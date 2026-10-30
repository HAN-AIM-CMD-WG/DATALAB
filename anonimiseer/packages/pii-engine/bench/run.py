"""Run detection systems over the benchmark documents.

For every system and document this writes bench/data/hits/<system>__<doc>.json
with the detections (start, end, category, label, score) and the analysis time.
Labels are mapped to one shared scope; everything outside it is dropped:
PERSON, ADDRESS, PHONE, EMAIL, BSN, IBAN.

Usage (see README.md for the environment):
    python bench/run.py anonimiseer bardsai-v3 gliner2-pii
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from heldout import DATA
from heldout import write as write_heldout

REPO = Path(__file__).resolve().parents[3]
HITS = DATA / "hits"
ENGINE_URL = os.environ.get("BENCH_ENGINE_URL", "http://127.0.0.1:8765")

Hit = dict[str, Any]


def documents() -> dict[str, str]:
    txt, _ = write_heldout()
    return {
        "heldout": txt.read_text(encoding="utf-8"),
        "devset": (REPO / "docs" / "examples" / "test-document.md").read_text(encoding="utf-8"),
    }


def save(system: str, doc: str, hits: list[Hit], seconds: float) -> None:
    HITS.mkdir(parents=True, exist_ok=True)
    payload = {"seconds": seconds, "hits": hits}
    (HITS / f"{system}__{doc}.json").write_text(json.dumps(payload, ensure_ascii=False))
    print(f"  {system:14} {doc:8} {len(hits):4} detections {seconds:7.1f}s", flush=True)


def windows(text: str, size: int = 1000, overlap: int = 200) -> list[tuple[int, str]]:
    """Overlapping chunks for models with a short input limit."""
    out, pos = [], 0
    while pos < len(text):
        out.append((pos, text[pos : pos + size]))
        pos += size - overlap
    return out


def trim(text: str, hits: list[Hit]) -> list[Hit]:
    for h in hits:
        while h["start"] < h["end"] and text[h["start"]].isspace():
            h["start"] += 1
        while h["end"] > h["start"] and text[h["end"] - 1].isspace():
            h["end"] -= 1
    return [h for h in hits if h["end"] > h["start"]]


def dedupe(hits: list[Hit]) -> list[Hit]:
    seen, out = set(), []
    for h in hits:
        key = (h["start"], h["end"], h["label"])
        if key not in seen:
            seen.add(key)
            out.append(h)
    return out


# --------------------------------------------------------------------- our engine

OURS = {
    "PERSON": "PERSON",
    "LOCATION": "ADDRESS",
    "NL_POSTCODE": "ADDRESS",
    "NL_PHONE_NUMBER": "PHONE",
    "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "NL_BSN": "BSN",
    "IBAN_CODE": "IBAN",
}


def run_anonimiseer(docs: dict[str, str]) -> None:
    """Our engine over HTTP, at the app's default sensitivity (0.50)."""
    import httpx

    for doc, text in docs.items():
        t0 = time.perf_counter()
        r = httpx.post(
            f"{ENGINE_URL}/analyze", json={"text": text, "score_threshold": 0.5}, timeout=600
        )
        r.raise_for_status()
        hits: list[Hit] = [
            {
                "start": h["start"],
                "end": h["end"],
                "label": h["entity_type"],
                "category": OURS[h["entity_type"]],
                "score": h["score"],
            }
            for h in r.json()["items"]
            if h["entity_type"] in OURS
        ]
        save("anonimiseer", doc, hits, time.perf_counter() - t0)


# --------------------------------------------------------- token-classification models

BARDSAI = {
    "PERSON_NAME": "PERSON",
    "POSTAL_ADDRESS": "ADDRESS",
    "LOCATION": "ADDRESS",
    "GEO_LOCATION": "ADDRESS",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "PERSON_IDENTIFIER": "BSN",
    "BANK_ACCOUNT_IDENTIFIER": "IBAN",
}
OPENAI_PF = {
    "private_person": "PERSON",
    "private_address": "ADDRESS",
    "private_phone": "PHONE",
    "private_email": "EMAIL",
    "account_number": "IBAN",
}


def run_bio(system: str, model_id: str, mapping: dict[str, str], docs: dict[str, str]) -> None:
    """B-/I- tagged model, run in chunks because of its 512-token input limit."""
    from transformers import pipeline

    clf = pipeline(
        "token-classification", model=model_id, aggregation_strategy="simple", device="cpu"
    )
    for doc, text in docs.items():
        t0 = time.perf_counter()
        hits: list[Hit] = []
        for offset, chunk in windows(text):
            for e in clf(chunk):
                label = e["entity_group"]
                if label in mapping:
                    hits.append(
                        {
                            "start": offset + e["start"],
                            "end": offset + e["end"],
                            "label": label,
                            "category": mapping[label],
                            "score": float(e["score"]),
                        }
                    )
        save(system, doc, trim(text, dedupe(hits)), time.perf_counter() - t0)


def bioes_spans(tokens: list[dict], mapping: dict[str, str]) -> list[Hit]:
    """Merge BIOES-tagged tokens into spans.

    transformers' built-in aggregation only knows B-/I-; with BIOES labels it
    splits a single name into separate fragments.
    """
    spans: list[dict] = []
    cur: dict | None = None
    for t in tokens:
        prefix, _, label = t["entity"].partition("-") if t["entity"] != "O" else ("O", "", "")
        if label not in mapping:
            cur = None
            continue
        continues = cur is not None and cur["label"] == label and t["start"] - cur["end"] <= 1
        if prefix in ("B", "S") or not continues:
            cur = {"start": t["start"], "end": t["end"], "label": label, "scores": [t["score"]]}
            spans.append(cur)
        else:
            cur["end"] = t["end"]
            cur["scores"].append(t["score"])
        if prefix in ("E", "S"):
            cur = None
    return [
        {
            "start": s["start"],
            "end": s["end"],
            "label": s["label"],
            "category": mapping[s["label"]],
            "score": float(min(s["scores"])),
        }
        for s in spans
    ]


def run_openai_pf(docs: dict[str, str]) -> None:
    """OpenAI Privacy Filter: BIOES labels, 128k context, so no chunking."""
    from transformers import pipeline

    clf = pipeline(
        "token-classification",
        model="openai/privacy-filter",
        aggregation_strategy="none",
        device="cpu",
    )
    for doc, text in docs.items():
        t0 = time.perf_counter()
        hits = trim(text, bioes_spans(clf(text), OPENAI_PF))
        save("openai-pf", doc, hits, time.perf_counter() - t0)


# ------------------------------------------------------------------------- GLiNER2

GLINER2_LABELS = {
    "person": "PERSON",
    "address": "ADDRESS",
    "street_address": "ADDRESS",
    "postal_code": "ADDRESS",
    "phone_number": "PHONE",
    "email": "EMAIL",
    "national_id_number": "BSN",
    "iban": "IBAN",
}


def run_gliner2(docs: dict[str, str], threshold: float = 0.3) -> None:
    from gliner2 import GLiNER2

    model = GLiNER2.from_pretrained("fastino/gliner2-privacy-filter-PII-multi")
    for doc, text in docs.items():
        t0 = time.perf_counter()
        hits: list[Hit] = []
        for offset, chunk in windows(text, size=1200):
            res = model.extract_entities(
                chunk,
                list(GLINER2_LABELS),
                threshold=threshold,
                include_spans=True,
                include_confidence=True,
            )
            for label, values in (res.get("entities") or {}).items():
                for v in values:
                    if isinstance(v, dict) and "start" in v:
                        hits.append(
                            {
                                "start": offset + v["start"],
                                "end": offset + v["end"],
                                "label": label,
                                "category": GLINER2_LABELS[label],
                                "score": float(v.get("confidence", 0)),
                            }
                        )
        save("gliner2-pii", doc, trim(text, dedupe(hits)), time.perf_counter() - t0)


SYSTEMS: dict[str, Callable[[dict[str, str]], None]] = {
    "anonimiseer": run_anonimiseer,
    "bardsai-v3": lambda d: run_bio(
        "bardsai-v3", "bardsai/eu-pii-anonimization-multilang-v3", BARDSAI, d
    ),
    "gliner2-pii": run_gliner2,
    "openai-pf": run_openai_pf,
}


if __name__ == "__main__":
    chosen = sys.argv[1:] or ["anonimiseer", "bardsai-v3", "gliner2-pii"]
    unknown = [s for s in chosen if s not in SYSTEMS]
    if unknown:
        raise SystemExit(f"unknown system(s): {unknown}; choose from {list(SYSTEMS)}")
    docs = documents()
    for name in chosen:
        SYSTEMS[name](docs)

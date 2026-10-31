"""Score every system in bench/data/hits the same way.

heldout: complete answer key -> recall, precision, F1, traps hit.
devset : our own gold set (docs/examples). Its key is not exhaustive, so only
         recall and traps are reported; precision would be unfair there.

A personal data item counts as found when at least 80% of its non-space
characters are covered by detections, whatever their category: for masking,
the label does not matter. Precision counts a detection as correct when it
overlaps any personal data item.

Usage:
    python bench/score.py               # tables plus per-system details
    python bench/score.py --markdown    # tables only, for docs/benchmarks.md
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any

from heldout import DATA
from run import HITS, REPO

DEV_DOC = REPO / "docs" / "examples" / "test-document.md"
DEV_GOLD = DEV_DOC.with_name("test-document.expected.jsonl")
DEV_SCOPE = {
    "PERSON": "PERSON",
    "LOCATION": "ADDRESS",
    "NL_POSTCODE": "ADDRESS",
    "NL_PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "NL_BSN": "BSN",
    "IBAN_CODE": "IBAN",
}
COVERAGE = 0.8


def occurrences(doc: str, fragment: str) -> list[tuple[int, int]]:
    pre = r"(?<!\w)" if fragment[:1].isalnum() else ""
    suf = r"(?!\w)" if fragment[-1:].isalnum() else ""
    return [(m.start(), m.end()) for m in re.finditer(pre + re.escape(fragment) + suf, doc)]


def load_gold() -> dict[str, dict[str, Any]]:
    held = json.loads((DATA / "heldout.gold.json").read_text(encoding="utf-8"))
    gold: dict[str, dict[str, Any]] = {
        "heldout": {
            "text": (DATA / "heldout.txt").read_text(encoding="utf-8"),
            "pii": [
                (s["start"], s["end"], s["category"], s["text"]) for s in held if s["kind"] == "pii"
            ],
            "traps": [
                (s["start"], s["end"], s["note"], s["text"]) for s in held if s["kind"] == "trap"
            ],
            "complete": True,
        }
    }
    dev_text = DEV_DOC.read_text(encoding="utf-8")
    pii, traps = [], []
    for line in DEV_GOLD.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        g = json.loads(line)
        for s, e in occurrences(dev_text, g["text"]):
            if g["should_match"] and g["type"] in DEV_SCOPE:
                pii.append((s, e, DEV_SCOPE[g["type"]], g["text"]))
            elif not g["should_match"]:
                traps.append((s, e, g.get("comment", ""), g["text"]))
    gold["devset"] = {"text": dev_text, "pii": pii, "traps": traps, "complete": False}
    return gold


def coverage(text: str, start: int, end: int, hits: list[dict[str, Any]]) -> float:
    covered = [False] * (end - start)
    for h in hits:
        for i in range(max(start, h["start"]), min(end, h["end"])):
            covered[i - start] = True
    idx = [i for i in range(end - start) if not text[start + i].isspace()]
    return sum(covered[i] for i in idx) / len(idx) if idx else 1.0


def overlaps(h: dict[str, Any], start: int, end: int) -> bool:
    return bool(h["start"] < end and start < h["end"])


def evaluate(g: dict[str, Any], hits: list[dict[str, Any]]) -> dict[str, Any]:
    text = g["text"]
    missed, per_cat = [], {}
    for s, e, cat, frag in g["pii"]:
        found = coverage(text, s, e, hits) >= COVERAGE
        per_cat.setdefault(cat, [0, 0])
        per_cat[cat][1] += 1
        if found:
            per_cat[cat][0] += 1
        else:
            missed.append(f"{frag} ({cat})")
    n_pii = len(g["pii"])
    trap_spans = {(s, e) for s, e, _, _ in g["traps"]}
    trap_hits = sorted(
        {
            f"{frag} — {note}"
            for s, e, note, frag in g["traps"]
            if any(overlaps(h, s, e) for h in hits)
        }
    )
    res: dict[str, Any] = {
        "recall": (n_pii - len(missed)) / n_pii,
        "missed": missed,
        "per_cat": per_cat,
        "trap_hits": trap_hits,
        "n_traps": len(trap_spans),
    }
    if g["complete"]:
        fps = [h for h in hits if not any(overlaps(h, s, e) for s, e, _, _ in g["pii"])]
        p = (len(hits) - len(fps)) / len(hits) if hits else 1.0
        r = res["recall"]
        res["precision"] = p
        res["f1"] = 2 * p * r / (p + r) if p + r else 0.0
        res["fps"] = sorted({f"{text[h['start'] : h['end']]!r}→{h['label']}" for h in fps})
    return res


def load_hits(system: str, doc: str) -> tuple[list[dict[str, Any]], float] | None:
    f = HITS / f"{system}__{doc}.json"
    if not f.exists():
        return None
    d = json.loads(f.read_text())
    return d["hits"], d["seconds"]


def main(markdown: bool) -> None:
    gold = load_gold()
    systems = sorted({p.name.split("__")[0] for p in HITS.glob("*.json")})
    for doc in ("heldout", "devset"):
        g = gold[doc]
        rows = [(s, *loaded) for s in systems if (loaded := load_hits(s, doc))]
        ours = load_hits("anonimiseer", doc)
        if ours:
            for s in systems:
                other = load_hits(s, doc)
                if not s.startswith("anonimiseer") and other:
                    rows.append((f"anonimiseer + {s}", ours[0] + other[0], ours[1] + other[1]))
        n_traps = len({(s, e) for s, e, _, _ in g["traps"]})
        print(f"\n### {doc}: {len(g['pii'])} personal data items, {n_traps} traps\n")
        cols = (
            ["System", "Recall"]
            + (["Precision", "F1"] if g["complete"] else [])
            + ["Traps hit", "Time"]
        )
        print("| " + " | ".join(cols) + " |")
        print("|" + "---|" * len(cols))
        details = []
        for name, hits, secs in rows:
            r = evaluate(g, hits)
            cells = [name, f"{r['recall']:.1%}"]
            if g["complete"]:
                cells += [f"{r['precision']:.1%}", f"{r['f1']:.3f}"]
            cells += [f"{len(r['trap_hits'])}/{r['n_traps']}", f"{secs:.1f} s"]
            print("| " + " | ".join(cells) + " |")
            details.append((name, r))
        if markdown or doc != "heldout":
            continue
        for name, r in details:
            if "+" in name:
                continue
            print(f"\n--- {name}")
            print("  per category:", {k: f"{v[0]}/{v[1]}" for k, v in sorted(r["per_cat"].items())})
            print("  missed:", r["missed"] or "nothing")
            print("  traps hit:", r["trap_hits"] or "none")
            print(f"  false positives ({len(r['fps'])}):", r["fps"][:14])


if __name__ == "__main__":
    main(markdown="--markdown" in sys.argv)

"""Regressie-scoring van de detectie tegen de gouden testset.

Stuurt ``docs/examples/test-document.md`` door een lopende engine en
vergelijkt de treffers met ``test-document.expected.jsonl``. Bedoeld als
**dev-tool** en release-poort: draait er iets stuk in de recognizers of in
``postfilter.py``, dan zakt de recall of vallen er negatieve gevallen om.

De gouden set annoteert geen offsets maar tekst-fragmenten. Per regel:

    {"text": "Fatima El Amrani", "type": "PERSON", "should_match": true}

* ``should_match: true``  — elk voorkomen van ``text`` in het document moet
  door een treffer van ``type`` afgedekt worden.
* ``should_match: false`` — er mag géén treffer van ``type`` over dat
  fragment liggen. Dit zijn de bewuste valkuilen (veldlabels, HTTP-codes,
  versienummers) uit sectie 10 van het testdocument.
* ``tolerant: true``      — afgedekt zijn telt, ongeacht welk label de
  engine eraan hing. Voor gevallen waar het label discutabel is
  (``P. de Vries`` als PERSON of als initialen).

Gebruik::

    # Engine alvast draaien met het aanbevolen profiel:
    PII_ENGINE_ENABLE_BSN=true PII_ENGINE_ENABLE_SONAR=true pii-engine &

    python scripts/score.py
    python scripts/score.py --threshold 0.5 --fail-under 0.98
    python scripts/score.py --json          # machine-leesbaar, voor CI
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DOCUMENT = REPO_ROOT / "docs" / "examples" / "test-document.md"
DEFAULT_EXPECTED = REPO_ROOT / "docs" / "examples" / "test-document.expected.jsonl"
DEFAULT_URL = "http://127.0.0.1:8765"


@dataclass(frozen=True)
class GoldEntry:
    """Eén regel uit de ``.expected.jsonl``."""

    text: str
    entity_type: str
    should_match: bool
    tolerant: bool = False
    comment: str = ""

    @property
    def label(self) -> str:
        suffix = f" — {self.comment}" if self.comment else ""
        return f"{self.text!r} ({self.entity_type}){suffix}"


@dataclass(frozen=True)
class Hit:
    """Eén treffer uit ``/analyze``."""

    entity_type: str
    start: int
    end: int
    score: float
    original: str

    def overlaps(self, start: int, end: int) -> bool:
        return self.start < end and start < self.end


@dataclass
class EntryResult:
    entry: GoldEntry
    occurrences: int = 0
    hits_ok: int = 0
    #: Voorkomens die wél afgedekt zijn, maar met een ander entiteitstype.
    wrong_type: list[str] = field(default_factory=list)
    #: Voorkomens die helemaal niet gevonden zijn.
    missed: int = 0


def load_gold(path: Path) -> list[GoldEntry]:
    entries: list[GoldEntry] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{lineno}: ongeldige JSON — {exc}") from exc
        entries.append(
            GoldEntry(
                text=raw["text"],
                entity_type=raw["type"],
                should_match=bool(raw["should_match"]),
                tolerant=bool(raw.get("tolerant", False)),
                comment=raw.get("comment", ""),
            )
        )
    return entries


def find_occurrences(document: str, fragment: str) -> list[tuple[int, int]]:
    """Alle voorkomens van ``fragment``, op woordgrenzen waar dat kan.

    Zonder grenzen zou ``Jan`` ook binnen ``Janssen`` raak zijn en zouden
    korte negatieve gevallen (``BIC``, ``404``) vals alarm geven.
    """
    prefix = r"(?<!\w)" if fragment[:1].isalnum() else ""
    suffix = r"(?!\w)" if fragment[-1:].isalnum() else ""
    pattern = re.compile(prefix + re.escape(fragment) + suffix)
    return [(m.start(), m.end()) for m in pattern.finditer(document)]


def analyze(url: str, document: str, threshold: float | None, timeout: float) -> list[Hit]:
    payload: dict[str, Any] = {"text": document, "language": "nl"}
    if threshold is not None:
        payload["score_threshold"] = threshold
    try:
        response = httpx.post(f"{url}/analyze", json=payload, timeout=timeout)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SystemExit(
            f"Engine op {url} niet bereikbaar of gaf een fout: {exc}\n"
            "Start hem eerst:  PII_ENGINE_ENABLE_SONAR=true pii-engine &"
        ) from exc
    return [Hit(**item) for item in response.json()["items"]]


def engine_description(url: str, timeout: float) -> str:
    try:
        active = httpx.get(f"{url}/engine/active", timeout=timeout).json()
    except (httpx.HTTPError, ValueError):
        return url
    sonar = "SoNaR aan" if active.get("sonar_enabled") else "SoNaR uit"
    han = "HAN-profiel aan" if active.get("han_edu_enabled") else "HAN-profiel uit"
    return (
        f"{active.get('spacy_model', '?')}, {sonar}, {han}, "
        f"{len(active.get('recognizers', []))} recognizers, "
        f"drempel {active.get('score_threshold')}"
    )


def score_positives(
    document: str, gold: list[GoldEntry], hits: list[Hit]
) -> tuple[list[EntryResult], set[int]]:
    """Scoor de positieve gevallen; geef ook terug welke hits gebruikt zijn."""
    results: list[EntryResult] = []
    used: set[int] = set()

    for entry in gold:
        result = EntryResult(entry=entry)
        for start, end in find_occurrences(document, entry.text):
            result.occurrences += 1
            overlapping = [(i, h) for i, h in enumerate(hits) if h.overlaps(start, end)]
            used.update(i for i, _ in overlapping)
            correct = [h for _, h in overlapping if h.entity_type == entry.entity_type]
            if correct or (entry.tolerant and overlapping):
                result.hits_ok += 1
            elif overlapping:
                result.wrong_type.append(overlapping[0][1].entity_type)
            else:
                result.missed += 1
        results.append(result)

    return results, used


def score_negatives(document: str, gold: list[GoldEntry], hits: list[Hit]) -> list[EntryResult]:
    """Een negatief geval faalt zodra er een treffer van dát type overheen ligt."""
    results: list[EntryResult] = []
    for entry in gold:
        result = EntryResult(entry=entry)
        for start, end in find_occurrences(document, entry.text):
            result.occurrences += 1
            if any(h.overlaps(start, end) and h.entity_type == entry.entity_type for h in hits):
                result.missed += 1
            else:
                result.hits_ok += 1
        results.append(result)
    return results


def build_report(document: str, gold: list[GoldEntry], hits: list[Hit]) -> dict[str, Any]:
    positives = [e for e in gold if e.should_match]
    negatives = [e for e in gold if not e.should_match]

    pos_results, used = score_positives(document, positives, hits)
    neg_results = score_negatives(document, negatives, hits)

    pos_total = sum(r.occurrences for r in pos_results)
    pos_ok = sum(r.hits_ok for r in pos_results)
    neg_total = sum(r.occurrences for r in neg_results)
    neg_ok = sum(r.hits_ok for r in neg_results)

    unmatched = [h for i, h in enumerate(hits) if i not in used]

    return {
        "recall": pos_ok / pos_total if pos_total else 1.0,
        "specificity": neg_ok / neg_total if neg_total else 1.0,
        "positives": {"ok": pos_ok, "total": pos_total},
        "negatives": {"ok": neg_ok, "total": neg_total},
        "hits": len(hits),
        "missed": [{"entry": r.entry.label, "count": r.missed} for r in pos_results if r.missed],
        "wrong_type": [
            {"entry": r.entry.label, "got": r.wrong_type} for r in pos_results if r.wrong_type
        ],
        "false_positives": [
            {"entry": r.entry.label, "count": r.missed} for r in neg_results if r.missed
        ],
        "unlisted": [
            {"text": h.original, "type": h.entity_type, "score": round(h.score, 2)}
            for h in unmatched
        ],
    }


def print_report(report: dict[str, Any], engine: str, show_unlisted: int) -> None:
    pos, neg = report["positives"], report["negatives"]
    print(f"Engine: {engine}")
    print(f"Treffers in document: {report['hits']}\n")
    print(f"Recall           {pos['ok']:>4}/{pos['total']:<4} {report['recall']:>7.1%}")
    print(
        f"Negatieve set    {neg['ok']:>4}/{neg['total']:<4} {report['specificity']:>7.1%}"
        "   (bewuste valkuilen correct genegeerd)"
    )

    if report["missed"]:
        print(f"\nGemist ({sum(m['count'] for m in report['missed'])}x):")
        for item in report["missed"]:
            times = f" [{item['count']}x]" if item["count"] > 1 else ""
            print(f"  · {item['entry']}{times}")

    if report["wrong_type"]:
        print(f"\nAfgedekt maar verkeerd gelabeld ({len(report['wrong_type'])}):")
        for item in report["wrong_type"]:
            print(f"  · {item['entry']} → kreeg {', '.join(item['got'])}")

    if report["false_positives"]:
        print(f"\nVals-positief op negatieve gevallen ({len(report['false_positives'])}):")
        for item in report["false_positives"]:
            print(f"  · {item['entry']}")

    if report["unlisted"] and show_unlisted:
        shown = report["unlisted"][:show_unlisted]
        print(f"\nTreffers die niet in de gouden set staan ({len(report['unlisted'])}):")
        for item in shown:
            print(f"  · {item['text']!r} ({item['type']}, {item['score']})")
        if len(report["unlisted"]) > len(shown):
            print(f"  … en {len(report['unlisted']) - len(shown)} meer (--unlisted 0 verbergt dit)")
        print("  Dit zijn kandidaat-false-positives óf gaten in de gouden set.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--document", type=Path, default=DEFAULT_DOCUMENT)
    parser.add_argument("--expected", type=Path, default=DEFAULT_EXPECTED)
    parser.add_argument("--url", default=DEFAULT_URL, help=f"Engine-URL (default {DEFAULT_URL})")
    parser.add_argument("--threshold", type=float, default=None, help="Override score_threshold.")
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--unlisted",
        type=int,
        default=15,
        help="Hoeveel niet-geannoteerde treffers tonen (0 = geen).",
    )
    parser.add_argument(
        "--fail-under",
        type=float,
        default=None,
        help="Exit-code 1 als recall óf negatieve-set-score hieronder zakt (0.0–1.0).",
    )
    parser.add_argument("--json", action="store_true", help="Print het rapport als JSON.")
    args = parser.parse_args()

    for path in (args.document, args.expected):
        if not path.is_file():
            raise SystemExit(f"Niet gevonden: {path}")

    document = args.document.read_text(encoding="utf-8")
    gold = load_gold(args.expected)
    hits = analyze(args.url, document, args.threshold, args.timeout)
    report = build_report(document, gold, hits)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report, engine_description(args.url, args.timeout), args.unlisted)

    if args.fail_under is not None:
        worst = min(report["recall"], report["specificity"])
        if worst < args.fail_under:
            print(f"\nFAIL: {worst:.1%} < drempel {args.fail_under:.1%}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

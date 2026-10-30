"""Can a GLiNER2 model find concepts that are in no PII training set?

Organisation profiles let users add their own concepts ("dossiernummer",
"projectcode"). This checks per model whether such labels work at all, and
whether near-synonyms ("dossiernummer" vs "contractnummer") stay apart.
The text is invented.

Usage:
    python bench/custom_labels.py fastino/gliner2-multi-v1 [threshold]
"""

from __future__ import annotations

import sys
import time

TEXT = """
Betreft dossiernummer DS-2026-11873 en polisnummer PN 4471-2290, klantnummer 0048211.
Mevrouw E. Willemsen meldde op 2 september schade aan haar woning. De afhandeling loopt
via projectcode PRJ-ALFA-07 en valt onder contractnummer C-2026/3318 met leverancier
Noordlicht BV. Behandelaar is Jesse Koster; hij stemt af met Priya Raghunathan van de
afdeling schadebeheer. Het aanvraagformulier vermeldt de velden dossiernummer, polisnummer
en klantnummer.
"""

EXPECTED = {
    "dossiernummer": {"DS-2026-11873"},
    "polisnummer": {"PN 4471-2290"},
    "klantnummer": {"0048211"},
    "projectcode": {"PRJ-ALFA-07"},
    "contractnummer": {"C-2026/3318"},
    "person": {"E. Willemsen", "Jesse Koster", "Priya Raghunathan"},
    "organization": {"Noordlicht BV"},
}


def main(model_id: str, threshold: float) -> None:
    from gliner2 import GLiNER2

    model = GLiNER2.from_pretrained(model_id)
    t0 = time.perf_counter()
    res = model.extract_entities(TEXT, list(EXPECTED), threshold=threshold, include_confidence=True)
    seconds = time.perf_counter() - t0
    found_total = expected_total = wrong_total = 0
    print(f"\n{model_id} @ {threshold} ({seconds:.1f}s)")
    for label, expected in EXPECTED.items():
        got = [
            (
                v["text"] if isinstance(v, dict) else str(v),
                float(v.get("confidence", 0)) if isinstance(v, dict) else 0.0,
            )
            for v in (res.get("entities") or {}).get(label, [])
        ]
        hit = {e for e in expected if any(e in t or t.strip() in e for t, _ in got if t.strip())}
        wrong = [t for t, _ in got if not any(e in t or t.strip() in e for e in expected)]
        found_total += len(hit)
        expected_total += len(expected)
        wrong_total += len(wrong)
        shown = ", ".join(f"{t!r} ({s:.2f})" for t, s in got) or "-"
        print(f"  {label:15} {len(hit)}/{len(expected)}  {shown}")
    print(f"  TOTAL found {found_total}/{expected_total}, wrong {wrong_total}")


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.5)

"""Anonymizer-laag: mapt Presidio-analyzerresultaten naar twee modi.

- **Redact**: vervangt door een leesbaar label ``[TYPE]``.
- **Pseudonymize**: vervangt door een stabiele pseudoniem-token
  (``TYPE_1``, ``TYPE_2``, ...) die consistent is binnen één run. De mapping
  wordt teruggegeven zodat de frontend deze (encrypted) kan bewaren voor
  latere deanonimisering.

Beide modi gebruiken dezelfde in-place offset-stabiele vervanging om
overlap-conflicten deterministisch op te lossen.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from presidio_analyzer import RecognizerResult

__all__ = [
    "AnonymizationMode",
    "AnonymizationResult",
    "PseudonymMapping",
    "anonymize_with_mode",
]

AnonymizationMode = Literal["redact", "pseudonymize"]


@dataclass
class PseudonymMapping:
    """Stabiele mapping van originele string → pseudoniem, per entiteitstype.

    Lookup gebeurt case-insensitief (``Jan`` en ``jan`` delen één pseudoniem),
    maar we rapporteren de *oorspronkelijke* schrijfwijze van het eerst geziene
    voorkomen terug in ``as_public_dict``. Zo kan de frontend bijvoorbeeld
    ``6811 AA`` tonen en niet ``6811 aa``.
    """

    counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    # (entity_type, text.casefold()) → pseudonym-token
    mapping: dict[tuple[str, str], str] = field(default_factory=dict)
    # pseudonym-token → eerste geziene originele schrijfwijze
    _originals: dict[str, str] = field(default_factory=dict)

    def pseudonym_for(self, entity_type: str, text: str) -> str:
        key = (entity_type, text.casefold())
        if key in self.mapping:
            return self.mapping[key]
        self.counters[entity_type] += 1
        token = f"{entity_type}_{self.counters[entity_type]}"
        self.mapping[key] = token
        self._originals[token] = text
        return token

    def as_public_dict(self) -> list[dict[str, str]]:
        """Serializable weergave voor de API-response.

        Rapporteert per pseudoniem het originele tekstfragment met de
        oorspronkelijke casing.
        """

        result: list[dict[str, str]] = []
        for (etype, _casefolded), pseudonym in self.mapping.items():
            original = self._originals.get(pseudonym, _casefolded)
            result.append(
                {"entity_type": etype, "original": original, "pseudonym": pseudonym}
            )
        return result


@dataclass
class AnonymizationResult:
    """Gestructureerd resultaat voor de API/SDK."""

    text: str
    items: list[dict[str, object]]
    mapping: list[dict[str, str]] | None = None


def _dedupe_overlapping(results: list[RecognizerResult]) -> list[RecognizerResult]:
    """Los overlap op door score desc + start asc; hoogste score wint.

    We sorteren op ``(start asc, score desc)`` en gooien daarna alles weg wat
    binnen een al geaccepteerde span valt of ermee overlapt.
    """

    ordered = sorted(results, key=lambda r: (r.start, -r.score))
    kept: list[RecognizerResult] = []
    last_end = -1
    for r in ordered:
        if r.start >= last_end:
            kept.append(r)
            last_end = r.end
    return kept


def _replace_spans(
    text: str,
    results: list[RecognizerResult],
    replacement: Callable[[str, RecognizerResult], str],
) -> tuple[str, list[dict[str, object]]]:
    """Vervang spans van achter naar voor om offsets stabiel te houden."""

    kept = _dedupe_overlapping(results)
    new_text = text
    items: list[dict[str, object]] = []
    for r in sorted(kept, key=lambda r: r.start, reverse=True):
        original = new_text[r.start : r.end]
        token = replacement(original, r)
        new_text = new_text[: r.start] + token + new_text[r.end :]
        items.append(
            {
                "entity_type": r.entity_type,
                "original": original,
                "pseudonym": token if token.startswith(f"{r.entity_type}_") else None,
                "start": r.start,
                "end": r.end,
                "score": round(r.score, 3),
            }
        )
    items.reverse()
    return new_text, items


def anonymize_with_mode(
    text: str,
    results: list[RecognizerResult],
    mode: AnonymizationMode = "pseudonymize",
    mapping: PseudonymMapping | None = None,
) -> AnonymizationResult:
    """Anonimiseer of pseudonimiseer een tekst op basis van analyzerresultaten.

    Args:
        text: Originele tekst.
        results: Output van ``AnalyzerEngine.analyze``.
        mode: ``redact`` → ``[TYPE]`` placeholder; ``pseudonymize`` → stabiele
            pseudoniemen met mapping in response.
        mapping: Optionele bestaande mapping om cross-document consistent te
            blijven. Als ``None`` wordt een verse mapping aangemaakt.
    """

    if mode == "redact":
        new_text, items = _replace_spans(
            text, results, replacement=lambda _orig, r: f"[{r.entity_type}]"
        )
        return AnonymizationResult(text=new_text, items=items, mapping=None)

    mapping = mapping or PseudonymMapping()
    new_text, items = _replace_spans(
        text,
        results,
        replacement=lambda original, r: mapping.pseudonym_for(r.entity_type, original),
    )
    return AnonymizationResult(text=new_text, items=items, mapping=mapping.as_public_dict())

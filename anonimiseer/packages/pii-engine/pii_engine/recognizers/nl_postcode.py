"""Nederlandse postcode-recognizer.

Formaat: ``1234 AB`` of ``1234AB``. Het eerste cijfer mag geen 0 zijn. De
lettercombinaties ``SA``, ``SD`` en ``SS`` worden niet uitgegeven; die sluiten
we uit om false positives op onzinstrings als "1234 SS" te beperken.

Belangrijk: een Nederlandse postcode-letter is **altijd hoofdletter**.
Presidio compileert patroon-regexes case-insensitief, dus ``1985 in``
matcht zonder extra check. We valideren in :meth:`analyze` dat de
laatste twee karakters daadwerkelijk uppercase zijn.

A number with two capitals is often not a postcode at all ("1600 MB",
"2400 GB opslag"). Only a match with address context (a context word nearby,
a street and house number before it, or a place name after it) gets the full
score. Without context it scores lower, so the strict sensitivity leaves it
visible as a doubtful case; if its letters are a unit, it is dropped.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["NlPostcodeRecognizer"]

_CONTEXT = ["postcode", "adres", "woonadres", "woonplaats", "pc"]

# Let op: we sluiten SA/SD/SS expliciet uit via een negative lookahead
# onmiddellijk na de vier cijfers (met optionele spatie).
_POSTCODE = r"\b[1-9][0-9]{3}\s?(?!SA\b|SD\b|SS\b)[A-Z]{2}\b"

# "pc" is left out on purpose: in IT texts it means a computer.
_CONTEXT_BEFORE_RE = re.compile(
    r"\b(?:post|woon|bezoek|aflever|correspondentie|vestigings)?adres\b|\bpostcode\b|\bwoonplaats\b",
    re.IGNORECASE,
)
_CONTEXT_WINDOW = 80
_STREET_BEFORE_RE = re.compile(
    r"[A-Za-zÀ-ÿ]{3,}\.?\s+\d{1,5}(?:[-/ ]?[A-Za-z0-9]{1,4})?\s*[,(]?\s*$"
)
_PLACE_AFTER_RE = re.compile(r"^[ \t]*,?[ \t]*(?:'s-|'t\s|[A-Z][a-zà-ÿ]|[A-Z]{4,}\b)")
_UNIT_LETTERS = frozenset(
    {"KB", "MB", "GB", "TB", "PB", "KW", "MW", "GW", "KV", "KG", "MG", "ML", "CL", "DL", "KM"}
    | {"CM", "MM", "PK", "CC", "BC", "AD", "AM", "PM"}
)


def _has_address_context(text: str, start: int, end: int) -> bool:
    if _CONTEXT_BEFORE_RE.search(text[max(0, start - _CONTEXT_WINDOW) : start]):
        return True
    line_before = text[max(0, start - 60) : start].rsplit("\n", 1)[-1]
    if _STREET_BEFORE_RE.search(line_before):
        return True
    line_after = text[end : end + 40].split("\n", 1)[0]
    return bool(_PLACE_AFTER_RE.match(line_after))


class NlPostcodeRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85
    NO_CONTEXT_SCORE: ClassVar[float] = 0.55

    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_postcode", regex=_POSTCODE, score=0.5),
        ]
        super().__init__(
            supported_entity="NL_POSTCODE",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            raw = text[r.start : r.end]
            # De laatste twee karakters moeten hoofdletters zijn (NL spec).
            # Filtert "1985 in" en "1234 ab" weg.
            if not raw[-2:].isupper():
                continue
            if _has_address_context(text, r.start, r.end):
                r.score = max(r.score, self.DEFAULT_SCORE)
            elif raw[-2:] in _UNIT_LETTERS:
                continue
            else:
                r.score = max(r.score, self.NO_CONTEXT_SCORE)
            validated.append(r)
        return validated

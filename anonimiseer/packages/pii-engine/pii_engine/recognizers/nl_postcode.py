"""Nederlandse postcode-recognizer.

Formaat: ``1234 AB`` of ``1234AB``. Het eerste cijfer mag geen 0 zijn. De
lettercombinaties ``SA``, ``SD`` en ``SS`` worden niet uitgegeven; die sluiten
we uit om false positives op onzinstrings als "1234 SS" te beperken.

Belangrijk: een Nederlandse postcode-letter is **altijd hoofdletter**.
Presidio compileert patroon-regexes case-insensitief, dus ``1985 in``
matcht zonder extra check. We valideren in :meth:`analyze` dat de
laatste twee karakters daadwerkelijk uppercase zijn.
"""

from __future__ import annotations

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


class NlPostcodeRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85

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
            r.score = max(r.score, self.DEFAULT_SCORE)
            validated.append(r)
        return validated

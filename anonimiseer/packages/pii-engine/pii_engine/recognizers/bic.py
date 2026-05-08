"""BIC- (SWIFT-)code recognizer.

BIC / SWIFT is 8 of 11 tekens:

    BBBB CC LL [XXX]

    - 4 letters bankcode
    - 2 letters landcode (ISO 3166)
    - 2 letters/cijfers locatie
    - 3 optionele tekens (filiaal)

Zonder context wordt dit vaak verward met een organisatie of locatie
(``ABNANL2A`` bevat ``NL`` dus spaCy ziet 'm soms als NL-organisatie).
We eisen óf de letters "BIC"/"SWIFT" in de buurt, óf een IBAN binnen
een klein venster — dan weten we dat het om bank-/betaaldata gaat.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["BicRecognizer"]


_BIC_MARKERS = (
    "bic",
    "bic:",
    "bic-code",
    "swift",
    "swift-code",
    "swiftcode",
    "swift:",
    "sepa",
)

# 8 of 11 tekens totaal. Presidio is case-insensitief; we valideren
# uppercase in ``analyze``.
_BIC_REGEX = r"\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b"

# IBAN-regex om te detecteren of er binnen een klein venster een IBAN
# staat (dan is een BIC naast 'm zeer waarschijnlijk een BIC). We
# gebruiken een losse versie (geen checksum) voor snelheid.
_NEARBY_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")


class BicRecognizer(PatternRecognizer):
    """BIC/SWIFT-code; eis BIC/SWIFT-label of naburige IBAN."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="BIC_CODE",
            patterns=[Pattern(name="bic", regex=_BIC_REGEX, score=0.2)],
            context=list(_BIC_MARKERS),
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
            # Hard vereist: uppercase tekens. Presidio's regex-compilatie
            # is case-insensitief; ``abnanl2a`` moet dus niet matchen.
            if any(c.isalpha() and c.islower() for c in raw):
                continue
            # Minstens één cijfer of minstens 11 chars om te onderscheiden
            # van random 8-letter woorden; BIC's bevatten bijna altijd
            # cijfers in de location-posities.
            context_window_start = max(0, r.start - 60)
            context_window_end = min(len(text), r.end + 60)
            window = text[context_window_start:context_window_end].lower()
            has_marker = any(m.lower() in window for m in _BIC_MARKERS)
            has_iban = bool(_NEARBY_IBAN.search(text, context_window_start, context_window_end))
            if not (has_marker or has_iban):
                continue
            r.score = self.DEFAULT_SCORE
            r.analysis_explanation = AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=self.DEFAULT_SCORE,
                pattern_name="bic_code",
                pattern=_BIC_REGEX,
                validation_result=True,
                textual_explanation=(
                    "BIC/SWIFT-patroon (8/11 uppercase alfanum) met label of IBAN ernaast."
                ),
            )
            validated.append(r)
        return validated

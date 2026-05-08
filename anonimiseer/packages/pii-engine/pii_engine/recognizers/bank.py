"""Bank-naam-recognizer (NL/BE).

spaCy NER pakt grote/internationale bankenamen wisselend op (``ING``,
``Commerzbank`` lukt vaak; ``ABN AMRO``, ``Rabobank``, ``Belfius`` niet
altijd, vooral binnen markdown-tabellen). Deze recognizer levert een
deterministische dictionary-match op de meest voorkomende NL/BE-banken
zodat ze altijd als ``ORGANIZATION`` worden herkend.

We blijven bewust beperkt tot daadwerkelijke bankinstellingen — geen
fintech-merken zonder banklicentie — om false positives op
algemene woorden te voorkomen.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["BankNameRecognizer", "BANK_NAMES"]


# Multi-word entries staan vóór single-word zodat we bij overlap de
# langere variant pakken (bv. ``ABN AMRO`` boven ``ABN``).
BANK_NAMES: tuple[str, ...] = (
    # NL — universele banken
    "ABN AMRO",
    "ING Bank",
    "ING",
    "Rabobank",
    "Triodos Bank",
    "Triodos",
    "SNS Bank",
    "SNS",
    "ASN Bank",
    "ASN",
    "Bunq",
    "Knab",
    "RegioBank",
    "Volksbank",
    "Van Lanschot",
    "NIBC",
    "NIBC Bank",
    # BE
    "Belfius",
    "KBC",
    "BNP Paribas Fortis",
    "BNP Paribas",
    "Argenta",
    "Beobank",
    "AXA Bank",
    "Crelan",
    # DE / overig veel voorkomend in NL-stukken
    "Commerzbank",
    "Deutsche Bank",
    "Sparkasse",
    "Volksbank Bremen",
    "DKB",
    # Internationaal-zakelijk
    "Citibank",
    "HSBC",
    "Barclays",
    "Santander",
    "BNP Paribas",
)


def _build_pattern(names: tuple[str, ...]) -> re.Pattern[str]:
    # Sorteer aflopend op lengte zodat de langste alternatief het eerst
    # gematcht wordt (regex alternation is left-to-right).
    sorted_names = sorted(set(names), key=len, reverse=True)
    escaped = [re.escape(n) for n in sorted_names]
    pattern = r"(?<![A-Za-zÀ-ÿ])(?:" + "|".join(escaped) + r")(?![A-Za-zÀ-ÿ])"
    return re.compile(pattern)


_BANK_REGEX = _build_pattern(BANK_NAMES)


class BankNameRecognizer(EntityRecognizer):
    """Dictionary-match op bekende NL/BE bankinstellingen → ``ORGANIZATION``."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["ORGANIZATION"],
            name="BankNameRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:  # noqa: D401 - Presidio interface
        """Geen externe assets nodig."""

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "ORGANIZATION" not in entities:
            return []
        out: list[RecognizerResult] = []
        for m in _BANK_REGEX.finditer(text):
            out.append(
                RecognizerResult(
                    entity_type="ORGANIZATION",
                    start=m.start(),
                    end=m.end(),
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="bank_dict",
                        pattern="",
                        validation_result=True,
                        textual_explanation=(
                            "Dictionary-match op bekende NL/BE bank-instelling."
                        ),
                    ),
                )
            )
        return out

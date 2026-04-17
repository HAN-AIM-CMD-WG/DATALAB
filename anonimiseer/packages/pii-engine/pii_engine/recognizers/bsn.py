"""Burgerservicenummer-recognizer met Elfproef-validatie.

De Elfproef voor het BSN (zie Rijksoverheid specificatie): voor een BSN
``c_1 c_2 ... c_9`` is het nummer geldig wanneer

    9*c1 + 8*c2 + 7*c3 + 6*c4 + 5*c5 + 4*c6 + 3*c7 + 2*c8 - 1*c9  ==  0  (mod 11)

Nummers van 8 cijfers worden voor de berekening voorafgegaan door een 0.
``000000000`` is uitgesloten om trivial false positives te voorkomen. Nummers
met meer dan 9 cijfers worden afgewezen, net als nummers met alleen maar
dezelfde cijfers.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["BsnRecognizer", "is_valid_bsn"]


_BSN_CONTEXT = [
    "bsn",
    "burgerservicenummer",
    "burgerservice",
    "sofinummer",  # verouderde benaming, nog steeds in gebruik
    "sofi-nummer",
    "rijksregisternr",  # voor de zekerheid (BE), wordt alsnog door Elfproef afgewezen
]

# 8 of 9 cijfers, eventueel met spaties/punten/streepjes tussen blokken.
# We vangen in de pattern alle plausibele layouts en normaliseren daarna.
_BSN_PATTERN = r"\b(?:\d[\s.\-]?){7,8}\d\b"


def is_valid_bsn(candidate: str) -> bool:
    """Controleer of een string een geldig BSN is volgens de Elfproef.

    Args:
        candidate: Ruwe string, mag spaties/punten/streepjes bevatten.

    Returns:
        ``True`` als het genormaliseerde nummer 8 of 9 cijfers heeft en aan de
        Elfproef voldoet, anders ``False``.
    """

    digits = re.sub(r"\D", "", candidate)
    if len(digits) == 8:
        digits = "0" + digits
    if len(digits) != 9:
        return False
    if digits == "000000000":
        return False
    # Triviaal zelfde-cijfer afwijzen (111111111, 222222222, ...).
    # Expliciet check omdat sommige patronen de Elfproef-check kunnen passeren.
    if len(set(digits)) == 1:
        return False

    weights = (9, 8, 7, 6, 5, 4, 3, 2, -1)
    total = sum(int(d) * w for d, w in zip(digits, weights, strict=True))
    return total % 11 == 0


class BsnRecognizer(PatternRecognizer):
    """Presidio-recognizer die kandidaten matcht op regex en filtert op Elfproef.

    We erven van ``PatternRecognizer`` voor de regex-matching maar overriden
    :meth:`analyze` om elke match door :func:`is_valid_bsn` te halen. Geldige
    matches krijgen ``score = 1.0`` (checksum-gevalideerd); niet-valide matches
    worden volledig verworpen.
    """

    DEFAULT_SCORE: ClassVar[float] = 1.0
    LOW_SCORE_WITHOUT_CONTEXT: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(
                name="bsn_elfproef",
                regex=_BSN_PATTERN,
                score=0.3,  # pre-validatie score; we overschrijven na Elfproef
            ),
        ]
        super().__init__(
            supported_entity="NL_BSN",
            patterns=patterns,
            context=_BSN_CONTEXT,
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
            text,
            entities or self.supported_entities,
            nlp_artifacts,
            regex_flags,
        )
        validated: list[RecognizerResult] = []
        for r in results:
            raw = text[r.start : r.end]
            if not is_valid_bsn(raw):
                continue
            r.score = self.DEFAULT_SCORE
            explanation = AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=r.score,
                pattern_name="bsn_elfproef",
                pattern=_BSN_PATTERN,
                validation_result=True,
                textual_explanation="Elfproef-checksum geldig.",
            )
            r.analysis_explanation = explanation
            validated.append(r)
        return validated


# Type-guard voor linters: we willen expliciet dat PatternRecognizer als basis
# erkend wordt.
assert issubclass(BsnRecognizer, EntityRecognizer)

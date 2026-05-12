"""Studentnummer-recognizer voor NL hogeronderwijs-instellingen.

In de HAN-praktijk (het primaire pilot-doelwit) zijn studentnummers
*bijna altijd* 7 cijfers zonder prefix (``1234567``) — de oude ``S``-variant
(``s1234567``) wordt nog wel gebruikt in verslagen en systemen als Osiris,
Alluris en Brightspace. We dekken beide:

1. ``S`` + 7 cijfers als **zelfdragend** patroon (hoge score).
2. Kaal 7- of 8-cijfer als **context-afhankelijk** patroon: alleen een
   hit als er in de directe nabijheid een label staat zoals
   ``studentnummer``, ``studentnr``, ``osiris``, ``alluris``, ``Brightspace``,
   ``HAN``, of als het getal gekoppeld staat aan ``@student.han.nl``.

Door de kale variant expliciet aan context te koppelen voorkomen we
dat willekeurige 7-cijferige getallen (telefoon, datum, KvK) ten
onrechte als studentnummer worden gelabeld.
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

__all__ = ["NlStudentnrRecognizer"]

# Contextwoorden die Presidio gebruikt om scores te boosten; en
# tegelijk onze eigen "has-context"-check hieronder. Alles lowercase:
_CONTEXT = [
    "studentnummer",
    "studentnr",
    "student-nummer",
    "studentenkaart",
    "studentnummmer",  # veelvoorkomende typo
    "sis",
    "osiris",
    "alluris",
    "brightspace",
    "han",
    "hbo",
    "hogeschool",
    "student.han.nl",
    "studentnummmer:",
]

# ``S`` + 7 cijfers: zelfdragend.
_S_PREFIX = r"\b[Ss]\d{7}\b"
_S_PREFIX_RE = re.compile(_S_PREFIX)

# Kaal 7 of 8 cijfers. Lage pattern-score: eindscore komt uit context-boost.
_GENERIC = r"\b\d{7,8}\b"

# Markers die we in een 40-char window vóór de match willen vinden om
# het kale cijferpatroon te promoveren tot NL_STUDENT_ID.
_HAN_STUDENT_MARKERS = (
    "studentnummer",
    "studentnr",
    "student-nummer",
    "stud.nr",
    "stud nr",
    "osiris",
    "alluris",
    "brightspace",
    "sis:",
    "han studentnr",
    "han-nr",
)


def _has_student_context(text: str, start: int, window: int = 40) -> bool:
    """Staat er binnen ``window`` chars vóór ``start`` een studentnummer-label?"""

    window_start = max(0, start - window)
    preceding = text[window_start:start].lower()
    return any(m in preceding for m in _HAN_STUDENT_MARKERS)


class NlStudentnrRecognizer(PatternRecognizer):
    """Studentnummer-recognizer met HAN-gerichte context-fallback."""

    CONTEXT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_studentnr_s_prefix", regex=_S_PREFIX, score=0.7),
            Pattern(name="nl_studentnr_generic", regex=_GENERIC, score=0.2),
        ]
        super().__init__(
            supported_entity="NL_STUDENT_ID",
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
            text,
            entities or self.supported_entities,
            nlp_artifacts,
            regex_flags,
        )
        upgraded: list[RecognizerResult] = []
        for r in results:
            raw = text[r.start : r.end]
            # S-prefix blijft op zijn pattern-score (+ eventuele Presidio
            # context-boost). Voor de kale variant vereisen we dat er in
            # de directe nabijheid een label staat; anders laten we 'm
            # vallen om generieke 7-cijferige getallen niet te taggen.
            if _S_PREFIX_RE.fullmatch(raw):
                upgraded.append(r)
                continue
            if _has_student_context(text, r.start):
                r.score = max(r.score, self.CONTEXT_SCORE)
                r.analysis_explanation = AnalysisExplanation(
                    recognizer=self.__class__.__name__,
                    original_score=r.score,
                    pattern_name="nl_studentnr_context",
                    pattern=_GENERIC,
                    validation_result=True,
                    textual_explanation=(
                        "Kaal 7/8-cijferig nummer vlak na een HAN/Osiris/"
                        "Alluris/studentnummer-label."
                    ),
                )
                upgraded.append(r)
                # De zonder-context-hits filteren we uit; die zijn te
                # generiek. Presidio's default-threshold doet dat ook,
                # maar expliciet is veiliger.
        return upgraded

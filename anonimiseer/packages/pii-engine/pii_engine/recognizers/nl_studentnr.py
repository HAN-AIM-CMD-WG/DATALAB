"""Studentnummer-recognizer voor NL hogeronderwijs-instellingen.

Het HAN-studentnummer bestaat uit een hoofdletter S gevolgd door 7 cijfers
(bv. ``S1234567``), of een puur 7-cijferig nummer als het direct na het
contextwoord "studentnummer" staat. Omdat andere instellingen andere formats
gebruiken nemen we beide patronen mee, maar leunen we zwaar op contextwoorden
om generieke 7-cijferige getallen niet als studentnummer te markeren.
"""

from __future__ import annotations

from presidio_analyzer import Pattern, PatternRecognizer

__all__ = ["NlStudentnrRecognizer"]

_CONTEXT = [
    "studentnummer",
    "studentnr",
    "student-nummer",
    "studentenkaart",
    "studentnummmer",  # veelvoorkomende typo
    "sis",
    "osiris",
    "han-nummer",
]

# HAN-stijl: S + 7 cijfers (ook s of S).
_HAN_S = r"\b[Ss]\d{7}\b"

# Generiek 7 tot 8 cijfers; relatief lage score, leunt op context-boost.
_GENERIC = r"\b\d{7,8}\b"


class NlStudentnrRecognizer(PatternRecognizer):
    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_studentnr_han", regex=_HAN_S, score=0.65),
            Pattern(name="nl_studentnr_generic", regex=_GENERIC, score=0.2),
        ]
        super().__init__(
            supported_entity="NL_STUDENT_ID",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

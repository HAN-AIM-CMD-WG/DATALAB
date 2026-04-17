"""Studentnummer-recognizer voor NL hogeronderwijs-instellingen.

Sommige instellingen gebruiken studentnummers met een hoofdletter S gevolgd
door 7 cijfers (bv. ``S1234567``); andere gebruiken puur 7- of 8-cijferige
nummers. We dekken beide patronen maar leunen zwaar op contextwoorden zoals
"studentnummer" of "osiris" om generieke getallen niet onterecht als
studentnummer te markeren.
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
]

_S_PREFIX = r"\b[Ss]\d{7}\b"

# Generiek 7 tot 8 cijfers; relatief lage score, leunt op context-boost.
_GENERIC = r"\b\d{7,8}\b"


class NlStudentnrRecognizer(PatternRecognizer):
    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_studentnr_s_prefix", regex=_S_PREFIX, score=0.65),
            Pattern(name="nl_studentnr_generic", regex=_GENERIC, score=0.2),
        ]
        super().__init__(
            supported_entity="NL_STUDENT_ID",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

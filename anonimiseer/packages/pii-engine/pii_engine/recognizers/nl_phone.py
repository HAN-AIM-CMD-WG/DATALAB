"""Nederlandse telefoonnummer-recognizer.

Herkent drie veelvoorkomende notaties:

1. Mobiele nummers: ``06-12345678``, ``06 12 34 56 78``, ``0612345678``.
2. Vaste nummers: ``0345-123456``, ``020-1234567``, ``0345 123 456``.
3. Internationale notatie: ``+31 6 12345678``, ``+31612345678``, ``+31(0)6-12345678``.
"""

from __future__ import annotations

from presidio_analyzer import Pattern, PatternRecognizer

__all__ = ["NlPhoneRecognizer"]

_CONTEXT = [
    "telefoon",
    "telefoonnummer",
    "tel",
    "mobiel",
    "gsm",
    "bel",
    "06-nummer",
    "bereikbaar",
]

# Mobiel: start met 06 of +31 6, daarna 8 cijfers met optionele scheidingstekens.
_MOBILE = r"\b06[-\s.]?\d{2}[-\s.]?\d{2}[-\s.]?\d{2}[-\s.]?\d{2}\b"
_MOBILE_COMPACT = r"\b06\d{8}\b"

# Vast: start met 0, gevolgd door 1-3 cijfers regio, dan 6-7 cijfers.
# We vereisen hier een scheidingsteken om false positives op willekeurige
# 10-cijferige reeksen te beperken.
_LANDLINE = r"\b0[1-57-9]\d{1,2}[-\s][\d\s.-]{6,10}\d\b"

# Internationaal: +31, optioneel (0) of losse 0, dan 9 cijfers met willekeurige
# scheidingstekens. Het eerste cijfer mag geen 0 zijn.
_INTL = r"(?<!\d)\+31[\s\-]?\(?0?\)?[\s\-]?[1-9](?:[\s\-.]?\d){8}"
_INTL_COMPACT = r"(?<!\d)\+31\d{9}"


class NlPhoneRecognizer(PatternRecognizer):
    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_phone_mobile", regex=_MOBILE, score=0.55),
            Pattern(name="nl_phone_mobile_compact", regex=_MOBILE_COMPACT, score=0.5),
            Pattern(name="nl_phone_landline", regex=_LANDLINE, score=0.45),
            Pattern(name="nl_phone_intl", regex=_INTL, score=0.6),
            Pattern(name="nl_phone_intl_compact", regex=_INTL_COMPACT, score=0.55),
        ]
        super().__init__(
            supported_entity="NL_PHONE_NUMBER",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

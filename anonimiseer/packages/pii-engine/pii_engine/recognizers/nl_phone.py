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

# Vast: start met 0, gevolgd door 1-3 cijfers regio, dan 6-7 cijfers
# (totaal 10 cijfers in een NL-vast nummer). We vereisen een hard
# scheidingsteken na het regio-deel om random 10-cijferige reeksen te
# vermijden. Het nummer-deel mag intern spaties/streepjes bevatten,
# maar moet bestaan uit precies 6-7 cijfers (excl. tussenspaties).
_LANDLINE = r"\b0[1-57-9]\d{1,2}[-\s.](?:\d[\s.-]?){5,7}\d\b"

# Internationaal: +31, optioneel (0) of losse 0, dan 9 cijfers met willekeurige
# scheidingstekens. Het eerste cijfer mag geen 0 zijn.
_INTL = r"(?<!\d)\+31[\s\-]?\(?0?\)?[\s\-]?[1-9](?:[\s\-.]?\d){8}"
_INTL_COMPACT = r"(?<!\d)\+31\d{9}"

# Alternatieve notatie zonder '+' maar met '00' als landcode-prefix
# (``0031612345678``). Gebruikt in oude administraties en buiten NL.
_INTL_ZERO = r"(?<!\d)0031\d{9}(?!\d)"

# Internationale nummers met een Europese landcode anders dan +31. We
# beperken bewust tot een whitelist van veelgebruikte codes zodat we
# niet álle "+gevolgd door cijfers" als telefoonnummer pakken (zou
# valutabedragen kunnen treffen). De landcode is 2 of 3 cijfers en
# wordt gevolgd door een lokaal nummer met optionele scheidingstekens.
#
# Whitelist: BE, DE, GB, FR, ES, IT, PT, IE, LU, CH, AT, DK, SE, NO, FI,
# PL, CZ, SK.
_INTL_OTHER = (
    r"(?<!\d)\+"
    r"(?:32|49|44|33|34|39|351|353|352|41|43|45|46|47|358|48|420|421)"
    r"[\s\-]?\(?0?\)?[\s\-]?"
    r"[1-9](?:[\s\-.]?\d){7,11}"
    r"(?!\d)"
)
_INTL_OTHER_COMPACT = (
    r"(?<!\d)\+(?:32|49|44|33|34|39|351|353|352|41|43|45|46|47|358|48|420|421)"
    r"\d{7,11}(?!\d)"
)


class NlPhoneRecognizer(PatternRecognizer):
    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            # Scores zijn bewust iets hoger dan de default threshold (0.5)
            # zodat een telefoonnummer niet door een concurrerende
            # ``DATE_TIME``-hit (score 0.85) weg-gefilterd wordt wanneer er
            # geen "telefoon"-context-woord in de buurt staat.
            # Patronen zijn streng (vereisen 06/0xx-prefix met scheidings-
            # tekens of een ``+``-landcode); een bewuste match is hier
            # zelden een false positive. We tillen alle scores boven de
            # ``streng``-threshold (0.7) zodat telefoonnummers ook bij die
            # gebruikersinstelling consequent gemaskeerd blijven.
            Pattern(name="nl_phone_mobile", regex=_MOBILE, score=0.85),
            Pattern(name="nl_phone_mobile_compact", regex=_MOBILE_COMPACT, score=0.8),
            Pattern(name="nl_phone_landline", regex=_LANDLINE, score=0.8),
            Pattern(name="nl_phone_intl", regex=_INTL, score=0.9),
            Pattern(name="nl_phone_intl_compact", regex=_INTL_COMPACT, score=0.85),
            Pattern(name="nl_phone_intl_zero", regex=_INTL_ZERO, score=0.85),
            # Niet-NL Europees (+32, +49, …): hard ``+``-prefix met whitelist
            # van landcodes. Even sterk als NL-internationaal.
            Pattern(name="intl_phone_other", regex=_INTL_OTHER, score=0.85),
            Pattern(
                name="intl_phone_other_compact",
                regex=_INTL_OTHER_COMPACT,
                score=0.8,
            ),
        ]
        super().__init__(
            supported_entity="NL_PHONE_NUMBER",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

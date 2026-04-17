"""Nederlandse postcode-recognizer.

Formaat: ``1234 AB`` of ``1234AB``. Het eerste cijfer mag geen 0 zijn. De
lettercombinaties ``SA``, ``SD`` en ``SS`` worden niet uitgegeven; die sluiten
we uit om false positives op onzinstrings als "1234 SS" te beperken.
"""

from __future__ import annotations

from presidio_analyzer import Pattern, PatternRecognizer

__all__ = ["NlPostcodeRecognizer"]

_CONTEXT = ["postcode", "adres", "woonadres", "woonplaats", "pc"]

# Let op: we sluiten SA/SD/SS expliciet uit via een negative lookahead
# onmiddellijk na de vier cijfers (met optionele spatie).
_POSTCODE = r"\b[1-9][0-9]{3}\s?(?!SA\b|SD\b|SS\b)[A-Z]{2}\b"


class NlPostcodeRecognizer(PatternRecognizer):
    def __init__(self, supported_language: str = "nl") -> None:
        patterns = [
            Pattern(name="nl_postcode", regex=_POSTCODE, score=0.7),
        ]
        super().__init__(
            supported_entity="NL_POSTCODE",
            patterns=patterns,
            context=_CONTEXT,
            supported_language=supported_language,
        )

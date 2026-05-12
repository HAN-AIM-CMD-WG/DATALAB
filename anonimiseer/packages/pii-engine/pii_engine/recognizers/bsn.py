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


# Context-markers die een 9-cijferige string in de directe nabijheid bijna
# zeker tot een BSN maken (ook als de elfproef faalt — bij demo- en
# testdata komt dat vaak voor). We zoeken de marker binnen 40 karakters
# vóór de match, case-insensitive, met optionele label-markers (**BSN:** enz).
_BSN_NEAR_RE = re.compile(
    r"(?i)(?:^|[^a-z])(?:bsn|burgerservicenummer|burgerservice|sofinummer|sofi-nummer)"
    r"\s*[:\-*]{0,3}\s*$"
)

# Negatieve markers: als de tekst vlak voor het nummer aangeeft dat het
# om een ander type nummer gaat (polis/KvK/BIG/AGB/rijbewijs/paspoort),
# dan is het geen BSN, ook niet als het toevallig door de Elfproef komt.
# Dit voorkomt dat een polisnummer als ``106543210`` (Elfproef-geldig)
# onterecht als BSN wordt gelabeld.
_BSN_NEGATIVE_MARKERS = (
    "polisnummer",
    "polis:",
    "polis ",
    "zorgverzekering",
    "zorgpolis",
    "kvk-nummer",
    "kvk nummer",
    "kvknummer",
    "kvk:",
    "big-nummer",
    "big nummer",
    "big:",
    "agb-code",
    "agb code",
    "agb:",
    "rijbewijs",
    "paspoortnummer",
    "id-kaart",
    "identiteitskaart",
    "btw-nummer",
    "btw:",
    "iban",
)


def _has_bsn_context(text: str, start: int) -> bool:
    """Staat er vlak voor ``start`` een BSN-achtige label-marker?"""

    window_start = max(0, start - 40)
    preceding = text[window_start:start]
    return bool(_BSN_NEAR_RE.search(preceding))


def _has_non_bsn_context(text: str, start: int) -> bool:
    """Staat er vlak voor ``start`` een label dat BSN uitsluit?

    We kijken in een 40-karakter venster — genoeg voor labels als
    ``**Polisnummer zorgverzekeraar:** 106543210`` of
    ``**BTW-nummer (NL):** NL812345678B01``.
    """

    window_start = max(0, start - 40)
    preceding = text[window_start:start].lower()
    return any(marker in preceding for marker in _BSN_NEGATIVE_MARKERS)


class BsnRecognizer(PatternRecognizer):
    """Presidio-recognizer die kandidaten matcht op regex en filtert op Elfproef.

    Drie paden:

    1. **Elfproef-valide** → ``score = 1.0`` (zeker een BSN).
    2. **Niet elfproef-valide, maar mét context-label ("BSN:" ervoor)** →
       ``score = 0.8``. Dit dekt demo-/testdata af waar mensen bewust
       fake-BSNs gebruiken (zoals ``987654321``). Zonder context-boost
       zouden die anders onzichtbaar blijven en risico op lekken geven.
    3. **Niet elfproef-valide en geen context** → verworpen (te veel false
       positives: willekeurige 9-cijferige nummers zoals telefoonnummers).
    """

    DEFAULT_SCORE: ClassVar[float] = 1.0
    CONTEXT_ONLY_SCORE: ClassVar[float] = 0.8

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
            # Negatief-label check: als er "Polisnummer"/"KvK-nummer"/... vlak
            # ervoor staat, is het sowieso geen BSN.
            if _has_non_bsn_context(text, r.start):
                continue
            if is_valid_bsn(raw):
                r.score = self.DEFAULT_SCORE
                r.analysis_explanation = AnalysisExplanation(
                    recognizer=self.__class__.__name__,
                    original_score=r.score,
                    pattern_name="bsn_elfproef",
                    pattern=_BSN_PATTERN,
                    validation_result=True,
                    textual_explanation="Elfproef-checksum geldig.",
                )
                validated.append(r)
                continue

            # Fallback: 9 cijfers, geen elfproef, maar wel in BSN-context.
            digits = re.sub(r"\D", "", raw)
            if len(digits) in (8, 9) and _has_bsn_context(text, r.start):
                r.score = self.CONTEXT_ONLY_SCORE
                r.analysis_explanation = AnalysisExplanation(
                    recognizer=self.__class__.__name__,
                    original_score=r.score,
                    pattern_name="bsn_context_label",
                    pattern=_BSN_PATTERN,
                    validation_result=False,
                    textual_explanation=(
                        "Elfproef faalt, maar vlak ervoor staat een BSN-label "
                        '("BSN:" o.i.d.); behandel voor de zekerheid als BSN.'
                    ),
                )
                validated.append(r)

        return validated


# Type-guard voor linters: we willen expliciet dat PatternRecognizer als basis
# erkend wordt.
assert issubclass(BsnRecognizer, EntityRecognizer)

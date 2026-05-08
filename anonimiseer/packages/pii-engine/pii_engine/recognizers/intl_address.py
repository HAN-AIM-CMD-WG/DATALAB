"""Buitenlandse adres-recognizer (BE/DE/FR/UK).

NlAddressRecognizer dekt alleen Nederlandse straat+huisnr. Voor
internationale documenten (HAN-buitenlandstages, Erasmus-aanvragen,
zakelijk EU-correspondentie) zien we ook:

- **DE**: ``Bahnhofstraße 5``, ``Hauptstr. 12``, ``Lindenallee 3a``
- **BE/FR**: ``Rue de la Loi 200``, ``Avenue Louise 142``, ``Place
  Vendôme 4`` (huisnummer ná de straatnaam, zoals NL)
- **UK**: ``10 Downing Street``, ``221B Baker Street`` (huisnummer
  vóór de straatnaam)
- **DE/FR-postcode + plaats**: ``50667 Köln``, ``75001 Paris``
- **UK-postcode**: ``SW1A 2AA`` (1-2 letters + cijfer + spatie + 1
  cijfer + 2 letters)

Alle hits → ``LOCATION``.
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

__all__ = ["IntlAddressRecognizer"]


# ---------------------------------------------------------------------------
# Patronen
# ---------------------------------------------------------------------------

# Duitse straatnaam: eindigt op ``straße``, ``str.``, ``allee``, ``platz``,
# ``weg``, ``gasse``, ``ring``. Hoofdletter aan het begin (Duits).
_DE_SUFFIXES = (
    "straße",
    "strasse",
    "str\\.",
    "allee",
    "platz",
    "weg",
    "gasse",
    "ring",
    "ufer",
    "damm",
    "chaussee",
)
_DE_NAME = (
    r"[A-ZÄÖÜ][\wÄÖÜäöüß\-\.]*?(?:" + "|".join(_DE_SUFFIXES) + r")"
)
_DE_HOUSE = r"\d{1,4}[a-zA-Z]?(?:\s*[-\u2013]\s*\d{1,4}[a-zA-Z]?)?"
_DE_STREET = re.compile(
    rf"\b(?P<street>{_DE_NAME})\s+(?P<nr>{_DE_HOUSE})\b"
)

# Frans/Belgisch (NL-volgorde): straatnaam + huisnummer. Belangrijkste
# typen: ``rue``, ``avenue``, ``boulevard``, ``place``, ``chaussée``,
# ``impasse``, ``allée``, ``quai``, ``route``. Het eerste woord ná de
# kop is meestal lowercase (``de la Loi``), dus we zijn hier soepeler
# met case.
_FR_HEAD = (
    r"(?:Rue|rue|Avenue|avenue|Boulevard|boulevard|Place|place|"
    r"Chaussée|chaussée|Impasse|impasse|Allée|allée|Quai|quai|"
    r"Route|route|Voie|voie|Cours|cours|Square|Promenade)"
)
_FR_TAIL = r"(?:\s+(?:de|du|des|la|le|les|d'|l'|au|aux|saint|sainte|st\.?|ste\.?|[A-ZÀ-ÿ][\wÀ-ÿ\-']*)){1,5}"
_FR_HOUSE = r"\d{1,4}[a-zA-Z]?(?:\s*[-\u2013/]\s*\d{1,4}[a-zA-Z]?)?(?:\s*bis|\s*ter)?"
_FR_STREET = re.compile(
    rf"\b(?P<street>{_FR_HEAD}{_FR_TAIL})\s+(?P<nr>{_FR_HOUSE})\b"
)
# FR-variant met huisnummer vóór de straatnaam (``1 rue de la
# République``, ``15 avenue de la Liberté``).
_FR_STREET_NRFIRST = re.compile(
    rf"\b(?P<nr>{_FR_HOUSE})\s+(?P<street>{_FR_HEAD}{_FR_TAIL})\b"
)

# UK-volgorde: huisnummer eerst, dan straatnaam. Suffixen vrij divers
# (``Street``, ``Road``, ``Avenue``, ``Lane``, ``Square``, ``Drive``,
# ``Place``, ``Way``, ``Crescent``, ``Court``, ``Park``).
_UK_SUFFIX = (
    r"(?:Street|Road|Avenue|Lane|Square|Drive|Place|Way|Crescent|"
    r"Court|Park|Boulevard|Gardens|Mews|Close|Hill|Walk|Terrace)"
)
_UK_NAME = rf"(?:[A-Z][a-zA-Z'\-]+\s+){{1,4}}{_UK_SUFFIX}"
_UK_STREET = re.compile(
    rf"\b(?P<nr>\d{{1,4}}[A-Za-z]?)\s+(?P<street>{_UK_NAME})\b"
)

# DE/FR postcode + plaats: 5 cijfers + spatie + 1-3 hoofdletter-woorden.
_FIVE_DIGIT_PC = r"\d{5}"
_INTL_CITY_TOKEN = r"[A-ZÄÖÜÀ-Þ][A-Za-zÄÖÜäöüßÀ-ÿ'\-]+"
_INTL_CITY = rf"{_INTL_CITY_TOKEN}(?:\s+{_INTL_CITY_TOKEN}){{0,2}}"
_INTL_PC_CITY = re.compile(
    rf"\b(?P<pc>{_FIVE_DIGIT_PC})\s+(?P<city>{_INTL_CITY})\b"
)

# UK-postcode: ``SW1A 2AA``, ``M1 1AE``, ``EC1A 1BB``.
_UK_POSTCODE = re.compile(
    r"\b(?P<pc>[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b"
)


class IntlAddressRecognizer(EntityRecognizer):
    """Buitenlandse straat+nr en postcode+plaats → ``LOCATION``."""

    STREET_SCORE: ClassVar[float] = 0.85
    POSTCODE_SCORE: ClassVar[float] = 0.85
    CITY_SCORE: ClassVar[float] = 0.8

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["LOCATION"],
            name="IntlAddressRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:  # pragma: no cover - Presidio interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "LOCATION" not in entities:
            return []
        out: list[RecognizerResult] = []

        # DE-straat
        for m in _DE_STREET.finditer(text):
            out.append(
                self._mk(m.start("street"), m.end("nr"), "de_street",
                         "Duits adres (Straße/Str./Allee/Platz/Weg + huisnr).",
                         self.STREET_SCORE)
            )

        # FR/BE-straat (nr ná straatnaam — BE-volgorde)
        for m in _FR_STREET.finditer(text):
            out.append(
                self._mk(m.start("street"), m.end("nr"), "fr_street",
                         "Frans/Belgisch adres (Rue/Avenue/Boulevard + huisnr).",
                         self.STREET_SCORE)
            )
        # FR-straat (nr vóór straatnaam — FR-volgorde)
        for m in _FR_STREET_NRFIRST.finditer(text):
            out.append(
                self._mk(m.start("nr"), m.end("street"), "fr_street_nrfirst",
                         "Frans adres met huisnr vóór straatnaam.",
                         self.STREET_SCORE)
            )

        # UK-straat
        for m in _UK_STREET.finditer(text):
            out.append(
                self._mk(m.start("nr"), m.end("street"), "uk_street",
                         "UK adres (huisnr + Street/Road/Avenue/…).",
                         self.STREET_SCORE)
            )

        # 5-cijfer postcode + plaats (DE/FR)
        for m in _INTL_PC_CITY.finditer(text):
            # Span dekt het hele "12345 Plaats"
            out.append(
                self._mk(m.start("pc"), m.end("city"), "intl_pc_city",
                         "5-cijfer postcode + plaatsnaam (DE/FR-formaat).",
                         self.POSTCODE_SCORE)
            )

        # UK-postcode standalone
        for m in _UK_POSTCODE.finditer(text):
            raw = m.group("pc")
            # Filter random uppercase woorden van vorm ``A1 2BC``: vereis
            # dat eerste blok 2-4 chars is met letter+cijfer en tweede
            # 3 chars met cijfer+2 letters.
            if not _looks_like_uk_postcode(raw):
                continue
            out.append(
                self._mk(m.start("pc"), m.end("pc"), "uk_postcode",
                         "Britse postcode (outward+inward formaat).",
                         self.POSTCODE_SCORE)
            )
        return out

    def _mk(
        self,
        start: int,
        end: int,
        name: str,
        explanation: str,
        score: float,
    ) -> RecognizerResult:
        return RecognizerResult(
            entity_type="LOCATION",
            start=start,
            end=end,
            score=score,
            analysis_explanation=AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=score,
                pattern_name=name,
                pattern="",
                validation_result=True,
                textual_explanation=explanation,
            ),
        )


def _looks_like_uk_postcode(raw: str) -> bool:
    s = raw.replace(" ", "")
    if len(s) < 5 or len(s) > 7:
        return False
    return bool(re.fullmatch(r"[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}", s))

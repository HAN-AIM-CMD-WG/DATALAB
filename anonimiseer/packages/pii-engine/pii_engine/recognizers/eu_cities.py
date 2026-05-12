"""Steden-recognizer (NL/EU).

spaCy's NL-NER mist regelmatig:

- Plaatsnamen met apostrof (``'s-Hertogenbosch``, ``'s-Gravenhage``)
- Buitenlandse hoofdsteden / grote steden (``Paris`` → PERSON,
  ``Köln`` is wisselend)
- Samengestelde NL-steden (``Den Haag``, ``Den Bosch``)

Deze recognizer levert een deterministische dictionary-match op de
meest-voorkomende NL- en West-Europese steden zodat plaatsnamen altijd
als ``LOCATION`` worden herkend, ongeacht de NER-pipeline.

Bewuste keuze: alleen steden met >50.000 inwoners + alle Nederlandse
provinciehoofdsteden + alle EU-hoofdsteden. Kleine dorpen worden via
de ``NlAddressRecognizer`` (postcode-patroon) of spaCy gedekt.
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

__all__ = ["EU_CITY_NAMES", "EU_CITY_NAMES_LC", "EuCityRecognizer"]


EU_CITY_NAMES: tuple[str, ...] = (
    # Nederland — provinciehoofdsteden + grote steden
    "'s-Hertogenbosch",
    "'s-Gravenhage",
    "Den Haag",
    "Den Bosch",
    "Amsterdam",
    "Rotterdam",
    "Utrecht",
    "Eindhoven",
    "Groningen",
    "Tilburg",
    "Almere",
    "Breda",
    "Nijmegen",
    "Apeldoorn",
    "Haarlem",
    "Arnhem",
    "Enschede",
    "Amersfoort",
    "Zaanstad",
    "Maastricht",
    "Leiden",
    "Dordrecht",
    "Zoetermeer",
    "Zwolle",
    "Deventer",
    "Delft",
    "Alkmaar",
    "Leeuwarden",
    "Hilversum",
    "Hengelo",
    "Roosendaal",
    "Heerlen",
    "Helmond",
    "Venlo",
    "Sittard",
    "Middelburg",
    "Assen",
    "Lelystad",
    "Gouda",
    "Hoorn",
    "Almelo",
    "Veenendaal",
    # België — gewest-/provinciehoofdsteden
    "Brussel",
    "Bruxelles",
    "Antwerpen",
    "Gent",
    "Charleroi",
    "Luik",
    "Liège",
    "Brugge",
    "Namen",
    "Namur",
    "Leuven",
    "Mons",
    "Bergen",
    "Hasselt",
    "Mechelen",
    "Aalst",
    "Kortrijk",
    "Oostende",
    # Duitsland — grootste steden + grenssteden
    "Berlin",
    "Hamburg",
    "München",
    "Köln",
    "Frankfurt",
    "Stuttgart",
    "Düsseldorf",
    "Leipzig",
    "Dortmund",
    "Essen",
    "Bremen",
    "Hannover",
    "Nürnberg",
    "Duisburg",
    "Bochum",
    "Wuppertal",
    "Bielefeld",
    "Bonn",
    "Münster",
    "Karlsruhe",
    "Mannheim",
    "Augsburg",
    "Wiesbaden",
    "Mönchengladbach",
    "Aachen",
    "Kleve",
    "Emmerich",
    "Osnabrück",
    "Oldenburg",
    # Frankrijk — grootste steden
    "Paris",
    "Marseille",
    "Lyon",
    "Toulouse",
    "Nice",
    "Nantes",
    "Strasbourg",
    "Montpellier",
    "Bordeaux",
    "Lille",
    "Rennes",
    "Reims",
    "Le Havre",
    "Saint-Étienne",
    "Toulon",
    "Grenoble",
    "Dijon",
    "Angers",
    "Nîmes",
    # UK
    "London",
    "Birmingham",
    "Manchester",
    "Glasgow",
    "Liverpool",
    "Edinburgh",
    "Bristol",
    "Leeds",
    "Sheffield",
    "Cardiff",
    "Belfast",
    "Newcastle",
    "Nottingham",
    "Southampton",
    "Oxford",
    "Cambridge",
    # Overig EU — hoofdsteden
    "Madrid",
    "Barcelona",
    "Sevilla",
    "Valencia",
    "Lissabon",
    "Lisbon",
    "Lisboa",
    "Porto",
    "Rome",
    "Roma",
    "Milaan",
    "Milano",
    "Napels",
    "Napoli",
    "Turijn",
    "Torino",
    "Florence",
    "Firenze",
    "Wenen",
    "Wien",
    "Vienna",
    "Salzburg",
    "Praag",
    "Praha",
    "Prague",
    "Warschau",
    "Warsaw",
    "Krakau",
    "Krakow",
    "Boedapest",
    "Budapest",
    "Kopenhagen",
    "København",
    "Stockholm",
    "Göteborg",
    "Gothenburg",
    "Oslo",
    "Bergen",
    "Helsinki",
    "Dublin",
    "Cork",
    "Athene",
    "Athens",
    "Bern",
    "Zürich",
    "Zurich",
    "Genève",
    "Geneva",
    "Bazel",
    "Basel",
    "Luxemburg",
    "Luxembourg",
)


def _build_pattern(names: tuple[str, ...]) -> re.Pattern[str]:
    # Multi-word/long namen eerst zodat ``Den Haag`` niet door ``Den`` of
    # ``Haag`` wordt gedwarsboomd.
    sorted_names = sorted(set(names), key=len, reverse=True)
    escaped = [re.escape(n) for n in sorted_names]
    # Gebruik géén ``\b`` aan het begin omdat sommige namen met een
    # apostrof (``'s-Hertogenbosch``) aan een non-word karakter
    # beginnen; we eisen handmatig dat het vorige teken geen letter is.
    pattern = r"(?<![A-Za-zÀ-ÿ])(?:" + "|".join(escaped) + r")(?![A-Za-zÀ-ÿ])"
    return re.compile(pattern)


_CITY_REGEX = _build_pattern(EU_CITY_NAMES)

# Lowercase-set voor losse-token-validatie door andere recognizers
# (``IntlAddressRecognizer`` checkt of "1040 Brussel" → "Brussel" een
# bekende stad is voordat hij de span pakt).
EU_CITY_NAMES_LC: frozenset[str] = frozenset(name.lower() for name in EU_CITY_NAMES)


class EuCityRecognizer(EntityRecognizer):
    """Dictionary-match op bekende NL/EU-steden → ``LOCATION``."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["LOCATION"],
            name="EuCityRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:
        """Geen externe assets nodig."""

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "LOCATION" not in entities:
            return []
        out: list[RecognizerResult] = []
        for m in _CITY_REGEX.finditer(text):
            out.append(
                RecognizerResult(
                    entity_type="LOCATION",
                    start=m.start(),
                    end=m.end(),
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="city_dict",
                        pattern="",
                        validation_result=True,
                        textual_explanation=("Dictionary-match op bekende NL/EU-stadsnaam."),
                    ),
                )
            )
        return out

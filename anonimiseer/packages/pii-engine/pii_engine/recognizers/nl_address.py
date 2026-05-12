"""Nederlandse adres-recognizer.

Detecteert twee veelvoorkomende adresvormen die spaCy vaak mist:

* **Straatnaam + huisnummer** — bv. ``Rijnstraat 45``, ``Dr. van
  Heugtenweg 3b``, ``Professor Bellefroidstraat 22-III``. We herkennen
  typische NL-straatsuffixen (``-straat``, ``-laan``, ``-weg``,
  ``-dijk``, ``-plein``, ``-kade``, ``-singel``, ``-gracht``, ``-hof``,
  ``-park``, ``-plantsoen``, ``-steeg``, ``-pad``, ``-boulevard``).

* **Postcode + plaatsnaam** — bv. ``6811 EW Arnhem``, ``1015 CJ
  Amsterdam``. De postcode zelf wordt al door :class:`NlPostcodeRecognizer`
  gevangen; deze recognizer dekt de plaats ná de postcode.

Beide vormen worden geëxporteerd als ``LOCATION`` zodat ze in de
bestaande "locatie/adres"-UI-categorie passen.
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

__all__ = ["NlAddressRecognizer"]


# Typische NL-straatsuffixen. Case-insensitive in het pattern; we
# herkennen samenstellingen (bv. "Rijnstraat", "Oosterpark") én losse
# vormen na een spatie (zeldzaam: "Korte Straat"). De negatieve
# woord-lookahead ``(?=\s)`` zorgt dat "straatverbod" niet matcht.
_STREET_SUFFIXES = (
    "straat",
    "straten",
    "laan",
    "weg",
    "dijk",
    "plein",
    "kade",
    "singel",
    "gracht",
    "hof",
    "park",
    "plantsoen",
    "steeg",
    "pad",
    "boulevard",
    "allee",
    "markt",
    "ring",
    "baan",
    "dreef",
    "erf",
    "wal",
    "werf",
    "hofje",
    "plaats",
    "veld",
    "brink",
    "lei",
    # Specifieke suffixen voor minder voorkomende NL-straten
    # (``Voorhout`` → -hout, ``Hooghorst`` → -horst, ``Strijkamp`` → -kamp).
    "hout",
    "horst",
    "kamp",
)

# Straatnaam = één of meer hoofdlettertokens, eventueel met titels als
# "Dr.", "Prof.", "Mr.", ``van``, ``de``. De laatste token moet eindigen
# op één van de suffixen — dat is de "harde eis" voor een NL-straat.
_TITLE = r"(?:Dr\.|Prof\.|Mr\.|Ir\.|Ing\.|Drs\.|Mgr\.)"
_TOKEN = r"[A-ZÀ-Þ][A-Za-zÀ-ÿ'\-]+"
_TUSSEN = r"(?:van(?:\s+der?)?|de|den|der|te|ten|ter|het|'t|op|aan)"
_STREET_LAST = rf"[A-ZÀ-Þ][A-Za-zÀ-ÿ'\-]*?(?:{'|'.join(_STREET_SUFFIXES)})"
_STREET_NAME = (
    rf"(?:{_TITLE}\s+)?"
    rf"(?:(?:{_TOKEN}|{_TUSSEN})\s+){{0,3}}"
    rf"{_STREET_LAST}"
)
# Huisnummer: 1-5 cijfers + optionele toevoeging. De toevoeging plakt
# ofwel direct aan het cijfer (``45A``, ``45-a``, ``45/III``) ofwel
# volgt na een spatie maar dan alleen met expliciete sleutelwoorden
# (``45 bis``, ``45 huis``, ``45 II``). Zo voorkomen we dat een los
# "te", "aan", "bij" onterecht als toevoeging wordt gezien.
_HOUSE_NUMBER = (
    r"\d{1,5}"
    r"(?:"
    r"[-/]?[A-Za-z]{1,3}"  # aanplakkend: 45a, 45-a, 45/b, 45III
    r"|"
    r"[-/]\d{1,4}[A-Za-z]?"  # appartement-nummer: 123-3, 45/12, 12-3a
    r"|"
    r"\s+(?:bis|huis|[IVXivx]{1,5})"  # met spatie, alleen expliciete suffixen
    r")?"
)
_STREET_PATTERN = re.compile(
    rf"\b(?P<street>{_STREET_NAME})\s+(?P<nr>{_HOUSE_NUMBER})\b",
    flags=0,  # expliciet case-sensitive — voorkomt random lowercase matches
)

# Postcode + plaatsnaam. De postcode zelf is ``[1-9]\d{3}\s?[A-Z]{2}``;
# daarna staan 1-3 hoofdletter-woorden met de plaats (bv. "Den Haag",
# "Bergen op Zoom"). We beperken tot 3 woorden zodat we niet hele
# zinnen binnenhalen.
_POSTCODE = r"[1-9]\d{3}\s?[A-Z]{2}"
_CITY_TOKEN = r"[A-ZÀ-Þ][A-Za-zÀ-ÿ'\-]+"
_CITY_CONNECTOR = r"(?:\s+(?:aan|op|bij|de|den|het|'t|in))"
_CITY_NAME = rf"{_CITY_TOKEN}(?:(?:{_CITY_CONNECTOR}\s+)?\s+{_CITY_TOKEN}){{0,2}}"
_POSTCODE_CITY_PATTERN = re.compile(
    rf"(?P<pc>{_POSTCODE})\s+(?P<city>{_CITY_NAME})\b",
    flags=0,
)

# Losse plaats na het label ``Woonplaats:`` / ``Plaats:`` / ``Stad:``.
_PLACE_LABEL_PATTERN = re.compile(
    rf"\b(?:woonplaats|plaats|stad|vestigingsplaats|gemeente)\b[^\S\n]*[:\-–][^\S\n]*"
    rf"(?P<city>{_CITY_NAME})",
    flags=re.IGNORECASE,
)


class NlAddressRecognizer(EntityRecognizer):
    """Straatnaam+huisnummer en postcode+plaats → ``LOCATION``."""

    STREET_SCORE: ClassVar[float] = 0.85
    CITY_SCORE: ClassVar[float] = 0.75

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["LOCATION"],
            supported_language=supported_language,
            name="NlAddressRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if "LOCATION" not in entities:
            return []
        results: list[RecognizerResult] = []

        for match in _STREET_PATTERN.finditer(text):
            start = match.start("street")
            end = match.end("nr")
            raw = text[start:end]
            # Een straatnaam begint met een hoofdletter. Als ons regex-
            # patroon per ongeluk een lowercase tussenvoegsel als eerste
            # token heeft meegepakt (``op\nKeizersgracht 123``) schuiven
            # we ``start`` op naar het eerste hoofdletter-token.
            while raw and not raw[0].isupper():
                ws_match = re.search(r"\s+", raw)
                if ws_match is None:
                    raw = ""
                    break
                skip = ws_match.end()
                start += skip
                raw = raw[skip:]
            if not raw or not raw[0].isupper():
                continue
            results.append(
                RecognizerResult(
                    entity_type="LOCATION",
                    start=start,
                    end=end,
                    score=self.STREET_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.STREET_SCORE,
                        pattern_name="nl_street_address",
                        pattern=_STREET_PATTERN.pattern,
                        validation_result=True,
                        textual_explanation=(
                            "NL-straatnaam met herkenbaar suffix (straat/laan/weg/…) + huisnummer."
                        ),
                    ),
                )
            )

        for match in _POSTCODE_CITY_PATTERN.finditer(text):
            city_start = match.start("city")
            city_end = match.end("city")
            raw = text[city_start:city_end]
            if not raw or not raw[0].isupper():
                continue
            # Filter lijst-artefacten (bv. "6811 EW Adres" — stopwoorden
            # die nooit plaatsnamen zijn).
            first_word = raw.split()[0].lower()
            if first_word in _NON_CITY_WORDS:
                continue
            results.append(
                RecognizerResult(
                    entity_type="LOCATION",
                    start=city_start,
                    end=city_end,
                    score=self.CITY_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.CITY_SCORE,
                        pattern_name="nl_postcode_city",
                        pattern=_POSTCODE_CITY_PATTERN.pattern,
                        validation_result=True,
                        textual_explanation=("Plaatsnaam direct na een NL-postcode."),
                    ),
                )
            )

        for match in _PLACE_LABEL_PATTERN.finditer(text):
            city_start = match.start("city")
            city_end = match.end("city")
            raw = text[city_start:city_end]
            if not raw or not raw[0].isupper():
                continue
            first_word = raw.split()[0].lower()
            if first_word in _NON_CITY_WORDS:
                continue
            results.append(
                RecognizerResult(
                    entity_type="LOCATION",
                    start=city_start,
                    end=city_end,
                    score=self.CITY_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.CITY_SCORE,
                        pattern_name="nl_place_label",
                        pattern=_PLACE_LABEL_PATTERN.pattern,
                        validation_result=True,
                        textual_explanation=("Plaatsnaam achter ``Woonplaats``/``Plaats``-label."),
                    ),
                )
            )

        return results


# Woorden die direct na een postcode of label kunnen voorkomen maar
# zeker geen plaatsnaam zijn. We houden deze lijst klein om het
# detectiebereik ruim te houden.
_NON_CITY_WORDS = frozenset(
    {
        "nvt",
        "onbekend",
        "adres",
        "postbus",
        "pb",
        "t.a.v.",
        "t.a.v",
        "p/a",
        "pa",
    }
)

"""Recognizers voor Nederlandse PII die nog niet elders zijn gedekt.

Voor nu: voertuigkentekens (Nederlandse sidecodes 1–8) en GPS-coördinaten.

* :class:`NlKentekenRecognizer` — herkent kentekens in alle officiële NL-
  sidecodes (``AB-12-CD``, ``12-ABC-3`` …) plus een tolerante fallback
  zoals ``AB-123-C`` voor afwijkende of historische plaatjes.
* :class:`GpsCoordinateRecognizer` — herkent decimal-degrees coördinaten
  in formaat ``52.0907° N, 5.1214° E`` of ``52.0907,5.1214``.
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


__all__ = ["NlKentekenRecognizer", "GpsCoordinateRecognizer"]


# Strikte NL sidecodes 1-8 (RDW-officieel). De afzonderlijke alternatieven
# zijn case-sensitief: kentekens staan in hoofdletters.
_KENTEKEN_STRICT = re.compile(
    r"(?<![A-Z0-9])(?:"
    r"[A-Z]{2}-\d{2}-\d{2}"           # 1: AB-12-34
    r"|\d{2}-\d{2}-[A-Z]{2}"          # 2: 12-34-AB
    r"|\d{2}-[A-Z]{2}-\d{2}"          # 3: 12-AB-34
    r"|[A-Z]{2}-\d{2}-[A-Z]{2}"       # 4: AB-12-CD
    r"|[A-Z]{2}-[A-Z]{2}-\d{2}"       # 5: AB-CD-12
    r"|\d{2}-[A-Z]{2}-[A-Z]{2}"       # 6: 12-AB-CD
    r"|\d{2}-[A-Z]{3}-\d"             # 7: 12-ABC-3
    r"|\d-[A-Z]{3}-\d{2}"             # 8: 1-ABC-23
    r")(?![A-Z0-9])"
)

# Tolerantere fallback: algemene 3-blokken met `-` ertussen, mits er
# zowel cijfers als letters in zitten en de totale lengte 5–9 is.
# Gebruiken we alleen wanneer er géén strikt-sidecode-match in de buurt
# staat én er een kenteken-label vlak vooraan staat.
_KENTEKEN_LOOSE = re.compile(
    r"(?<![A-Z0-9])"
    r"[A-Z0-9]{1,3}-[A-Z0-9]{1,3}-[A-Z0-9]{1,3}"
    r"(?![A-Z0-9])"
)
_KENTEKEN_CONTEXT = re.compile(
    r"\b(?:kenteken|voertuigkenteken|kentekenplaat|nummerbord|registratie)\b"
    r"[^\n]{0,30}$",
    flags=re.IGNORECASE,
)


def _has_letter_and_digit(text: str) -> bool:
    has_letter = any(c.isalpha() for c in text)
    has_digit = any(c.isdigit() for c in text)
    return has_letter and has_digit


class NlKentekenRecognizer(EntityRecognizer):
    """Detecteert Nederlandse voertuigkentekens als ``NL_KENTEKEN``."""

    DEFAULT_SCORE: ClassVar[float] = 0.95
    LOOSE_SCORE: ClassVar[float] = 0.8

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["NL_KENTEKEN"],
            supported_language=supported_language,
            name="NlKentekenRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "NL_KENTEKEN" not in entities:
            return []
        results: list[RecognizerResult] = []
        seen: set[tuple[int, int]] = set()

        for m in _KENTEKEN_STRICT.finditer(text):
            span = m.group()
            if span != span.upper():
                continue
            results.append(
                RecognizerResult(
                    entity_type="NL_KENTEKEN",
                    start=m.start(),
                    end=m.end(),
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="nl_kenteken_strict",
                        pattern=_KENTEKEN_STRICT.pattern,
                        validation_result=True,
                        textual_explanation=(
                            "Voldoet aan officiële NL-sidecode 1-8."
                        ),
                    ),
                )
            )
            seen.add((m.start(), m.end()))

        for m in _KENTEKEN_LOOSE.finditer(text):
            if (m.start(), m.end()) in seen:
                continue
            span = m.group()
            if not _has_letter_and_digit(span):
                continue
            if span != span.upper():
                continue
            length = m.end() - m.start()
            if length < 5 or length > 11:
                continue
            preceding = text[max(0, m.start() - 60) : m.start()]
            if not _KENTEKEN_CONTEXT.search(preceding):
                continue
            results.append(
                RecognizerResult(
                    entity_type="NL_KENTEKEN",
                    start=m.start(),
                    end=m.end(),
                    score=self.LOOSE_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.LOOSE_SCORE,
                        pattern_name="nl_kenteken_loose",
                        pattern=_KENTEKEN_LOOSE.pattern,
                        validation_result=True,
                        textual_explanation=(
                            "Drie alfanumerieke groepen rond een kenteken-label."
                        ),
                    ),
                )
            )

        return results


# GPS-coördinaten in decimaal-graden formaat. Voorbeelden:
#   ``52.0907° N, 5.1214° E``     (mét graden-symbool, hoofdrichting)
#   ``52.0907 N 5.1214 E``         (zonder symbool)
#   ``52.0907, 5.1214``            (puur decimaal, beide positief)
#   ``-52.0907, -5.1214``          (decimaal mét teken)
_GPS_DEC_DEG = (
    r"-?(?:\d{1,2}|1[0-7]\d)\.\d{2,7}"  # -180..180 met decimalen
)
_GPS_DD_DEG = (
    r"-?(?:\d{1,2}|[1-8]\d)\.\d{2,7}"  # -90..90 met decimalen
)
_GPS_LAT_LON = re.compile(
    rf"\b(?P<lat>{_GPS_DD_DEG})\s*°?\s*(?P<latH>[NS])?"
    rf"[,;\s]+"
    rf"(?P<lon>{_GPS_DEC_DEG})\s*°?\s*(?P<lonH>[EWO])?"
    r"\b"
)


class GpsCoordinateRecognizer(EntityRecognizer):
    """Decimal-degrees GPS-coördinaten → ``LOCATION``."""

    DEFAULT_SCORE: ClassVar[float] = 0.95

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["LOCATION"],
            supported_language=supported_language,
            name="GpsCoordinateRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "LOCATION" not in entities:
            return []
        results: list[RecognizerResult] = []
        for m in _GPS_LAT_LON.finditer(text):
            try:
                lat = float(m.group("lat"))
                lon = float(m.group("lon"))
            except ValueError:
                continue
            if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
                continue
            results.append(
                RecognizerResult(
                    entity_type="LOCATION",
                    start=m.start(),
                    end=m.end(),
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="gps_decimal_degrees",
                        pattern=_GPS_LAT_LON.pattern,
                        validation_result=True,
                        textual_explanation=(
                            "Decimal-degrees GPS-coördinaat (lat, lon)."
                        ),
                    ),
                )
            )
        return results

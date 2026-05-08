"""Nederlandse datum-recognizer.

Presidio's standaard ``DATE_TIME`` heeft score 0.6 — onder de
``streng``-threshold (0.7) — waardoor geboortedatums als ``14-03-1985``
in lopende tekst kunnen blijven staan. Dat is een privacy-risico: een
geboortedatum is harde PII (Wpr/AVG).

Deze recognizer detecteert klassieke NL-/EU-datumnotaties en geeft ze
score 0.8+ wanneer:

- Het patroon onmiskenbaar is (``dd-mm-jjjj`` met realistische jaren),
- Of er een ``geboortedatum``/``datum``-label vóór staat.

Maand-namen zijn Nederlands en Engels; we vangen ook ISO-formaat
(``1985-03-14``) en lange schrijfwijzen (``14 maart 1985``).
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

__all__ = ["NlDateRecognizer"]


# ---------------------------------------------------------------------------
# Constanten
# ---------------------------------------------------------------------------

_DAY = r"(?:0?[1-9]|[12][0-9]|3[01])"
_MONTH = r"(?:0?[1-9]|1[0-2])"
_YEAR4 = r"(?:1[89]\d{2}|20\d{2}|21\d{2})"
_YEAR2 = r"\d{2}"

_MONTH_NAMES = (
    # NL
    r"januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|"
    # NL-afk.
    r"jan|feb|mrt|apr|mei|jun|jul|aug|sep|sept|okt|nov|dec|"
    # EN (komt voor in import-bestanden, software-output)
    r"january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
)

# 14-03-1985, 14/03/1985, 14.03.1985 (numerieke EU-volgorde)
_DATE_NUMERIC = re.compile(
    rf"\b{_DAY}[\-/.]{_MONTH}[\-/.]{_YEAR4}\b"
)
# 1985-03-14 (ISO)
_DATE_ISO = re.compile(rf"\b{_YEAR4}-{_MONTH}-{_DAY}\b")
# 14 maart 1985, 14 mrt 2026
_DATE_LONG = re.compile(
    rf"\b{_DAY}\s+(?:{_MONTH_NAMES})\s+{_YEAR4}\b",
    flags=re.IGNORECASE,
)
# Korte numeriek met 2-cijferig jaar (``14-03-85``); risico op false
# positives, daarom alleen actief met label-context.
_DATE_SHORT = re.compile(rf"\b{_DAY}[\-/.]{_MONTH}[\-/.]{_YEAR2}\b")

# Labels die een datum bevestigen.
_DATE_LABELS = (
    "geboortedatum",
    "geboren",
    "geb.",
    "datum",
    "ingangsdatum",
    "vervaldatum",
    "uitgiftedatum",
    "datum van",
    "geboorte",
    "dob",
    "birthdate",
    "date of birth",
)


def _has_label_before(text: str, start: int, *, window: int = 60) -> bool:
    """Staat er een datum-label binnen ``window`` chars vóór ``start``?"""

    snippet = text[max(0, start - window) : start].lower()
    return any(label in snippet for label in _DATE_LABELS)


class NlDateRecognizer(EntityRecognizer):
    """NL/EU datum-detectie met realistische jaarrange en context-boost."""

    SCORE_FULL: ClassVar[float] = 0.85   # ``dd-mm-jjjj`` met 4-cijferig jaar
    SCORE_LONG: ClassVar[float] = 0.9    # ``14 maart 1985`` (zeer eenduidig)
    SCORE_ISO: ClassVar[float] = 0.85    # ISO-formaat
    SCORE_LABELED: ClassVar[float] = 0.85  # 2-cijferig jaar met label
    SCORE_SHORT: ClassVar[float] = 0.4   # 2-cijferig jaar zonder label (laag)

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["DATE_TIME"],
            name="NlDateRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:  # noqa: D401 - Presidio interface
        """Geen externe assets nodig."""

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "DATE_TIME" not in entities:
            return []
        out: list[RecognizerResult] = []
        seen: set[tuple[int, int]] = set()

        def _emit(start: int, end: int, score: float, name: str) -> None:
            key = (start, end)
            if key in seen:
                return
            seen.add(key)
            out.append(
                RecognizerResult(
                    entity_type="DATE_TIME",
                    start=start,
                    end=end,
                    score=score,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=score,
                        pattern_name=name,
                        pattern="",
                        validation_result=True,
                        textual_explanation=(
                            "NL/EU datum (mogelijk geboortedatum); "
                            "realistisch jaartal of label-context."
                        ),
                    ),
                )
            )

        for m in _DATE_NUMERIC.finditer(text):
            score = self.SCORE_FULL
            if _has_label_before(text, m.start()):
                score = max(score, self.SCORE_LABELED)
            _emit(m.start(), m.end(), score, "date_numeric")
        for m in _DATE_ISO.finditer(text):
            _emit(m.start(), m.end(), self.SCORE_ISO, "date_iso")
        for m in _DATE_LONG.finditer(text):
            _emit(m.start(), m.end(), self.SCORE_LONG, "date_long")
        for m in _DATE_SHORT.finditer(text):
            # Kort jaartal: alleen als er een label vóór staat.
            if _has_label_before(text, m.start()):
                _emit(m.start(), m.end(), self.SCORE_LABELED, "date_short_labeled")
        return out

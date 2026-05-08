"""Recognizer voor interne dossier-/patiënt-/zaaknummers.

Veel organisaties gebruiken zelf-gedefinieerde alfanumerieke nummers
zoals ``PAT-2026-001234`` (patiëntnummer), ``2026-OND-09812``
(dossiernummer) of ``CASE-12345``. Deze passen niet in de generieke
``KvK``/``BIG``/``BSN``-patronen, maar zijn wél PII zodra je ze in een
dossier kan opzoeken.

Strategie: we matchen alleen op formats die letters én cijfers bevatten
(zodat losse jaartallen of versies niet getriggerd worden) én alleen
mét een nabij label — ``Patiëntnummer:``, ``Dossier``, ``Zaaknummer``,
``Aanvraag``, ``Ticket``, ``Kenmerk``, ``Referentie``, ``Case`` etc.

Het entity-type is ``INTERNAL_CASE_NUMBER`` zodat de UI dit
gemakkelijk onder de bestaande "ID- en bedrijfsnummers"-categorie
kan hangen.
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


__all__ = ["InternalCaseNumberRecognizer"]


# Patroon-bibliotheek (alle in één regex met named groups voor logging
# zou makkelijker zijn maar Presidio interesseert dat niet).
_PATTERNS: tuple[re.Pattern[str], ...] = (
    # PAT-2026-001234, ZAAK-25-9812, CASE-12345-A
    re.compile(
        r"(?<![A-Za-z0-9])"
        r"[A-Z]{2,6}-\d{2,4}-\d{3,10}(?:-[A-Z0-9]{1,4})?"
        r"(?![A-Za-z0-9])"
    ),
    # 2026-OND-09812, 25-DOS-1234
    re.compile(
        r"(?<![A-Za-z0-9])"
        r"\d{2,4}-[A-Z]{2,6}-\d{3,10}"
        r"(?![A-Za-z0-9])"
    ),
    # PAT2026001234, ZAAK20251234 — letters direct gevolgd door cijfers
    re.compile(
        r"(?<![A-Za-z0-9])"
        r"[A-Z]{3,6}\d{5,12}"
        r"(?![A-Za-z0-9])"
    ),
)

# Label-patroon dat *vlak voor* het nummer moet staan (binnen ~40 tekens
# en op dezelfde regel). Dit voorkomt dat we per ongeluk een random
# product-SKU markeren.
_LABEL_RE = re.compile(
    r"\b(?:"
    r"patiënt(?:en)?(?:nummer|id|code)?|patient(?:en)?(?:nummer|id|code)?|"
    r"dossier(?:nummer|id|code)?|"
    r"zaak(?:nummer|id|code)?|"
    r"aanvraag(?:nummer|id)?|"
    r"ticket(?:nummer|id)?|"
    r"kenmerk|referentie(?:nummer)?|"
    r"case(?:nummer|number|id)?|"
    r"klantnummer|cliëntnummer|clientnummer|"
    r"bestelnummer|ordernummer|order-?id|"
    r"factuurnummer|"
    r"meldnummer|incidentnummer|incident-?id|"
    r"onderzoeksnummer|onderzoek-?id"
    r")\b[^\n]{0,40}$",
    flags=re.IGNORECASE,
)


def _has_letter_and_digit(text: str) -> bool:
    return any(c.isalpha() for c in text) and any(c.isdigit() for c in text)


class InternalCaseNumberRecognizer(EntityRecognizer):
    """Detecteert interne dossier-/patiënt-/zaaknummers.

    Score:
    * ``0.85`` als er een expliciet label vlak vooraan staat
      (Patiëntnummer:, Dossier:, Zaaknummer: …).
    * ``0.55`` zonder zo'n label — alleen het patroon zelf, en alleen
      als het patroon onmiskenbaar gestructureerd is (twee koppeltekens
      in het format ``LET-NUM-NUM`` of ``NUM-LET-NUM``).
    """

    BOOSTED_SCORE: ClassVar[float] = 0.85
    BASE_SCORE: ClassVar[float] = 0.55

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["INTERNAL_CASE_NUMBER"],
            supported_language=supported_language,
            name="InternalCaseNumberRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if "INTERNAL_CASE_NUMBER" not in entities:
            return []

        results: list[RecognizerResult] = []
        seen: set[tuple[int, int]] = set()

        for pattern_idx, pattern in enumerate(_PATTERNS):
            for match in pattern.finditer(text):
                start, end = match.start(), match.end()
                value = match.group()

                if (start, end) in seen:
                    continue

                if not _has_letter_and_digit(value):
                    continue

                preceding = text[max(0, start - 80) : start]
                has_label = _LABEL_RE.search(preceding) is not None

                # Patroon 0 en 1 zijn structureel sterk genoeg om ook
                # zonder label te triggeren. Patroon 2 (LETTERS+CIJFERS
                # zonder koppeltekens) eist altijd een label, anders
                # vangt het te veel SKU's en versies op.
                if not has_label:
                    if pattern_idx == 2:
                        continue
                    score = self.BASE_SCORE
                else:
                    score = self.BOOSTED_SCORE

                explanation = AnalysisExplanation(
                    recognizer=self.name,
                    original_score=score,
                    pattern_name=f"internal_case_p{pattern_idx}",
                    pattern=pattern.pattern,
                    validation_result=None,
                    textual_explanation=(
                        "Intern dossier-/patiëntnummer "
                        f"({'met' if has_label else 'zonder'} label-context)"
                    ),
                )

                results.append(
                    RecognizerResult(
                        entity_type="INTERNAL_CASE_NUMBER",
                        start=start,
                        end=end,
                        score=score,
                        analysis_explanation=explanation,
                        recognition_metadata={
                            RecognizerResult.RECOGNIZER_NAME_KEY: self.name,
                            RecognizerResult.RECOGNIZER_IDENTIFIER_KEY: self.id,
                        },
                    )
                )
                seen.add((start, end))

        return results

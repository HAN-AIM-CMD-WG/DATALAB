"""A general PII model as an extra layer: ``bardsai/eu-pii-anonimization-multilang-v3``.

Measured on our independent test set it finds what our rules and SoNaR miss
(single first names, values in table cells), but it also tags a nine-digit
order number as a personal identifier. So its output is translated to our
entity types and goes through the same checks as our own recognizers: Elfproef
for nine-digit identifiers, mod-97 for IBAN, Luhn for payment cards. Labels
without a matching category in the app are dropped. The post-filter then
treats these detections like any other (labels, overlaps, block boundaries).

The model is downloaded on request in the Model Manager and loaded from disk
only, in the background, like SoNaR.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, ClassVar

from presidio_analyzer import AnalysisExplanation, EntityRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts

from pii_engine.recognizers.lazy_model import (
    LazyModel,
    LoadState,
    local_token_classifier,
    text_windows,
)
from pii_engine.validation import digits_only, iban_valid, is_valid_bsn, luhn_valid

if TYPE_CHECKING:
    from transformers import Pipeline

__all__ = ["PII_MODEL_ENTITIES", "PiiModelRecognizer"]


def _phone_plausible(value: str) -> bool:
    """10 to 15 digits, or an international number starting with +."""
    count = len(digits_only(value))
    return 10 <= count <= 15 or (value.startswith("+") and 8 <= count <= 15)


# Model label -> (our entity type, check the detected text must pass).
_LABELS: dict[str, tuple[str, Callable[[str], bool] | None]] = {
    "PERSON_NAME": ("PERSON", None),
    "PERSON_ALIAS": ("PERSON", None),
    "POSTAL_ADDRESS": ("LOCATION", None),
    "LOCATION": ("LOCATION", None),
    "ORGANIZATION_NAME": ("ORGANIZATION", None),
    "EMAIL_ADDRESS": ("EMAIL_ADDRESS", None),
    "PHONE_NUMBER": ("PHONE_NUMBER", _phone_plausible),
    "BANK_ACCOUNT_IDENTIFIER": ("IBAN_CODE", iban_valid),
    "PAYMENT_CARD": ("CREDIT_CARD", luhn_valid),
    "DATE_OF_BIRTH": ("BIRTH_DATE", None),
    "IP_ADDRESS": ("IP_ADDRESS", None),
    "IDENTIFYING_LINK": ("PERSONAL_URL", None),
    "URL": ("URL", None),
    "CONTACT_HANDLE": ("SOCIAL_HANDLE", None),
    "AUTH_SECRET": ("PASSWORD", None),
}
# Identifiers: a BSN when it passes the Elfproef, dropped when it is eight or
# nine digits that fail it (an order or invoice number), otherwise kept as a
# personal identifier (passport, student or customer number).
_IDENTIFIER_LABELS = frozenset({"PERSON_IDENTIFIER", "DOCUMENT_IDENTIFIER"})
_NUMBER = re.compile(r"[\d .\-]+")

PII_MODEL_ENTITIES: list[str] = sorted(
    {entity for entity, _ in _LABELS.values()} | {"NL_BSN", "PERSON_IDENTIFIER"}
)


def _identifier_type(value: str) -> str | None:
    if _NUMBER.fullmatch(value) and len(digits_only(value)) in (8, 9):
        return "NL_BSN" if is_valid_bsn(value) else None
    return "PERSON_IDENTIFIER"


class PiiModelRecognizer(EntityRecognizer):
    DEFAULT_MODEL_NAME: ClassVar[str] = "bardsai/eu-pii-anonimization-multilang-v3"
    DEFAULT_SCORE_MIN: ClassVar[float] = 0.5

    def __init__(
        self,
        supported_language: str = "nl",
        model_name: str | None = None,
        score_min: float | None = None,
    ) -> None:
        super().__init__(
            supported_entities=PII_MODEL_ENTITIES,
            supported_language=supported_language,
            name="PiiModelRecognizer",
        )
        self._model_name = model_name or self.DEFAULT_MODEL_NAME
        self._score_min = score_min if score_min is not None else self.DEFAULT_SCORE_MIN
        self._model: LazyModel[Pipeline] = LazyModel(
            self._model_name, lambda: local_token_classifier(self._model_name)
        )

    def load(self) -> None:
        """Lazy: see ``warm_up``."""

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def state(self) -> LoadState:
        return self._model.state

    @property
    def load_error(self) -> str | None:
        return self._model.error

    def warm_up(self) -> None:
        self._model.warm_up()

    def _to_result(
        self, text: str, start: int, end: int, label: str, score: float
    ) -> RecognizerResult | None:
        # The tokenizer can include the space before a word, or stop inside
        # one: "18204957" out of "318204957". Checks run on the whole word.
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        while start > 0 and text[start - 1].isalnum():
            start -= 1
        while end < len(text) and text[end].isalnum():
            end += 1
        if start >= end or score < self._score_min:
            return None
        value = text[start:end]
        if label in _IDENTIFIER_LABELS:
            entity: str | None = _identifier_type(value)
        elif label in _LABELS:
            entity, check = _LABELS[label]
            if check is not None and not check(value):
                entity = None
        else:
            entity = None
        if entity is None:
            return None
        return RecognizerResult(
            entity_type=entity,
            start=start,
            end=end,
            score=score,
            analysis_explanation=AnalysisExplanation(
                recognizer="PiiModelRecognizer",
                original_score=score,
                pattern_name=label,
                pattern="",
                validation_result=True,
                textual_explanation=f"PII-model: {label}.",
            ),
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        wanted = set(entities) if entities else set(PII_MODEL_ENTITIES)
        if not text.strip() or not wanted.intersection(PII_MODEL_ENTITIES):
            return []
        try:
            pipe = self._model.get()
        except Exception:
            # Reported through the pipeline status; the app shows "Beperkt".
            return []

        best: dict[tuple[int, int, str], RecognizerResult] = {}
        for offset, chunk in text_windows(text, size=2000, overlap=200):
            raw: list[dict[str, Any]] = pipe(chunk)
            for ent in raw:
                result = self._to_result(
                    text,
                    offset + int(ent["start"]),
                    offset + int(ent["end"]),
                    str(ent.get("entity_group", "")),
                    float(ent.get("score", 0.0)),
                )
                if result is None or result.entity_type not in wanted:
                    continue
                key = (result.start, result.end, result.entity_type)
                if key not in best or result.score > best[key].score:
                    best[key] = result
        return list(best.values())

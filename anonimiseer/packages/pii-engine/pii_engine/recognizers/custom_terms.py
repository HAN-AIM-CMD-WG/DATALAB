"""An organisation's own terms, found by ``fastino/gliner2-privacy-filter-PII-multi``.

An organisation profile can list terms that are personal or confidential for
that organisation but in no PII training set, such as "dossiernummer" or
"projectcode", each with a short description. GLiNER2 finds them from the
label and description alone; in our test it found nine of nine without a wrong
detection, also with look-alike reference numbers side by side.

Each term becomes its own entity type, ``TERM_<LABEL>``, so the pseudonym says
what was replaced (``TERM_DOSSIERNUMMER_1``). The model is downloaded on request
and loaded from disk only, in the background.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any, ClassVar

from presidio_analyzer import AnalysisExplanation, EntityRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts

from pii_engine.recognizers.lazy_model import (
    LazyModel,
    LoadState,
    require_local_hf_model,
    text_windows,
)

__all__ = ["CustomTerm", "CustomTermsRecognizer", "term_entity_type"]

TERM_PREFIX = "TERM_"


@dataclass(frozen=True)
class CustomTerm:
    label: str
    description: str = ""


def term_entity_type(label: str) -> str:
    """``Dossier-nummer`` becomes ``TERM_DOSSIER_NUMMER``."""
    ascii_label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "_", ascii_label).strip("_").upper()
    return TERM_PREFIX + (slug or "BEGRIP")


def _load_gliner2(repo_id: str) -> Any:
    cache_dir = require_local_hf_model(repo_id)
    from gliner2 import GLiNER2
    from huggingface_hub import snapshot_download

    path = snapshot_download(repo_id, cache_dir=cache_dir, local_files_only=True)
    return GLiNER2.from_pretrained(path)


class CustomTermsRecognizer(EntityRecognizer):
    DEFAULT_MODEL_NAME: ClassVar[str] = "fastino/gliner2-privacy-filter-PII-multi"
    DEFAULT_THRESHOLD: ClassVar[float] = 0.3

    def __init__(
        self,
        terms: list[CustomTerm],
        supported_language: str = "nl",
        model_name: str | None = None,
        threshold: float | None = None,
    ) -> None:
        self._labels = {t.label: t.description or t.label for t in terms}
        self._types = {t.label: term_entity_type(t.label) for t in terms}
        super().__init__(
            supported_entities=sorted(set(self._types.values())),
            supported_language=supported_language,
            name="CustomTermsRecognizer",
        )
        self._model_name = model_name or self.DEFAULT_MODEL_NAME
        self._threshold = threshold if threshold is not None else self.DEFAULT_THRESHOLD
        self._model: LazyModel[Any] = LazyModel(
            self._model_name, lambda: _load_gliner2(self._model_name)
        )

    def load(self) -> None:
        """Lazy: see ``warm_up``."""

    @property
    def state(self) -> LoadState:
        return self._model.state

    @property
    def load_error(self) -> str | None:
        return self._model.error

    def warm_up(self) -> None:
        self._model.warm_up()

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        wanted = set(entities) if entities else set(self._types.values())
        labels = {
            label: desc for label, desc in self._labels.items() if self._types[label] in wanted
        }
        if not text.strip() or not labels:
            return []
        try:
            model = self._model.get()
        except Exception:
            # Reported through the pipeline status; the app shows "Beperkt".
            return []

        best: dict[tuple[int, int, str], RecognizerResult] = {}
        for offset, chunk in text_windows(text, size=1200, overlap=150):
            found = model.extract_entities(
                chunk,
                labels,
                threshold=self._threshold,
                include_spans=True,
                include_confidence=True,
            )
            for label, values in (found.get("entities") or {}).items():
                entity = self._types.get(label)
                if entity is None:
                    continue
                for value in values:
                    if not isinstance(value, dict) or "start" not in value:
                        continue
                    start = offset + int(value["start"])
                    end = offset + int(value["end"])
                    score = float(value.get("confidence", 0.0))
                    key = (start, end, entity)
                    if key in best and best[key].score >= score:
                        continue
                    best[key] = RecognizerResult(
                        entity_type=entity,
                        start=start,
                        end=end,
                        score=score,
                        analysis_explanation=AnalysisExplanation(
                            recognizer="CustomTermsRecognizer",
                            original_score=score,
                            pattern_name=label,
                            pattern="",
                            validation_result=True,
                            textual_explanation=f"Eigen begrip uit het profiel: {label}.",
                        ),
                    )
        return list(best.values())

"""Presidio-recognizer gebaseerd op de Nederlandse SoNaR-NER BERT.

Model: ``wietsedv/bert-base-dutch-cased-finetuned-sonar-ner``

Achtergrond:
    spaCy ``nl_core_news_lg`` presteert voor gemiddelde Nederlandse tekst
    redelijk, maar mist relatief veel persoonsnamen met tussenvoegsels
    (``van den Broek``, ``ter Horst``), informele aanspreekvormen, minder
    frequente achternamen, en kortere orgnamen. Het SoNaR-gefinetunde model
    van Wietsedv is getraind op het SoNaR-corpus (Nederlandse transcripties,
    Wikipedia, nieuws) en haalt op PERSON/LOCATION/ORG duidelijk hogere
    recall op Nederlandse tekst.

Integratie:
    Deze recognizer laadt het model lazy (pas bij eerste call) zodat
    startup niet blokkeert. Het model blijft daarna in geheugen. Torch
    CPU-inference voor een korte zin kost ~50-150ms; voor langere chunks
    wordt geadviseerd deze recognizer alleen selectief aan te zetten via
    ``PII_ENGINE_ENABLE_SONAR``.

    Dit is een zuivere Python/PyTorch implementatie. Voor snellere inference
    in productie kan het model geëxporteerd worden naar ONNX via ``optimum``;
    die optimalisatie zit in de backlog (Fase 4 performance-tuning).
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, Any

from presidio_analyzer import EntityRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts

if TYPE_CHECKING:
    from transformers import Pipeline

logger = logging.getLogger(__name__)

__all__ = ["SONAR_ENTITIES", "SONAR_LABEL_MAP", "SonarRecognizer"]

# Presidio entity types die deze recognizer ondersteunt. We mappen alleen
# naar types die ook door de rest van de pijplijn gedragen worden zodat
# merge/dedup met spaCy en regex klopt.
SONAR_LABEL_MAP: dict[str, str] = {
    "PER": "PERSON",
    "LOC": "LOCATION",
    "ORG": "ORGANIZATION",
    # MISC/PRO/EVE laten we expliciet vallen: te ambigu voor PII-doeleinden
    # en levert false positives op tech-/product-termen.
}

SONAR_ENTITIES: list[str] = sorted(set(SONAR_LABEL_MAP.values()))


class SonarRecognizer(EntityRecognizer):
    """Wrapper rond ``wietsedv/bert-base-dutch-cased-finetuned-sonar-ner``.

    Gebruikt de HuggingFace ``token-classification`` pipeline met
    ``aggregation_strategy="simple"`` zodat sub-tokens automatisch
    samengevoegd worden tot hele entity-spans.
    """

    DEFAULT_MODEL_NAME = "wietsedv/bert-base-dutch-cased-finetuned-sonar-ner"
    DEFAULT_SCORE_MIN = 0.5

    def __init__(
        self,
        supported_language: str = "nl",
        model_name: str | None = None,
        score_min: float | None = None,
        name: str = "SonarRecognizer",
    ) -> None:
        super().__init__(
            supported_entities=SONAR_ENTITIES,
            supported_language=supported_language,
            name=name,
        )
        self._model_name = model_name or self.DEFAULT_MODEL_NAME
        self._score_min = score_min if score_min is not None else self.DEFAULT_SCORE_MIN
        self._pipeline: Pipeline | None = None
        self._pipeline_lock = threading.Lock()

    def load(self) -> None:
        """Presidio roept dit eenmaal aan bij registratie. We stellen het
        zware model-load-moment uit tot de eerste echte analyse-call."""
        # Bewust no-op: lazy loading.
        return None

    def _get_pipeline(self) -> Pipeline:
        if self._pipeline is not None:
            return self._pipeline
        with self._pipeline_lock:
            if self._pipeline is not None:
                return self._pipeline
            logger.info("SoNaR NER-model laden: %s", self._model_name)
            # Import binnen de functie om startup van pii-engine niet te
            # blokkeren als sonar-extras niet geïnstalleerd zijn.
            from transformers import pipeline as hf_pipeline

            self._pipeline = hf_pipeline(
                task="token-classification",
                model=self._model_name,
                aggregation_strategy="simple",
            )
            logger.info("SoNaR NER-model geladen")
            return self._pipeline

    @staticmethod
    def _is_full_word(text: str, start: int, end: int) -> bool:
        """Afbakening-check zoals in de originele referentie-implementatie:
        de match moet aan beide zijden begrensd worden door niet-alnum
        tekens of tekst-begin/-einde. Dit voorkomt dat we per-ongeluk
        delen van langere woorden als entiteit markeren."""
        left = start == 0 or not text[start - 1].isalnum()
        right = end == len(text) or not text[end].isalnum()
        return left and right

    @staticmethod
    def _expand_to_word_boundaries(text: str, start: int, end: int) -> tuple[int, int]:
        """Breid de span uit tot links/rechts de eerste niet-alfanumerieke
        grens of tekst-rand. Nodig omdat de BERT-tokenizer soms midden in
        een woord eindigt (bijv. ``den`` wordt getokeniseerd als
        ``de`` + ``##n`` en alleen ``de`` krijgt de PER-tag)."""
        while start > 0 and text[start - 1].isalnum():
            start -= 1
        while end < len(text) and text[end].isalnum():
            end += 1
        return start, end

    @staticmethod
    def _merge_adjacent(
        spans: list[tuple[int, int, str, float]],
        text: str,
    ) -> list[tuple[int, int, str, float]]:
        """Voeg aangrenzende spans van dezelfde entity samen.

        Het SoNaR-model levert bij aggregation_strategy="simple" voor namen met
        dubbele tussenvoegsels soms twee spans op ("van de" + "Broek"). Als de
        gap tussen twee opeenvolgende spans alleen whitespace bevat en beide
        dezelfde entity-klasse hebben, combineren we ze tot één span.
        """
        if not spans:
            return []
        spans_sorted = sorted(spans, key=lambda s: s[0])
        merged: list[tuple[int, int, str, float]] = [spans_sorted[0]]
        for start, end, label, score in spans_sorted[1:]:
            prev_start, prev_end, prev_label, prev_score = merged[-1]
            gap = text[prev_end:start]
            if label == prev_label and gap and gap.strip() == "":
                # Aangrenzend via alleen whitespace: samenvoegen, laagste score
                # behouden als veilige ondergrens.
                merged[-1] = (prev_start, end, prev_label, min(prev_score, score))
            else:
                merged.append((start, end, label, score))
        return merged

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if not text or not text.strip():
            return []

        wanted = set(entities) if entities else set(SONAR_ENTITIES)
        # Als er niets uit onze set wordt gevraagd, hoeven we het model
        # niet eens te activeren.
        if not wanted.intersection(SONAR_ENTITIES):
            return []

        try:
            pipe = self._get_pipeline()
            raw_entities: list[dict[str, Any]] = pipe(text)
        except Exception as exc:  # pragma: no cover - model/runtime failures
            logger.warning("SoNaR-pipeline faalde: %s", exc)
            return []

        candidates: list[tuple[int, int, str, float]] = []
        for ent in raw_entities:
            label_raw = str(ent.get("entity_group", "")).upper()
            mapped = SONAR_LABEL_MAP.get(label_raw)
            if mapped is None or mapped not in wanted:
                continue
            start = int(ent["start"])
            end = int(ent["end"])
            score = float(ent.get("score", 0.0))
            if score < self._score_min:
                continue
            if start >= end or end > len(text):
                continue
            start, end = self._expand_to_word_boundaries(text, start, end)
            candidates.append((start, end, mapped, score))

        merged = self._merge_adjacent(candidates, text)

        results: list[RecognizerResult] = []
        for start, end, mapped, score in merged:
            if not self._is_full_word(text, start, end):
                continue
            results.append(
                RecognizerResult(
                    entity_type=mapped,
                    start=start,
                    end=end,
                    score=score,
                )
            )
        return results

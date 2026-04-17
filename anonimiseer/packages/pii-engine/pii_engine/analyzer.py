"""Analyzer-factory voor de PII-engine.

Zet de Presidio ``AnalyzerEngine`` op met NL-NLP-pipeline en alle aanvullende
recognizers uit :mod:`pii_engine.recognizers`. Gebruik :func:`build_analyzer`
voor een enkele run of :func:`get_default_analyzer` voor een gedeelde instantie
binnen de FastAPI-app.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngine, NlpEngineProvider

from pii_engine.config import Settings, get_settings
from pii_engine.recognizers import (
    BsnRecognizer,
    NlPhoneRecognizer,
    NlPostcodeRecognizer,
    NlStudentnrRecognizer,
)

logger = logging.getLogger(__name__)


def _build_nlp_engine(settings: Settings) -> NlpEngine:
    """Bouw de NLP-engine (spaCy) of val terug op een lege NL-pipeline.

    In CI en op kale dev-machines is het spaCy-model niet geïnstalleerd. Dan
    gebruiken we ``spacy.blank("nl")`` onder de motorkap via Presidio's
    provider. Voor productie installeer je de extra ``nl-large`` (of ``nl-small``).
    """

    configuration = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "nl", "model_name": settings.spacy_model}],
    }
    try:
        provider = NlpEngineProvider(nlp_configuration=configuration)
        return provider.create_engine()
    except (OSError, ValueError) as exc:
        if not settings.allow_blank_nlp_fallback:
            raise
        logger.warning(
            "spaCy-model '%s' niet gevonden (%s). Val terug op blank('nl'). "
            "Installeer extras `nl-small` of `nl-large` voor productie.",
            settings.spacy_model,
            exc,
        )
        import spacy  # lazy import voor fallback-pad

        # Maak een dummy-pipeline en registreer als 'nl_blank'.
        spacy.blank("nl")
        fallback_conf = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "nl", "model_name": "nl"}],
        }
        try:
            return NlpEngineProvider(nlp_configuration=fallback_conf).create_engine()
        except Exception:  # pragma: no cover - laatste redmiddel
            # Directe constructie via spacy-blank als Presidio's provider ook faalt.
            from presidio_analyzer.nlp_engine import SpacyNlpEngine

            engine = SpacyNlpEngine(models=[{"lang_code": "nl", "model_name": "nl"}])
            return engine


def build_analyzer(settings: Settings | None = None) -> AnalyzerEngine:
    """Bouw een nieuwe ``AnalyzerEngine`` met NL-recognizers.

    Args:
        settings: Optioneel overschrijven van de gecachede settings (handig
            voor tests).
    """

    settings = settings or get_settings()

    registry = RecognizerRegistry(supported_languages=["nl"])
    if settings.enable_presidio_builtins:
        registry.load_predefined_recognizers(languages=["nl"])

    if settings.enable_bsn:
        registry.add_recognizer(BsnRecognizer(supported_language="nl"))
    if settings.enable_nl_phone:
        registry.add_recognizer(NlPhoneRecognizer(supported_language="nl"))
    if settings.enable_nl_postcode:
        registry.add_recognizer(NlPostcodeRecognizer(supported_language="nl"))
    if settings.enable_nl_studentnr:
        registry.add_recognizer(NlStudentnrRecognizer(supported_language="nl"))

    nlp_engine = _build_nlp_engine(settings)
    analyzer = AnalyzerEngine(
        registry=registry,
        nlp_engine=nlp_engine,
        supported_languages=["nl"],
        default_score_threshold=settings.default_score_threshold,
    )
    logger.info(
        "PII-engine analyzer geladen: %d recognizers, spaCy=%s.",
        sum(1 for _ in registry.recognizers),
        settings.spacy_model,
    )
    return analyzer


@lru_cache(maxsize=1)
def get_default_analyzer() -> AnalyzerEngine:
    """Cached singleton voor de FastAPI-app."""

    return build_analyzer()

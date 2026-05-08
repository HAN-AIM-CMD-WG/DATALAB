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
from pii_engine.runtime import effective_settings
from pii_engine.recognizers import (
    BankNameRecognizer,
    BeRijksregisterRecognizer,
    BicRecognizer,
    BsnRecognizer,
    CreditCardMetaRecognizer,
    EuCityRecognizer,
    GpsCoordinateRecognizer,
    IntlAddressRecognizer,
    EduClassRecognizer,
    EduCourseCodeRecognizer,
    EduCrohoRecognizer,
    EduLabeledPersonRecognizer,
    HanPortalStudentIdRecognizer,
    InternalCaseNumberRecognizer,
    NlAddressRecognizer,
    NlAgbRecognizer,
    NlDateRecognizer,
    NlFirstNameRecognizer,
    NlIdCardRecognizer,
    NlBigRecognizer,
    NlBtwRecognizer,
    NlEmployeeIdRecognizer,
    NlKentekenRecognizer,
    NlKvkRecognizer,
    NlOrganizationRecognizer,
    NlOvChipkaartRecognizer,
    NlPhoneRecognizer,
    NlPolicyNumberRecognizer,
    NlPostcodeRecognizer,
    NlRijbewijsRecognizer,
    NlStudentnrRecognizer,
    OnlineIdentifierRecognizer,
    StageOrganizationRecognizer,
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
            voor tests). Als ``None``, gebruiken we de runtime-overrides
            bovenop ``Settings`` zodat keuzes uit de Model Manager
            doorwerken zonder engine-restart.
    """

    settings = settings or effective_settings()

    registry = RecognizerRegistry(supported_languages=["nl"])
    if settings.enable_presidio_builtins:
        registry.load_predefined_recognizers(languages=["nl"])
        # Presidio's standaard CC/IP/MAC/URL/Email-recognizers zijn alleen
        # in 'en' aangemeld. Voor NL-documenten missen we ze dan helemaal.
        # We instantiëren ze expliciet als NL-variant zodat creditcards,
        # IP-adressen en MAC-adressen ook in NL-tekst gedetecteerd worden.
        from presidio_analyzer.predefined_recognizers import (
            CreditCardRecognizer,
            EmailRecognizer,
            IpRecognizer,
            MacAddressRecognizer,
            UrlRecognizer,
        )

        registry.add_recognizer(CreditCardRecognizer(supported_language="nl"))
        registry.add_recognizer(IpRecognizer(supported_language="nl"))
        registry.add_recognizer(MacAddressRecognizer(supported_language="nl"))
        registry.add_recognizer(EmailRecognizer(supported_language="nl"))
        registry.add_recognizer(UrlRecognizer(supported_language="nl"))

    if settings.enable_bsn:
        registry.add_recognizer(BsnRecognizer(supported_language="nl"))
    if settings.enable_nl_phone:
        registry.add_recognizer(NlPhoneRecognizer(supported_language="nl"))
    if settings.enable_nl_postcode:
        registry.add_recognizer(NlPostcodeRecognizer(supported_language="nl"))
    if settings.enable_nl_address:
        registry.add_recognizer(NlAddressRecognizer(supported_language="nl"))
    if settings.enable_intl_address:
        registry.add_recognizer(IntlAddressRecognizer(supported_language="nl"))
    if settings.enable_eu_cities:
        registry.add_recognizer(EuCityRecognizer(supported_language="nl"))
    if settings.enable_nl_date:
        registry.add_recognizer(NlDateRecognizer(supported_language="nl"))
    if settings.enable_creditcard_meta:
        registry.add_recognizer(
            CreditCardMetaRecognizer(supported_language="nl")
        )
    if settings.enable_nl_firstnames:
        registry.add_recognizer(NlFirstNameRecognizer(supported_language="nl"))
    if settings.enable_nl_studentnr:
        registry.add_recognizer(NlStudentnrRecognizer(supported_language="nl"))
    if settings.enable_nl_organization:
        registry.add_recognizer(NlOrganizationRecognizer(supported_language="nl"))
    if settings.enable_bic:
        registry.add_recognizer(BicRecognizer(supported_language="nl"))
    if settings.enable_bank_names:
        registry.add_recognizer(BankNameRecognizer(supported_language="nl"))
    if settings.enable_online_identifiers:
        registry.add_recognizer(
            OnlineIdentifierRecognizer(supported_language="nl")
        )
    if settings.enable_nl_kenteken:
        registry.add_recognizer(NlKentekenRecognizer(supported_language="nl"))
    if settings.enable_gps:
        registry.add_recognizer(GpsCoordinateRecognizer(supported_language="nl"))
    if settings.enable_internal_case:
        registry.add_recognizer(
            InternalCaseNumberRecognizer(supported_language="nl")
        )
    if settings.enable_nl_identifiers:
        registry.add_recognizer(NlKvkRecognizer(supported_language="nl"))
        registry.add_recognizer(NlBigRecognizer(supported_language="nl"))
        registry.add_recognizer(NlAgbRecognizer(supported_language="nl"))
        registry.add_recognizer(NlRijbewijsRecognizer(supported_language="nl"))
        registry.add_recognizer(NlBtwRecognizer(supported_language="nl"))
        registry.add_recognizer(NlPolicyNumberRecognizer(supported_language="nl"))
        registry.add_recognizer(NlIdCardRecognizer(supported_language="nl"))
        registry.add_recognizer(BeRijksregisterRecognizer(supported_language="nl"))
    if settings.enable_han_edu:
        registry.add_recognizer(NlEmployeeIdRecognizer(supported_language="nl"))
        registry.add_recognizer(EduClassRecognizer(supported_language="nl"))
        registry.add_recognizer(EduCourseCodeRecognizer(supported_language="nl"))
        registry.add_recognizer(EduCrohoRecognizer(supported_language="nl"))
        registry.add_recognizer(EduLabeledPersonRecognizer(supported_language="nl"))
        registry.add_recognizer(StageOrganizationRecognizer(supported_language="nl"))
        registry.add_recognizer(NlOvChipkaartRecognizer(supported_language="nl"))
        registry.add_recognizer(HanPortalStudentIdRecognizer(supported_language="nl"))
    if settings.enable_sonar:
        try:
            from pii_engine.recognizers.sonar import SonarRecognizer

            registry.add_recognizer(
                SonarRecognizer(
                    supported_language="nl",
                    model_name=settings.sonar_model,
                    score_min=settings.sonar_score_min,
                )
            )
        except ImportError as exc:
            logger.warning(
                "enable_sonar=True maar transformers/torch niet beschikbaar (%s). "
                "Installeer extras [sonar] om SoNaR-NER te gebruiken.",
                exc,
            )

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

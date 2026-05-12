"""Applicatie-instellingen voor de PII-engine.

Leest uit environment variables met prefix ``PII_ENGINE_``. Zie ``README.md``
voor het overzicht van alle variabelen.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuratie."""

    model_config = SettingsConfigDict(
        env_prefix="PII_ENGINE_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # NLP
    spacy_model: str = Field(
        default="nl_core_news_lg",
        description=(
            "spaCy-model voor Presidio. Valt terug op blank('nl') als niet geïnstalleerd "
            "(tenzij allow_blank_nlp_fallback uit staat). "
            "De PyInstaller-bundle bevat 'nl_core_news_lg' als basismodel voor de "
            "beste Nederlandse namen-recall."
        ),
    )
    allow_blank_nlp_fallback: bool = Field(
        default=True,
        description="Sta toe terug te vallen op een lege NL-pipeline als het spaCy-model mist. "
        "Zet op False in productie om een foutieve start te voorkomen.",
    )

    # Recognizers
    enable_bsn: bool = True
    enable_bic: bool = True
    enable_bank_names: bool = True
    enable_online_identifiers: bool = True
    enable_nl_phone: bool = True
    enable_nl_date: bool = True
    enable_intl_address: bool = True
    enable_eu_cities: bool = True
    enable_creditcard_meta: bool = True
    enable_nl_postcode: bool = True
    enable_nl_address: bool = True
    enable_nl_firstnames: bool = True
    enable_nl_studentnr: bool = True
    enable_nl_organization: bool = True
    enable_nl_kenteken: bool = True
    enable_gps: bool = True
    # Interne dossier-/patiënt-/zaaknummers (PAT-2026-001234,
    # 2026-OND-09812, CASE-12345). Patroon-gebaseerd; sterke matches
    # zonder label zijn 0.55, met label 0.85.
    enable_internal_case: bool = True
    # NL-specifieke identificatienummers (KvK, BIG, AGB, BTW, rijbewijs,
    # polisnummer, BE rijksregister). Zonder deze set wordt een KvK-nummer
    # vaak door Presidio als ``DATE_TIME`` gelabeld.
    enable_nl_identifiers: bool = True
    # HAN-/onderwijsspecifieke recognizers: personeelsnummer, klas-/groeps-
    # code, cursus-/vakcode, CROHO en mentor-/docent-label-personen. Staat
    # default aan omdat de pilot een HAN-deployment is; zet uit via env
    # ``PII_ENGINE_ENABLE_HAN_EDU=false`` bij inzet buiten onderwijs.
    enable_han_edu: bool = True
    enable_presidio_builtins: bool = True

    # SoNaR-BERT NER voor betere NL-PERSON/LOCATION/ORGANIZATION recall.
    # Default uit: zwaarder model (~440MB), traagt startup en per-call af.
    # Zet aan met PII_ENGINE_ENABLE_SONAR=true (en installeer `[sonar]` extras).
    enable_sonar: bool = False
    sonar_model: str = Field(
        default="wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
        description="HuggingFace-id van het SoNaR NER-model.",
    )
    sonar_score_min: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Minimum modelvertrouwen om een entiteit te accepteren.",
    )

    # Engine
    default_language: Literal["nl"] = "nl"
    default_score_threshold: float = Field(default=0.35, ge=0.0, le=1.0)

    # API
    host: str = "127.0.0.1"
    port: int = 8765
    cors_allow_origins: list[str] = Field(default_factory=lambda: ["http://localhost"])

    # Playground UI
    enable_playground: bool = Field(
        default=True,
        description="Serveert de lokale HTML-playground op '/' en '/playground'. "
        "Zet op False in productie als de engine publiekelijk bereikbaar is.",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor zodat .env één keer wordt gelezen."""

    return Settings()

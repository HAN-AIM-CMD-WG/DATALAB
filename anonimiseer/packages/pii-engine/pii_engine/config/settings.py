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
        description="spaCy-model voor Presidio. Valt terug op blank('nl') als niet geïnstalleerd.",
    )
    allow_blank_nlp_fallback: bool = Field(
        default=True,
        description="Sta toe terug te vallen op een lege NL-pipeline als het spaCy-model mist. "
        "Zet op False in productie om een foutieve start te voorkomen.",
    )

    # Recognizers
    enable_bsn: bool = True
    enable_nl_phone: bool = True
    enable_nl_postcode: bool = True
    enable_nl_studentnr: bool = True
    enable_presidio_builtins: bool = True

    # Engine
    default_language: Literal["nl"] = "nl"
    default_score_threshold: float = Field(default=0.35, ge=0.0, le=1.0)

    # API
    host: str = "127.0.0.1"
    port: int = 8765
    cors_allow_origins: list[str] = Field(default_factory=lambda: ["http://localhost"])


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor zodat .env één keer wordt gelezen."""

    return Settings()

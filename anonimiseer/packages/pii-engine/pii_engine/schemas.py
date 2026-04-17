"""Pydantic-schemas voor de REST-API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from pii_engine import __version__


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str = __version__
    recognizers: int
    spacy_model: str


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=False)

    text: str = Field(..., min_length=0, description="Te analyseren brontekst.")
    language: Literal["nl"] = "nl"
    entities: list[str] | None = Field(
        default=None,
        description="Optionele filter: alleen deze entiteitstypes terug. Default: alle geregistreerde.",
    )
    score_threshold: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Minimale confidence (0.0 tot 1.0). Standaard uit settings.",
    )


class AnalysisItem(BaseModel):
    entity_type: str
    start: int
    end: int
    score: float
    original: str


class AnalyzeResponse(BaseModel):
    items: list[AnalysisItem]


class AnonymizeRequest(AnalyzeRequest):
    mode: Literal["redact", "pseudonymize"] = "pseudonymize"
    preserve_mapping: bool = Field(
        default=True,
        description="Geef de pseudoniem-mapping terug in de response (alleen relevant bij mode='pseudonymize').",
    )


class AnonymizeItem(BaseModel):
    entity_type: str
    original: str
    pseudonym: str | None = None
    start: int
    end: int
    score: float | None = None


class MappingEntry(BaseModel):
    entity_type: str
    original: str
    pseudonym: str


class AnonymizeResponse(BaseModel):
    text: str
    items: list[AnonymizeItem]
    mapping: list[MappingEntry] | None = None

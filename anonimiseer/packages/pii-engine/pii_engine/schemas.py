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
    proof: str | None = Field(
        default=None,
        description=(
            "HMAC-SHA256 over de meegegeven ``nonce`` met het gedeelde geheim. "
            "Alleen gevuld als er een auth-token is ingesteld én er een nonce is "
            "meegestuurd. Hiermee stelt de app vast dat zij met háár engine praat."
        ),
    )


class ActiveModelInfo(BaseModel):
    """Een model dat momenteel door de detectie-pipeline wordt geladen."""

    id: str = Field(..., description="Registry-id, bv. 'spacy:nl_core_news_lg'.")
    label: str
    kind: Literal["spacy", "hf"]
    role: Literal["nlp", "ner"] = Field(
        ...,
        description=(
            "'nlp' = primaire spaCy-pipeline (tokenisatie/POS/ontology). 'ner' "
            "= aanvullend NER-model dat tokens labelt (bv. SoNaR-BERT)."
        ),
    )


class EngineConfigRequest(BaseModel):
    """Wijzig runtime welke modellen Anonimiseer in de pipeline laadt.

    Velden zijn optioneel: ``None`` = ongewijzigd laten.
    """

    spacy_model: str | None = Field(
        default=None,
        description="Pip-naam, bv. 'nl_core_news_md'. Moet geïnstalleerd zijn.",
    )
    enable_sonar: bool | None = Field(
        default=None,
        description="Schakel SoNaR-BERT in/uit. Vereist [sonar] extras.",
    )
    sonar_model: str | None = Field(
        default=None,
        description="HF-repo voor SoNaR (laat leeg voor default).",
    )
    enable_han_edu: bool | None = Field(
        default=None,
        description=(
            "Schakel het HAN-/onderwijsprofiel in/uit: klas-, cursus-, "
            "CROHO-, personeelsnummer- en mentor-/docent-labelherkenners."
        ),
    )
    ollama_model: str | None = Field(
        default=None,
        description="Ollama-tag (bv. 'qwen3.5:4b') voor LLM-rollen.",
    )
    ollama_review_enabled: bool | None = Field(
        default=None,
        description="Schakel de LLM-review na anonimisering in/uit.",
    )
    ollama_extra_ner_enabled: bool | None = Field(
        default=None,
        description="Schakel LLM-extra-NER in/uit (nog niet gebruikt).",
    )
    ollama_borderline_enabled: bool | None = Field(
        default=None,
        description="Schakel LLM-borderline-rechter in/uit (nog niet gebruikt).",
    )


class OllamaEngineState(BaseModel):
    """Ollama-integratie status voor de UI."""

    model: str | None = Field(default=None, description="Geselecteerde Ollama-tag.")
    daemon_running: bool = Field(default=False, description="Antwoordt de lokale daemon?")
    model_present: bool = Field(
        default=False,
        description="Staat het gekozen model daadwerkelijk in ``ollama list``?",
    )
    review_enabled: bool = False
    extra_ner_enabled: bool = False
    borderline_enabled: bool = False


class ActiveEngineResponse(BaseModel):
    """Wat de PII-engine nu écht gebruikt voor een ``/analyze``."""

    spacy_model: str
    sonar_enabled: bool
    sonar_model: str | None = None
    han_edu_enabled: bool = Field(
        default=True,
        description=(
            "Staat het HAN-/onderwijsprofiel aan? Als False worden de "
            "klas-, cursus-, CROHO-, personeelsnummer- en mentor-label-"
            "recognizers niet geladen."
        ),
    )
    score_threshold: float
    recognizers: list[str] = Field(
        default_factory=list,
        description="Klassennamen van alle aktieve recognizers.",
    )
    active_models: list[ActiveModelInfo] = Field(
        default_factory=list,
        description=(
            "Voor de UI: koppeling tussen Model Manager-registry en wat er live"
            " in de pipeline zit. Zo kan 'Actief'-badge correct getoond worden."
        ),
    )
    ollama: OllamaEngineState = Field(default_factory=OllamaEngineState)


class ReviewFindingSchema(BaseModel):
    snippet: str
    category: str
    explanation: str


class ReviewRequest(BaseModel):
    """Vraag om een LLM-second-opinion op een geanonimiseerde tekst."""

    text: str = Field(..., description="De reeds geanonimiseerde tekst.")
    model: str | None = Field(
        default=None,
        description="Override-Ollama-tag. Laat leeg voor runtime-keuze.",
    )


class ReviewResponse(BaseModel):
    model: str
    verdict: Literal["clean", "suspect", "unknown"]
    summary: str
    findings: list[ReviewFindingSchema] = Field(default_factory=list)
    raw_response: str = ""
    eval_duration_ms: int | None = None


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


class DocumentBlock(BaseModel):
    id: str
    kind: str
    start: int
    end: int


class DocumentExtractResponse(BaseModel):
    flat_text: str
    blocks: list[DocumentBlock]


class DocumentReplacement(BaseModel):
    start: int
    end: int
    replacement: str
    original: str | None = None


class ModelInfo(BaseModel):
    id: str
    label: str
    kind: Literal["spacy", "hf"]
    description: str
    size_mb: int
    install_target: str
    installed: bool
    local_path: str | None = None
    min_ram_mb: int = 0
    gpu_recommended: bool = False


class ModelListResponse(BaseModel):
    models: list[ModelInfo]


class InstallModelRequest(BaseModel):
    descriptor_id: str


class InstallTaskResponse(BaseModel):
    task_id: str
    descriptor_id: str
    state: Literal["pending", "running", "done", "error"]
    progress: float = Field(ge=0.0, le=1.0)
    message: str
    started_at: float
    finished_at: float | None = None


class DocumentApplyPayload(BaseModel):
    """JSON-payload die meekomt naast het originele bestand bij /document/apply."""

    replacements: list[DocumentReplacement]
    blocks: list[DocumentBlock]
    footer_note: str | None = Field(
        default=None,
        description=(
            "Optionele waarschuwingstekst die als watermerk/footer aan het"
            " document wordt toegevoegd. Doel is dat een lezer altijd kan"
            " zien dat dit een geautomatiseerde anonimisatie is."
        ),
    )

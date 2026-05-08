"""FastAPI-applicatie voor de PII-engine.

Endpoints:

- ``GET /health`` — liveness + metadata.
- ``POST /analyze`` — detecteert PII en geeft spans terug.
- ``POST /anonymize`` — detecteert + anonimiseert of pseudonimiseert.

De app draait standaard op ``127.0.0.1:8765`` (localhost only). CORS staat
alleen ``http://localhost`` toe; de Electron-app praat via native requests.
"""

from __future__ import annotations

import json
import logging
from importlib import resources
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from pii_engine import (
    __version__,
    documents,
    models as model_registry,
    ollama_client,
    ollama_review,
    runtime,
)
from pii_engine.analyzer import get_default_analyzer
from pii_engine.anonymizer import PseudonymMapping, anonymize_with_mode
from pii_engine.config import get_settings
from pii_engine.postfilter import filter_overlaps
from pii_engine.schemas import (
    ActiveEngineResponse,
    ActiveModelInfo,
    AnalysisItem,
    AnalyzeRequest,
    AnalyzeResponse,
    AnonymizeItem,
    AnonymizeRequest,
    AnonymizeResponse,
    DocumentApplyPayload,
    DocumentBlock,
    DocumentExtractResponse,
    EngineConfigRequest,
    HealthResponse,
    InstallModelRequest,
    InstallTaskResponse,
    MappingEntry,
    ModelInfo,
    ModelListResponse,
    OllamaEngineState,
    ReviewFindingSchema,
    ReviewRequest,
    ReviewResponse,
)

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Anonimiseer — PII-engine",
        description=(
            "Lokale Nederlandse PII-detectie en -anonimisering (Presidio + NL)."
            " Deze service is bedoeld voor localhost-gebruik door de Electron-app"
            " en de Open WebUI-filter. Zet nooit publiekelijk open."
        ),
        version=__version__,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=False,
        allow_methods=["POST", "GET"],
        allow_headers=["content-type"],
    )

    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    def health() -> HealthResponse:
        analyzer = get_default_analyzer()
        return HealthResponse(
            recognizers=sum(1 for _ in analyzer.registry.recognizers),
            spacy_model=settings.spacy_model,
        )

    @app.post("/analyze", response_model=AnalyzeResponse, tags=["pii"])
    def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
        analyzer = get_default_analyzer()
        try:
            results = analyzer.analyze(
                text=req.text,
                language=req.language,
                entities=req.entities,
                score_threshold=req.score_threshold,
                return_decision_process=True,
            )
        except Exception as exc:  # pragma: no cover
            logger.exception("Analyse mislukt")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        results = filter_overlaps(results, text=req.text)
        items = [
            AnalysisItem(
                entity_type=r.entity_type,
                start=r.start,
                end=r.end,
                score=round(r.score, 3),
                original=req.text[r.start : r.end],
            )
            for r in results
        ]
        return AnalyzeResponse(items=items)

    @app.post("/anonymize", response_model=AnonymizeResponse, tags=["pii"])
    def anonymize(req: AnonymizeRequest) -> AnonymizeResponse:
        analyzer = get_default_analyzer()
        try:
            results = analyzer.analyze(
                text=req.text,
                language=req.language,
                entities=req.entities,
                score_threshold=req.score_threshold,
                return_decision_process=True,
            )
            results = filter_overlaps(results, text=req.text)
            mapping = PseudonymMapping() if req.mode == "pseudonymize" else None
            out = anonymize_with_mode(
                text=req.text,
                results=results,
                mode=req.mode,
                mapping=mapping,
            )
        except Exception as exc:  # pragma: no cover
            logger.exception("Anonymisatie mislukt")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        response_mapping: list[MappingEntry] | None = None
        if req.mode == "pseudonymize" and req.preserve_mapping and out.mapping is not None:
            response_mapping = [MappingEntry(**entry) for entry in out.mapping]

        return AnonymizeResponse(
            text=out.text,
            items=[AnonymizeItem.model_validate(item) for item in out.items],
            mapping=response_mapping,
        )

    _MAX_DOC_BYTES = 50 * 1024 * 1024  # 50 MiB — ruim boven normale kantoordocumenten.

    _MIME_MAP = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pdf": "application/pdf",
    }

    async def _read_upload(upload: UploadFile) -> bytes:
        data = await upload.read()
        if len(data) > _MAX_DOC_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"bestand is te groot (>{_MAX_DOC_BYTES} bytes)",
            )
        return data

    @app.post(
        "/document/extract",
        response_model=DocumentExtractResponse,
        tags=["document"],
    )
    async def document_extract(file: UploadFile = File(...)) -> DocumentExtractResponse:
        if not file.filename:
            raise HTTPException(status_code=400, detail="bestand heeft geen naam")
        data = await _read_upload(file)
        try:
            result = documents.extract(data, file.filename)
        except documents.UnsupportedFormat as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover
            logger.exception("Extractie mislukt")
            raise HTTPException(status_code=500, detail=f"extractie mislukt: {exc}") from exc
        return DocumentExtractResponse(
            flat_text=result.flat_text,
            blocks=[DocumentBlock(id=b.id, kind=b.kind, start=b.start, end=b.end) for b in result.blocks],
        )

    @app.post("/document/apply", tags=["document"])
    async def document_apply(
        file: UploadFile = File(...),
        payload: str = Form(...),
    ) -> Response:
        if not file.filename:
            raise HTTPException(status_code=400, detail="bestand heeft geen naam")
        data = await _read_upload(file)
        try:
            parsed = DocumentApplyPayload.model_validate(json.loads(payload))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"ongeldige payload: {exc}") from exc
        try:
            result_bytes = documents.apply(
                data,
                file.filename,
                replacements=[
                    documents.AcceptedReplacement(
                        start=r.start, end=r.end, replacement=r.replacement, original=r.original
                    )
                    for r in parsed.replacements
                ],
                blocks=[
                    documents.Block(id=b.id, kind=b.kind, start=b.start, end=b.end)  # type: ignore[arg-type]
                    for b in parsed.blocks
                ],
                footer_note=parsed.footer_note,
            )
        except documents.UnsupportedFormat as exc:
            raise HTTPException(status_code=415, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover
            logger.exception("Toepassing mislukt")
            raise HTTPException(status_code=500, detail=f"toepassing mislukt: {exc}") from exc
        ext = Path(file.filename).suffix.lower()
        media_type = _MIME_MAP.get(ext, "application/octet-stream")
        return Response(content=result_bytes, media_type=media_type)

    @app.get("/engine/active", response_model=ActiveEngineResponse, tags=["meta"])
    def engine_active() -> ActiveEngineResponse:
        """Retourneert wat er nu écht in de detectie-pipeline zit.

        Gebruikt door de Electron Model Manager om een "Actief"-badge te
        tonen naast de juiste registry-modellen, zodat een gebruiker in één
        oogopslag ziet welk(e) model(len) Anonimiseer op dit moment voor de
        analyse gebruikt.
        """

        analyzer = get_default_analyzer()
        # Gebruik effectieve settings (incl. runtime-overrides via /engine/config).
        active_settings = runtime.effective_settings()
        recognizer_names = sorted(
            {type(r).__name__ for r in analyzer.registry.recognizers}
        )

        active: list[ActiveModelInfo] = []

        # Primaire spaCy-pipeline (altijd één, valt anders terug op blank('nl')).
        spacy_id = f"spacy:{active_settings.spacy_model}"
        spacy_descriptor = model_registry.REGISTRY_BY_ID.get(spacy_id)
        active.append(
            ActiveModelInfo(
                id=spacy_id,
                label=spacy_descriptor.label if spacy_descriptor else active_settings.spacy_model,
                kind="spacy",
                role="nlp",
            )
        )

        # Optioneel SoNaR-BERT NER, alleen als het ook daadwerkelijk geladen is.
        sonar_loaded = active_settings.enable_sonar and any(
            type(r).__name__ == "SonarRecognizer" for r in analyzer.registry.recognizers
        )
        if sonar_loaded:
            sonar_id = f"hf:{active_settings.sonar_model}"
            sonar_descriptor = model_registry.REGISTRY_BY_ID.get(sonar_id)
            active.append(
                ActiveModelInfo(
                    id=sonar_id,
                    label=sonar_descriptor.label if sonar_descriptor else active_settings.sonar_model,
                    kind="hf",
                    role="ner",
                )
            )

        rt = runtime.get_runtime()
        ollama_state = OllamaEngineState(
            model=rt.ollama_model,
            daemon_running=ollama_client.is_available(),
            model_present=(
                ollama_client.model_present(rt.ollama_model) if rt.ollama_model else False
            ),
            review_enabled=bool(rt.ollama_review_enabled),
            extra_ner_enabled=bool(rt.ollama_extra_ner_enabled),
            borderline_enabled=bool(rt.ollama_borderline_enabled),
        )

        return ActiveEngineResponse(
            spacy_model=active_settings.spacy_model,
            sonar_enabled=sonar_loaded,
            sonar_model=active_settings.sonar_model if sonar_loaded else None,
            han_edu_enabled=active_settings.enable_han_edu,
            score_threshold=active_settings.default_score_threshold,
            recognizers=recognizer_names,
            active_models=active,
            ollama=ollama_state,
        )

    @app.post("/engine/config", response_model=ActiveEngineResponse, tags=["meta"])
    def engine_set_config(req: EngineConfigRequest) -> ActiveEngineResponse:
        """Wissel runtime van actief spaCy-model en/of SoNaR aan/uit.

        Validatie weigert niet-geïnstalleerde modellen zodat de pipeline
        niet kan crashen na een fout-typed wijziging. Na succes leegt
        deze handler de analyzer-cache, zodat de eerstvolgende ``/analyze``
        de nieuwe pipeline opbouwt.
        """

        try:
            runtime.apply(
                spacy_model=req.spacy_model,
                enable_sonar=req.enable_sonar,
                sonar_model=req.sonar_model,
                enable_han_edu=req.enable_han_edu,
                ollama_model=req.ollama_model,
                ollama_review_enabled=req.ollama_review_enabled,
                ollama_extra_ner_enabled=req.ollama_extra_ner_enabled,
                ollama_borderline_enabled=req.ollama_borderline_enabled,
            )
        except runtime.RuntimeConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover
            logger.exception("Runtime-config wijzigen mislukt")
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return engine_active()

    @app.post("/engine/config/reset", response_model=ActiveEngineResponse, tags=["meta"])
    def engine_reset_config() -> ActiveEngineResponse:
        """Verwijder alle runtime-overrides; val terug op env/defaults."""

        runtime.reset()
        return engine_active()

    @app.post("/engine/review", response_model=ReviewResponse, tags=["meta"])
    def engine_review(req: ReviewRequest) -> ReviewResponse:
        """Laat een lokaal Ollama-model een second-opinion geven.

        Gebruikt de runtime-gekozen tag tenzij de request expliciet
        een andere meegeeft. Adviseert: we gooien niet, maar retourneren
        ``verdict=unknown`` met een uitleg als er iets misgaat — zodat
        de UI altijd iets fatsoenlijks aan de gebruiker kan laten zien.
        """

        rt = runtime.get_runtime()
        chosen = req.model or rt.ollama_model
        if not chosen:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Er is geen Ollama-model gekozen. Selecteer er eerst één "
                    "in Modellen beheren."
                ),
            )
        if not ollama_client.is_available():
            raise HTTPException(
                status_code=503,
                detail="De Ollama-daemon reageert niet op localhost:11434.",
            )
        if not ollama_client.model_present(chosen):
            raise HTTPException(
                status_code=400,
                detail=f"Ollama-model '{chosen}' is niet lokaal aanwezig.",
            )

        result = ollama_review.review(text=req.text, model=chosen)
        return ReviewResponse(
            model=result.model,
            verdict=result.verdict,
            summary=result.summary,
            findings=[
                ReviewFindingSchema(
                    snippet=f.snippet,
                    category=f.category,
                    explanation=f.explanation,
                )
                for f in result.findings
            ],
            raw_response=result.raw_response,
            eval_duration_ms=result.eval_duration_ms,
        )

    @app.get("/models", response_model=ModelListResponse, tags=["models"])
    def list_models() -> ModelListResponse:
        items: list[ModelInfo] = []
        for descriptor in model_registry.REGISTRY:
            installed, local_path = model_registry.status_for(descriptor)
            items.append(
                ModelInfo(
                    id=descriptor.id,
                    label=descriptor.label,
                    kind=descriptor.kind,
                    description=descriptor.description,
                    size_mb=descriptor.size_mb,
                    install_target=descriptor.install_target,
                    installed=installed,
                    local_path=local_path,
                    min_ram_mb=descriptor.min_ram_mb,
                    gpu_recommended=descriptor.gpu_recommended,
                )
            )
        return ModelListResponse(models=items)

    @app.post("/models/install", response_model=InstallTaskResponse, tags=["models"])
    def install_model(req: InstallModelRequest) -> InstallTaskResponse:
        descriptor = model_registry.REGISTRY_BY_ID.get(req.descriptor_id)
        if descriptor is None:
            raise HTTPException(status_code=404, detail=f"onbekend model: {req.descriptor_id}")
        task = model_registry.start_install(descriptor)
        return InstallTaskResponse(
            task_id=task.id,
            descriptor_id=task.descriptor_id,
            state=task.state,
            progress=task.progress,
            message=task.message,
            started_at=task.started_at,
            finished_at=task.finished_at,
        )

    @app.get("/models/tasks/{task_id}", response_model=InstallTaskResponse, tags=["models"])
    def get_install_task(task_id: str) -> InstallTaskResponse:
        task = model_registry.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="onbekende task")
        return InstallTaskResponse(
            task_id=task.id,
            descriptor_id=task.descriptor_id,
            state=task.state,
            progress=task.progress,
            message=task.message,
            started_at=task.started_at,
            finished_at=task.finished_at,
        )

    if settings.enable_playground:

        @app.get("/", include_in_schema=False)
        def root() -> RedirectResponse:
            return RedirectResponse(url="/playground")

        @app.get("/playground", include_in_schema=False, response_class=HTMLResponse)
        def playground() -> HTMLResponse:
            try:
                html = (
                    resources.files("pii_engine.static")
                    .joinpath("playground.html")
                    .read_text(encoding="utf-8")
                )
            except (FileNotFoundError, ModuleNotFoundError):
                fallback = Path(__file__).parent / "static" / "playground.html"
                html = fallback.read_text(encoding="utf-8")
            return HTMLResponse(content=html)

    return app


app = create_app()

"""FastAPI-applicatie voor de PII-engine.

Endpoints:

- ``GET /health`` — liveness + metadata.
- ``POST /analyze`` — detecteert PII en geeft spans terug.
- ``POST /anonymize`` — detecteert + anonimiseert of pseudonimiseert.

De app draait standaard op ``127.0.0.1:8765`` (localhost only). CORS staat
alleen ``http://localhost`` toe; de Electron-app praat via native requests.
"""

from __future__ import annotations

import logging
from importlib import resources
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from pii_engine import __version__
from pii_engine.analyzer import get_default_analyzer
from pii_engine.anonymizer import PseudonymMapping, anonymize_with_mode
from pii_engine.config import get_settings
from pii_engine.schemas import (
    AnalysisItem,
    AnalyzeRequest,
    AnalyzeResponse,
    AnonymizeItem,
    AnonymizeRequest,
    AnonymizeResponse,
    HealthResponse,
    MappingEntry,
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
            )
        except Exception as exc:  # pragma: no cover
            logger.exception("Analyse mislukt")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

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
            )
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

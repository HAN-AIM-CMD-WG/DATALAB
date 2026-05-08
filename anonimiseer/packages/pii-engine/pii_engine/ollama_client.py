"""Lichtgewicht Ollama-client voor de PII-engine.

We praten direct met de Ollama-daemon op ``http://localhost:11434``
zonder het officiële SDK-pakket: dat scheelt een dependency en houdt
het deploy-pad simpel.

Ontwerpregels:

* Alle calls hebben een korte timeout — Ollama is optioneel; als de
  daemon niet draait of het model ontbreekt, willen we de pipeline
  niet ophouden.
* Geen exceptions naar de FastAPI-laag: clients krijgen een
  ``OllamaResult`` of een ``OllamaError`` met een uitlegbare reden.
* JSON-mode wanneer mogelijk (``format="json"``) zodat het LLM een
  parseerbaar antwoord teruggeeft.

Privacybelofte: dit module roept *alleen* lokale URLs aan. Cloud-
endpoints (``api.ollama.com``, ``OLLAMA_HOST`` met externe waarde)
worden expliciet geweigerd om te voorkomen dat tekst per ongeluk de
machine verlaat.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


DEFAULT_HOST = "http://127.0.0.1:11434"
LIST_TIMEOUT_S = 3.0
GENERATE_TIMEOUT_S = 60.0


def _resolve_host() -> str:
    """Bepaal de Ollama-host en weiger niet-lokale waarden.

    We accepteren ``OLLAMA_HOST`` als die wijst naar localhost / 127.0.0.1
    / ::1; alles anders wordt afgewezen omdat dat per ongeluk een externe
    server kan zijn.
    """

    raw = os.environ.get("OLLAMA_HOST", DEFAULT_HOST).strip()
    if not raw:
        return DEFAULT_HOST
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        logger.warning(
            "OLLAMA_HOST=%s wijst niet naar localhost; val terug op %s om data lokaal te houden.",
            raw,
            DEFAULT_HOST,
        )
        return DEFAULT_HOST
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass(frozen=True)
class OllamaModelTag:
    name: str
    size_mb: int


@dataclass(frozen=True)
class OllamaResult:
    model: str
    response: str
    eval_count: int | None = None
    eval_duration_ms: int | None = None


class OllamaError(RuntimeError):
    """Een mens-leesbare reden waarom een Ollama-call faalde."""


def list_models() -> list[OllamaModelTag]:
    host = _resolve_host()
    try:
        with httpx.Client(timeout=LIST_TIMEOUT_S) as client:
            res = client.get(f"{host}/api/tags")
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPError as exc:
        raise OllamaError(f"Kan Ollama niet bereiken: {exc}") from exc
    raw_models = data.get("models")
    if not isinstance(raw_models, list):
        raise OllamaError("Ollama-antwoord bevat geen modelarray")
    out: list[OllamaModelTag] = []
    for entry in raw_models:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        size = entry.get("size")
        if not isinstance(name, str):
            continue
        size_mb = int(size / (1024 * 1024)) if isinstance(size, (int, float)) else 0
        out.append(OllamaModelTag(name=name, size_mb=size_mb))
    return out


def model_present(name: str) -> bool:
    """Snelle check: is `name` aanwezig in de lokale Ollama-installatie?"""

    try:
        return any(m.name == name for m in list_models())
    except OllamaError:
        return False


def generate(
    *,
    model: str,
    prompt: str,
    system: str | None = None,
    json_mode: bool = False,
    temperature: float = 0.0,
    timeout_s: float | None = None,
    think: bool | None = None,
) -> OllamaResult:
    """Voer één synchrone generate-call uit en retourneer het antwoord.

    We zetten ``stream=False`` zodat we het hele antwoord in één keer
    binnenkrijgen — voor onze gebruiken (paar honderd tokens) is dat
    eenvoudiger en sneller.

    ``think=False`` schakelt redeneerstappen uit voor reasoning-modellen
    (qwen3, deepseek-r1, …). Wordt door oudere Ollama-versies genegeerd.
    """

    host = _resolve_host()
    payload: dict[str, object] = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    if system:
        payload["system"] = system
    if json_mode:
        payload["format"] = "json"
    if think is not None:
        payload["think"] = think
    try:
        with httpx.Client(timeout=timeout_s or GENERATE_TIMEOUT_S) as client:
            res = client.post(f"{host}/api/generate", json=payload)
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPStatusError as exc:
        body = exc.response.text[:240]
        raise OllamaError(
            f"Ollama gaf HTTP {exc.response.status_code}: {body or 'geen body'}"
        ) from exc
    except httpx.HTTPError as exc:
        raise OllamaError(f"Ollama-call mislukte: {exc}") from exc

    response_text = data.get("response")
    if not isinstance(response_text, str):
        raise OllamaError("Ollama-antwoord bevat geen 'response'-veld")
    return OllamaResult(
        model=model,
        response=response_text,
        eval_count=_safe_int(data.get("eval_count")),
        eval_duration_ms=_to_ms(_safe_int(data.get("eval_duration"))),
    )


def _safe_int(value: object) -> int | None:
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _to_ms(nanoseconds: int | None) -> int | None:
    if nanoseconds is None:
        return None
    return nanoseconds // 1_000_000


def is_available() -> bool:
    """``True`` als de daemon antwoordt; gebruikt voor health-display."""

    try:
        list_models()
        return True
    except OllamaError:
        return False


__all__: tuple[str, ...] = (
    "OllamaError",
    "OllamaModelTag",
    "OllamaResult",
    "generate",
    "is_available",
    "list_models",
    "model_present",
)

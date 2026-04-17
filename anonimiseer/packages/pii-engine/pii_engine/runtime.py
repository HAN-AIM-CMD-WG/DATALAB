"""Runtime-configuratie van de PII-engine.

Anders dan :mod:`pii_engine.config.settings` (die env-vars bij start
inleest) kan deze module *tijdens het draaien* veranderd worden, zodat
de Electron-app de gebruiker een echte modelkeuze kan aanbieden zonder
de engine te herstarten.

Persistentie: ``~/.anonimiseer/runtime_config.json`` (override met
``ANONIMISEER_RUNTIME_CONFIG``). Bij appstart lezen we dit bestand;
elke ``apply()`` schrijft het bij.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from pii_engine.config import Settings, get_settings
from pii_engine.models import REGISTRY_BY_ID, status_for
from pii_engine import ollama_client

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuntimeConfig:
    """In-memory overrides bovenop ``Settings``.

    ``None`` betekent: gebruik de default uit ``Settings`` / env-var.
    """

    spacy_model: str | None = None
    enable_sonar: bool | None = None
    sonar_model: str | None = None
    # Ollama integraties. ``ollama_model`` = tagnaam zoals in
    # ``ollama list`` (bv. ``qwen3.5:4b``). De drie flags zijn opt-in
    # zodat Ollama-aanwezigheid alleen bewust meedoet aan detectie.
    ollama_model: str | None = None
    ollama_review_enabled: bool | None = None
    ollama_extra_ner_enabled: bool | None = None
    ollama_borderline_enabled: bool | None = None


_LOCK = threading.Lock()
_CURRENT: RuntimeConfig = RuntimeConfig()
_LOADED = False


def _config_path() -> Path:
    explicit = os.environ.get("ANONIMISEER_RUNTIME_CONFIG")
    if explicit:
        return Path(explicit)
    return Path.home() / ".anonimiseer" / "runtime_config.json"


def _optional_bool(raw: dict, key: str) -> bool | None:
    if key not in raw or raw[key] is None:
        return None
    return bool(raw[key])


def _load_from_disk() -> RuntimeConfig:
    path = _config_path()
    if not path.exists():
        return RuntimeConfig()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("runtime_config.json onleesbaar (%s); negeren.", exc)
        return RuntimeConfig()
    return RuntimeConfig(
        spacy_model=raw.get("spacy_model") or None,
        enable_sonar=_optional_bool(raw, "enable_sonar"),
        sonar_model=raw.get("sonar_model") or None,
        ollama_model=raw.get("ollama_model") or None,
        ollama_review_enabled=_optional_bool(raw, "ollama_review_enabled"),
        ollama_extra_ner_enabled=_optional_bool(raw, "ollama_extra_ner_enabled"),
        ollama_borderline_enabled=_optional_bool(raw, "ollama_borderline_enabled"),
    )


def _save_to_disk(cfg: RuntimeConfig) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")
    tmp.replace(path)


def get_runtime() -> RuntimeConfig:
    """Geef de actuele overrides terug; lazy-load bij eerste call."""

    global _CURRENT, _LOADED
    with _LOCK:
        if not _LOADED:
            _CURRENT = _load_from_disk()
            _LOADED = True
        return _CURRENT


def effective_settings() -> Settings:
    """Combineer ``Settings`` met runtime-overrides."""

    base = get_settings()
    override = get_runtime()
    changes: dict[str, object] = {}
    if override.spacy_model:
        changes["spacy_model"] = override.spacy_model
    if override.enable_sonar is not None:
        changes["enable_sonar"] = override.enable_sonar
    if override.sonar_model:
        changes["sonar_model"] = override.sonar_model
    if not changes:
        return base
    # Pydantic BaseSettings ondersteunt model_copy(update=...).
    return base.model_copy(update=changes)


class RuntimeConfigError(ValueError):
    """Een wijziging is geweigerd, met een mens-leesbare reden."""


def _validate(
    *,
    spacy_model: str | None,
    enable_sonar: bool | None,
    sonar_model: str | None,
    ollama_model: str | None,
    ollama_review_enabled: bool | None,
    ollama_extra_ner_enabled: bool | None,
    ollama_borderline_enabled: bool | None,
) -> None:
    if spacy_model:
        descriptor = REGISTRY_BY_ID.get(f"spacy:{spacy_model}")
        if descriptor is None:
            raise RuntimeConfigError(
                f"spaCy-model '{spacy_model}' staat niet in de registry."
            )
        installed, _ = status_for(descriptor)
        if not installed:
            raise RuntimeConfigError(
                f"spaCy-model '{spacy_model}' is niet geïnstalleerd. Download het eerst."
            )

    if enable_sonar:
        # Sonar vereist transformers + torch (extras [sonar]) en het
        # daadwerkelijke HF-snapshot in cache.
        try:
            import transformers  # noqa: F401
            import torch  # noqa: F401
        except ImportError as exc:
            raise RuntimeConfigError(
                "SoNaR vereist de extra 'sonar' (transformers + torch); "
                "die is niet geïnstalleerd in deze engine."
            ) from exc

        target_repo = sonar_model or get_settings().sonar_model
        descriptor = REGISTRY_BY_ID.get(f"hf:{target_repo}")
        if descriptor is not None:
            installed, _ = status_for(descriptor)
            if not installed:
                raise RuntimeConfigError(
                    f"SoNaR-model '{target_repo}' is niet gedownload. Haal het op via Modellen beheren."
                )

    # Ollama: model moet in de lokale daemon staan; rollen vereisen een model.
    if ollama_model:
        if not ollama_client.model_present(ollama_model):
            raise RuntimeConfigError(
                f"Ollama-model '{ollama_model}' draait niet lokaal. "
                "Pull hem eerst of start de Ollama-daemon."
            )

    current = get_runtime()
    # Pre-check of er een model is wanneer een rol *nieuw* wordt aangezet.
    model_after = ollama_model if ollama_model is not None else current.ollama_model
    for flag_value, flag_name in (
        (ollama_review_enabled, "Review-laag"),
        (ollama_extra_ner_enabled, "Extra NER-detector"),
        (ollama_borderline_enabled, "Borderline-rechter"),
    ):
        if flag_value is True and not model_after:
            raise RuntimeConfigError(
                f"{flag_name} aanzetten kan alleen als er eerst een Ollama-model is gekozen."
            )


def apply(
    *,
    spacy_model: str | None = None,
    enable_sonar: bool | None = None,
    sonar_model: str | None = None,
    ollama_model: str | None = None,
    ollama_review_enabled: bool | None = None,
    ollama_extra_ner_enabled: bool | None = None,
    ollama_borderline_enabled: bool | None = None,
) -> RuntimeConfig:
    """Pas de runtime-overrides aan, sla op en leeg de analyzer-cache.

    ``None`` voor een veld betekent: ongewijzigd laten (vorige override
    blijft staan). Wil je een veld terugzetten naar default, gebruik
    :func:`reset`.
    """

    global _CURRENT, _LOADED
    _validate(
        spacy_model=spacy_model,
        enable_sonar=enable_sonar,
        sonar_model=sonar_model,
        ollama_model=ollama_model,
        ollama_review_enabled=ollama_review_enabled,
        ollama_extra_ner_enabled=ollama_extra_ner_enabled,
        ollama_borderline_enabled=ollama_borderline_enabled,
    )

    with _LOCK:
        current = _CURRENT if _LOADED else _load_from_disk()
        new = replace(
            current,
            spacy_model=spacy_model if spacy_model is not None else current.spacy_model,
            enable_sonar=enable_sonar if enable_sonar is not None else current.enable_sonar,
            sonar_model=sonar_model if sonar_model is not None else current.sonar_model,
            ollama_model=ollama_model if ollama_model is not None else current.ollama_model,
            ollama_review_enabled=(
                ollama_review_enabled if ollama_review_enabled is not None else current.ollama_review_enabled
            ),
            ollama_extra_ner_enabled=(
                ollama_extra_ner_enabled
                if ollama_extra_ner_enabled is not None
                else current.ollama_extra_ner_enabled
            ),
            ollama_borderline_enabled=(
                ollama_borderline_enabled
                if ollama_borderline_enabled is not None
                else current.ollama_borderline_enabled
            ),
        )
        _save_to_disk(new)
        _CURRENT = new
        _LOADED = True

    _invalidate_analyzer_cache()
    return new


def reset() -> RuntimeConfig:
    """Verwijder alle overrides; engine valt terug op env/defaults."""

    global _CURRENT, _LOADED
    with _LOCK:
        _CURRENT = RuntimeConfig()
        _LOADED = True
        path = _config_path()
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    _invalidate_analyzer_cache()
    return _CURRENT


def _invalidate_analyzer_cache() -> None:
    """Tip de analyzer-singleton om bij volgende ``/analyze`` te herbouwen."""

    # Lazy import om circulaire imports te vermijden.
    from pii_engine import analyzer as analyzer_module

    analyzer_module.get_default_analyzer.cache_clear()
    logger.info("analyzer-cache geleegd na runtime-config wijziging.")


__all__ = [
    "RuntimeConfig",
    "RuntimeConfigError",
    "apply",
    "effective_settings",
    "get_runtime",
    "reset",
]

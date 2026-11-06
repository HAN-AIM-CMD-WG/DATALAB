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

import contextlib
import json
import logging
import os
import re
import threading
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from pii_engine import ollama_client
from pii_engine.config import Settings, get_settings
from pii_engine.models import REGISTRY_BY_ID, status_for

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RuntimeConfig:
    """In-memory overrides bovenop ``Settings``.

    ``None`` betekent: gebruik de default uit ``Settings`` / env-var.
    """

    spacy_model: str | None = None
    enable_sonar: bool | None = None
    sonar_model: str | None = None
    # HAN-/onderwijsprofiel: zet de klas-, cursus-, CROHO-, personeels-
    # en mentor-recognizers aan of uit zonder engine-restart. ``None``
    # betekent: gebruik de env-var/Settings-default (in de pilot: True).
    enable_han_edu: bool | None = None
    # Extra PII-model (bardsai); alleen aan als het gedownload is.
    enable_pii_model: bool | None = None
    # Organisatieprofiel: naam en eigen begrippen als (label, omschrijving).
    profile_name: str | None = None
    custom_terms: tuple[tuple[str, str], ...] | None = None
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


def _optional_bool(raw: dict[str, object], key: str) -> bool | None:
    if key not in raw or raw[key] is None:
        return None
    return bool(raw[key])


def _stored_terms(raw: object) -> tuple[tuple[str, str], ...] | None:
    if not isinstance(raw, list):
        return None
    return tuple(
        (str(item[0]), str(item[1]))
        for item in raw
        if isinstance(item, (list, tuple)) and len(item) == 2
    )


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
        enable_han_edu=_optional_bool(raw, "enable_han_edu"),
        enable_pii_model=_optional_bool(raw, "enable_pii_model"),
        profile_name=raw.get("profile_name") or None,
        custom_terms=_stored_terms(raw.get("custom_terms")),
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
    if override.enable_han_edu is not None:
        changes["enable_han_edu"] = override.enable_han_edu
    if override.enable_pii_model is not None:
        changes["enable_pii_model"] = override.enable_pii_model
    if override.profile_name is not None:
        changes["profile_name"] = override.profile_name
    if override.custom_terms is not None:
        changes["custom_terms"] = [
            {"label": label, "description": description}
            for label, description in override.custom_terms
        ]
    if not changes:
        return base
    # Pydantic BaseSettings ondersteunt model_copy(update=...).
    return base.model_copy(update=changes)


class RuntimeConfigError(ValueError):
    """Een wijziging is geweigerd, met een mens-leesbare reden."""


def _is_cloud_model(name: str) -> bool:
    tag = name.strip().lower()
    return tag.endswith((":cloud", "-cloud")) or ":cloud-" in tag


def _require_hf_model(repo: str, what: str) -> None:
    """The model must be in the registry, downloaded, and runnable here."""
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError as exc:
        raise RuntimeConfigError(
            f"Het {what} vereist de extra 'sonar' (transformers + torch); "
            "die is niet geïnstalleerd in deze engine."
        ) from exc
    descriptor = REGISTRY_BY_ID.get(f"hf:{repo}")
    # Only models from the registry: any other name would make the engine
    # fetch an arbitrary repository from HuggingFace.
    if descriptor is None:
        raise RuntimeConfigError(f"{what} '{repo}' staat niet in de registry.")
    installed, _ = status_for(descriptor)
    if not installed:
        raise RuntimeConfigError(
            f"{what} '{repo}' is niet gedownload. Haal het op via Modellen beheren."
        )


MAX_TERMS = 25
_TERM_LABEL = re.compile(r"[\w][\w \-/]{0,39}")


def _validate_terms(terms: list[tuple[str, str]]) -> None:
    if len(terms) > MAX_TERMS:
        raise RuntimeConfigError(f"Een profiel mag hoogstens {MAX_TERMS} eigen begrippen hebben.")
    seen: set[str] = set()
    for label, description in terms:
        if not _TERM_LABEL.fullmatch(label.strip()):
            raise RuntimeConfigError(
                f"Begrip '{label}' is ongeldig: 1 tot 40 letters, cijfers, spaties of streepjes."
            )
        if len(description) > 300:
            raise RuntimeConfigError(f"De omschrijving van '{label}' is langer dan 300 tekens.")
        key = label.strip().lower()
        if key in seen:
            raise RuntimeConfigError(f"Begrip '{label}' staat dubbel in het profiel.")
        seen.add(key)


def _validate(
    *,
    spacy_model: str | None,
    enable_sonar: bool | None,
    sonar_model: str | None,
    enable_han_edu: bool | None,
    ollama_model: str | None,
    ollama_review_enabled: bool | None,
    ollama_extra_ner_enabled: bool | None,
    ollama_borderline_enabled: bool | None,
    enable_pii_model: bool | None = None,
    custom_terms: list[tuple[str, str]] | None = None,
) -> None:
    if custom_terms:
        _validate_terms(custom_terms)
        _require_hf_model(get_settings().custom_terms_model, "model voor eigen begrippen")
    if spacy_model:
        descriptor = REGISTRY_BY_ID.get(f"spacy:{spacy_model}")
        if descriptor is None:
            raise RuntimeConfigError(f"spaCy-model '{spacy_model}' staat niet in de registry.")
        installed, _ = status_for(descriptor)
        if not installed:
            raise RuntimeConfigError(
                f"spaCy-model '{spacy_model}' is niet geïnstalleerd. Download het eerst."
            )

    if enable_sonar or sonar_model:
        _require_hf_model(sonar_model or get_settings().sonar_model, "SoNaR-model")
    if enable_pii_model:
        _require_hf_model(get_settings().pii_model, "PII-model")

    # A cloud variant runs on Ollama's servers: the local daemon would forward
    # the document text there.
    if ollama_model and _is_cloud_model(ollama_model):
        raise RuntimeConfigError(
            f"Ollama-model '{ollama_model}' draait in de cloud, niet op deze computer."
        )

    # Ollama: model moet in de lokale daemon staan; rollen vereisen een model.
    if ollama_model and not ollama_client.model_present(ollama_model):
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
    enable_han_edu: bool | None = None,
    ollama_model: str | None = None,
    ollama_review_enabled: bool | None = None,
    ollama_extra_ner_enabled: bool | None = None,
    ollama_borderline_enabled: bool | None = None,
    enable_pii_model: bool | None = None,
    profile_name: str | None = None,
    custom_terms: list[tuple[str, str]] | None = None,
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
        enable_han_edu=enable_han_edu,
        ollama_model=ollama_model,
        ollama_review_enabled=ollama_review_enabled,
        ollama_extra_ner_enabled=ollama_extra_ner_enabled,
        ollama_borderline_enabled=ollama_borderline_enabled,
        enable_pii_model=enable_pii_model,
        custom_terms=custom_terms,
    )

    with _LOCK:
        current = _CURRENT if _LOADED else _load_from_disk()
        new = replace(
            current,
            spacy_model=spacy_model if spacy_model is not None else current.spacy_model,
            enable_sonar=enable_sonar if enable_sonar is not None else current.enable_sonar,
            sonar_model=sonar_model if sonar_model is not None else current.sonar_model,
            enable_han_edu=(
                enable_han_edu if enable_han_edu is not None else current.enable_han_edu
            ),
            enable_pii_model=(
                enable_pii_model if enable_pii_model is not None else current.enable_pii_model
            ),
            profile_name=profile_name if profile_name is not None else current.profile_name,
            custom_terms=(
                tuple((label.strip(), description.strip()) for label, description in custom_terms)
                if custom_terms is not None
                else current.custom_terms
            ),
            ollama_model=ollama_model if ollama_model is not None else current.ollama_model,
            ollama_review_enabled=(
                ollama_review_enabled
                if ollama_review_enabled is not None
                else current.ollama_review_enabled
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
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
    _invalidate_analyzer_cache()
    return _CURRENT


def _invalidate_analyzer_cache() -> None:
    """Tip de analyzer-singleton om bij volgende ``/analyze`` te herbouwen."""

    # Lazy import om circulaire imports te vermijden.
    from pii_engine import analyzer as analyzer_module

    analyzer_module.get_default_analyzer.cache_clear()
    logger.info("analyzer-cache geleegd na runtime-config wijziging.")


def refresh_pipeline() -> None:
    """Rebuild the pipeline on next use, e.g. once a model it was missing is installed."""
    _invalidate_analyzer_cache()


__all__ = [
    "RuntimeConfig",
    "RuntimeConfigError",
    "apply",
    "effective_settings",
    "get_runtime",
    "refresh_pipeline",
    "reset",
]

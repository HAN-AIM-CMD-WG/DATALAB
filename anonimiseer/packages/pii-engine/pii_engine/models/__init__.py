"""Model-registry en download-manager voor de PII-engine.

Doel: de Electron-app moet 1-klik de modellen kunnen ophalen die
Anonimiseer nodig heeft, zonder dat de gebruiker een terminal hoeft
te openen of pip-commando's hoeft uit te voeren.

We onderscheiden drie types:

* ``spacy`` — pip-installeerbare wheel (bv. ``nl_core_news_lg``).
* ``hf`` — HuggingFace-model dat we via ``snapshot_download`` cachen
  in ``HF_HOME`` (zelfde cache die transformers gebruikt).
* ``ollama`` — wordt **niet** door deze module gedaan; de Electron-
  app praat daar zelf met de Ollama-daemon (localhost:11434), omdat
  Ollama een eigen proces heeft dat los staat van de pii-engine.

Downloads draaien in een background-thread zodat de FastAPI-loop niet
blokkeert. Voortgang wordt per task in een in-memory dict bijgehouden;
bij een server-restart raken running tasks kwijt — dat is acceptabel
voor een lokale tool.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

logger = logging.getLogger(__name__)

ModelKind = Literal["spacy", "hf"]
TaskState = Literal["pending", "running", "done", "error"]


@dataclass(frozen=True)
class ModelDescriptor:
    id: str
    label: str
    kind: ModelKind
    description: str
    size_mb: int
    """Voor spacy: pip-installeerbare modulenaam (``nl_core_news_lg``).

    Voor hf: HuggingFace-repo-id (``GroNLP/bert-base-dutch-cased``)."""
    install_target: str
    min_ram_mb: int = 0
    """Indicatieve minimum-RAM die we aanraden om dit model comfortabel
    te draaien (model in geheugen + werkruimte). UI gebruikt dit voor
    een fit-check tegen de detectie van het systeem; geen harde grens."""
    gpu_recommended: bool = False


@dataclass
class TaskInfo:
    id: str
    descriptor_id: str
    state: TaskState = "pending"
    progress: float = 0.0
    message: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None


REGISTRY: list[ModelDescriptor] = [
    ModelDescriptor(
        id="spacy:nl_core_news_sm",
        label="spaCy NL — klein",
        kind="spacy",
        description=(
            "Lichte spaCy-pipeline voor Nederlands. ~12 MB. Snel maar mist"
            " soms namen met tussenvoegsels."
        ),
        size_mb=12,
        install_target="nl_core_news_sm",
        min_ram_mb=512,
    ),
    ModelDescriptor(
        id="spacy:nl_core_news_md",
        label="spaCy NL — medium",
        kind="spacy",
        description=(
            "Tussenoptie tussen recall en RAM-gebruik. ~43 MB."
        ),
        size_mb=43,
        install_target="nl_core_news_md",
        min_ram_mb=1024,
    ),
    ModelDescriptor(
        id="spacy:nl_core_news_lg",
        label="spaCy NL — large",
        kind="spacy",
        description=(
            "Aanbevolen voor productie-anonimisering. ~568 MB. Beter bij"
            " complexere namen."
        ),
        size_mb=568,
        install_target="nl_core_news_lg",
        min_ram_mb=2048,
    ),
    ModelDescriptor(
        id="hf:GroNLP/bert-base-dutch-cased",
        label="BERTje (BERT-base NL)",
        kind="hf",
        description=(
            "Algemeen Nederlands BERT-model. Vereist door SoNaR-NER. ~440 MB."
        ),
        size_mb=440,
        install_target="GroNLP/bert-base-dutch-cased",
        min_ram_mb=2048,
    ),
    ModelDescriptor(
        id="hf:wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
        label="SoNaR-BERT NER",
        kind="hf",
        description=(
            "Op het SoNaR-corpus fijnafgestelde BERT voor Nederlandse NER."
            " Geeft betere recall op personen, locaties en organisaties."
        ),
        size_mb=440,
        install_target="wietsedv/bert-base-dutch-cased-finetuned-sonar-ner",
        min_ram_mb=2048,
    ),
]

REGISTRY_BY_ID: dict[str, ModelDescriptor] = {m.id: m for m in REGISTRY}


def _spacy_installed(name: str) -> tuple[bool, str | None]:
    try:
        import importlib

        mod = importlib.import_module(name)
        path = getattr(mod, "__file__", None)
        return True, str(Path(path).parent) if path else None
    except Exception:
        return False, None


def _anonimiseer_hf_home() -> Path:
    """Eigen schrijfbare HuggingFace-home voor Anonimiseer.

    We omzeilen ``~/.cache/huggingface`` volledig: niet alleen ``hub``
    kan op sommige machines per ongeluk van root zijn (oude sudo-run),
    maar HuggingFace heeft ook ``xet`` en ``datasets`` subdirs die
    onafhankelijk een ``PermissionError`` kunnen geven.

    Override-mogelijkheden:

    * ``ANONIMISEER_HF_CACHE`` — expliciet pad voor deze app.
    * ``HF_HOME`` — als die al gezet is en schrijfbaar, gebruiken we 'm.
    """

    explicit = os.environ.get("ANONIMISEER_HF_CACHE")
    if explicit:
        return Path(explicit)
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        candidate = Path(hf_home)
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            test = candidate / ".write-check"
            test.write_text("ok", encoding="utf-8")
            test.unlink()
            return candidate
        except OSError:
            logger.warning(
                "HF_HOME=%s is niet schrijfbaar; val terug op ~/.anonimiseer/huggingface",
                hf_home,
            )
    return Path.home() / ".anonimiseer" / "huggingface"


def _ensure_hf_home_env() -> Path:
    """Zorg dat alle HF-subprocessen onze eigen home gebruiken.

    Zet zowel ``HF_HOME`` (algemene root van hub/xet/datasets) als
    ``HF_HUB_CACHE`` (specifiek voor model-snapshots), zodat zowel de
    nieuwe als oudere huggingface_hub-versies hetzelfde pad pakken.
    """

    home = _anonimiseer_hf_home()
    home.mkdir(parents=True, exist_ok=True)
    hub = home / "hub"
    hub.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(home)
    os.environ["HF_HUB_CACHE"] = str(hub)
    return hub


def _hf_installed(repo_id: str) -> tuple[bool, str | None]:
    """Heel pragmatisch: kijk of de cache-folder bestaat."""

    hub = _anonimiseer_hf_home() / "hub"
    folder = hub / f"models--{repo_id.replace('/', '--')}"
    if folder.exists():
        return True, str(folder)
    return False, None


def status_for(descriptor: ModelDescriptor) -> tuple[bool, str | None]:
    if descriptor.kind == "spacy":
        return _spacy_installed(descriptor.install_target)
    if descriptor.kind == "hf":
        return _hf_installed(descriptor.install_target)
    return False, None


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

_TASKS: dict[str, TaskInfo] = {}
_TASK_LOCK = threading.Lock()


def _new_task(descriptor: ModelDescriptor) -> TaskInfo:
    task = TaskInfo(id=str(uuid.uuid4()), descriptor_id=descriptor.id)
    with _TASK_LOCK:
        _TASKS[task.id] = task
    return task


def get_task(task_id: str) -> TaskInfo | None:
    with _TASK_LOCK:
        return _TASKS.get(task_id)


def _update_task(task_id: str, **changes) -> None:
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
        if task is None:
            return
        for key, value in changes.items():
            setattr(task, key, value)


def _install_spacy(descriptor: ModelDescriptor, task_id: str) -> None:
    """Installeer een spaCy-model via ``python -m spacy download``.

    We laten de subprocess zijn output streamen zodat we voortgang
    kunnen tonen. Voor pip-installs hebben we geen exacte percentage,
    dus we tonen een onbekend-percentage met een live "wat doet pip nu"
    bericht.
    """

    cmd = [sys.executable, "-m", "spacy", "download", descriptor.install_target]
    _update_task(task_id, state="running", progress=0.05, message="spaCy download starten…")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert proc.stdout is not None
        last_msg = ""
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            last_msg = line[:240]
            _update_task(task_id, message=last_msg)
        proc.wait()
        if proc.returncode != 0:
            _update_task(
                task_id,
                state="error",
                progress=1.0,
                message=f"spaCy install mislukt (exit {proc.returncode}): {last_msg}",
                finished_at=time.time(),
            )
            return
    except FileNotFoundError as exc:
        _update_task(
            task_id,
            state="error",
            message=f"spaCy CLI niet gevonden: {exc}",
            finished_at=time.time(),
        )
        return
    _update_task(
        task_id,
        state="done",
        progress=1.0,
        message="Geïnstalleerd. Herstart de engine om het model te gebruiken.",
        finished_at=time.time(),
    )


def _install_hf(descriptor: ModelDescriptor, task_id: str) -> None:
    """Download een HuggingFace-snapshot."""

    try:
        cache_root = _ensure_hf_home_env()
    except OSError as exc:
        _update_task(
            task_id,
            state="error",
            message=(
                f"Kan cache-map niet aanmaken: {exc}. "
                "Tip: zet ANONIMISEER_HF_CACHE naar een schrijfbaar pad."
            ),
            finished_at=time.time(),
        )
        return

    _update_task(
        task_id,
        state="running",
        progress=0.05,
        message=f"Verbinding met HuggingFace… (cache: {cache_root})",
    )
    try:
        from huggingface_hub import snapshot_download

        local = snapshot_download(
            repo_id=descriptor.install_target,
            cache_dir=str(cache_root),
            allow_patterns=[
                "*.json",
                "*.txt",
                "*.bin",
                "*.safetensors",
                "*.model",
                "*.spm",
                "tokenizer*",
                "vocab*",
            ],
        )
        _update_task(
            task_id,
            state="done",
            progress=1.0,
            message=f"Geïnstalleerd in {local}",
            finished_at=time.time(),
        )
    except PermissionError as exc:
        logger.exception("HF-download geweigerd door OS")
        _update_task(
            task_id,
            state="error",
            message=(
                f"Geen schrijfrechten in cache-map ({exc.filename or cache_root}). "
                "Controleer de eigenaar van die map (mogelijk per ongeluk root) "
                "of zet ANONIMISEER_HF_CACHE naar een eigen pad."
            ),
            finished_at=time.time(),
        )
    except Exception as exc:  # pragma: no cover
        logger.exception("HF-download mislukt")
        _update_task(
            task_id,
            state="error",
            message=f"HF-download mislukt: {exc}",
            finished_at=time.time(),
        )


_INSTALLERS: dict[ModelKind, Callable[[ModelDescriptor, str], None]] = {
    "spacy": _install_spacy,
    "hf": _install_hf,
}


def start_install(descriptor: ModelDescriptor) -> TaskInfo:
    """Start een download in een background-thread en geef de task terug."""

    task = _new_task(descriptor)
    installer = _INSTALLERS.get(descriptor.kind)
    if installer is None:
        _update_task(
            task.id,
            state="error",
            message=f"Geen installer voor type {descriptor.kind}",
            finished_at=time.time(),
        )
        return task

    def _run() -> None:
        try:
            installer(descriptor, task.id)
        except Exception as exc:  # pragma: no cover
            logger.exception("Installer crashte")
            _update_task(task.id, state="error", message=str(exc), finished_at=time.time())

    thread = threading.Thread(target=_run, daemon=True, name=f"install-{descriptor.id}")
    thread.start()
    return task


__all__ = [
    "ModelDescriptor",
    "ModelKind",
    "REGISTRY",
    "REGISTRY_BY_ID",
    "TaskInfo",
    "TaskState",
    "get_task",
    "start_install",
    "status_for",
]

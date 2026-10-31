"""Load a model once, in the background, from disk only, and remember why it failed.

Shared by the recognizers that run a HuggingFace model (SoNaR, the PII model,
GLiNER2). Loading happens in a background thread right after the analyzer is
built, so the pipeline status is known before the first analysis; an analysis
that arrives earlier waits for the same load. A failure is kept, so it is
reported as a limitation instead of being retried and silently skipped on
every analysis.
"""

from __future__ import annotations

import contextlib
import logging
import threading
from collections.abc import Callable, Iterator
from typing import TYPE_CHECKING, Generic, Literal, TypeVar

if TYPE_CHECKING:
    from transformers import Pipeline

logger = logging.getLogger(__name__)

T = TypeVar("T")
LoadState = Literal["loading", "loaded", "failed"]


def explain_load_error(exc: Exception) -> str:
    """A reason a user can act on; shown in the app next to "Beperkt"."""
    if isinstance(exc, FileNotFoundError):
        return "het model staat niet op deze computer; installeer het via Modellen beheren"
    if isinstance(exc, ImportError):
        return "een benodigd onderdeel ontbreekt in deze installatie"
    if isinstance(exc, MemoryError):
        return "te weinig werkgeheugen"
    return f"laden mislukt ({type(exc).__name__})"


class LazyModel(Generic[T]):
    def __init__(self, name: str, loader: Callable[[], T]) -> None:
        self._name = name
        self._loader = loader
        self._value: T | None = None
        self._error: str | None = None
        self._lock = threading.Lock()

    @property
    def state(self) -> LoadState:
        if self._value is not None:
            return "loaded"
        return "failed" if self._error is not None else "loading"

    @property
    def error(self) -> str | None:
        return self._error

    def warm_up(self) -> None:
        def _load() -> None:
            with contextlib.suppress(Exception):
                self.get()

        threading.Thread(target=_load, name=f"warm-up-{self._name}", daemon=True).start()

    def get(self) -> T:
        if self._value is not None:
            return self._value
        with self._lock:
            if self._value is not None:
                return self._value
            if self._error is not None:
                raise RuntimeError(self._error)
            logger.info("Model laden: %s", self._name)
            try:
                self._value = self._loader()
            except Exception as exc:
                self._error = explain_load_error(exc)
                logger.warning("Model %s niet geladen: %s", self._name, exc)
                raise
            logger.info("Model geladen: %s", self._name)
            return self._value


def text_windows(text: str, size: int, overlap: int) -> Iterator[tuple[int, str]]:
    """Overlapping chunks for a model with a limited input, cut at a line break
    or space so no name is cut in half. Yields ``(offset, chunk)``."""
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            cut = max(
                text.rfind("\n", start + size // 2, end), text.rfind(" ", start + size // 2, end)
            )
            if cut > start:
                end = cut
        yield start, text[start:end]
        if end >= len(text):
            return
        start = max(end - overlap, start + 1)


def require_local_hf_model(repo_id: str) -> str:
    """Cache folder for ``repo_id``; raises when it is not on disk.

    Downloading is an explicit install in the Model Manager, never something
    an analysis may trigger on its own.
    """
    from pii_engine.models import hf_hub_cache, hf_model_present

    if not hf_model_present(repo_id):
        raise FileNotFoundError(repo_id)
    return str(hf_hub_cache())


def local_token_classifier(repo_id: str) -> Pipeline:
    """A token-classification pipeline from the local cache, sub-tokens merged into spans."""
    cache_dir = require_local_hf_model(repo_id)
    # Imported here so the engine starts without the [sonar] extras installed.
    from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline

    tokenizer = AutoTokenizer.from_pretrained(repo_id, cache_dir=cache_dir, local_files_only=True)
    model = AutoModelForTokenClassification.from_pretrained(
        repo_id, cache_dir=cache_dir, local_files_only=True
    )
    return pipeline(
        task="token-classification",
        model=model,
        tokenizer=tokenizer,
        aggregation_strategy="simple",
    )

"""The app analyses several files at once; the engine must cope with that."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from pii_engine import analyzer
from pii_engine.recognizers.lazy_model import LazyModel


def test_requests_arriving_together_build_the_pipeline_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built: list[object] = []

    def slow_build() -> object:
        time.sleep(0.05)
        built.append(object())
        return built[-1]

    monkeypatch.setattr(analyzer, "build_analyzer", slow_build)
    analyzer.reset_default_analyzer()
    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: analyzer.get_default_analyzer(), range(6)))
    finally:
        analyzer.reset_default_analyzer()
    assert len(built) == 1
    assert all(r is built[0] for r in results)


class _Tokenizer:
    """Fails like a HuggingFace tokenizer used by two threads at once."""

    def __init__(self) -> None:
        self._busy = threading.Lock()

    def __call__(self, text: str) -> str:
        if not self._busy.acquire(blocking=False):
            raise RuntimeError("Already borrowed")
        try:
            time.sleep(0.01)
            return text
        finally:
            self._busy.release()


def test_a_model_serves_one_request_at_a_time() -> None:
    model: LazyModel[_Tokenizer] = LazyModel("nep", _Tokenizer)

    def run(text: str) -> str:
        with model.use() as tokenizer:
            return tokenizer(text)

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(run, [str(i) for i in range(16)])) == [str(i) for i in range(16)]

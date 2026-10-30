"""The engine reports what it really runs with, not what it was configured to run.

A missing spaCy model silently becomes an empty pipeline without NER, and a
SoNaR model that cannot load silently finds nothing. Both must show up as a
limitation the app can display as "Beperkt".
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from pii_engine.analyzer import build_analyzer
from pii_engine.api import create_app
from pii_engine.config import Settings
from pii_engine.model_status import pipeline_status


def _wait_for_sonar(analyzer: object, settings: Settings, timeout: float = 30.0) -> str:
    deadline = time.monotonic() + timeout
    while True:
        state = pipeline_status(analyzer, settings).sonar_state  # type: ignore[arg-type]
        if state != "loading" or time.monotonic() > deadline:
            return state
        time.sleep(0.05)


def test_empty_fallback_pipeline_is_a_limitation() -> None:
    settings = Settings(spacy_model="nl_bestaat_niet", allow_blank_nlp_fallback=True)
    status = pipeline_status(build_analyzer(settings), settings)
    assert status.spacy_model is None
    assert any("nl_bestaat_niet" in reason for reason in status.limitations)


def test_sonar_off_is_not_a_limitation() -> None:
    settings = Settings(
        spacy_model="nl_bestaat_niet", allow_blank_nlp_fallback=True, enable_sonar=False
    )
    status = pipeline_status(build_analyzer(settings), settings)
    assert status.sonar_state == "off"
    assert not any("SoNaR" in reason for reason in status.limitations)


def test_missing_sonar_model_fails_without_a_download(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_network(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("SoNaR tried to download a model")

    monkeypatch.setattr("huggingface_hub.snapshot_download", no_network, raising=False)
    settings = Settings(
        spacy_model="nl_bestaat_niet",
        allow_blank_nlp_fallback=True,
        enable_sonar=True,
        sonar_model="voorbeeld/bestaat-niet",
    )
    analyzer = build_analyzer(settings)
    assert _wait_for_sonar(analyzer, settings) == "failed"
    status = pipeline_status(analyzer, settings)
    assert any("niet op deze computer" in reason for reason in status.limitations)
    assert analyzer.analyze(text="Jan de Vries belt.", language="nl") is not None


def test_health_reports_limitations() -> None:
    client = TestClient(create_app(), base_url="http://127.0.0.1")
    body = client.get("/health").json()
    assert isinstance(body["limitations"], list)

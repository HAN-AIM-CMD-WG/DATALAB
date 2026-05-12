"""Gedeelde pytest-fixtures.

We forceren spaCy-fallback naar ``blank('nl')`` zodat CI geen 500MB model hoeft
te downloaden. Het `nl_core_news_lg`-model wordt alleen in productie-builds
meegenomen.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

os.environ.setdefault("PII_ENGINE_SPACY_MODEL", "nl_core_news_sm")
os.environ.setdefault("PII_ENGINE_ALLOW_BLANK_NLP_FALLBACK", "true")


@pytest.fixture(scope="session")
def analyzer() -> Iterator[object]:
    """Session-scope analyzer om startup-kosten te delen."""

    from pii_engine.analyzer import build_analyzer
    from pii_engine.config import Settings

    settings = Settings(spacy_model="nl_core_news_sm", allow_blank_nlp_fallback=True)
    yield build_analyzer(settings=settings)

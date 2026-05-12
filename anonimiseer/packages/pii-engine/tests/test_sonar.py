"""Tests voor de SoNaR-recognizer.

Worden automatisch geskipt als ``torch``/``transformers`` niet
geïnstalleerd zijn (dat hangt af van of de ``[sonar]`` extras zijn
meegenomen). In CI draaien we de default-config zonder sonar; op de
dev-machine met ``[sonar]`` lopen deze tests wel mee en downloaden
ze het model uit de HF-cache.
"""

from __future__ import annotations

import pytest

transformers = pytest.importorskip("transformers")


from pii_engine.recognizers.sonar import (  # noqa: E402
    SONAR_ENTITIES,
    SONAR_LABEL_MAP,
    SonarRecognizer,
)


@pytest.fixture(scope="module")
def recognizer() -> SonarRecognizer:
    rec = SonarRecognizer(supported_language="nl", score_min=0.5)
    rec.load()
    return rec


def test_supported_entities_are_the_mapped_ones() -> None:
    assert set(SONAR_ENTITIES) == set(SONAR_LABEL_MAP.values())
    # Alleen PII-relevante categorieën opgenomen.
    assert "PERSON" in SONAR_ENTITIES
    assert "LOCATION" in SONAR_ENTITIES
    assert "ORGANIZATION" in SONAR_ENTITIES


def test_empty_text_returns_empty(recognizer: SonarRecognizer) -> None:
    assert recognizer.analyze("", entities=["PERSON"]) == []
    assert recognizer.analyze("   ", entities=["PERSON"]) == []


def test_skips_when_no_requested_entity_matches(recognizer: SonarRecognizer) -> None:
    """Als de caller alleen NL_BSN vraagt, hoeft SoNaR niet te draaien."""
    assert recognizer.analyze("Jan de Vries", entities=["NL_BSN"]) == []


@pytest.mark.slow
def test_detects_dutch_person_with_tussenvoegsel(recognizer: SonarRecognizer) -> None:
    text = "Mevrouw van den Broek belde."
    results = recognizer.analyze(text, entities=["PERSON", "LOCATION", "ORGANIZATION"])
    persons = [r for r in results if r.entity_type == "PERSON"]
    assert persons, f"Geen PERSON gevonden in: {text!r}. Resultaten: {results}"
    matched = [text[r.start : r.end] for r in persons]
    assert any("van den Broek" in m for m in matched), matched


@pytest.mark.slow
def test_detects_dutch_location(recognizer: SonarRecognizer) -> None:
    text = "De vergadering is in Arnhem op maandag."
    results = recognizer.analyze(text, entities=["PERSON", "LOCATION", "ORGANIZATION"])
    locations = [r for r in results if r.entity_type == "LOCATION"]
    matched = [text[r.start : r.end] for r in locations]
    assert any("Arnhem" in m for m in matched), matched


@pytest.mark.slow
def test_does_not_detect_when_no_person_present(recognizer: SonarRecognizer) -> None:
    """Geen PER-entiteiten in een zin zonder namen/locaties."""
    text = "De bushalte ontbreekt op de kaart."
    results = recognizer.analyze(text, entities=["PERSON"])
    persons = [r for r in results if r.entity_type == "PERSON"]
    assert persons == [], [text[r.start : r.end] for r in persons]

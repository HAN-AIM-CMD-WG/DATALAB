"""An organisation's own terms: entity types, detection and the profile's checks.

Uses a stand-in for GLiNER2, so it runs without the model. All terms and
values here are made up.
"""

from __future__ import annotations

from typing import Any

import pytest
from presidio_analyzer import AnalysisExplanation, RecognizerResult

from pii_engine import runtime
from pii_engine.postfilter import filter_overlaps
from pii_engine.recognizers import custom_terms
from pii_engine.recognizers.custom_terms import CustomTerm, CustomTermsRecognizer, term_entity_type


class _FakeGliner:
    def __init__(self, found: dict[str, str]) -> None:
        self.found = found
        self.labels_seen: list[dict[str, str]] = []

    def extract_entities(self, chunk: str, labels: dict[str, str], **_: Any) -> dict[str, Any]:
        self.labels_seen.append(labels)
        entities: dict[str, list[dict[str, Any]]] = {}
        for fragment, label in self.found.items():
            start = chunk.find(fragment)
            if start != -1 and label in labels:
                entities.setdefault(label, []).append(
                    {"start": start, "end": start + len(fragment), "confidence": 0.95}
                )
        return {"entities": entities}


def _recognizer(
    monkeypatch: pytest.MonkeyPatch, found: dict[str, str]
) -> tuple[CustomTermsRecognizer, _FakeGliner]:
    fake = _FakeGliner(found)
    monkeypatch.setattr(custom_terms, "_load_gliner2", lambda _repo: fake)
    terms = [
        CustomTerm("dossiernummer", "Nummer van een dossier"),
        CustomTerm("projectcode", "Code van een project"),
    ]
    return CustomTermsRecognizer(terms), fake


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("dossiernummer", "TERM_DOSSIERNUMMER"),
        ("Dossier-nummer", "TERM_DOSSIER_NUMMER"),
        ("Cliënt code", "TERM_CLIENT_CODE"),
        ("---", "TERM_BEGRIP"),
    ],
)
def test_term_entity_type(label: str, expected: str) -> None:
    assert term_entity_type(label) == expected


def test_terms_are_found_with_their_description(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "Dossier D-2024-0012 hoort bij project PRJ-778."
    recognizer, fake = _recognizer(
        monkeypatch, {"D-2024-0012": "dossiernummer", "PRJ-778": "projectcode"}
    )
    found = sorted((text[r.start : r.end], r.entity_type) for r in recognizer.analyze(text))
    assert found == [("D-2024-0012", "TERM_DOSSIERNUMMER"), ("PRJ-778", "TERM_PROJECTCODE")]
    assert fake.labels_seen[0] == {
        "dossiernummer": "Nummer van een dossier",
        "projectcode": "Code van een project",
    }


def test_only_the_terms_asked_for_are_searched(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "Dossier D-2024-0012 hoort bij project PRJ-778."
    recognizer, fake = _recognizer(
        monkeypatch, {"D-2024-0012": "dossiernummer", "PRJ-778": "projectcode"}
    )
    found = [text[r.start : r.end] for r in recognizer.analyze(text, ["TERM_PROJECTCODE"])]
    assert found == ["PRJ-778"]
    assert list(fake.labels_seen[0]) == ["projectcode"]


def test_a_term_beats_a_date_read_inside_it() -> None:
    text = "Dossier D-2024-0012 is gesloten."
    term_start = text.index("D-2024-0012")
    results = [
        RecognizerResult("TERM_DOSSIERNUMMER", term_start, term_start + 11, 0.95),
        RecognizerResult(
            "DATE_TIME",
            term_start + 2,
            term_start + 6,
            0.85,
            analysis_explanation=AnalysisExplanation(
                recognizer="NlDateRecognizer", original_score=0.85
            ),
        ),
    ]
    assert [r.entity_type for r in filter_overlaps(results, text)] == ["TERM_DOSSIERNUMMER"]


@pytest.mark.parametrize("rule_type", ["NL_STUDENT_ID", "EDU_COURSE_CODE", "INTERNAL_CASE_NUMBER"])
def test_a_rule_based_identifier_keeps_its_label_over_a_term(rule_type: str) -> None:
    text = "Studentnummer s7654321 staat in het dossier."
    start = text.index("s7654321")
    results = [
        RecognizerResult("TERM_DOSSIERNUMMER", start, start + 8, 0.95),
        RecognizerResult(rule_type, start, start + 8, 0.6),
    ]
    assert [r.entity_type for r in filter_overlaps(results, text)] == [rule_type]


def test_a_term_beats_a_generic_phone_number() -> None:
    text = "Klant 0612345678 belde."
    start = text.index("0612345678")
    results = [
        RecognizerResult("TERM_KLANTNUMMER", start, start + 10, 0.9),
        RecognizerResult("PHONE_NUMBER", start, start + 10, 0.4),
    ]
    assert [r.entity_type for r in filter_overlaps(results, text)] == ["TERM_KLANTNUMMER"]


@pytest.mark.parametrize(
    ("terms", "message"),
    [
        ([(f"begrip{i}", "") for i in range(26)], "hoogstens"),
        ([("<script>", "")], "ongeldig"),
        ([("dossiernummer", ""), ("Dossiernummer", "")], "dubbel"),
        ([("dossiernummer", "x" * 301)], "300"),
    ],
)
def test_profile_terms_are_checked(terms: list[tuple[str, str]], message: str) -> None:
    with pytest.raises(runtime.RuntimeConfigError, match=message):
        runtime._validate_terms(terms)

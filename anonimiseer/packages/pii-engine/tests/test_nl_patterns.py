"""Tests voor NL-patronen: telefoon, postcode, studentnummer."""

from __future__ import annotations

import pytest


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Bel me op 06-12345678 morgen.", "06-12345678"),
        ("Mijn nummer is 0612345678.", "0612345678"),
        ("Contact: +31 6 12345678", "+31 6 12345678"),
        ("Vast: 020-1234567", "020-1234567"),
    ],
)
def test_phone_detected(analyzer: object, text: str, expected: str) -> None:
    results = analyzer.analyze(text=text, language="nl", entities=["NL_PHONE_NUMBER"])  # type: ignore[attr-defined]
    assert results, f"Geen telefoonnummer gedetecteerd in {text!r}"
    matched = [text[r.start : r.end] for r in results]
    assert any(expected.replace(" ", "") in m.replace(" ", "") for m in matched), matched


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Ik woon op postcode 6811 AA.", "6811 AA"),
        ("De postcode is 1234AB.", "1234AB"),
        ("Adres: Kerkstraat 5, 3811 AJ Amersfoort", "3811 AJ"),
    ],
)
def test_postcode_detected(analyzer: object, text: str, expected: str) -> None:
    results = analyzer.analyze(text=text, language="nl", entities=["NL_POSTCODE"])  # type: ignore[attr-defined]
    assert results, f"Geen postcode gedetecteerd in {text!r}"
    matched = [text[r.start : r.end] for r in results]
    assert any(m.replace(" ", "") == expected.replace(" ", "") for m in matched), matched


@pytest.mark.parametrize(
    "text",
    [
        "Postcode 0234 AB bestaat niet",  # mag niet met 0
        "1234 SA is een uitgesloten combinatie",
        "1234 SD ook",
    ],
)
def test_postcode_rejects_invalid(analyzer: object, text: str) -> None:
    results = analyzer.analyze(text=text, language="nl", entities=["NL_POSTCODE"])  # type: ignore[attr-defined]
    assert results == [], f"Mocht niet matchen: {text!r}"


def test_student_number_han(analyzer: object) -> None:
    text = "Mijn studentnummer is S1234567, aanmelding via HAN."
    results = analyzer.analyze(text=text, language="nl", entities=["NL_STUDENT_ID"])  # type: ignore[attr-defined]
    matched = [text[r.start : r.end] for r in results]
    assert "S1234567" in matched, matched

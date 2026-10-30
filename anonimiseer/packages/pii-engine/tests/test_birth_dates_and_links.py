"""Birth dates and links to a person are masked by default; other dates and links are not.

All names and links here are made up.
"""

from __future__ import annotations

import pytest

from pii_engine.postfilter import filter_overlaps


def _found(analyzer: object, text: str, entities: list[str]) -> list[tuple[str, str]]:
    raw = analyzer.analyze(text=text, language="nl", entities=entities)  # type: ignore[attr-defined]
    return sorted((text[r.start : r.end], r.entity_type) for r in filter_overlaps(raw, text))


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("De heer Smit (geboren 14-03-1985) belde.", "14-03-1985"),
        ("Geboortedatum: 14 maart 1985", "14 maart 1985"),
        ("Geboortedatum\n\n1985-03-14", "1985-03-14"),
        ("Anna Smit, geb. 14-03-85, woont in Ede.", "14-03-85"),
        ("Date of birth: 14/03/1985", "14/03/1985"),
    ],
)
def test_birth_date_detected(analyzer: object, text: str, expected: str) -> None:
    assert _found(analyzer, text, ["BIRTH_DATE"]) == [(expected, "BIRTH_DATE")]


@pytest.mark.parametrize(
    "text",
    [
        "Het overleg is op 14-03-2026 in Ede.",
        "Geboorteplaats: Utrecht. In dienst sinds 01-09-2020.",
    ],
)
def test_other_dates_are_not_birth_dates(analyzer: object, text: str) -> None:
    assert _found(analyzer, text, ["BIRTH_DATE"]) == []


def test_birth_date_is_still_a_date_when_only_dates_are_on(analyzer: object) -> None:
    text = "De heer Smit (geboren 14-03-1985) belde."
    assert ("14-03-1985", "DATE_TIME") in _found(analyzer, text, ["DATE_TIME"])


def test_birth_date_wins_over_date_when_both_are_on(analyzer: object) -> None:
    text = "De heer Smit (geboren 14-03-1985) belde."
    assert _found(analyzer, text, ["BIRTH_DATE", "DATE_TIME"]) == [("14-03-1985", "BIRTH_DATE")]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "Profiel: https://www.linkedin.com/in/anna-de-vries-12ab34/.",
            "https://www.linkedin.com/in/anna-de-vries-12ab34/",
        ),
        ("Zie linkedin.com/in/jdevries voor haar cv.", "linkedin.com/in/jdevries"),
        (
            "Code staat op https://github.com/jdevries/planner",
            "https://github.com/jdevries/planner",
        ),
        (
            "Volg haar op https://www.instagram.com/annadevries_",
            "https://www.instagram.com/annadevries_",
        ),
        (
            "Contact: https://www.voorbeeld.nl/team/anna-de-vries",
            "https://www.voorbeeld.nl/team/anna-de-vries",
        ),
        ("Zijn pagina: www.voorbeeld.nl/mensen/jeroen.smit", "www.voorbeeld.nl/mensen/jeroen.smit"),
    ],
)
def test_personal_url_detected(analyzer: object, text: str, expected: str) -> None:
    assert _found(analyzer, text, ["PERSONAL_URL"]) == [(expected, "PERSONAL_URL")]


@pytest.mark.parametrize(
    "text",
    [
        "Bedrijfspagina: https://www.linkedin.com/company/voorbeeld-bv",
        "Lees https://github.com/features voor meer.",
        "Kijk op https://www.voorbeeld.nl/vacatures/job-vacatures-ede",
        "Meer info op https://www.voorbeeld.nl/over-ons",
        "Mail anna.devries@example.com voor vragen.",
    ],
)
def test_other_links_are_not_personal(analyzer: object, text: str) -> None:
    assert _found(analyzer, text, ["PERSONAL_URL"]) == []


def test_personal_url_wins_over_url_and_names_inside_it(analyzer: object) -> None:
    text = "Profiel: https://www.linkedin.com/in/anna-de-vries"
    found = _found(analyzer, text, ["PERSONAL_URL", "URL", "PERSON"])
    assert found == [("https://www.linkedin.com/in/anna-de-vries", "PERSONAL_URL")]

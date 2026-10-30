"""Span trimming in the post-filter, without running any NER.

In extracted documents a blank line is always a paragraph or table-cell
boundary. A detection that crosses one cannot be applied to the document, and
one that starts with a field label used to be reduced to that label and then
dropped as a false positive — both leaked the personal data next to it. A
detection that covers values in several cells is split, one part per cell.
"""

from __future__ import annotations

import pytest
from presidio_analyzer import RecognizerResult

from pii_engine.postfilter import filter_overlaps
from pii_engine.recognizers.nl_address import NlAddressRecognizer
from pii_engine.recognizers.nl_firstnames import NlFirstNameRecognizer

_FORM = "Naam\n\nIlse Brinkman\n\nAdres\n\nMolenweg 12b, 8011 RM Zwolle\n\nTelefoon\n\n06-52817340"


def _trimmed(text: str, entity: str, fragment: str) -> list[str]:
    start = text.index(fragment)
    result = RecognizerResult(
        entity_type=entity, start=start, end=start + len(fragment), score=0.85
    )
    return [text[r.start : r.end] for r in filter_overlaps([result], text)]


@pytest.mark.parametrize(
    ("text", "entity", "fragment", "expected"),
    [
        # Never across a blank line: the name stays, the next cell does not.
        (
            "Mohamed Bakkali\n\nMet vriendelijke groet",
            "PERSON",
            "Mohamed Bakkali\n\nMet",
            ["Mohamed Bakkali"],
        ),
        # A field label on the line(s) before the value is skipped, not kept.
        ("Adres\n\nBeukenlaan 8, Ede", "LOCATION", "Adres\n\nBeukenlaan 8", ["Beukenlaan 8"]),
        (
            "Contactpersoon\n\nMohamed Bakkali",
            "PERSON",
            "Contactpersoon\n\nMohamed Bakkali",
            ["Mohamed Bakkali"],
        ),
        ("Naam:\nAnna de Vries", "PERSON", "Naam:\nAnna de Vries", ["Anna de Vries"]),
        # A value followed by the next label keeps only the value.
        ("Ede\n\nContactpersoon", "LOCATION", "Ede\n\nContactpersoon", ["Ede"]),
        # Values in several cells are all kept, each as its own part.
        ("Tim\n\nTim de Wit", "PERSON", "Tim\n\nTim de Wit", ["Tim", "Tim de Wit"]),
        (
            "Ilse Brinkman\n\nAdres\n\nMolenweg 12b",
            "PERSON",
            "Ilse Brinkman\n\nAdres\n\nMolenweg",
            ["Ilse Brinkman", "Molenweg"],
        ),
        # A name that continues on the next line is kept whole …
        (
            "Jeroen\nvan der Meulen belt",
            "PERSON",
            "Jeroen\nvan der Meulen",
            ["Jeroen\nvan der Meulen"],
        ),
        # … but not when the next line is a role or a closing phrase.
        ("Piet van der Berg\nDocent", "PERSON", "Piet van der Berg\nDocent", ["Piet van der Berg"]),
        ("Anna Jansen\nMet vriendelijke groet", "PERSON", "Anna Jansen\nMet", ["Anna Jansen"]),
        # Only labels and blank lines: nothing left to mask.
        ("Adres\n\nPostcode", "LOCATION", "Adres\n\nPostcode", []),
    ],
)
def test_span_trimming_at_line_boundaries(
    text: str, entity: str, fragment: str, expected: list[str]
) -> None:
    assert _trimmed(text, entity, fragment) == expected


def test_address_recognizer_stays_within_a_line() -> None:
    results = NlAddressRecognizer().analyze(_FORM, ["LOCATION"])
    assert sorted(_FORM[r.start : r.end] for r in results) == ["Molenweg 12b", "Zwolle"]


def test_first_name_recognizer_stays_within_a_block() -> None:
    results = NlFirstNameRecognizer().analyze(_FORM, ["PERSON"])
    assert [_FORM[r.start : r.end] for r in results] == ["Ilse Brinkman"]


def test_first_name_recognizer_follows_a_wrapped_name() -> None:
    text = "Het gesprek met Jeroen\nvan der Meulen duurde kort."
    results = NlFirstNameRecognizer().analyze(text, ["PERSON"])
    assert [text[r.start : r.end] for r in results] == ["Jeroen\nvan der Meulen"]

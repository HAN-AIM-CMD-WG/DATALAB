"""Span trimming in the post-filter, without running any NER.

In extracted documents a blank line is always a paragraph or table-cell
boundary. A detection that crosses one cannot be applied to the document, and
one that starts with a field label used to be reduced to that label and then
dropped as a false positive — both leaked the personal data next to it. A
detection that covers values in several cells is split, one part per cell.
"""

from __future__ import annotations

import pytest
from presidio_analyzer import AnalysisExplanation, RecognizerResult

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
        # An address over two lines stays whole, a "Label: value" line does not join.
        (
            "Keizersgracht 123-3\nAmsterdam\nTelefoon: 020-1234567",
            "LOCATION",
            "Keizersgracht 123-3\nAmsterdam\nTelefoon: 020-1234567",
            ["Keizersgracht 123-3", "Amsterdam"],
        ),
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


def _hit(text: str, fragment: str, entity: str, recognizer: str) -> RecognizerResult:
    start = text.index(fragment)
    # Like the real SonarRecognizer, which only gets Presidio's metadata.
    explanation = (
        None
        if recognizer == "SonarRecognizer"
        else AnalysisExplanation(recognizer=recognizer, original_score=0.9)
    )
    return RecognizerResult(
        entity_type=entity,
        start=start,
        end=start + len(fragment),
        score=0.9,
        analysis_explanation=explanation,
        recognition_metadata={"recognizer_name": recognizer},
    )


def test_ner_overlapping_a_postcode_keeps_the_city() -> None:
    text = "Adres: Keizersgracht 123-3, 1015 CJ Amsterdam"
    results = [
        _hit(text, "1015 CJ", "NL_POSTCODE", "NlPostcodeRecognizer"),
        _hit(text, "CJ Amsterdam", "LOCATION", "SonarRecognizer"),
        _hit(text, "CJ Amsterdam", "ORGANIZATION", "SpacyRecognizer"),
    ]
    found = sorted((text[r.start : r.end], r.entity_type) for r in filter_overlaps(results, text))
    assert found == [("1015 CJ", "NL_POSTCODE"), ("Amsterdam", "LOCATION")]


def test_ner_overlapping_an_email_keeps_the_name_without_brackets() -> None:
    text = "Van: Tim de Wit <t.dewit@example.com>"
    results = [
        _hit(text, "t.dewit@example.com", "EMAIL_ADDRESS", "EmailRecognizer"),
        _hit(text, "Tim de Wit <t.dewit", "PERSON", "SonarRecognizer"),
    ]
    found = sorted(text[r.start : r.end] for r in filter_overlaps(results, text))
    assert found == ["Tim de Wit", "t.dewit@example.com"]


def test_model_label_beats_spacy_on_the_same_span() -> None:
    text = "Keizersgracht 123-3, 1015 CJ Amsterdam"
    results = [
        _hit(text, "1015 CJ", "NL_POSTCODE", "NlPostcodeRecognizer"),
        _hit(text, text, "LOCATION", "PiiModelRecognizer"),
        _hit(text, "CJ Amsterdam", "ORGANIZATION", "SpacyRecognizer"),
    ]
    found = sorted((text[r.start : r.end], r.entity_type) for r in filter_overlaps(results, text))
    assert found == [
        ("1015 CJ", "NL_POSTCODE"),
        ("Amsterdam", "LOCATION"),
        ("Keizersgracht 123-3", "LOCATION"),
    ]


def test_address_over_two_lines_keeps_the_place_after_the_postcode() -> None:
    text = "woonachtig op\nKeizersgracht 123-3\n1015 CJ Amsterdam."
    results = [
        _hit(text, "1015 CJ", "NL_POSTCODE", "NlPostcodeRecognizer"),
        _hit(text, "Keizersgracht 123-3\n1015 CJ Amsterdam", "LOCATION", "PiiModelRecognizer"),
        _hit(text, "CJ Amsterdam", "ORGANIZATION", "SpacyRecognizer"),
    ]
    found = sorted((text[r.start : r.end], r.entity_type) for r in filter_overlaps(results, text))
    assert found == [
        ("1015 CJ", "NL_POSTCODE"),
        ("Amsterdam", "LOCATION"),
        ("Keizersgracht 123-3", "LOCATION"),
    ]


def test_cut_keeps_the_apostrophe_of_a_place_name() -> None:
    text = "Stationsplein 4, 5211 AP 's-Hertogenbosch"
    results = [
        _hit(text, "5211 AP", "NL_POSTCODE", "NlPostcodeRecognizer"),
        _hit(text, text, "LOCATION", "PiiModelRecognizer"),
    ]
    found = sorted(text[r.start : r.end] for r in filter_overlaps(results, text))
    assert found == ["'s-Hertogenbosch", "5211 AP", "Stationsplein 4"]


def test_ner_address_around_a_postcode_is_split() -> None:
    text = "Molenweg 12b, 8011 RM Zwolle"
    results = [
        _hit(text, "8011 RM", "NL_POSTCODE", "NlPostcodeRecognizer"),
        _hit(text, text, "LOCATION", "SonarRecognizer"),
    ]
    found = sorted(text[r.start : r.end] for r in filter_overlaps(results, text))
    assert found == ["8011 RM", "Molenweg 12b", "Zwolle"]


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

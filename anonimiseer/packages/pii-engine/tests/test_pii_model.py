"""The PII model's output goes through the same checks as our own recognizers.

Uses a stand-in for the model, so it runs without the 1.1 GB download. All
names and numbers here are made up.
"""

from __future__ import annotations

from typing import Any

import pytest

from pii_engine.recognizers import pii_model
from pii_engine.recognizers.pii_model import PiiModelRecognizer
from pii_engine.validation import iban_valid, luhn_valid


def _recognizer(
    monkeypatch: pytest.MonkeyPatch, labels: dict[str, str]
) -> tuple[PiiModelRecognizer, list[str]]:
    """A recognizer whose model tags each listed fragment with its label."""
    calls: list[str] = []

    def fake_pipeline(chunk: str) -> list[dict[str, Any]]:
        calls.append(chunk)
        found = []
        for fragment, label in labels.items():
            start = chunk.find(fragment)
            if start != -1:
                found.append(
                    {
                        "entity_group": label,
                        "start": start,
                        "end": start + len(fragment),
                        "score": 0.9,
                    }
                )
        return found

    monkeypatch.setattr(pii_model, "local_token_classifier", lambda _repo: fake_pipeline)
    return PiiModelRecognizer(), calls


def _found(recognizer: PiiModelRecognizer, text: str) -> list[tuple[str, str]]:
    return sorted((text[r.start : r.end], r.entity_type) for r in recognizer.analyze(text))


def test_identifiers_are_checked_with_the_elfproef(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "BSN 123456782, order 318204957, paspoort NX12AB345."
    recognizer, _ = _recognizer(
        monkeypatch,
        {
            "123456782": "PERSON_IDENTIFIER",
            "318204957": "PERSON_IDENTIFIER",
            "NX12AB345": "DOCUMENT_IDENTIFIER",
        },
    )
    assert _found(recognizer, text) == [("123456782", "NL_BSN"), ("NX12AB345", "PERSON_IDENTIFIER")]


def test_bank_accounts_and_cards_need_a_valid_check_digit(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "IBAN NL91 ABNA 0417 1643 00 of NL00ABNA0000000000; kaart 4111 1111 1111 1111 of 4111 1111 1111 1112."
    recognizer, _ = _recognizer(
        monkeypatch,
        {
            "NL91 ABNA 0417 1643 00": "BANK_ACCOUNT_IDENTIFIER",
            "NL00ABNA0000000000": "BANK_ACCOUNT_IDENTIFIER",
            "4111 1111 1111 1111": "PAYMENT_CARD",
            "4111 1111 1111 1112": "PAYMENT_CARD",
        },
    )
    assert _found(recognizer, text) == [
        ("4111 1111 1111 1111", "CREDIT_CARD"),
        ("NL91 ABNA 0417 1643 00", "IBAN_CODE"),
    ]


def test_labels_are_translated_and_unknown_ones_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "Gesprek met Yusuf over zijn diabetes, woont op Molenweg 12b."
    recognizer, _ = _recognizer(
        monkeypatch,
        {" Yusuf": "PERSON_NAME", "diabetes": "HEALTH_DATA", "Molenweg 12b": "POSTAL_ADDRESS"},
    )
    assert _found(recognizer, text) == [("Molenweg 12b", "LOCATION"), ("Yusuf", "PERSON")]


def test_a_cut_off_number_is_judged_as_a_whole(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "Ordernummer 318204957 is verzonden; bel 06-12345678."
    recognizer, _ = _recognizer(
        monkeypatch, {"18204957": "PHONE_NUMBER", "06-12345678": "PHONE_NUMBER"}
    )
    assert _found(recognizer, text) == [("06-12345678", "PHONE_NUMBER")]


def test_long_texts_are_read_in_overlapping_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "Inleiding. " * 300 + "Contactpersoon is Ilse Brinkman." + " Slot." * 50
    recognizer, calls = _recognizer(monkeypatch, {"Ilse Brinkman": "PERSON_NAME"})
    assert _found(recognizer, text) == [("Ilse Brinkman", "PERSON")]
    assert len(calls) > 1


def test_entities_not_asked_for_are_not_returned(monkeypatch: pytest.MonkeyPatch) -> None:
    recognizer, calls = _recognizer(monkeypatch, {"Yusuf": "PERSON_NAME"})
    assert recognizer.analyze("Bel Yusuf.", entities=["IBAN_CODE"]) == []
    assert recognizer.analyze("Bel Yusuf.", entities=["NL_KENTEKEN"]) == []
    assert calls == ["Bel Yusuf."]


@pytest.mark.parametrize(
    ("value", "expected"),
    [("NL91ABNA0417164300", True), ("NL91 ABNA 0417 1643 01", False), ("12345", False)],
)
def test_iban_check(value: str, expected: bool) -> None:
    assert iban_valid(value) is expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("4111111111111111", True), ("4111111111111112", False), ("1234", False)],
)
def test_luhn_check(value: str, expected: bool) -> None:
    assert luhn_valid(value) is expected

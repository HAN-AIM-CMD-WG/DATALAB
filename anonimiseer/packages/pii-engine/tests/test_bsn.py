"""Tests voor de BSN Elfproef-recognizer.

Geldige test-BSN's (berekend met Elfproef; geen echte personen):

- ``123456782``  (9*1+8*2+7*3+6*4+5*5+4*6+3*7+2*8-1*2 = 154, deelbaar door 11)
- ``111222333``  (Elfproef-geldig)
- ``234567880``  (Elfproef-geldig)
- ``999995571``  (Elfproef-geldig)

Ongeldig:
- ``123456789``  (faalt Elfproef)
- ``010203040``  (faalt Elfproef, score 40)
- ``000000000``  (uitgesloten)
- ``111111111``  (trivial all-same)
"""

from __future__ import annotations

import pytest

from pii_engine.recognizers.bsn import BsnRecognizer, is_valid_bsn


class TestElfproef:
    @pytest.mark.parametrize(
        "bsn",
        [
            "123456782",
            "111222333",
            "234567880",
            "999995571",
            "123 456 782",  # spaties
            "123-456-782",  # streepjes
        ],
    )
    def test_valid_bsns(self, bsn: str) -> None:
        assert is_valid_bsn(bsn) is True

    @pytest.mark.parametrize(
        "bsn",
        [
            "123456789",  # Elfproef faalt
            "010203040",  # Elfproef faalt
            "000000000",  # uitgesloten
            "111111111",  # alle dezelfde cijfers
            "222222222",
            "12345",  # te kort
            "12345678901",  # te lang
            "abcdefghi",  # geen cijfers
            "",
        ],
    )
    def test_invalid_bsns(self, bsn: str) -> None:
        assert is_valid_bsn(bsn) is False

    def test_eight_digit_padding_valid(self) -> None:
        """Een 8-cijferig nummer dat mét voorlopende 0 Elfproef-geldig is, wordt geaccepteerd."""

        # "010000008" is Elfproef-geldig (som = 8 - 8 = 0). De kale 8-cijferige
        # "10000008" moet implicet met leading 0 gepadded worden en ook valide zijn.
        assert is_valid_bsn("010000008") is True
        assert is_valid_bsn("10000008") is True


class TestBsnRecognizerIntegration:
    def test_recognizes_valid_bsn_in_context(self, analyzer: object) -> None:
        text = "Mijn BSN is 123456782 en mijn naam is Jan."
        # Mypy: runtime-type, we gebruiken de fixture uit conftest.
        results = analyzer.analyze(text=text, language="nl", entities=["NL_BSN"])  # type: ignore[attr-defined]
        assert len(results) == 1
        hit = results[0]
        assert hit.entity_type == "NL_BSN"
        assert text[hit.start : hit.end] == "123456782"
        assert hit.score == pytest.approx(1.0)

    def test_rejects_invalid_bsn(self, analyzer: object) -> None:
        text = "Let op: 123456789 is geen geldig BSN."
        results = analyzer.analyze(text=text, language="nl", entities=["NL_BSN"])  # type: ignore[attr-defined]
        assert results == []

    def test_standalone_recognizer_constructs(self) -> None:
        """Zonder fixture: de recognizer moet kunnen construeren en patronen hebben."""

        rec = BsnRecognizer()
        assert rec.supported_entities == ["NL_BSN"]
        assert rec.patterns[0].name == "bsn_elfproef"

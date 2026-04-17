"""Tests voor de ``anonymize_with_mode`` routine."""

from __future__ import annotations

from presidio_analyzer import RecognizerResult

from pii_engine.anonymizer import PseudonymMapping, anonymize_with_mode


def _result(entity_type: str, start: int, end: int, score: float = 0.9) -> RecognizerResult:
    return RecognizerResult(entity_type=entity_type, start=start, end=end, score=score)


class TestPseudonymize:
    def test_stable_token_for_same_original(self) -> None:
        text = "Jan werkt bij HAN. Jan belt vaak."
        # Twee detecties voor "Jan".
        results = [_result("PERSON", 0, 3), _result("PERSON", 19, 22)]
        mapping = PseudonymMapping()
        out = anonymize_with_mode(text, results, mode="pseudonymize", mapping=mapping)
        assert out.text == "PERSON_1 werkt bij HAN. PERSON_1 belt vaak."
        assert out.mapping is not None
        assert len(out.mapping) == 1
        assert out.mapping[0]["pseudonym"] == "PERSON_1"

    def test_different_entity_types_get_own_counters(self) -> None:
        text = "Jan woont in Ede."
        results = [_result("PERSON", 0, 3), _result("LOCATION", 13, 16)]
        out = anonymize_with_mode(text, results, mode="pseudonymize")
        assert "PERSON_1" in out.text
        assert "LOCATION_1" in out.text

    def test_mapping_reports_original_casing(self) -> None:
        """De API-mapping moet de originele schrijfwijze behouden, niet de
        case-folded lookup-key."""

        text = "Postcode 6811 AA hier."
        results = [_result("NL_POSTCODE", 9, 16)]
        out = anonymize_with_mode(text, results, mode="pseudonymize")
        assert out.mapping is not None
        entry = next(m for m in out.mapping if m["pseudonym"] == "NL_POSTCODE_1")
        assert entry["original"] == "6811 AA"

    def test_overlap_highest_score_wins(self) -> None:
        text = "Jan de Vries"
        # Twee overlappende detecties: "Jan" (lage score) en "Jan de Vries" (hoge score).
        results = [
            _result("PERSON", 0, 3, score=0.4),
            _result("PERSON", 0, 12, score=0.95),
        ]
        out = anonymize_with_mode(text, results, mode="pseudonymize")
        assert out.text == "PERSON_1"


class TestRedact:
    def test_replaces_with_label(self) -> None:
        text = "Jan belt 06-12345678."
        results = [_result("PERSON", 0, 3), _result("NL_PHONE_NUMBER", 9, 20)]
        out = anonymize_with_mode(text, results, mode="redact")
        assert out.text == "[PERSON] belt [NL_PHONE_NUMBER]."
        assert out.mapping is None

    def test_empty_results_passthrough(self) -> None:
        out = anonymize_with_mode("Geen PII hier.", [], mode="redact")
        assert out.text == "Geen PII hier."
        assert out.items == []

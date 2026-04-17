"""Aanvullende Presidio ``EntityRecognizer``s voor NL-specifieke PII."""

from pii_engine.recognizers.bsn import BsnRecognizer, is_valid_bsn
from pii_engine.recognizers.nl_phone import NlPhoneRecognizer
from pii_engine.recognizers.nl_postcode import NlPostcodeRecognizer
from pii_engine.recognizers.nl_studentnr import NlStudentnrRecognizer

__all__ = [
    "BsnRecognizer",
    "NlPhoneRecognizer",
    "NlPostcodeRecognizer",
    "NlStudentnrRecognizer",
    "is_valid_bsn",
]

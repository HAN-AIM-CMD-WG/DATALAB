"""Checks that a number is what a model says it is.

A model recognises the shape of an identifier, not its checksum. Model output
goes through the same checks as our own recognizers, so ``318204957`` is not a
BSN just because it has nine digits.
"""

from __future__ import annotations

import re

from pii_engine.recognizers.bsn import is_valid_bsn

__all__ = ["digits_only", "iban_valid", "is_valid_bsn", "luhn_valid"]

_IBAN_SHAPE = re.compile(r"[A-Z]{2}\d{2}[A-Z0-9]{10,30}")


def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def iban_valid(value: str) -> bool:
    """ISO 13616: move the first four characters to the end; the number mod 97 is 1."""
    iban = re.sub(r"[\s.\-]", "", value).upper()
    if not _IBAN_SHAPE.fullmatch(iban):
        return False
    rearranged = iban[4:] + iban[:4]
    return int("".join(str(int(c, 36)) for c in rearranged)) % 97 == 1


def luhn_valid(value: str) -> bool:
    """Payment card check digit; 12 to 19 digits."""
    digits = [int(c) for c in digits_only(value)]
    if not 12 <= len(digits) <= 19:
        return False
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0

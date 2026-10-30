"""Put the originals back into a pseudonymised text or document.

The inverse of pseudonymising: every pseudonym from the mapping is replaced by
its original, and the watermark the app added is removed, so a document comes
back as it was, apart from the document properties that were cleared (those
were never kept). PDFs cannot be restored: redaction removes the text for good.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

from docx import Document
from openpyxl import load_workbook

from pii_engine.postfilter import ENTITY_PRIORITY

#: The start of the watermark added by the app (``buildFooterNote``).
WATERMARK_PREFIX = "Anonimiseer — automatisch verwerkt op"
WATERMARK_SHEET = "_Anonimiseer"

_BOUNDARY_BEFORE = r"(?<![A-Za-z0-9_])"
_BOUNDARY_AFTER = r"(?![A-Za-z0-9_])"
_ANY_PSEUDONYM = re.compile(
    _BOUNDARY_BEFORE
    + r"(?P<type>(?:"
    + "|".join(sorted(map(re.escape, ENTITY_PRIORITY), key=len, reverse=True))
    + r"))_\d+"
    + _BOUNDARY_AFTER
)


class RestoreError(ValueError):
    """The file cannot be restored; the message is meant for the user."""


@dataclass(frozen=True)
class Restored:
    data: bytes
    #: Pseudonyms replaced by their original.
    restored: int
    #: Pseudonyms in the file that are not in this mapping (another run's).
    unknown: int


def _pattern(mapping: dict[str, str]) -> re.Pattern[str] | None:
    if not mapping:
        return None
    # Longest first, and whole tokens only, so PERSON_1 never matches inside PERSON_10.
    names = sorted(mapping, key=len, reverse=True)
    return re.compile(
        _BOUNDARY_BEFORE + "(?:" + "|".join(map(re.escape, names)) + ")" + _BOUNDARY_AFTER
    )


def count_unknown(text: str, mapping: dict[str, str]) -> int:
    return sum(1 for m in _ANY_PSEUDONYM.finditer(text) if m.group(0) not in mapping)


def restore_text(text: str, mapping: dict[str, str]) -> tuple[str, int, int]:
    """Return the restored text, the number of pseudonyms replaced and unknown."""
    unknown = count_unknown(text, mapping)
    pattern = _pattern(mapping)
    if pattern is None:
        return text, 0, unknown
    restored, count = pattern.subn(lambda m: mapping[m.group(0)], text)
    return restored, count, unknown


def _remove_docx_watermark(data: bytes) -> bytes:
    doc = Document(io.BytesIO(data))
    paragraphs = doc.paragraphs
    for index in range(len(paragraphs) - 1, -1, -1):
        if paragraphs[index].text.startswith(WATERMARK_PREFIX):
            doomed = [paragraphs[index]]
            # The empty spacer paragraph the app adds right before it.
            if index > 0 and not paragraphs[index - 1].text.strip():
                doomed.append(paragraphs[index - 1])
            for para in doomed:
                para._element.getparent().remove(para._element)
            break
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _remove_xlsx_watermark(data: bytes) -> bytes:
    wb = load_workbook(io.BytesIO(data))
    if WATERMARK_SHEET not in wb.sheetnames:
        return data
    del wb[WATERMARK_SHEET]
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def restore_document(file_bytes: bytes, filename: str, mapping: dict[str, str]) -> Restored:
    from . import AcceptedReplacement, apply, count_unreplaced, extract

    ext = PurePosixPath(filename).suffix.lower()
    if ext == ".pdf":
        raise RestoreError(
            "Een PDF kan niet worden teruggezet: bij het anonimiseren is de tekst er "
            "definitief uit gehaald. Gebruik het originele bestand."
        )
    if ext == ".docx":
        cleaned = _remove_docx_watermark(file_bytes)
    elif ext == ".xlsx":
        cleaned = _remove_xlsx_watermark(file_bytes)
    else:
        raise RestoreError(f"Bestandstype '{ext}' kan niet worden teruggezet.")

    extracted = extract(cleaned, filename)
    unknown = count_unknown(extracted.flat_text, mapping)
    pattern = _pattern(mapping)
    replacements = (
        [
            AcceptedReplacement(m.start(), m.end(), mapping[m.group(0)], m.group(0))
            for m in pattern.finditer(extracted.flat_text)
        ]
        if pattern is not None
        else []
    )
    data = apply(cleaned, filename, replacements, extracted.blocks)
    missed = count_unreplaced(cleaned, data, filename, replacements)
    return Restored(data=data, restored=len(replacements) - missed, unknown=unknown + missed)


__all__ = ["RestoreError", "Restored", "count_unknown", "restore_document", "restore_text"]

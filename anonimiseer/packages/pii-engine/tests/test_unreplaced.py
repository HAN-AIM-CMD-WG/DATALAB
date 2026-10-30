"""A replacement that silently fails must be reported, not lost.

Covers the check that runs after applying replacements: it compares how often
each replaced text occurs before and after. All names here are made up.
"""

from __future__ import annotations

import io
import json

import fitz
import pytest
from docx import Document
from fastapi.testclient import TestClient

from pii_engine.api import create_app
from pii_engine.documents import AcceptedReplacement, apply, count_unreplaced, extract

NAME = "Anna de Vries"


def _docx(*paragraphs: str) -> bytes:
    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _replace(flat_text: str, value: str, occurrence: int = 0) -> AcceptedReplacement:
    start = -1
    for _ in range(occurrence + 1):
        start = flat_text.index(value, start + 1)
    return AcceptedReplacement(start, start + len(value), "PERSON_1", value)


def _check(data: bytes, filename: str, replacements: list[AcceptedReplacement]) -> int:
    blocks = extract(data, filename).blocks
    return count_unreplaced(
        data, apply(data, filename, replacements, blocks), filename, replacements
    )


def test_nothing_reported_when_every_replacement_lands() -> None:
    data = _docx(f"Gesprek met {NAME}.", f"{NAME} belt terug.")
    flat = extract(data, "a.docx").flat_text
    reps = [_replace(flat, NAME, 0), _replace(flat, NAME, 1)]
    assert _check(data, "a.docx", reps) == 0


def test_a_rejected_occurrence_is_not_reported() -> None:
    data = _docx(f"Gesprek met {NAME}.", f"{NAME} belt terug.")
    flat = extract(data, "a.docx").flat_text
    assert _check(data, "a.docx", [_replace(flat, NAME, 0)]) == 0


def test_a_replacement_across_paragraphs_is_reported() -> None:
    data = _docx("Gesprek met Anna", "de Vries belt terug.")
    flat = extract(data, "a.docx").flat_text
    start = flat.index("Anna")
    end = flat.index("de Vries") + len("de Vries")
    rep = AcceptedReplacement(start, end, "PERSON_1", flat[start:end])
    assert _check(data, "a.docx", [rep]) == 1


def test_pdf_text_that_cannot_be_found_is_reported() -> None:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), f"Gesprek met {NAME}.")
    data = doc.tobytes()
    doc.close()
    flat = extract(data, "a.pdf").flat_text
    found = _replace(flat, NAME)
    lost = AcceptedReplacement(found.start, found.end, "PERSON_1", original=None)
    assert _check(data, "a.pdf", [found]) == 0
    assert _check(data, "a.pdf", [lost]) == 1


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(), base_url="http://127.0.0.1")


def test_apply_endpoint_reports_the_count(client: TestClient) -> None:
    data = _docx("Gesprek met Anna", "de Vries belt terug.")
    extracted = extract(data, "a.docx")
    flat = extracted.flat_text
    start = flat.index("Anna")
    end = flat.index("de Vries") + len("de Vries")
    payload = {
        "replacements": [
            {"start": start, "end": end, "replacement": "PERSON_1", "original": flat[start:end]}
        ],
        "blocks": [
            {"id": b.id, "kind": b.kind, "start": b.start, "end": b.end} for b in extracted.blocks
        ],
    }
    response = client.post(
        "/document/apply",
        files={"file": ("a.docx", data)},
        data={"payload": json.dumps(payload)},
    )
    assert response.status_code == 200
    assert response.headers["X-Anonimiseer-Unreplaced"] == "1"

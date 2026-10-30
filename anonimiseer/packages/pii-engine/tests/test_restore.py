"""Restoring a pseudonymised file gives back the original.

The documents are pseudonymised the way the app does it, watermark included,
and must come back with the same text. All names here are made up.
"""

from __future__ import annotations

import io
import json

import fitz
import pytest
from docx import Document
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

from pii_engine.api import create_app
from pii_engine.documents import AcceptedReplacement, apply, extract
from pii_engine.documents.restore import RestoreError, restore_document, restore_text

WATERMARK = "Anonimiseer — automatisch verwerkt op 2026-10-30 via pseudonimisering."
ORIGINALS = {"Anne de Vries": "PERSON_1", "Bram Smit": "PERSON_2", "Ede": "LOCATION_1"}
MAPPING = {pseudonym: original for original, pseudonym in ORIGINALS.items()}


def _pseudonymise(data: bytes, filename: str) -> bytes:
    extracted = extract(data, filename)
    replacements = []
    for original, pseudonym in ORIGINALS.items():
        start = extracted.flat_text.find(original)
        while start != -1:
            replacements.append(
                AcceptedReplacement(start, start + len(original), pseudonym, original)
            )
            start = extracted.flat_text.find(original, start + 1)
    return apply(data, filename, replacements, extracted.blocks, footer_note=WATERMARK)


def test_restore_text_replaces_whole_pseudonyms_only() -> None:
    text = "PERSON_1 belde PERSON_10 en PERSON_2 over LOCATION_1; PERSON_3 onbekend."
    mapping = {**MAPPING, "PERSON_10": "Ilse Brinkman"}
    restored, count, unknown = restore_text(text, mapping)
    assert restored == "Anne de Vries belde Ilse Brinkman en Bram Smit over Ede; PERSON_3 onbekend."
    assert (count, unknown) == (4, 1)


def test_docx_round_trip() -> None:
    doc = Document()
    doc.add_paragraph("Gesprek met Anne de Vries in Ede.")
    table = doc.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Contactpersoon"
    table.rows[0].cells[1].text = "Bram Smit"
    doc.add_paragraph("Anne de Vries belt Bram Smit terug.")
    buffer = io.BytesIO()
    doc.save(buffer)
    original = buffer.getvalue()

    pseudonymised = _pseudonymise(original, "a.docx")
    assert "Anne de Vries" not in extract(pseudonymised, "a.docx").flat_text

    result = restore_document(pseudonymised, "a.docx", MAPPING)
    assert extract(result.data, "a.docx").flat_text == extract(original, "a.docx").flat_text
    assert (result.restored, result.unknown) == (5, 0)


def test_xlsx_round_trip() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Contacten"
    ws["A1"] = "Anne de Vries"
    ws["B1"] = "Ede"
    ws["A2"] = "Bram Smit"
    buffer = io.BytesIO()
    wb.save(buffer)
    original = buffer.getvalue()

    pseudonymised = _pseudonymise(original, "a.xlsx")
    assert "_Anonimiseer" in load_workbook(io.BytesIO(pseudonymised)).sheetnames

    result = restore_document(pseudonymised, "a.xlsx", MAPPING)
    restored_wb = load_workbook(io.BytesIO(result.data))
    assert restored_wb.sheetnames == ["Contacten"]
    assert [[c.value for c in row] for row in restored_wb["Contacten"].iter_rows()] == [
        ["Anne de Vries", "Ede"],
        ["Bram Smit", None],
    ]


def test_pdf_is_refused() -> None:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "PERSON_1 belt.")
    with pytest.raises(RestoreError, match="PDF"):
        restore_document(doc.tobytes(), "a.pdf", MAPPING)


def _mapping_payload() -> list[dict[str, str]]:
    return [
        {"entity_type": p.split("_")[0], "pseudonym": p, "original": o} for p, o in MAPPING.items()
    ]


def test_restore_endpoints() -> None:
    client = TestClient(create_app(), base_url="http://127.0.0.1")
    body = client.post(
        "/restore/text",
        json={"text": "PERSON_1 woont in LOCATION_1.", "mapping": _mapping_payload()},
    ).json()
    assert body == {"text": "Anne de Vries woont in Ede.", "restored": 2, "unknown": 0}

    doc = Document()
    doc.add_paragraph("Gesprek met Anne de Vries.")
    buffer = io.BytesIO()
    doc.save(buffer)
    pseudonymised = _pseudonymise(buffer.getvalue(), "a.docx")
    response = client.post(
        "/document/restore",
        files={"file": ("a.docx", pseudonymised)},
        data={"payload": json.dumps({"mapping": _mapping_payload()})},
    )
    assert response.status_code == 200
    assert response.headers["X-Anonimiseer-Restored"] == "1"
    original_text = extract(buffer.getvalue(), "a.docx").flat_text
    assert extract(response.content, "a.docx").flat_text == original_text

    refused = client.post(
        "/document/restore",
        files={"file": ("a.pdf", b"%PDF-1.4")},
        data={"payload": json.dumps({"mapping": []})},
    )
    assert refused.status_code == 415

"""Personal data outside the visible text must not survive anonymisation.

Covers document properties, comments and tracked changes in Word, properties
and cell comments in Excel, and the info dictionary, XMP metadata and
annotations in PDF. All names here are made up.
"""

from __future__ import annotations

import io
import re
import zipfile

import fitz
from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment

from pii_engine.documents import AcceptedReplacement
from pii_engine.documents.docx_support import apply_docx, extract_docx
from pii_engine.documents.pdf_support import apply_pdf, extract_pdf
from pii_engine.documents.xlsx_support import apply_xlsx, extract_xlsx

AUTHOR = "Joke Vermeer"
CLIENT = "Laura Smit"
COMPANY = "Bureau Vermeer"
DELETED_BSN = "123456782"


def _package_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        return "\n".join(
            package.read(name).decode("utf-8", "replace") for name in package.namelist()
        )


def _with_company(data: bytes, company: str) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            content = src.read(info.filename)
            if info.filename == "docProps/app.xml":
                xml = re.sub(r"<Company\s*/>|<Company>.*?</Company>", "", content.decode())
                content = xml.replace(
                    "</Properties>", f"<Company>{company}</Company></Properties>"
                ).encode()
            dst.writestr(info, content)
    return out.getvalue()


def _docx_with_hidden_personal_data() -> bytes:
    doc = Document()
    props = doc.core_properties
    props.author = AUTHOR
    props.last_modified_by = AUTHOR
    props.title = f"Intake {CLIENT}"
    props.subject = CLIENT
    props.keywords = CLIENT
    props.comments = f"Dossier {CLIENT}"

    para = doc.add_paragraph("Beste mevrouw ")
    para._p.append(
        parse_xml(
            f'<w:ins {nsdecls("w")} w:id="1" w:author="{AUTHOR}" '
            f'w:date="2026-01-05T10:00:00Z"><w:r><w:t>{CLIENT}</w:t></w:r></w:ins>'
        )
    )
    para._p.append(
        parse_xml(
            f'<w:del {nsdecls("w")} w:id="2" w:author="{AUTHOR}" '
            f'w:date="2026-01-05T10:00:00Z"><w:r><w:delText> (BSN {DELETED_BSN})</w:delText>'
            f"</w:r></w:del>"
        )
    )
    note = doc.add_paragraph("Zie bijlage.")
    doc.add_comment(note.runs[0], text=f"Nog navragen bij {CLIENT}", author=AUTHOR, initials="JV")

    buffer = io.BytesIO()
    doc.save(buffer)
    return _with_company(buffer.getvalue(), COMPANY)


class TestDocx:
    def test_tracked_changes_are_accepted_before_extraction(self):
        result = extract_docx(_docx_with_hidden_personal_data())
        assert f"Beste mevrouw {CLIENT}" in result.flat_text
        assert DELETED_BSN not in result.flat_text

    def test_output_has_no_personal_data_outside_the_text(self):
        data = _docx_with_hidden_personal_data()
        assert AUTHOR in _package_text(data)
        assert COMPANY in _package_text(data)
        assert DELETED_BSN in _package_text(data)

        result = extract_docx(data)
        start = result.flat_text.index(CLIENT)
        out = apply_docx(
            data,
            [AcceptedReplacement(start, start + len(CLIENT), "PERSOON_1", CLIENT)],
            result.blocks,
        )

        package = _package_text(out)
        for value in (AUTHOR, CLIENT, COMPANY, DELETED_BSN):
            assert value not in package, f"{value!r} survived in the output package"
        assert "w:delText" not in package

        out_doc = Document(io.BytesIO(out))
        assert out_doc.paragraphs[0].text == "Beste mevrouw PERSOON_1"
        assert out_doc.core_properties.author == ""
        assert out_doc.core_properties.title == ""

    def test_extract_and_apply_agree_on_blocks_with_revisions(self):
        data = _docx_with_hidden_personal_data()
        result = extract_docx(data)
        out = apply_docx(data, [], result.blocks)
        assert extract_docx(out).flat_text == result.flat_text


class TestXlsx:
    def test_output_has_no_properties_or_cell_comments(self):
        wb = Workbook()
        wb.properties.creator = AUTHOR
        wb.properties.lastModifiedBy = AUTHOR
        wb.properties.title = f"Intake {CLIENT}"
        ws = wb.active
        ws["A1"] = "Zaak"
        ws["A1"].comment = Comment(f"Bel {CLIENT}", AUTHOR)
        buffer = io.BytesIO()
        wb.save(buffer)
        data = buffer.getvalue()
        assert AUTHOR in _package_text(data)

        out = apply_xlsx(data, [], extract_xlsx(data).blocks)

        package = _package_text(out)
        assert AUTHOR not in package
        assert CLIENT not in package
        out_wb = load_workbook(io.BytesIO(out))
        assert out_wb.active["A1"].value == "Zaak"
        assert out_wb.active["A1"].comment is None


class TestPdf:
    def test_output_has_no_metadata_or_annotations(self):
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "Zie bijlage.")
        doc.set_metadata({"author": AUTHOR, "title": f"Intake {CLIENT}", "subject": CLIENT})
        doc.set_xml_metadata(f"<x:xmpmeta xmlns:x='adobe:ns:meta/'>{AUTHOR}</x:xmpmeta>")
        annot = page.add_text_annot((100, 100), f"Bel {CLIENT}")
        annot.set_info(title=AUTHOR)
        annot.update()
        data = doc.tobytes()
        doc.close()

        out = apply_pdf(data, [], extract_pdf(data).blocks)

        out_doc = fitz.open(stream=out, filetype="pdf")
        metadata = out_doc.metadata or {}
        assert not metadata.get("author")
        assert not metadata.get("title")
        assert not metadata.get("subject")
        assert AUTHOR not in out_doc.get_xml_metadata()
        assert list(out_doc[0].annots() or []) == []
        assert AUTHOR.encode() not in out
        assert CLIENT.encode() not in out

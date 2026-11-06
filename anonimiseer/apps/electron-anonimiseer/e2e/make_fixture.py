"""Generate the Word and PDF fixtures for the end-to-end test.

Everything in them is invented. In the Word file the layout is what matters: a
table where the label ("Adres", "Contactpersoon") sits in its own cell next to
or above the value, plus author and title in the document properties. Both are
places where personal data has leaked before. The PDF is written by hand, so
PyMuPDF is not needed here: the app downloads it during the test.

Run with the engine's environment, which has python-docx:
    ../../packages/pii-engine/.venv/bin/python e2e/make_fixture.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from docx import Document

OUT = Path(__file__).parent / ".tmp" / "input"

# Every value that must be gone from the anonymised output, text and properties alike.
ORIGINALS = {
    "body": [
        "Laura Smit", "111222333", "NL91ABNA0417164300", "06-12345678",
        "laura.smit@example.nl", "Beukenlaan 8", "6711 AB", "Mohamed Bakkali", "Joke Vermeer",
    ],
    "properties": ["Joke Vermeer", "Laura Smit"],
    "pdf": [
        "Pieter de Groot", "Kastanjelaan 14", "3512 AB", "06-87654321", "p.degroot@example.nl",
        "Sanne Bos",
    ],
}

PDF_LINES = [
    "Geachte heer Pieter de Groot,",
    "Uw aanvraag is ontvangen. U woont op Kastanjelaan 14, 3512 AB Utrecht.",
    "Bel ons gerust op 06-87654321 of mail naar p.degroot@example.nl.",
    "Met vriendelijke groet,",
    "Sanne Bos",
]


def write_pdf(path: Path, lines: list[str]) -> None:
    """One A4 page in Helvetica; ASCII text only."""
    ops = ["BT", "/F1 11 Tf", "72 770 Td"]
    for line in lines:
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        ops += [f"({escaped}) Tj", "0 -18 Td"]
    stream = "\n".join([*ops, "ET"]).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]"
        b" /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    path.write_bytes(bytes(out))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = Document()
    doc.core_properties.author = "Joke Vermeer"
    doc.core_properties.last_modified_by = "Joke Vermeer"
    doc.core_properties.title = "Intake Laura Smit"
    doc.add_heading("Intakeverslag", level=1)
    doc.add_paragraph("Beste mevrouw Laura Smit,")
    doc.add_paragraph(
        "Naar aanleiding van ons gesprek bevestig ik uw gegevens. Uw BSN is 111222333 en uw "
        "IBAN is NL91ABNA0417164300. U bent bereikbaar op 06-12345678 en via "
        "laura.smit@example.nl."
    )
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Adres"
    table.cell(0, 1).text = "Beukenlaan 8, 6711 AB Ede"
    table.cell(1, 0).text = "Contactpersoon"
    table.cell(1, 1).text = "Mohamed Bakkali"
    doc.add_paragraph("Met vriendelijke groet,\nJoke Vermeer")
    doc.save(OUT / "intake.docx")
    write_pdf(OUT / "brief.pdf", PDF_LINES)
    (OUT / "intake.originals.json").write_text(json.dumps(ORIGINALS, ensure_ascii=False, indent=1))
    print(f"fixture written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

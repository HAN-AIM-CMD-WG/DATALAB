"""Generate the Word fixture for the end-to-end test.

Everything in it is invented. The layout is what matters: a table where the
label ("Adres", "Contactpersoon") sits in its own cell next to or above the
value, plus author and title in the document properties. Both are places where
personal data has leaked before.

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
}


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
    (OUT / "intake.originals.json").write_text(json.dumps(ORIGINALS, ensure_ascii=False, indent=1))
    print(f"fixture written to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

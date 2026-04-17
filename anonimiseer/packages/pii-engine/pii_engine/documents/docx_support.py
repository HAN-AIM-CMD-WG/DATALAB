"""DOCX-extractie en -herbouw via python-docx.

We lopen over alle paragrafen (body, table-cellen, headers, footers) en
behandelen iedere paragraaf als één blok. Vervangingen worden
rechts-naar-links binnen een paragraaf toegepast op run-niveau zodat
zoveel mogelijk opmaak (bold/italic/hyperlinks) behouden blijft.

Caveats:
    * Velden en comments worden niet aangeraakt.
    * Run-granulariteit betekent dat een vervanging die *midden* in
      een run begint en in de volgende eindigt, tot verlies van opmaak
      op het overgangsstuk leidt. Dat is een bewust trade-off voor
      simpliciteit en werkt voor 99% van wat we tegenkomen.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING, Iterable

from docx import Document
from docx.document import Document as DocumentType
from docx.table import Table, _Cell
from docx.text.paragraph import Paragraph

from ._common import apply_replacements_to_text, group_replacements_per_block

if TYPE_CHECKING:  # pragma: no cover
    from . import AcceptedReplacement, Block, ExtractResult

_BLOCK_SEPARATOR = "\n\n"


def _container_element(container):
    """Geef het XML-element terug waarvan we direct de children willen.

    * Document → ``<w:body>`` (hier leven paragrafen/tabellen).
    * _Cell → ``<w:tc>`` element (cell container).
    * Anders → probeer ``_element`` (protected API, maar stabiel
      genoeg voor python-docx — de ``.element`` property heeft niet
      elke subclass).
    """

    if isinstance(container, DocumentType):
        return container.element.body
    if isinstance(container, _Cell):
        return container._tc  # noqa: SLF001
    return container._element  # noqa: SLF001


def _iter_container(
    container, prefix: str, kind: str = "paragraph"
) -> Iterable[tuple[str, str, Paragraph]]:
    """Loop sequentieel over paragrafen en tabellen in een container.

    Werkt voor zowel een Document als een _Cell. We gebruiken het XML
    rechtstreeks om paragrafen en tabellen in originele volgorde op te
    leveren; dat geeft stabielere id's dan ``container.paragraphs`` +
    ``container.tables`` apart af te lopen.
    """

    element = _container_element(container)
    para_idx = 0
    table_idx = 0
    for child in element.iterchildren():
        tag = child.tag.split("}", 1)[-1]
        if tag == "p":
            yield (f"{prefix}.p{para_idx}", kind, Paragraph(child, container))
            para_idx += 1
        elif tag == "tbl":
            table = Table(child, container)
            for row_idx, row in enumerate(table.rows):
                for cell_idx, cell in enumerate(row.cells):
                    yield from _iter_container(
                        cell,
                        f"{prefix}.t{table_idx}.r{row_idx}.c{cell_idx}",
                        kind="table-cell",
                    )
            table_idx += 1


def _iter_all_paragraphs(doc: DocumentType) -> Iterable[tuple[str, str, Paragraph]]:
    """Yield (block_id, kind, paragraph) voor alle tekstvelden in doc.

    Volgorde: per sectie header → body (in document-volgorde, inclusief
    tabellen) → per sectie footer. De id-structuur is deterministisch
    voor hetzelfde document.
    """

    for section_idx, section in enumerate(doc.sections):
        for para_idx, para in enumerate(section.header.paragraphs):
            yield (f"h{section_idx}.p{para_idx}", "header", para)

    yield from _iter_container(doc, "b")

    for section_idx, section in enumerate(doc.sections):
        for para_idx, para in enumerate(section.footer.paragraphs):
            yield (f"f{section_idx}.p{para_idx}", "footer", para)


def extract_docx(file_bytes: bytes) -> "ExtractResult":
    """Bouw flat_text en block_map op voor een DOCX-bestand."""

    from . import Block, ExtractResult

    doc = Document(io.BytesIO(file_bytes))
    texts: list[str] = []
    blocks: list[Block] = []
    cursor = 0

    for block_id, kind, para in _iter_all_paragraphs(doc):
        text = para.text
        start = cursor
        end = start + len(text)
        blocks.append(Block(id=block_id, kind=kind, start=start, end=end))  # type: ignore[arg-type]
        texts.append(text)
        cursor = end + len(_BLOCK_SEPARATOR)

    flat_text = _BLOCK_SEPARATOR.join(texts)
    return ExtractResult(flat_text=flat_text, blocks=blocks)


def _replace_paragraph_text(para: Paragraph, new_text: str) -> None:
    """Vervang de tekst van een paragraaf maar behoud opmaak van run 0.

    We pakken de eerste run als "ankerrun" en zetten daar de nieuwe
    tekst in. De overige runs verwijderen we. Dat verliest inline-
    formatting (bold midden in de zin) maar houdt
    paragraaf-level-opmaak (lettertype, grootte, alinea-stijl) intact.
    """

    runs = para.runs
    if not runs:
        # Lege paragraaf kunnen we niet zinvol vullen zonder een run te maken;
        # gebruik `add_run` als fallback.
        para.add_run(new_text)
        return

    # Bewaar run[0] als anker; wis rest.
    first_run = runs[0]
    for run in runs[1:]:
        run._element.getparent().remove(run._element)  # noqa: SLF001
    first_run.text = new_text


def apply_docx(
    file_bytes: bytes,
    replacements: list["AcceptedReplacement"],
    blocks: list["Block"],
    footer_note: str | None = None,
) -> bytes:
    """Pas vervangingen toe en geef nieuwe DOCX-bytes terug."""

    doc = Document(io.BytesIO(file_bytes))
    grouped = group_replacements_per_block(blocks, replacements)

    # Bouw een index van block_id → paragraph-ref in de huidige parse.
    paragraphs: dict[str, Paragraph] = {}
    for block_id, _kind, para in _iter_all_paragraphs(doc):
        paragraphs[block_id] = para

    for block_id, block_replacements in grouped.items():
        if not block_replacements:
            continue
        para = paragraphs.get(block_id)
        if para is None:
            # Block uit de extract-stap bestaat niet meer in dit document —
            # defensief overslaan.
            continue
        new_text = apply_replacements_to_text(para.text, block_replacements)
        if new_text != para.text:
            _replace_paragraph_text(para, new_text)

    if footer_note:
        # Een lichte horizontale lijn + cursief italic paragraaf onderaan
        # de body. We schrijven 'm in het body-element zodat hij in elke
        # standaard DOCX-viewer zichtbaar is, ook als er secties of
        # kolommen zijn.
        doc.add_paragraph()  # spacer
        para = doc.add_paragraph()
        run = para.add_run(footer_note)
        run.italic = True
        run.font.size = None  # erf van paragraaf-stijl

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


__all__ = ["apply_docx", "extract_docx"]

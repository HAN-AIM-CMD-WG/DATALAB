"""PDF-extractie en -herbouw via PyMuPDF (fitz).

PDF is fundamenteel positioneel: er is geen notie van "paragraaf".
We extraheren daarom per *regel* (zoals PyMuPDF die detecteert) en
bouwen daar blokken van. Dat geeft de review-UI genoeg granulariteit,
en laat ons bij opslaan de bijbehorende rechthoeken terugvinden om
redactie-annotaties te plaatsen.

Bij het toepassen:
    * Voor elke geaccepteerde hit binnen een regel zoeken we de
      bounding box van de *originele* tekst binnen die regel op via
      ``page.search_for``.
    * We plaatsen een redaction-annotatie met de vervangende tekst;
      ``apply_redactions`` knipt dan de oude tekst weg en tekent de
      nieuwe in dezelfde positie.

Caveats:
    * Als tekst een pagina/lijn-break overschrijdt (zeldzaam voor
      PII-patronen, maar wel mogelijk) wordt de hit overgeslagen.
    * De font en kleur van de vervangtekst is de pagina-default; we
      proberen niet de originele font te matchen.
    * Formulieren, annotaties en OCR-lagen worden niet aangeraakt.
"""

from __future__ import annotations

import io
from typing import TYPE_CHECKING

import fitz  # PyMuPDF

from ._common import group_replacements_per_block

if TYPE_CHECKING:  # pragma: no cover
    from . import AcceptedReplacement, Block, ExtractResult

_BLOCK_SEPARATOR = "\n"


def _line_id(page_idx: int, block_idx: int, line_idx: int) -> str:
    return f"p{page_idx}:b{block_idx}:l{line_idx}"


def _parse_line_id(block_id: str) -> tuple[int, int, int] | None:
    try:
        page_part, block_part, line_part = block_id.split(":")
        return (
            int(page_part[1:]),
            int(block_part[1:]),
            int(line_part[1:]),
        )
    except (ValueError, IndexError):
        return None


def extract_pdf(file_bytes: bytes) -> ExtractResult:
    from . import Block, ExtractResult

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    texts: list[str] = []
    blocks: list[Block] = []
    cursor = 0

    try:
        for page_idx, page in enumerate(doc):
            page_dict = page.get_text("dict")
            for block_idx, raw_block in enumerate(page_dict.get("blocks", [])):
                # type 0 = tekstblok; type 1 = afbeelding.
                if raw_block.get("type", 0) != 0:
                    continue
                for line_idx, line in enumerate(raw_block.get("lines", [])):
                    spans = line.get("spans", [])
                    line_text = "".join(span.get("text", "") for span in spans).strip()
                    if not line_text:
                        continue
                    block_id = _line_id(page_idx, block_idx, line_idx)
                    start = cursor
                    end = start + len(line_text)
                    blocks.append(Block(id=block_id, kind="pdf-line", start=start, end=end))
                    texts.append(line_text)
                    cursor = end + len(_BLOCK_SEPARATOR)
    finally:
        doc.close()

    flat_text = _BLOCK_SEPARATOR.join(texts)
    return ExtractResult(flat_text=flat_text, blocks=blocks)


def apply_pdf(
    file_bytes: bytes,
    replacements: list[AcceptedReplacement],
    blocks: list[Block],
    footer_note: str | None = None,
) -> bytes:
    grouped = group_replacements_per_block(blocks, replacements)

    # Groepeer blok-ids per pagina zodat we per pagina één keer werken.
    per_page: dict[int, list[tuple[str, list[AcceptedReplacement]]]] = {}
    for block in blocks:
        parsed = _parse_line_id(block.id)
        if parsed is None:
            continue
        page_idx = parsed[0]
        per_page.setdefault(page_idx, []).append((block.id, grouped.get(block.id, [])))

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        for page_idx, page_blocks in per_page.items():
            if page_idx >= len(doc):
                continue
            page = doc[page_idx]
            any_redaction = False
            for _block_id, block_replacements in page_blocks:
                if not block_replacements:
                    continue
                for rep in block_replacements:
                    # PyMuPDF kent geen offset-based replace, dus we moeten
                    # op literale tekst zoeken. De UI levert ``original``
                    # voor PDF's mee; zonder dat kunnen we de bounding box
                    # niet vinden en slaan we de hit over.
                    original = rep.original
                    if not original:
                        continue
                    areas = page.search_for(original, quads=False)
                    for area in areas:
                        page.add_redact_annot(area, text=rep.replacement, fill=(1, 1, 1))
                        any_redaction = True
            if any_redaction:
                page.apply_redactions()

        if footer_note:
            # Watermerk: kleine grijze tekst onderaan elke pagina. Niet
            # roterend (geen "DRAFT"-overlay) want dat maakt de tekst
            # moeilijker leesbaar; doel is alleen herleidbaarheid.
            for page in doc:
                rect = page.rect
                margin = 14
                box = fitz.Rect(
                    margin, rect.height - 22, rect.width - margin, rect.height - margin / 2
                )
                page.insert_textbox(
                    box,
                    footer_note,
                    fontsize=7,
                    color=(0.5, 0.5, 0.5),
                    align=1,  # center
                )

        buffer = io.BytesIO()
        doc.save(buffer, deflate=True, garbage=3)
        return buffer.getvalue()
    finally:
        doc.close()


__all__ = ["apply_pdf", "extract_pdf"]

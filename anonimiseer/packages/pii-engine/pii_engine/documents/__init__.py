"""Document-extractie en -herbouw voor Anonimiseer.

Dit subpackage levert één uniforme API voor het:

1. **extraheren** van tekstinhoud uit een documentbestand (DOCX/XLSX/PDF)
   tot een *flat* tekstrepresentatie + een ``block_map`` die iedere
   sectie van de originele tekst koppelt aan coördinaten in de flat
   tekst;
2. **toepassen** van een set geaccepteerde vervangingen (in coördinaten
   van de flat tekst) op het originele bestand, zonder de
   oorspronkelijke opmaak te verliezen waar dat redelijkerwijs kan.

De flat-tekst wordt door de Electron-app getoond in de review-stap,
zodat dezelfde highlight-UI voor alle formaten werkt. De block_map
zorgt dat we bij het opslaan terug kunnen mappen naar de juiste
paragraaf/cel/pagina.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from .docx_support import apply_docx, extract_docx
from .pdf_support import apply_pdf, extract_pdf
from .xlsx_support import apply_xlsx, extract_xlsx

BlockKind = Literal[
    "paragraph",
    "table-cell",
    "header",
    "footer",
    "sheet-cell",
    "pdf-line",
    "pdf-page",
]


@dataclass(frozen=True)
class Block:
    """Eén doorlopend tekstblok in het document.

    Attributes:
        id: Stabiele identifier, format hangt af van het document-type.
        kind: Welk soort blok dit is; puur informatief voor de UI.
        start: Offset (inclusief) in de flat tekst waar dit blok begint.
        end: Offset (exclusief) waar het blok eindigt.
    """

    id: str
    kind: BlockKind
    start: int
    end: int


@dataclass(frozen=True)
class ExtractResult:
    """Resultaat van :func:`extract`.

    ``blocks`` en ``flat_text`` zijn samen voldoende om de originele
    structuur terug te vinden: ``flat_text[block.start:block.end]`` geeft
    de tekst van dat blok terug.
    """

    flat_text: str
    blocks: list[Block]


@dataclass(frozen=True)
class AcceptedReplacement:
    """Eén door de gebruiker geaccepteerde vervanging in flat-tekst-coords.

    Attributes:
        start: Begin-offset in de flat tekst.
        end: Einde-offset in de flat tekst (exclusief).
        replacement: Nieuwe tekst om in te zetten.
        original: Optionele originele tekst — noodzakelijk voor PDF omdat
            PyMuPDF op tekstinhoud zoekt, niet op offsets. Voor DOCX/XLSX
            wordt dit veld genegeerd.
    """

    start: int
    end: int
    replacement: str
    original: str | None = None


class UnsupportedFormat(ValueError):  # noqa: N818 — publieke API, niet hernoemen
    """Het ingediende bestand heeft een extensie die we niet kennen."""


def _ext(filename: str) -> str:
    return PurePosixPath(filename).suffix.lower()


def extract(file_bytes: bytes, filename: str) -> ExtractResult:
    """Pak de tekstinhoud uit een documentbestand.

    Raises:
        UnsupportedFormat: als de extensie niet ondersteund wordt.
    """

    ext = _ext(filename)
    if ext == ".docx":
        return extract_docx(file_bytes)
    if ext == ".xlsx":
        return extract_xlsx(file_bytes)
    if ext == ".pdf":
        return extract_pdf(file_bytes)
    raise UnsupportedFormat(f"Bestandstype '{ext}' wordt niet ondersteund.")


def apply(
    file_bytes: bytes,
    filename: str,
    replacements: list[AcceptedReplacement],
    blocks: list[Block],
    footer_note: str | None = None,
) -> bytes:
    """Pas de vervangingen toe en geef nieuwe bestand-bytes terug.

    De implementatie per formaat is verantwoordelijk voor het terug-
    mappen van flat-tekst-coördinaten naar de juiste lokale positie en
    voor het zo veel mogelijk bewaren van opmaak. Als ``footer_note``
    gevuld is wordt een zichtbaar watermerk toegevoegd zodat een
    ontvanger weet dat dit een geautomatiseerde anonimisatie is.
    """

    ext = _ext(filename)
    if ext == ".docx":
        return apply_docx(file_bytes, replacements, blocks, footer_note=footer_note)
    if ext == ".xlsx":
        return apply_xlsx(file_bytes, replacements, blocks, footer_note=footer_note)
    if ext == ".pdf":
        return apply_pdf(file_bytes, replacements, blocks, footer_note=footer_note)
    raise UnsupportedFormat(f"Bestandstype '{ext}' wordt niet ondersteund.")


__all__ = [
    "AcceptedReplacement",
    "Block",
    "ExtractResult",
    "UnsupportedFormat",
    "apply",
    "extract",
]

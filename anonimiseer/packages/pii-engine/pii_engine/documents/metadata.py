"""Remove personal data that lives outside the visible text of a document.

Anonymising the body text is not enough. Office files carry the author, the
last editor, the title and the company in their document properties; comments
carry their author and their own text; tracked changes keep deleted text in
the file and name whoever made each change. Text extraction sees none of it,
so all of it would leave the machine unanonymised.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Callable
from typing import Any

from lxml import etree

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# Core properties (docProps/core.xml) that name or describe a person or case.
_CORE_FIELDS = {
    "{http://purl.org/dc/elements/1.1/}creator",
    "{http://purl.org/dc/elements/1.1/}title",
    "{http://purl.org/dc/elements/1.1/}subject",
    "{http://purl.org/dc/elements/1.1/}description",
    "{http://purl.org/dc/elements/1.1/}identifier",
    "{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}lastModifiedBy",
    "{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}keywords",
    "{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}category",
    "{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}contentStatus",
}
# Extended properties (docProps/app.xml).
_APP_FIELDS = {
    "{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Company",
    "{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Manager",
    "{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}HyperlinkBase",
}
# Attributes that identify a person on comments, revisions and comment authors.
_PERSON_ATTRS = {"author", "initials", "userId", "displayName", "providerId"}

# Word revision records: deleted content goes, inserted content stays.
_REMOVE_WITH_CONTENT = {f"{{{_W}}}{t}" for t in ("del", "moveFrom", "delText")}
_UNWRAP = {f"{{{_W}}}{t}" for t in ("ins", "moveTo")}
_REMOVE_MARKERS = {
    f"{{{_W}}}{t}"
    for t in (
        "rPrChange",
        "pPrChange",
        "sectPrChange",
        "tblPrChange",
        "trPrChange",
        "tcPrChange",
        "tblGridChange",
        "numberingChange",
        "cellIns",
        "cellDel",
        "moveFromRangeStart",
        "moveFromRangeEnd",
        "moveToRangeStart",
        "moveToRangeEnd",
    )
}
_REMOVE = _REMOVE_WITH_CONTENT | _REMOVE_MARKERS
_WORD_STORY = re.compile(r"^word/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$")
_XML_PART = re.compile(r"^(word|xl)/.+\.xml$")


def _rewrite_zip(data: bytes, transform: Callable[[str, bytes], bytes | None]) -> bytes:
    """Copy an OOXML package, letting ``transform`` replace parts by name."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as dst:
        for info in src.infolist():
            content = src.read(info.filename)
            replaced = transform(info.filename, content)
            dst.writestr(info, content if replaced is None else replaced)
    return out.getvalue()


def _parse(content: bytes) -> Any:
    return etree.fromstring(content, parser=etree.XMLParser(resolve_entities=False))


def _serialize(root: Any) -> bytes:
    return bytes(etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True))


def _accept_revisions(root: Any) -> None:
    for el in [e for e in root.iter() if e.tag in _REMOVE]:
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
    for el in [e for e in root.iter() if e.tag in _UNWRAP]:
        parent = el.getparent()
        if parent is None:
            continue
        if parent.tag == f"{{{_W}}}rPr":
            # A revision marker on a paragraph mark, not a content container.
            parent.remove(el)
            continue
        index = parent.index(el)
        for child in list(el):
            parent.insert(index, child)
            index += 1
        parent.remove(el)


def accept_docx_revisions(data: bytes) -> bytes:
    """Accept all tracked changes in a DOCX.

    Inserted text becomes ordinary text, so it is extracted and anonymised like
    the rest; deleted text is removed, so it cannot survive in the file. Both
    extraction and applying replacements must start from this same accepted
    version, otherwise their paragraph positions no longer line up.
    """

    def transform(name: str, content: bytes) -> bytes | None:
        if not _WORD_STORY.match(name):
            return None
        root = _parse(content)
        _accept_revisions(root)
        return _serialize(root)

    return _rewrite_zip(data, transform)


def _clear_text(root: Any, tags: set[str]) -> None:
    for el in root.iter():
        if el.tag in tags:
            el.text = ""
            for child in list(el):
                el.remove(child)


def scrub_office_metadata(data: bytes) -> bytes:
    """Strip people and case details from an OOXML package (DOCX or XLSX).

    Clears identifying document properties, empties every custom property,
    blanks author attributes on comments and revisions, and empties the text of
    Word comments (it is never extracted, so it is never anonymised).
    """

    def transform(name: str, content: bytes) -> bytes | None:
        if name == "docProps/core.xml":
            root = _parse(content)
            _clear_text(root, _CORE_FIELDS)
            return _serialize(root)
        if name == "docProps/app.xml":
            root = _parse(content)
            _clear_text(root, _APP_FIELDS)
            return _serialize(root)
        if name == "docProps/custom.xml":
            root = _parse(content)
            for prop in root:
                for value in prop:
                    value.text = ""
            return _serialize(root)
        if not _XML_PART.match(name):
            return None
        root = _parse(content)
        changed = False
        for el in root.iter():
            if not isinstance(el.tag, str):
                continue
            for attr in list(el.attrib):
                if etree.QName(attr).localname in _PERSON_ATTRS and el.attrib[attr]:
                    el.attrib[attr] = ""
                    changed = True
            if etree.QName(el).localname == "author" and el.text:
                el.text = ""
                changed = True
        if re.match(r"^word/comments\w*\.xml$", name):
            for t in root.iter(f"{{{_W}}}t"):
                if t.text:
                    t.text = ""
                    changed = True
        return _serialize(root) if changed else None

    return _rewrite_zip(data, transform)


def scrub_pdf_metadata(doc: Any) -> None:
    """Clear the info dictionary, XMP metadata and annotations of a PyMuPDF document.

    Annotations include comments and sticky notes, which carry their author and
    text that extraction does not see. Call after redactions have been applied.
    """
    doc.set_metadata({})
    doc.del_xml_metadata()
    for page in doc:
        for annot in list(page.annots() or []):
            page.delete_annot(annot)

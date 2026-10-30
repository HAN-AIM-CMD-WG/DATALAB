"""Independent Dutch test set with a complete answer key.

Everything in this file is invented: names, addresses, numbers, organisations.
E-mail domains are reserved example domains. Never add real documents or
fragments of them here; partner test sets stay with the partner.

The text covers common business document types (memo, minutes, letter, form in
table layout, e-mail with signature). Personal data is inserted at known
positions, so any detection that does not land on one is a proven false
positive. Traps are text that looks like personal data but is not.

Scope: PERSON, ADDRESS, PHONE, EMAIL, BSN, IBAN.

Usage:
    python bench/heldout.py      # writes bench/data/heldout.{txt,gold.json}
"""

from __future__ import annotations

import json
from pathlib import Path

DATA = Path(__file__).parent / "data"


def bsn(prefix8: str) -> str:
    """Complete eight digits to a BSN that passes the Elfproef."""
    total = sum(int(d) * w for d, w in zip(prefix8, range(9, 1, -1), strict=True))
    for last in range(10):
        if (total - last) % 11 == 0:
            return prefix8 + str(last)
    raise ValueError(f"no valid check digit for {prefix8}")


def passes_elfproef(number: str) -> bool:
    total = sum(int(d) * w for d, w in zip(number[:8], range(9, 1, -1), strict=True))
    return (total - int(number[8])) % 11 == 0


def iban_nl(bank: str, account10: str) -> str:
    digits = "".join(str(int(c, 36)) for c in f"{bank}{account10}NL00")
    return f"NL{98 - int(digits) % 97:02d}{bank}{account10}"


BSN_1 = bsn("35182046")
BSN_2 = bsn("28465013")
IBAN_1 = iban_nl("ABNA", "0512873406")
IBAN_2 = iban_nl("TRIO", "0390471852")
ORDER_NR = "318204957"
assert not passes_elfproef(ORDER_NR), "the order number trap must not be a valid BSN"

P, A, T, E, B, IB, X = "PERSON", "ADDRESS", "PHONE", "EMAIL", "BSN", "IBAN", "TRAP"

# Each segment is plain text, (category, value) or (TRAP, text, why).
DOC: list[object] = [
    "Memo migratie opslag\n\n",
    "Het team ",
    (X, "OPS", "department abbreviation"),
    " vervangt de opslagserver door type ",
    (X, "ZX-3310 v4", "product type number"),
    " met ",
    (X, "2400 GB", "size, not a postcode"),
    " opslag. De bestelling loopt onder ordernummer ",
    (X, ORDER_NR, "nine digits, not a BSN"),
    ". Zie ",
    (X, "Tabblad 2", "spreadsheet tab"),
    ", ",
    (X, "Kolom F", "spreadsheet column"),
    " voor de planning per locatie. Aanspreekpunt is ",
    (P, "Merel Kooistra"),
    ".\n\n",
    "In het overzicht staan de velden ",
    (X, "Woonplaats", "field label"),
    " en ",
    (X, "Contactpersonen", "field label"),
    "; lege velden worden niet geëxporteerd. ",
    "De software draait op ",
    (X, "versie 4.12.1", "version number"),
    ".\n\n",
    "---\n\n",
    "Notulen projectoverleg, 6 oktober 2026\n",
    "Aanwezig: ",
    (P, "Daan Wolters"),
    ", ",
    (P, "Yusuf Demir"),
    ", ",
    (P, "Sophie van den Akker"),
    ".\n",
    "Besluiten: ",
    (P, "Yusuf"),
    " maakt de offerte af. ",
    (P, "Sophie"),
    " plant de test met de afdeling ",
    (X, "BI", "department abbreviation"),
    ".\n\n",
    "---\n\n",
    "Aan: mevrouw ",
    (P, "C.J. Hoekstra-Visser"),
    "\n",
    (A, "Lindelaan 47"),
    "\n",
    (A, "3581 KX Utrecht"),
    "\n\n",
    "Zwolle, 9 oktober 2026\n\n",
    "Geachte mevrouw ",
    (P, "Hoekstra-Visser"),
    ",\n\n",
    "Wij hebben uw aanvraag ontvangen en uw gegevens geregistreerd: burgerservicenummer ",
    (B, BSN_1),
    ", rekeningnummer ",
    (IB, IBAN_1),
    ". U kunt ons bereiken op ",
    (T, "038-4217765"),
    " of via uw contactpersoon ",
    (E, "b.zwart@example.nl"),
    ".\n\n",
    "Met vriendelijke groet,\n\n",
    (P, "Bram Zwart"),
    "\nadviseur klantcontact\n\n",
    "---\n\n",
    "Aanmeldformulier\n\n",
    "Naam\n\n",
    (P, "Ilse Brinkman"),
    "\n\n",
    "Adres\n\n",
    (A, "Molenweg 12b, 8011 RM Zwolle"),
    "\n\n",
    "Telefoon\n\n",
    (T, "06-52817340"),
    "\n\n",
    "BSN\n\n",
    (B, BSN_2),
    "\n\n",
    "IBAN\n\n",
    (IB, IBAN_2),
    "\n\n",
    "Contactpersoon\n\n",
    (P, "Kofi Mensah"),
    "\n\n",
    "Met vriendelijke groet,\n",
    (P, "Anouk Peeters"),
    "\n\n",
    "---\n\n",
    "Van: ",
    (P, "Tim de Wit"),
    " <",
    (E, "t.dewit@example.com"),
    ">\n",
    "Aan: ",
    (P, "Ruben Hendriks"),
    " <",
    (E, "ruben.hendriks@example.org"),
    ">\n",
    "Onderwerp: planning testronde\n\n",
    "Hoi ",
    (P, "Ruben"),
    ",\n\n",
    "Zoals afgesproken met ",
    (P, "Ilse Brinkman"),
    " starten we de testronde na de migratie. Kun je ",
    (P, "Ilse"),
    " vragen of ze donderdag kan? Ze is bereikbaar op ",
    (T, "+31 6 4120 3398"),
    ".\n\n",
    "Groet ",
    (P, "Tim"),
    "\n\n",
    (P, "Tim de Wit"),
    " | Projectbureau\n",
    (T, "(030) 765 43 21"),
    "\n",
    (E, "t.dewit@example.com"),
    "\n\n",
    "---\n\n",
    "De verhuizing naar het pand aan de ",
    (A, "Prinses Irenestraat 9-1, 2595 BG Den Haag"),
    " staat gepland voor maart; ",
    (P, "Merel"),
    " regelt de sleuteloverdracht.\n",
]


def build() -> tuple[str, list[dict[str, object]]]:
    parts: list[str] = []
    spans: list[dict[str, object]] = []
    pos = 0
    for seg in DOC:
        if isinstance(seg, str):
            text = seg
        else:
            kind, text = seg[0], seg[1]
            span: dict[str, object] = {"start": pos, "end": pos + len(text), "text": text}
            if kind == X:
                span.update({"kind": "trap", "note": seg[2]})
            else:
                span.update({"kind": "pii", "category": kind})
            spans.append(span)
        parts.append(text)
        pos += len(text)
    return "".join(parts), spans


def write() -> tuple[Path, Path]:
    text, spans = build()
    DATA.mkdir(exist_ok=True)
    txt, gold = DATA / "heldout.txt", DATA / "heldout.gold.json"
    txt.write_text(text, encoding="utf-8")
    gold.write_text(json.dumps(spans, ensure_ascii=False, indent=1), encoding="utf-8")
    return txt, gold


if __name__ == "__main__":
    _, spans = build()
    write()
    pii = [s for s in spans if s["kind"] == "pii"]
    per_cat: dict[str, int] = {}
    for s in pii:
        per_cat[str(s["category"])] = per_cat.get(str(s["category"]), 0) + 1
    traps = sum(s["kind"] == "trap" for s in spans)
    print(f"{len(pii)} personal data items {per_cat}, {traps} traps -> {DATA}")

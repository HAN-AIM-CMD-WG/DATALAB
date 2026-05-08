"""Post-processing van Presidio-resultaten: false-positives verwijderen.

Presidio geeft soms overlappende hits terug die logisch samenvallen maar
formeel apart staan:

    - ``2514`` als ``DATE_TIME`` terwijl ``2514 EE`` al als ``NL_POSTCODE``
      is herkend → het jaartal is geen datum, het is het postcode-cijferdeel.
    - ``example.com`` als ``URL`` terwijl ``fatima@example.com`` al als
      ``EMAIL_ADDRESS`` is herkend → de URL is het email-domein.

Deze filter verwijdert zulke "losse" sub-hits zodat de UI en de
anonimisering ze niet als aparte entities behandelen. Belangrijk: we
verwijderen alleen hits die **volledig** binnen een andere, hogere-prioriteit
hit liggen.

Prioriteit-ordening (van sterkste naar zwakste):
    NL_BSN > EMAIL_ADDRESS > NL_POSTCODE > NL_PHONE_NUMBER > IBAN_CODE >
    PHONE_NUMBER > URL > ORGANIZATION > LOCATION > PERSON > DATE_TIME

Exacte gelijkwaardige hits (zelfde range + entity) worden ook deduplicated;
verschillende entity-types op exact dezelfde range blijven wel staan
(bv. een naam die ook locatie kan zijn — user beslist dan).
"""

from __future__ import annotations

import re
from typing import Sequence

from presidio_analyzer import RecognizerResult

# Hoe lager het getal, hoe sterker/preciezer de categorie. Bij overlap
# laten we alleen de "sterkste" (laagste getal) staan wanneer één hit
# volledig binnen de ander valt. "Onbekende" entities krijgen impliciet
# prioriteit 999 (zwakst).
ENTITY_PRIORITY: dict[str, int] = {
    # Sterkste categorieën: op checksum of hard patroon.
    "NL_BSN": 0,
    "IBAN_CODE": 1,
    "CREDIT_CARD": 1,
    "BIC_CODE": 2,
    "EMAIL_ADDRESS": 2,
    # Online identifiers: wachtwoord overschrijft PERSON/DATE_TIME zodat
    # ``Wachtwoord: Zomer2026`` niet als naam of datum eindigt. Username
    # en handle zijn iets minder sterk maar nog ruim boven NER.
    "PASSWORD": 1,
    "USERNAME": 4,
    "SOCIAL_HANDLE": 4,
    # NL-identificatienummers: hard patroon + context. Staan bewust
    # boven DATE_TIME/PHONE_NUMBER zodat we "KvK 34567890" niet als
    # datum of telefoonnummer behandelen.
    "NL_KVK": 2,
    "NL_BIG": 2,
    "NL_AGB": 2,
    "NL_BTW": 2,
    "NL_RIJBEWIJS": 2,
    "NL_ID_CARD": 2,
    "NL_POLICY_NUMBER": 2,
    "BE_RIJKSREGISTER": 2,
    "NL_POSTCODE": 3,
    "NL_STUDENT_ID": 3,
    "NL_EMPLOYEE_ID": 3,
    # OV-chipkaartnummer heeft dezelfde klasse als postcode/ID: strak
    # patroon + context. Prio onder IBAN om kaartnummer-op-bankpas (CC)
    # voorrang te laten houden.
    "NL_OV_CHIPKAART": 3,
    # Onderwijs-/HAN-codes. Zelfde rang als NL-identifiers: sterker dan
    # DATE_TIME en generieke NER, maar zwakker dan IBAN/BSN.
    "EDU_CLASS": 4,
    "EDU_COURSE_CODE": 4,
    "EDU_CROHO": 4,
    # IP- en MAC-adressen hebben een hard, onmiskenbaar patroon; we zetten
    # ze bewust boven PHONE_NUMBER zodat Presidio's generieke PhoneRecognizer
    # (die ``1.2.3.4`` soms als telefoonnummer leest) niet wint.
    "IP_ADDRESS": 3,
    "MAC_ADDRESS": 3,
    "NL_PHONE_NUMBER": 4,
    "PHONE_NUMBER": 5,
    "URL": 6,
    # NER-categorieën: breder, maar minder precies.
    "ORGANIZATION": 20,
    "LOCATION": 21,
    "PERSON": 22,
    # DATE_TIME is in Presidio zeer aggressief (pakt "4111", "20 1234567",
    # MAC-adressen) — daarom bewust laag: elke andere hit die overlapt wint.
    "DATE_TIME": 30,
    "NRP": 40,
}


def _priority(entity_type: str) -> int:
    return ENTITY_PRIORITY.get(entity_type, 999)


def _is_contained_in(inner: RecognizerResult, outer: RecognizerResult) -> bool:
    """``inner`` valt volledig binnen ``outer``? (niet zelfde object)."""

    if inner is outer:
        return False
    return inner.start >= outer.start and inner.end <= outer.end


def _overlaps(a: RecognizerResult, b: RecognizerResult) -> bool:
    """Overlappen ``a`` en ``b`` (niet hetzelfde object, niet disjoint)?"""

    if a is b:
        return False
    return not (a.end <= b.start or b.end <= a.start)


# Entity-types waar spaCy/SoNaR regelmatig stray hits op markdown-tabellen,
# lijst-opmaak en losse leestekens op levert. Voor deze types filteren
# we matches weg die geen enkele letter bevatten.
_PUNCT_SENSITIVE_TYPES = frozenset({"ORGANIZATION", "PERSON", "LOCATION"})
_HAS_LETTER_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]")
# Karakters die NER-hits soms aan de randen meetrekken bij markdown-tabellen
# en opmaak (``ING |``, ``**Paspoortnummer**``). We strippen die aan beide
# kanten zonder de binnenkant te raken.
_TRIM_CHARS = " \t|*_:;,-–—(){}[]"

# Woorden die we nooit als ORGANIZATION-naam willen zien, ook niet als
# spaCy ze als "eigennaam" oppikt: dit zijn label-termen die we zelf
# gebruiken om te promoten. Case-insensitief.
# Label-woorden die spaCy regelmatig als PERSON markeert omdat ze
# uniek en gekapitaliseerd zijn; ze zijn echter nooit een naam maar
# een veld-label. Filteren we er op dezelfde manier uit als
# organisatie-labels.
_PERSON_LABEL_WORDS = frozenset(
    {
        "paspoortnummer",
        "paspoort",
        "identiteitsbewijs",
        "identiteitskaart",
        "identiteit",
        "documentnummer",
        "persoonsnummer",
        "klantnummer",
        "dossiernummer",
        "zaaknummer",
        "kenmerk",
        "referentie",
        "referentienummer",
        "polisnummer",
        "rekeningnummer",
        "bsn",
        "bsn-nummer",
        "rijbewijs",
        "bankrekening",
        "iban",
        "bic",
        "btw",
        "btw-nummer",
        "kvk",
        "kvk-nummer",
        "agb",
        "big",
        "telefoon",
        "telefoonnummer",
        "mobiel",
        "vast",
        "e-mail",
        "email",
        "woonplaats",
        "geboortedatum",
        "adres",
        "postcode",
        "werkgever",
        "opdrachtgever",
        "naam",
        "voornaam",
        "achternaam",
        "tussenvoegsel",
    }
)


_ORG_LABEL_WORDS = frozenset(
    {
        "stagebedrijf",
        "stageorganisatie",
        "stageplaats",
        "werkgever",
        "opdrachtgever",
        "leerbedrijf",
        "leerwerkplek",
        "afstudeerbedrijf",
        "onderzoeksbedrijf",
        "contactbedrijf",
        "stagebegeleider",
        "praktijkbegeleider",
        "contactpersoon",
        "docent",
        "mentor",
        "begeleider",
        "coach",
        "examinator",
        "beoordelaar",
        "studieloopbaanbegeleider",
    }
)

# Presidio laadt voor NL soms een NrpRecognizer (nationalities/religions)
# die op HAN-context heel veel ruis geeft (``HAN-voorbeelddossier`` → NRP).
# We filteren deze categorie in z'n geheel uit de output; als iemand
# nationaliteiten echt nodig heeft zet 'ie de category aan via UI.
_DROPPED_ENTITY_TYPES = frozenset({"NRP"})

# Presidio's standaard DateRecognizer matcht op een loose patroon dat
# óók onzin als ``12-34-99`` (maand 34 bestaat niet) of ``Order 1234``
# laat passeren met score 0.6. We valideren ``DATE_TIME``-hits opnieuw
# tegen onze eigen, strakkere datum-regex (zie ``nl_date.py``). Hits
# die niet matchen worden weggefilterd, tenzij hun score ≥ 0.85
# (typisch onze eigen NlDateRecognizer of een hoog-confidence
# context-boost).
_DATE_VALIDATION_RE = re.compile(
    r"""(?ix)
    \b(?:
        # dd-mm-jjjj / dd/mm/jjjj / dd.mm.jjjj
        (?:0?[1-9]|[12][0-9]|3[01])[\-/.](?:0?[1-9]|1[0-2])[\-/.](?:1[89]\d{2}|20\d{2}|21\d{2})
      |
        # dd-mm-jj (mét label-context wordt dit door NlDateRecognizer geboost)
        (?:0?[1-9]|[12][0-9]|3[01])[\-/.](?:0?[1-9]|1[0-2])[\-/.]\d{2}
      |
        # jjjj-mm-dd (ISO)
        (?:1[89]\d{2}|20\d{2}|21\d{2})-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12][0-9]|3[01])
      |
        # dd maand-naam jjjj
        (?:0?[1-9]|[12][0-9]|3[01])\s+
        (?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|
           jan|feb|mrt|apr|mei|jun|jul|aug|sep|sept|okt|nov|dec|
           january|february|march|april|may|june|july|august|september|october|november|december|
           jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+
        (?:1[89]\d{2}|20\d{2}|21\d{2})
      |
        # losse maand-naam jjjj  (bv. "maart 2026")
        (?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+
        (?:1[89]\d{2}|20\d{2}|21\d{2})
    )\b
    # NB: een losstaand 4-cijferig jaar accepteren we bewust NIET hier,
    # anders worden ``Document 1985``, ``Versie 2026`` of ``regel 1985``
    # ook als DATE_TIME gemarkeerd. Geboortejaar zonder dag/maand is
    # bovendien minder identifying.
    """
)
def _from_strict_date_recognizer(r: RecognizerResult) -> bool:
    """Komt deze DATE_TIME-hit uit onze eigen NlDateRecognizer?"""

    explanation = getattr(r, "analysis_explanation", None)
    if explanation is None:
        return False
    return getattr(explanation, "recognizer", "") == "NlDateRecognizer"


def _is_mostly_punct(text_slice: str) -> bool:
    """True als de span geen enkele letter bevat (puur leestekens/cijfers)."""

    return not _HAS_LETTER_RE.search(text_slice)


def _trim_ner_span(
    result: RecognizerResult, text: str
) -> RecognizerResult | None:
    """Krimp de span van een NER-hit tot de eerste/laatste letter.

    Voorbeelden:

    - ``ING |``              → ``ING``
    - ``**Paspoortnummer**`` → ``Paspoortnummer``
    - ``|---|---|---|---|``  → ``None`` (niets over)
    - ``Piet van der Berg\nDocent`` → ``Piet van der Berg``

    We muteren het resultaat niet, maar geven een nieuw object terug.
    """

    span = text[result.start : result.end]
    # SpaCy labelt regelmatig NER-spans door naar een volgende regel
    # omdat het tabel-layout niet goed snapt (``Mentor: X\nDocent: Y``
    # levert dan één PERSON-span). Knip op de eerste newline.
    newline_idx = span.find("\n")
    if newline_idx != -1:
        span = span[:newline_idx]
    lstrip = span.lstrip(_TRIM_CHARS)
    rstrip = lstrip.rstrip(_TRIM_CHARS)
    if not rstrip:
        return None
    new_start = result.start + (len(span) - len(lstrip))
    new_end = new_start + len(rstrip)
    if new_start == result.start and new_end == result.end:
        return result
    return RecognizerResult(
        entity_type=result.entity_type,
        start=new_start,
        end=new_end,
        score=result.score,
        analysis_explanation=result.analysis_explanation,
    )


def filter_overlaps(
    results: Sequence[RecognizerResult],
    text: str | None = None,
) -> list[RecognizerResult]:
    """Verwijder "losse" sub-hits die binnen een sterkere entity vallen.

    Ook dedup van exact gelijke ranges+entities (same origin).
    """

    # Eerst exact-duplicaten dedupliceren (zelfde range + entity; hoogste
    # score wint). Dit gebeurt vaak als meerdere recognizers dezelfde
    # range vinden (bv. SpacyRecognizer + SonarRecognizer voor PERSON).
    by_key: dict[tuple[str, int, int], RecognizerResult] = {}
    for r in results:
        key = (r.entity_type, r.start, r.end)
        existing = by_key.get(key)
        if existing is None or r.score > existing.score:
            by_key[key] = r
    deduped = list(by_key.values())

    # Drop categorieën die in NL meer false positives dan waarde
    # opleveren (bv. NRP op HAN/CDA/PVV-achtige tokens).
    deduped = [r for r in deduped if r.entity_type not in _DROPPED_ENTITY_TYPES]

    # DATE_TIME-hits hervalideren tegen ons eigen patroon. Spans zoals
    # ``12-34-99`` (maand 34, door spaCy als DATE getagged), ``Order 1234``
    # of ``20 1234567`` worden zo weggefilterd. We behouden hits waarvan
    # de exacte tekst óók aan onze validatie voldoet OF die expliciet uit
    # de NlDateRecognizer komen (die zélf al strikt valideert).
    if text is not None:
        deduped = [
            r
            for r in deduped
            if r.entity_type != "DATE_TIME"
            or _from_strict_date_recognizer(r)
            or _DATE_VALIDATION_RE.fullmatch(text[r.start : r.end].strip())
        ]

    # Optionele punct-only filter: enkel NER-hits zonder letters droppen
    # (bv. spaCy labelt ``|---|---|---|---|`` soms als ORG). Voor ORG
    # filteren we ook hits die gelijk zijn aan een HAN-label (het woord
    # ``Stagebedrijf`` zelf mag geen ORG zijn).
    if text is not None:
        trimmed: list[RecognizerResult] = []
        for r in deduped:
            if r.entity_type in _PUNCT_SENSITIVE_TYPES:
                if _is_mostly_punct(text[r.start : r.end]):
                    continue
                fixed = _trim_ner_span(r, text)
                if fixed is None:
                    continue
                span_lower = text[fixed.start : fixed.end].strip().lower()
                if (
                    fixed.entity_type == "ORGANIZATION"
                    and span_lower in _ORG_LABEL_WORDS
                ):
                    continue
                if (
                    fixed.entity_type == "PERSON"
                    and span_lower in _PERSON_LABEL_WORDS
                ):
                    continue
                trimmed.append(fixed)
            else:
                trimmed.append(r)
        deduped = trimmed

    # Containment + partial-overlap filter. Twee regels:
    #
    #  1. ``inner`` valt volledig binnen ``outer`` en outer heeft hogere
    #     prioriteit → drop inner.
    #  2. ``a`` en ``b`` overlappen *deels*; de zwakker gerangschikte
    #     (hoger nummer) wordt gedropt als de sterkere een NL-specifiek
    #     entity is (prio < 10) en de zwakkere een NER-categorie of
    #     DATE_TIME is. Dit dekt "CJ Amsterdam" als ORG over "1015 CJ" als
    #     NL_POSTCODE en ``IBAN NL20INGB…`` als DATE_TIME over ``NL20INGB…``
    #     als IBAN_CODE.
    keep: list[bool] = [True] * len(deduped)
    for i, inner in enumerate(deduped):
        if not keep[i]:
            continue
        inner_prio = _priority(inner.entity_type)
        for j, outer in enumerate(deduped):
            if i == j or not keep[j]:
                continue
            outer_prio = _priority(outer.entity_type)

            # Regel 1: volledige containment.
            if _is_contained_in(inner, outer) and outer_prio < inner_prio:
                keep[i] = False
                break
            if (
                _is_contained_in(inner, outer)
                and outer_prio == inner_prio
                and (outer.end - outer.start) > (inner.end - inner.start)
                and outer.score >= inner.score
            ):
                keep[i] = False
                break

            # Regel 2: partiële overlap. Alleen ingrijpen als outer een
            # sterke NL-specifieke entity is (prio < 10) en inner een
            # NER/DATE_TIME-categorie (prio >= 20). Zo knippen we de
            # "CJ Amsterdam"-ORG niet af tegen een willekeurige PERSON
            # die overlapt met een andere PERSON.
            if (
                _overlaps(inner, outer)
                and outer_prio < 10
                and inner_prio >= 20
            ):
                keep[i] = False
                break

    return [r for r, k in zip(deduped, keep, strict=True) if k]

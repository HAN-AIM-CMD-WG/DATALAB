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
from collections.abc import Sequence

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
    # Social-handle prio = 1 zodat een Mastodon-/BlueSky-handle die een
    # e-mailadres of URL omhult, beide overschrijft. Anders zou
    # ``@user@mastodon.nl`` als EMAIL_ADDRESS eindigen.
    "SOCIAL_HANDLE": 1,
    "NL_KENTEKEN": 2,
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
    # Interne dossier-/patiënt-/zaaknummers. Patroon-gebaseerd, valideert
    # tegen explicit label of hard structureel format. Prio gelijk aan
    # NL_KVK zodat een PAT-2026-001234 wint van DATE_TIME en NER.
    "INTERNAL_CASE_NUMBER": 3,
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

# Aanhefwoorden en titels die spaCy regelmatig in de PERSON-span trekt
# (``Hoi Anna`` → één PERSON-span ``"Hoi Anna"``; ``De heer Van der
# Meulen`` → ``"heer Van der Meulen"``). We knippen ze hier weg als ze
# als prefix in een PERSON-span verschijnen, zodat de span alleen de
# echte naam bevat.
_GREETING_PREFIX_RE = re.compile(
    r"^(?:"
    # Begroetingen
    r"Hoi|Hallo|Hi|Hey|Dag|Beste|Geachte|"
    r"Goedemorgen|Goedemiddag|Goedenavond|Groetjes|"
    # Aanhef-titels (los of gecombineerd met "De ")
    r"(?:De\s+)?heer|Heer|"
    r"Mevrouw|mevrouw|Meneer|meneer|"
    r"Mw\.?|Dhr\.?|Mvr\.?|Mr\.?|"
    r"Dr\.?|Drs\.?|Prof\.?|Ir\.?|Ing\.?|Mr\.?"
    r")\s+",
    re.IGNORECASE,
)

# Detectie van een label-header op de regel ná een PERSON-span. Als een
# PERSON-span een newline bevat is dat meestal een naam over twee regels
# (``Jeroen\nvan der Meulen``); alleen wanneer de tweede regel daadwerkelijk
# met een markdown-label of veld begint (``\n**Docent:**`` /
# ``\nMentor:``) splitsen we op de newline.
_LABEL_AFTER_NEWLINE_RE = re.compile(r"^[\s\-*•·]*\*{0,2}[A-Z][A-Za-zÀ-ÿ'\-]+\*{0,2}\s*[:=]")
# Vervolg van een naam over de regelafbreking heen (``\nvan der Meulen``,
# ``\nde Vries-Smit``). Een tussenvoegsel of een hoofdletter-token telt.
_NAME_CONTINUATION_RE = re.compile(
    r"^\s*(?:"
    r"(?:el|al|ibn|bin|de|den|der|van|te|ten|ter|'t|het|op|aan)\s+"
    r"|"
    r"[A-ZÀ-Þ][a-zà-ÿ]"
    r")"
)

# Woorden die we nooit als ORGANIZATION/PERSON/LOCATION willen zien, ook
# niet als spaCy ze als "eigennaam" oppikt. Dit zijn alléén veld-labels die
# we zelf in formulieren/markdown gebruiken (``**Paspoortnummer:**``,
# ``**Twitter/X:**``). Vergelijking is case-insensitief, na het strippen
# van markdown-opmaak (``**``, ``:``, ``-`` aan de randen) door
# ``_trim_ner_span``. Filter is opzettelijk breed: liever een gemiste
# label-FP dan dat 'Paspoortnummer' als PERSON in de output blijft staan.
_LABEL_WORDS_ANY = frozenset(
    {
        # ---- Persoon-/contact-velden ----
        "naam",
        "voornaam",
        "achternaam",
        "tussenvoegsel",
        "roepnaam",
        "bijnaam",
        "geboortedatum",
        "geboorteplaats",
        "geboorteland",
        "geslacht",
        "leeftijd",
        "nationaliteit",
        "adres",
        "postcode",
        "woonplaats",
        "huisnummer",
        "straat",
        "plaats",
        "stad",
        "land",
        "provincie",
        "regio",
        "telefoon",
        "telefoonnummer",
        "mobiel",
        "vast",
        "tel",
        "gsm",
        "e-mail",
        "email",
        "mail",
        "e-mailadres",
        "mailadres",
        "werkgever",
        "opdrachtgever",
        "werknemer",
        "leverancier",
        "contact",
        "contactpersoon",
        # ---- Identificatie-nummers ----
        "bsn",
        "bsn-nummer",
        "sofinummer",
        "paspoort",
        "paspoortnummer",
        "id-kaart",
        "id-bewijs",
        "identiteit",
        "identiteitsbewijs",
        "identiteitskaart",
        "rijbewijs",
        "rijbewijsnummer",
        "documentnummer",
        "persoonsnummer",
        "klantnummer",
        "dossiernummer",
        "zaaknummer",
        "kenmerk",
        "referentie",
        "referentienummer",
        "polisnummer",
        "polis",
        "rekeningnummer",
        "bankrekening",
        "iban",
        "bic",
        "swift-code",
        "btw",
        "btw-nummer",
        "kvk",
        "kvk-nummer",
        "agb",
        "agb-code",
        "big",
        "big-nummer",
        "patiëntnummer",
        "patientnummer",
        "patiëntid",
        "patientid",
        "rijksregister",
        "rijksregisternummer",
        # ---- Onderwijs / HAN ----
        "studentnummer",
        "studienummer",
        "leerlingnummer",
        "medewerkernummer",
        "personeelsnummer",
        "klas",
        "klas-code",
        "klascode",
        "klasgroep",
        "cursus",
        "cursuscode",
        "vakcode",
        "modulecode",
        "croho",
        "croho-code",
        "mentor",
        "slb",
        "slb-er",
        "slb'er",
        "examinator",
        "begeleider",
        "coach",
        "docent",
        "lector",
        "stagebedrijf",
        "stageorganisatie",
        "stageplaats",
        "stage",
        "stagebegeleider",
        "praktijkbegeleider",
        "leerbedrijf",
        "leerwerkplek",
        "afstudeerbedrijf",
        "onderzoeksbedrijf",
        "contactbedrijf",
        "beoordelaar",
        "studieloopbaanbegeleider",
        "voertuigkenteken",
        "kenteken",
        "kentekenplaat",
        # ---- Online identifiers ----
        "gebruikersnaam",
        "username",
        "login",
        "account",
        "accountnaam",
        "wachtwoord",
        "password",
        "paswoord",
        "pwd",
        "backup-wachtwoord",
        "backupwachtwoord",
        "hoofdwachtwoord",
        "twitter",
        "twitter/x",
        "bluesky",
        "mastodon",
        "linkedin",
        "facebook",
        "instagram",
        "whatsapp",
        "signal",
        "telegram",
        "discord",
        "snapchat",
        "tiktok",
        "youtube",
        "github",
        "gitlab",
        "bitbucket",
        "ipv4",
        "ipv6",
        "ip-adres",
        "ip-address",
        "mac-adres",
        "mac-address",
        "url",
        "website",
        "homepage",
        "profielpagina",
        "profiel",
        "gps",
        "gps-locatie",
        "gps-coördinaten",
        "coördinaten",
        "geo",
        "geo-locatie",
        "locatie",
        "lat",
        "lng",
        "lon",
        "latitude",
        "longitude",
        # ---- Creditcard-meta ----
        "cvc",
        "cvv",
        "cvc-code",
        "cvv-code",
        "visa",
        "mastercard",
        "amex",
        "american-express",
        "dinersclub",
        "diners-club",
        "discover",
        "maestro",
        "creditcard",
        "creditcardnummer",
        "kaart",
        "kaartnummer",
        "vervaldatum",
        "verloopdatum",
        "geldigheidsdatum",
        "beveiligingscode",
        # ---- Aanhef die spaCy de naam-span in trekt ----
        "hoi",
        "hallo",
        "hey",
        "dag",
        "beste",
        "geachte",
        "goedemorgen",
        "goedemiddag",
        "goedenavond",
        "groetjes",
        "groet",
        "mevrouw",
        "meneer",
        "mvr",
        "dhr",
        "mw",
        # ---- Document-meta uit ons eigen test-template ----
        "strikt-additief",
        "additief",
        "patient",
        "patiënt",
        "han-specifieke",
        "han-medewerker",
        "han-student",
        "han-docent",
        "s-prefix",
        "p-prefix",
        # ---- IT- / dev-jargon dat spaCy graag als ORG of LOC pakt ----
        "code-blocks",
        "code-block",
        "codeblock",
        "codeblocks",
        "front-end",
        "frontend",
        "back-end",
        "backend",
        "full-stack",
        "fullstack",
        "build",
        "deploy",
        "deploys",
        "release",
        "releases",
        "endpoint",
        "endpoints",
        "api",
        "api's",
        "apis",
        "framework",
        "frameworks",
        "library",
        "libraries",
        "repo",
        "repository",
        "repositories",
        "dashboard",
        "dashboards",
        "logs",
        "log",
        "stacktrace",
        "pull-request",
        "pullrequest",
        "merge-request",
        "branch",
        "branches",
        "commit",
        "commits",
        "ci",
        "cd",
        "ci/cd",
        "devops",
        "config",
        "configs",
        "env",
        "envs",
        "environment",
    }
)


# Korte (≤ 3 tekens) hoofdletter-tokens die spaCy graag als ORG/LOC pakt
# maar die hier juist géén PII zijn (landcodes, sectie-letters tussen
# haakjes, ``Klant K``). Als de hit uit ``SpacyRecognizer`` komt en niet
# in deze whitelist staat → drop. De whitelist bevat 2-3 letter NL/BE/DE
# bank-/verzekeraar-/transport-codes die wél echte ORG-namen zijn.
_SHORT_UPPER_KEEP = frozenset(
    {
        "ING",
        "SNS",
        "ASN",
        "KBC",
        "DKB",
        "AXA",
        "BNP",
        "BNG",
        "HSBC",
        "NIBC",
        "DNB",
        "ASR",
        "FNG",
        "NHG",
        "KLM",
        "TNT",
        "DPD",
        "DHL",
        "UPS",
        "PostNL",
        "RTL",
        "NOS",
        "NPO",
        "NU.nl",
    }
)


def _from_spacy(r: RecognizerResult) -> bool:
    """True als de hit door Presidio's SpacyRecognizer is geproduceerd."""

    expl = getattr(r, "analysis_explanation", None)
    if expl is None:
        return False
    return getattr(expl, "recognizer", "") in {"SpacyRecognizer", "SonarRecognizer"}


# Recognizers die een address/locatie produceren. Hits hieruit winnen van
# een spaCy-ORG/PERSON op dezelfde tekst (regel 3 hieronder).
_ADDRESS_RECOGNIZER_NAMES = frozenset(
    {
        "NlAddressRecognizer",
        "IntlAddressRecognizer",
        "EuCityRecognizer",
    }
)


def _from_address_recognizer(r: RecognizerResult) -> bool:
    expl = getattr(r, "analysis_explanation", None)
    if expl is None:
        return False
    return getattr(expl, "recognizer", "") in _ADDRESS_RECOGNIZER_NAMES


def _is_paren_wrapped(text: str, start: int, end: int) -> bool:
    """True als de span tussen ``(`` en ``)`` staat: ``…(NL)`` , ``(BE)`` ."""

    return start > 0 and end < len(text) and text[start - 1] == "(" and text[end] == ")"


# Korte alfanumerieke codes (``AB12``, ``X3``, ``12AB``) zijn geen echte
# eigennamen; spaCy zet ze niettemin regelmatig op ORG omdat ze met een
# hoofdletter beginnen. We vangen ze hier weg, mits afkomstig uit
# ``SpacyRecognizer`` (eigen recognizers met deze patronen — kenteken,
# kvk, etc. — gebruiken hun eigen entity-types).
_SHORT_ALNUM_CODE_RE = re.compile(r"^(?:[A-Z]{1,3}\d{1,3}|\d{1,3}[A-Z]{1,3})$")

# Productnamen met expliciete tooling-suffix (``Anonimiseer-tool``,
# ``MyApp-cli``, ``Foo-bar-app``). spaCy tagt deze regelmatig als ORG,
# maar het is een productlabel, geen organisatie. Drop als hit uit
# ``SpacyRecognizer`` komt en score ≤ 0.86.
_PRODUCT_SUFFIX_RE = re.compile(
    r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9]{1,40}"
    r"(?:-[A-Za-zÀ-ÿ0-9]{1,20}){0,3}"
    r"-(?:tool|toolkit|app|cli|sdk|api|service|engine|bot|plugin|module|library|lib|framework|script|util|utils|daemon|server|client|gui|ui)$",
    re.IGNORECASE,
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


def _trim_ner_span(result: RecognizerResult, text: str) -> RecognizerResult | None:
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
    # levert dan één PERSON-span). Standaard knippen we op de eerste
    # newline, BEHALVE als de span een naam over twee regels is en de
    # tweede regel met een tussenvoegsel of hoofdletter-token begint
    # (``Jeroen\nvan der Meulen``). Dan houden we de hele naam in één
    # span. Een echte label-header op de tweede regel (``\n**Docent:**``)
    # wint nog wel: dan splitsen we alsnog.
    newline_idx = span.find("\n")
    if newline_idx != -1:
        after = span[newline_idx + 1 :]
        keep_through_newline = (
            result.entity_type == "PERSON"
            and not _LABEL_AFTER_NEWLINE_RE.match(after)
            and _NAME_CONTINUATION_RE.match(after)
        )
        if not keep_through_newline:
            span = span[:newline_idx]
    lstrip = span.lstrip(_TRIM_CHARS)
    rstrip = lstrip.rstrip(_TRIM_CHARS)
    if not rstrip:
        return None

    new_start = result.start + (len(span) - len(lstrip))
    new_end = new_start + len(rstrip)

    # Aanhef voor een PERSON-span (``Hoi Anna``) wegtrimmen zodat alleen
    # de naam overblijft. Geldt enkel voor PERSON; ``Hoi`` zelf hoort
    # nooit bij een org/loc.
    if result.entity_type == "PERSON":
        m = _GREETING_PREFIX_RE.match(rstrip)
        if m and len(rstrip) > m.end():
            shift = m.end()
            new_start += shift
            rstrip = rstrip[shift:]
            new_end = new_start + len(rstrip)

    # Bij een ORGANIZATION-span die eindigt op een rechtsvorm-afkorting
    # (``B.V``, ``N.V``, ``V.O.F``, ``Inc``, ``Ltd``, ``GmbH``, ``S.A``)
    # nemen we de direct volgende ``.`` mee, anders blijft die als losse
    # punt naast het pseudoniem staan (``ORGANIZATION_2.``).
    if result.entity_type == "ORGANIZATION" and new_end < len(text) and text[new_end] == ".":
        tail = rstrip[-6:].lower()
        if any(
            tail.endswith(suffix)
            for suffix in (
                "b.v",
                "n.v",
                "v.o.f",
                "c.v",
                "s.a",
                " inc",
                " ltd",
                " co",
                " plc",
                " gmbh",
                " ag",
                " kg",
            )
        ):
            rstrip = rstrip + "."
            new_end += 1

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

    # Optionele punct-only filter + label-FP-filter. Voor PERSON/ORG/LOCATION
    # uit de NER-laag kijken we apart naar drie soorten ruis:
    #
    #   1. Span bevat geen enkele letter (bv. ``|---|`` als ORG) → drop.
    #   2. Span (na trim) is exact een veld-label uit ``_LABEL_WORDS_ANY``
    #      (``Paspoortnummer`` als ORG, ``Postcode`` als LOC,
    #      ``Hoi`` ingebakken in ``Hoi Anna`` als PERSON) → drop.
    #   3. Span is ≤ 3 tekens hoofdletters, komt uit spaCy en staat niet in
    #      onze ``_SHORT_UPPER_KEEP``-whitelist (``(NL)``, ``Klant K``,
    #      ``(UK)``) → drop. Korte spans tussen haakjes zijn vrijwel altijd
    #      afkortingen of sectie-letters, geen PII.
    if text is not None:
        trimmed: list[RecognizerResult] = []
        for r in deduped:
            if r.entity_type in _PUNCT_SENSITIVE_TYPES:
                if _is_mostly_punct(text[r.start : r.end]):
                    continue
                fixed = _trim_ner_span(r, text)
                if fixed is None:
                    continue
                span = text[fixed.start : fixed.end].strip()
                span_lower = span.lower()

                if span_lower in _LABEL_WORDS_ANY:
                    continue

                is_short_upper = 1 <= len(span) <= 3 and span.isalpha() and span.isupper()
                if is_short_upper and _from_spacy(fixed) and span not in _SHORT_UPPER_KEEP:
                    continue

                if (
                    _from_spacy(fixed)
                    and len(span) <= 4
                    and _is_paren_wrapped(text, fixed.start, fixed.end)
                    and span not in _SHORT_UPPER_KEEP
                ):
                    continue

                if _from_spacy(fixed) and _SHORT_ALNUM_CODE_RE.match(span):
                    continue

                if _from_spacy(fixed) and fixed.score <= 0.86 and _PRODUCT_SUFFIX_RE.match(span):
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
        inner_is_ner = inner.entity_type in _PUNCT_SENSITIVE_TYPES
        for j, outer in enumerate(deduped):
            if i == j or not keep[j]:
                continue
            outer_prio = _priority(outer.entity_type)
            outer_is_ner = outer.entity_type in _PUNCT_SENSITIVE_TYPES

            # Regel 1: volledige containment. Uitzondering: een LOCATION
            # uit een eigen address-recognizer mag niet sneuvelen tegen
            # een spaCy-ORG/PERSON met formeel hogere prio. Die uitzondering
            # is symmetrisch met regel 3 hieronder.
            address_loc_vs_spacy_ner = (
                inner.entity_type == "LOCATION"
                and _from_address_recognizer(inner)
                and outer.entity_type in {"ORGANIZATION", "PERSON"}
                and _from_spacy(outer)
            )
            if (
                _is_contained_in(inner, outer)
                and outer_prio < inner_prio
                and not address_loc_vs_spacy_ner
            ):
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
            # Regel 1b: NER-types onderling (PERSON/ORG/LOC). Als de
            # binnenste hit volledig binnen een strikt grotere NER-hit
            # valt, droppen we de binnenste, ongeacht relatieve prio.
            # Dit voorkomt dat ``Boer`` als LOC overblijft binnen
            # ``Wim "Pim" Fortuyn-de Boer`` als PERSON.
            if (
                inner_is_ner
                and outer_is_ner
                and _is_contained_in(inner, outer)
                and (outer.end - outer.start) > (inner.end - inner.start)
            ):
                keep[i] = False
                break

            # Regel 2: partiële overlap. Alleen ingrijpen als outer een
            # sterke NL-specifieke entity is (prio < 10) en inner een
            # NER/DATE_TIME-categorie (prio >= 20). Zo knippen we de
            # "CJ Amsterdam"-ORG niet af tegen een willekeurige PERSON
            # die overlapt met een andere PERSON.
            if _overlaps(inner, outer) and outer_prio < 10 and inner_prio >= 20:
                keep[i] = False
                break

            # Regel 3: een eigen address-/plaats-recognizer levert een
            # LOCATION-hit die deels overlapt met een spaCy-ORG of
            # spaCy-PERSON: de LOCATION wint. Dit dekt
            # ``Bahnhofstraße 5`` (LOC uit IntlAddressRecognizer) vs.
            # ``Bahnhofstraße 5`` (ORG uit spaCy in lange zin-context).
            if (
                _overlaps(inner, outer)
                and inner_is_ner
                and inner.entity_type in {"ORGANIZATION", "PERSON"}
                and outer.entity_type == "LOCATION"
                and _from_address_recognizer(outer)
                and not _from_spacy(outer)
            ):
                keep[i] = False
                break

    return [r for r, k in zip(deduped, keep, strict=True) if k]

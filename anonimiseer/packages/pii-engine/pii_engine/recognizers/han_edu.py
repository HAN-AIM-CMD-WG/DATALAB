"""HAN-/onderwijsspecifieke recognizers.

Pilot-context voor Anonimiseer is de Hogeschool van Arnhem en Nijmegen
(HAN), waar verreweg de meeste documenten student- en medewerkerdata
bevatten. Dit bestand bundelt patronen die in die context herkend
moeten worden en in generieke NER te vaak wegvallen:

* :class:`NlEmployeeIdRecognizer` — kaal 6-7-cijferig personeelsnummer met
  een ``medewerkernummer``/``personeelsnummer``/``p-nummer``-label in
  de directe nabijheid.
* :class:`EduClassRecognizer` — klas-/groepsaanduidingen als
  ``HBO-ICT-1A``, ``BEDK-2-V``, ``CMD-3B``.
* :class:`EduCourseCodeRecognizer` — cursuscodes als ``OOABDK1``,
  ``ICA-PROF``, ``BFVHXX-18`` wanneer er een vak-/cursuslabel in de
  buurt staat.
* :class:`EduCrohoRecognizer` — 5-cijferige CROHO-opleidingscodes.
* :class:`EduLabeledPersonRecognizer` — promoot namen die expliciet als
  mentor, docent, SLB-er, examinator of begeleider genoemd worden
  naar een ``PERSON``-hit met hoge score, zelfs als spaCy ze niet
  als eigennaam heeft getagd.

Alle nieuwe recognizers leunen zwaar op context-vensters; we willen
geen 6-cijferig telefoonnummer per ongeluk als personeelsnummer
taggen of een generieke afkorting als cursuscode.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = [
    "EduClassRecognizer",
    "EduCourseCodeRecognizer",
    "EduCrohoRecognizer",
    "EduLabeledPersonRecognizer",
    "HanPortalStudentIdRecognizer",
    "NlEmployeeIdRecognizer",
    "NlOvChipkaartRecognizer",
    "StageOrganizationRecognizer",
]


def _preceded_by(text: str, start: int, markers: Iterable[str], window: int = 40) -> bool:
    """True als één van de markers binnen ``window`` chars vóór ``start`` staat."""

    window_start = max(0, start - window)
    preceding = text[window_start:start].lower()
    return any(m.lower() in preceding for m in markers)


# ---------------------------------------------------------------------------
# Personeelsnummer (medewerker-ID): HAN gebruikt in praktijk 6-7 cijfers,
# meestal zonder prefix. Overlap met NL_STUDENT_ID is mogelijk; we
# onderscheiden puur op basis van het label vlak voor het getal.
# ---------------------------------------------------------------------------
_EMPLOYEE_MARKERS = (
    "medewerkernummer",
    "medewerker-nummer",
    "medewerkersnummer",
    "personeelsnummer",
    "personeels-nummer",
    "personeelsnr",
    "p-nummer",
    "p.nummer",
    "p-nr",
    "pnr",
    "medewerker-id",
    "medewerker id",
    "employee id",
    "employee-id",
    "emp id",
)
_EMPLOYEE_REGEX = r"\b(?:[Pp]?\d{6,7})\b"


class NlEmployeeIdRecognizer(PatternRecognizer):
    """Pakt kaal 6-7-cijferig personeelsnummer, alléén met label-context."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_EMPLOYEE_ID",
            patterns=[
                Pattern(name="nl_employee", regex=_EMPLOYEE_REGEX, score=0.2),
            ],
            context=list(_EMPLOYEE_MARKERS),
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            if _preceded_by(text, r.start, _EMPLOYEE_MARKERS):
                r.score = self.DEFAULT_SCORE
                r.analysis_explanation = AnalysisExplanation(
                    recognizer=self.__class__.__name__,
                    original_score=r.score,
                    pattern_name="nl_employee_context",
                    pattern=_EMPLOYEE_REGEX,
                    validation_result=True,
                    textual_explanation=(
                        "Kaal 6-7-cijferig nummer direct na een HAN-achtig "
                        "medewerker-/personeelsnummer-label."
                    ),
                )
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Klas-/groepsnamen. HAN gebruikt codes als:
#   HBO-ICT-1A, HBO-ICT-VT-3, BEDK-2-V, CMD-2A, ICT-DS-3, FT-SJ-2C
# Patroon: 2-6 hoofdletters, minstens één koppelteken, eindigt op een
# jaar-letter-combi of een losse letter+cijfer. We zijn streng genoeg
# dat woorden als ``COVID-19`` of ``ISBN-978`` niet matchen.
# ---------------------------------------------------------------------------
_CLASS_REGEX = (
    r"\b[A-Z]{2,6}"  # opleiding, bv HBO of CMD
    r"(?:-[A-Z]{1,5}){0,2}"  # optionele variant (ICT, VT, DS)
    r"-(?:[1-4][A-Z]?|[A-Z]\d?[A-Z]?)"  # jaar/klas, bv 1A, 2, B, 3V
    r"\b"
)
_CLASS_MARKERS = (
    "klas",
    "groep",
    "jaargroep",
    "studiegroep",
    "studiejaar",
    "leerjaar",
    "cohort",
    "opleidingsgroep",
)
_CLASS_EXCLUDE = {
    # Veelvoorkomende niet-klasnaam-patronen die per ongeluk matchen.
    "covid-19",
    "iso-27001",
    "en-iso",
    "iban-nl",
    "isbn-978",
    "isbn-979",
    "gdpr-art",
    "avg-art",
}


class EduClassRecognizer(PatternRecognizer):
    """Herken HAN-klas-/groepsnamen, met context-eis."""

    DEFAULT_SCORE: ClassVar[float] = 0.75

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="EDU_CLASS",
            patterns=[Pattern(name="edu_class", regex=_CLASS_REGEX, score=0.25)],
            context=list(_CLASS_MARKERS),
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            raw = text[r.start : r.end]
            if raw.lower() in _CLASS_EXCLUDE:
                continue
            # Presidio compileert patronen met re.IGNORECASE; voor
            # klas-/groepsnamen vereisen we echter uppercase-afkortingen
            # zodat "hallo-sjaak-1a" of willekeurige titlecase-tekst niet
            # matcht. Snelle check: letters moeten uppercase zijn.
            letters = [c for c in raw if c.isalpha()]
            if letters and any(c.islower() for c in letters):
                continue
            if _preceded_by(text, r.start, _CLASS_MARKERS, window=60):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Cursuscodes (vak-/modulecodes). HAN gebruikt onder meer:
#   OOABDK1, ICA-PROF, BFVHXX-18, OSIMAIN-22, ITSEC4
# We zijn context-afhankelijk: zonder nabij vak-/cursus-/modulelabel
# doen we niets, want dit type code lijkt erg op ID-afkortingen.
# ---------------------------------------------------------------------------
_COURSE_REGEX = (
    r"\b[A-Z]{3,8}"  # basis-afkorting
    r"(?:\d{0,4})?"  # cijfer-suffix (OOABDK1)
    r"(?:-[A-Z0-9]{1,6})?"  # streepje-deel (ICA-PROF, BFVHXX-18)
    r"\b"
)
_COURSE_MARKERS = (
    "cursus",
    "cursuscode",
    "vakcode",
    "vak:",
    "vak ",
    "module",
    "modulecode",
    "studieonderdeel",
    "onderwijseenheid",
    "oer",
    "cursuscode:",
    "course code",
)


class EduCourseCodeRecognizer(PatternRecognizer):
    """Cursus-/vakcode-recognizer, streng context-gebonden."""

    DEFAULT_SCORE: ClassVar[float] = 0.7

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="EDU_COURSE_CODE",
            patterns=[Pattern(name="edu_course", regex=_COURSE_REGEX, score=0.2)],
            context=list(_COURSE_MARKERS),
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            raw = text[r.start : r.end]
            # Te kort / onwaarschijnlijk (bv "OER" op zich, "HAN", "NL") laten we vallen.
            if len(raw) < 5:
                continue
            # Presidio's pattern-match is case-insensitive. Cursuscodes zijn
            # in de HAN-praktijk *altijd* UPPERCASE. Anders vangen we hele
            # woorden als "formaat", "student" of "Sandra" op.
            letters = [c for c in raw if c.isalpha()]
            if not letters or any(c.islower() for c in letters):
                continue
            # Moet minstens één cijfer of streepje bevatten; anders is het
            # een gewone afkorting (bv. "HBO", "ICT") waar we EDU_CLASS
            # of ORGANIZATION voor gebruiken.
            if not any(c.isdigit() or c == "-" for c in raw):
                continue
            if _preceded_by(text, r.start, _COURSE_MARKERS, window=60):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# CROHO-codes: registratie van opleidingen in Nederland, 5 cijfers.
# ---------------------------------------------------------------------------
_CROHO_REGEX = r"\b\d{5}\b"
_CROHO_MARKERS = (
    "croho",
    "croho-code",
    "croho code",
    "crohonummer",
    "isat",
    "isat-code",
    "opleidingscode",
    "opleidings-code",
    # HAN-praktijk: interne module-/onderwijseenheid-codes worden ook
    # vaak als 5-cijferig nummer vermeld. We scharen ze samen met CROHO
    # zodat de UI ze als onderwijscode kan tonen.
    "onderwijseenheid",
    "studieonderdeel",
    "modulecode",
    "module:",
)


class EduCrohoRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.8

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="EDU_CROHO",
            patterns=[Pattern(name="edu_croho", regex=_CROHO_REGEX, score=0.15)],
            context=list(_CROHO_MARKERS),
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            if _preceded_by(text, r.start, _CROHO_MARKERS, window=60):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Mentor-/docent-/SLB-/examinator-label → PERSON.
#
# spaCy mist in de HAN-context regelmatig namen wanneer ze alleen als
# voorletters + achternaam voorkomen ("M.J. de Vries") of in tabelvorm.
# Deze recognizer zoekt expliciet naar de frase
# "<label>: <naam>" en markeert de naamgroep als PERSON.
# ---------------------------------------------------------------------------
_PERSON_LABELS = (
    # HAN-rollen
    "mentor",
    "docent",
    "begeleider",
    "coach",
    "studieloopbaanbegeleider",
    "slb",
    "slb-er",
    "slb'er",
    "examinator",
    "beoordelaar",
    "cijfergever",
    "tutor",
    "praktijkbegeleider",
    "stagebegeleider",
    "stagedocent",
    "contactpersoon",
    "auteur",
    # Deelnemer-rollen; pakken we alleen met nadrukkelijke scheider ``:`` of ``-``
    # omdat "de student ging lopen" natuurlijk geen naam is.
    "student",
    "studente",
    "stagiair",
    "stagiaire",
    "leerling",
    "cursist",
    "deelnemer",
    "kandidaat",
    "aanvrager",
    "aanvraagster",
    "patient",
    "patiënt",
    "patiente",
    "patiënte",
    "cliënt",
    "client",
    "medewerker",
    "medewerkster",
    "werknemer",
    "werknemer(ster)",
    "betrokkene",
)

# Matcht: "Mentor: A. Bakker" / "Mentor - J. de Vries-Smit" /
# "Stagebegeleider: Piet van der Berg".  De naam-groep is conservatief:
# begint met een hoofdletter of voorletter-punt, eventueel met
# tussenvoegsel, en bestaat uit max 4 tokens.
_NAME_PART = r"(?:[A-ZÀ-Þ][a-zà-ÿ'\-]*\.?|[A-Z]\.)"
# Tussenvoegsels en inline-whitespace (geen newline), zodat we niet
# over regelgrenzen heen stuiteren.
_INLINE_WS = r"[^\S\n]"
_NAME = (
    rf"{_NAME_PART}"
    rf"(?:{_INLINE_WS}+(?:van|van\s+de|van\s+der|van\s+den|de|den|der|te|ten|ter|el|al|ibn|bin))?"
    rf"(?:{_INLINE_WS}+{_NAME_PART}){{0,3}}"
)
_LABEL_PATTERN = re.compile(
    rf"\b(?:{'|'.join(_PERSON_LABELS)})\b{_INLINE_WS}*[:\-–]{_INLINE_WS}*(?P<name>{_NAME})",
    flags=re.IGNORECASE,
)

# Voor dossiers/verslagen schrijft men óók vaak "Student Fatima El Amrani
# (studentnummer …)" of "Tutor Marieke Visser" zonder dubbelepunt. Om
# false positives te voorkomen (bv. "Hij was student toen hij Willem
# ontmoette") eisen we hier:
#   - één van een nauwkeurige labelset (niet elk rol-woord);
#   - direct gevolgd door een naam van 2+ hoofdletter-tokens;
#   - direct gevolgd door ``(`` / ``,`` / ``.`` / einde van regel / of een
#     werkwoordspositie-markering (we houden het conservatief).
_INLINE_LABELS = (
    "student",
    "studente",
    "stagiair",
    "stagiaire",
    "leerling",
    "cursist",
    "deelnemer",
    "kandidaat",
    "patiënt",
    "patient",
    "cliënt",
    "client",
    "medewerker",
    "medewerkster",
    "werknemer",
    "tutor",
    "mentor",
    "docent",
    "docente",
    "begeleider",
    "begeleidster",
    "coach",
    "auteur",
    "aanvrager",
    "aanvraagster",
    "betrokkene",
    "examinator",
    "examinatrice",
)
_NAME_MULTI = (
    rf"{_NAME_PART}"
    rf"(?:{_INLINE_WS}+(?:van|van\s+de|van\s+der|van\s+den|de|den|der|te|ten|ter|el|al|ibn|bin))?"
    rf"(?:{_INLINE_WS}+{_NAME_PART}){{1,3}}"
)
_INLINE_FOLLOWERS = (
    "heeft",
    "is",
    "zal",
    "was",
    "werd",
    "krijgt",
    "krijgen",
    "beoordeelt",
    "beoordeelde",
    "begeleidt",
    "begeleidde",
    "levert",
    "leverde",
    "schreef",
    "schrijft",
    "vraagt",
    "vroeg",
    "dient",
    "diende",
    "neemt",
    "nam",
    "kreeg",
    "stopt",
    "start",
    "woont",
    "woonde",
    "werkt",
    "werkte",
    "studeert",
    "studeerde",
)
# Let op: we compileren ZONDER re.IGNORECASE, maar maken label- en
# follower-groep expliciet case-insensitive via ``(?i:…)`` inline flags.
# Dit is belangrijk: als we de hele regex case-insensitive maken, dan
# matcht ``_NAME_PART`` ook lowercase-woorden zoals "heeft" en trekt
# hij die mee de naam-span in.
_INLINE_PATTERN = re.compile(
    rf"(?<!\w)(?i:{'|'.join(_INLINE_LABELS)}){_INLINE_WS}+"
    rf"(?P<name>{_NAME_MULTI})"
    rf"(?=[\s]*[(,\.\n:]|{_INLINE_WS}+(?i:{'|'.join(_INLINE_FOLLOWERS)}))",
    flags=0,
)


class EduLabeledPersonRecognizer(EntityRecognizer):
    """Promoot namen die achter een rol-label als docent/mentor staan."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["PERSON"],
            supported_language=supported_language,
            name="EduLabeledPersonRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if "PERSON" not in entities:
            return []
        results: list[RecognizerResult] = []
        seen: set[tuple[int, int]] = set()

        def _add(start: int, end: int, pattern_name: str, pattern: str) -> None:
            raw = text[start:end].strip()
            if len(raw) < 2:
                return
            if raw.lower() in {"nvt", "n.v.t.", "onbekend", "tba", "t.b.d."}:
                return
            # Voorkom dat het pattern per ongeluk een vervolgwoord als
            # "heeft" / "is" meeneemt door een finditer-race; we eisen
            # minstens 1 hoofdletter aan het begin.
            if not raw[:1].isupper() and raw[:1] != ".":
                return
            key = (start, end)
            if key in seen:
                return
            seen.add(key)
            results.append(
                RecognizerResult(
                    entity_type="PERSON",
                    start=start,
                    end=end,
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name=pattern_name,
                        pattern=pattern,
                        validation_result=True,
                        textual_explanation=(
                            "Naam vlak achter een rol-label (mentor/docent/"
                            "student/tutor/SLB/examinator/begeleider)."
                        ),
                    ),
                )
            )

        for match in _LABEL_PATTERN.finditer(text):
            _add(
                match.start("name"),
                match.end("name"),
                "edu_labeled_person",
                _LABEL_PATTERN.pattern,
            )
        for match in _INLINE_PATTERN.finditer(text):
            _add(
                match.start("name"),
                match.end("name"),
                "edu_inline_labeled_person",
                _INLINE_PATTERN.pattern,
            )
        return results


# ---------------------------------------------------------------------------
# Stagebedrijf / werkgever → ORGANIZATION.
#
# In stageverslagen en begeleidingsformulieren staat de bedrijfsnaam
# vrijwel altijd achter een label als ``Stagebedrijf:`` of
# ``Werkgever:``. SpaCy herkent die vaak niet als organisatie (het is
# geen typische bedrijfsnaam-afkorting) — hier promoten we 'm expliciet.
# ---------------------------------------------------------------------------
_ORG_LABELS = (
    "stagebedrijf",
    "stageorganisatie",
    "stageplaats",
    "werkgever",
    "opdrachtgever",
    "leerbedrijf",
    "leerwerkplek",
    "stage bij",
    "afstudeerbedrijf",
    "onderzoeksbedrijf",
    "contactbedrijf",
    "organisatie:",
    "bedrijf:",
)
# Naam-groep voor organisaties. Bedrijven bestaan vaak uit meerdere
# gekapitaliseerde woorden, optioneel met rechtsvorm (``B.V.``, ``N.V.``,
# ``Holding``). We pakken maximaal 5 woorden, gevolgd door een optionele
# rechtsvorm-suffix.
_ORG_WORD = r"(?:[A-ZÀ-Þ][\w'&\-À-ÿ]*|\&)"
_ORG_SUFFIX = r"(?:B\.?V\.?|N\.?V\.?|BV|NV|Holding|Group|Groep|GmbH|SA|SAS|Ltd|Inc)"
_ORG_NAME = (
    rf"{_ORG_WORD}(?:{_INLINE_WS}+{_ORG_WORD}){{0,4}}"
    rf"(?:{_INLINE_WS}+{_ORG_SUFFIX})?"
)
_ORG_LABEL_PATTERN = re.compile(
    rf"\b(?:{'|'.join(_ORG_LABELS)})\b{_INLINE_WS}*[:\-–]{_INLINE_WS}*(?P<org>{_ORG_NAME})",
    flags=re.IGNORECASE,
)


class StageOrganizationRecognizer(EntityRecognizer):
    """Promoot namen na een stage-/werkgever-label naar ORGANIZATION."""

    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["ORGANIZATION"],
            supported_language=supported_language,
            name="StageOrganizationRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if "ORGANIZATION" not in entities:
            return []
        results: list[RecognizerResult] = []
        for match in _ORG_LABEL_PATTERN.finditer(text):
            start = match.start("org")
            end = match.end("org")
            raw = text[start:end].strip()
            if len(raw) < 2:
                continue
            if raw.lower() in {"nvt", "n.v.t.", "onbekend", "tba", "t.b.d."}:
                continue
            results.append(
                RecognizerResult(
                    entity_type="ORGANIZATION",
                    start=start,
                    end=end,
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="stage_organization",
                        pattern=_ORG_LABEL_PATTERN.pattern,
                        validation_result=True,
                        textual_explanation=(
                            "Organisatienaam vlak achter een stage-/werkgever-label."
                        ),
                    ),
                )
            )
        return results


# ---------------------------------------------------------------------------
# OV-chipkaartnummer. Het nummer is 16 cijfers, gedrukt op de kaart als
# groepjes van 4 (``3528 0000 0000 0000``). Studenten-OV staat in
# dossiers soms expliciet vermeld; we gebruiken context om random
# 16-cijfer-reeksen (IBAN, creditcard) niet verkeerd te labelen.
# ---------------------------------------------------------------------------
_OV_REGEX = r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{1,3})?\b"
_OV_MARKERS = (
    "ov-chip",
    "ov chipkaart",
    "ov-chipkaart",
    "ov-kaart",
    "chipkaartnummer",
    "chipkaart:",
    "studenten-ov",
    "ov-nummer",
)


class NlOvChipkaartRecognizer(PatternRecognizer):
    """OV-chipkaartnummer, alleen met OV-context om CC/IBAN niet te kapen."""

    DEFAULT_SCORE: ClassVar[float] = 0.8

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_OV_CHIPKAART",
            patterns=[Pattern(name="nl_ov", regex=_OV_REGEX, score=0.2)],
            context=list(_OV_MARKERS),
            supported_language=supported_language,
        )

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
        regex_flags: int | None = None,
    ) -> list[RecognizerResult]:
        results = super().analyze(
            text, entities or self.supported_entities, nlp_artifacts, regex_flags
        )
        validated: list[RecognizerResult] = []
        for r in results:
            if _preceded_by(text, r.start, _OV_MARKERS, window=60):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Student-ID in HAN-portal-URLs: Osiris, Alluris, Brightspace, Studielink.
#
# Wanneer een medewerker een link deelt als
# ``https://osiris.han.nl/student/1234567/overzicht`` of
# ``https://brightspace.han.nl/…?snr=1234567`` dan zit het studentnummer
# in de querystring en wordt het door de URL-recognizer genegeerd. We
# taggen het nummer apart zodat de anonimiser de URL kan blijven laten
# staan (of andersom, URL vervangen) zonder het nummer prijs te geven.
# ---------------------------------------------------------------------------
_PORTAL_HOSTS = (
    "osiris",
    "alluris",
    "brightspace",
    "studielink",
    "han.nl",
    "hanlms",
    "hanportal",
)
_PORTAL_URL_PATTERN = re.compile(
    r"https?://[^\s)]+|(?:osiris|alluris|brightspace|studielink|han|hanportal|hanlms)[^\s)]*",
    flags=re.IGNORECASE,
)
_PORTAL_STUDENT_NUMBER = re.compile(r"(?<![0-9A-Za-z])(?P<snr>\d{7})(?![0-9A-Za-z])")
# Optionele s-prefix studentnummer (s7654321) — lowercase 's' wordt
# in HAN-URLs vaak gebruikt.
_PORTAL_STUDENT_S = re.compile(r"(?<![0-9A-Za-z])(?P<snr>s\d{7})(?![0-9A-Za-z])")
# Personeels-ID in URLs: ``/users/p9876543`` of ``?pnr=p1234567``.
# Lowercase 'p' is de gangbare conventie binnen brightspace.han.nl.
# Strikt 7 cijfers; 6-cijferige medewerkernummers vallen hier niet onder
# (te kort om in een URL betrouwbaar van een random query-param te
# onderscheiden — die worden door de losse NlEmployeeIdRecognizer
# gepakt mits er context staat).
_PORTAL_EMPLOYEE_NUMBER = re.compile(r"(?<![0-9A-Za-z])(?P<pnr>[Pp]\d{7})(?![0-9A-Za-z])")


class HanPortalStudentIdRecognizer(EntityRecognizer):
    """Herken student- en medewerker-ID's binnen HAN-portal-URLs."""

    DEFAULT_SCORE: ClassVar[float] = 0.9

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["NL_STUDENT_ID", "NL_EMPLOYEE_ID"],
            supported_language=supported_language,
            name="HanPortalStudentIdRecognizer",
        )

    def load(self) -> None:  # pragma: no cover
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        want_student = "NL_STUDENT_ID" in entities
        want_employee = "NL_EMPLOYEE_ID" in entities
        if not (want_student or want_employee):
            return []

        results: list[RecognizerResult] = []
        for url_match in _PORTAL_URL_PATTERN.finditer(text):
            url_text = url_match.group(0).lower()
            if not any(h in url_text for h in _PORTAL_HOSTS):
                continue

            if want_student:
                for snr_match in _PORTAL_STUDENT_S.finditer(
                    text, url_match.start(), url_match.end()
                ):
                    results.append(
                        self._make_result(
                            "NL_STUDENT_ID",
                            snr_match.start("snr"),
                            snr_match.end("snr"),
                            "han_portal_snr_s",
                            _PORTAL_STUDENT_S.pattern,
                            "Studentnummer met s-prefix in HAN-portal-URL.",
                        )
                    )
                for snr_match in _PORTAL_STUDENT_NUMBER.finditer(
                    text, url_match.start(), url_match.end()
                ):
                    # Skip als deze positie al door s-prefix is gedekt
                    # (s1234567 zou anders óók als 1234567 matchen).
                    if any(
                        r.start <= snr_match.start("snr")
                        and r.end >= snr_match.end("snr")
                        and r.entity_type == "NL_STUDENT_ID"
                        for r in results
                    ):
                        continue
                    results.append(
                        self._make_result(
                            "NL_STUDENT_ID",
                            snr_match.start("snr"),
                            snr_match.end("snr"),
                            "han_portal_snr",
                            _PORTAL_STUDENT_NUMBER.pattern,
                            "7-cijferig studentnummer binnen een HAN-"
                            "portal-URL (Osiris/Alluris/Brightspace/"
                            "Studielink).",
                        )
                    )

            if want_employee:
                for pnr_match in _PORTAL_EMPLOYEE_NUMBER.finditer(
                    text, url_match.start(), url_match.end()
                ):
                    results.append(
                        self._make_result(
                            "NL_EMPLOYEE_ID",
                            pnr_match.start("pnr"),
                            pnr_match.end("pnr"),
                            "han_portal_pnr",
                            _PORTAL_EMPLOYEE_NUMBER.pattern,
                            "Medewerker-ID met p-prefix in HAN-portal-URL (Brightspace).",
                        )
                    )
        return results

    def _make_result(
        self,
        entity_type: str,
        start: int,
        end: int,
        pattern_name: str,
        pattern: str,
        explanation: str,
    ) -> RecognizerResult:
        return RecognizerResult(
            entity_type=entity_type,
            start=start,
            end=end,
            score=self.DEFAULT_SCORE,
            analysis_explanation=AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=self.DEFAULT_SCORE,
                pattern_name=pattern_name,
                pattern=pattern,
                validation_result=True,
                textual_explanation=explanation,
            ),
        )


# Sanity-check voor linters / unit-tests.
for _cls in (
    NlEmployeeIdRecognizer,
    EduClassRecognizer,
    EduCourseCodeRecognizer,
    EduCrohoRecognizer,
    EduLabeledPersonRecognizer,
    StageOrganizationRecognizer,
    NlOvChipkaartRecognizer,
    HanPortalStudentIdRecognizer,
):
    assert issubclass(_cls, EntityRecognizer)

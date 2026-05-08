"""Nederlandse (en Belgische) identificatienummer-recognizers.

Presidio's generieke ``DATE_TIME``-matcher pakt veel 8–11-cijferige reeksen
(KvK, BIG, rijbewijs, polisnummer) als datums. Dat is onwenselijk: het zijn
*geen* datums en het verhult dat er PII staat. Deze recognizers dekken de
meest voorkomende Nederlandse ID-nummers specifiek af, met een korte
*context-check* vlak vóór het cijferblok zodat we alleen matchen als het
nummer ook als zodanig aangekondigd wordt.

Entity-namen:

    - ``NL_KVK``           (8 cijfers, "KvK")
    - ``NL_BIG``           (11 cijfers, "BIG")
    - ``NL_AGB``           (XX-XXXXXX, "AGB")
    - ``NL_RIJBEWIJS``     (10 cijfers, "Rijbewijs")
    - ``NL_BTW``           (NL......B.. of BE0...)
    - ``NL_POLICY_NUMBER`` (9–12 cijfers, "Polis"/"Polisnummer")
    - ``BE_RIJKSREGISTER`` (YY.MM.DD-NNN.CC, "Rijksregister")

Eenzelfde patroon als :class:`BsnRecognizer`: we gebruiken Presidio's
``Pattern`` + optionele context-boost; daar waar een elfproef bestaat
valideren we die, anders vertrouwen we op de context.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import ClassVar

from presidio_analyzer import (
    EntityRecognizer,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = [
    "BeRijksregisterRecognizer",
    "NlAgbRecognizer",
    "NlBigRecognizer",
    "NlBtwRecognizer",
    "NlIdCardRecognizer",
    "NlKvkRecognizer",
    "NlPolicyNumberRecognizer",
    "NlRijbewijsRecognizer",
]


def _preceded_by(text: str, start: int, markers: Iterable[str], window: int = 40) -> bool:
    """Staat er binnen ``window`` karakters voor ``start`` een marker (case-insensitive)?

    We kijken puur of één van de labels in het venster voorkomt. Het
    venster (40 chars) is krap genoeg om meestal alleen de "label:"-frase
    te vangen, maar ruim genoeg voor varianten als
    ``**Polisnummer zorgverzekeraar:** 106543210`` of
    ``**AGB-code zorgverlener:** 01-012345``.
    """

    window_start = max(0, start - window)
    preceding = text[window_start:start].lower()
    return any(m.lower() in preceding for m in markers)


# ---------------------------------------------------------------------------
# Kamer van Koophandel (KvK): altijd 8 cijfers, recentelijk.
# ---------------------------------------------------------------------------
_KVK_MARKERS = ("kvk", "kvk-nummer", "kvknummer", "kamer van koophandel")
_KVK_REGEX = r"\b\d{8}\b"


class NlKvkRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_KVK",
            patterns=[Pattern(name="nl_kvk", regex=_KVK_REGEX, score=0.2)],
            context=list(_KVK_MARKERS),
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
            if _preceded_by(text, r.start, _KVK_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# BIG-register: zorgverleners. 11 cijfers, eerste twee cijfers zijn het
# geboortejaar (19xx/20xx). We vertrouwen alleen op de context.
# ---------------------------------------------------------------------------
_BIG_MARKERS = ("big-nummer", "bignummer", "big nummer", "big:")
_BIG_REGEX = r"\b\d{11}\b"


class NlBigRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_BIG",
            patterns=[Pattern(name="nl_big", regex=_BIG_REGEX, score=0.2)],
            context=list(_BIG_MARKERS),
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
            if _preceded_by(text, r.start, _BIG_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Nederlands ID-kaart / paspoortnummer. Sinds 2014: 9 posities,
# alfanumeriek (doorgaans letters + cijfers). Veel documenten schrijven
# ze als 2 letters + 7 tekens of 1 letter + 8 cijfers. Zonder context
# matcht zo'n string ook verwarrend op DATE_TIME; we eisen een label.
# ---------------------------------------------------------------------------
_IDCARD_MARKERS = (
    "id-kaart",
    "id kaart",
    "id-bewijs",
    "identiteitsbewijs",
    "identiteitskaart",
    "paspoortnummer",
    "paspoort:",
    "paspoort ",
    "document(nummer)",
    "documentnummer",
    "document nummer",
    "nik",  # nummer identiteitskaart
)
# 9 alfanumerieke posities (minstens één cijfer én één letter om
# "123456789" te onderscheiden van BSN, en "ABCDEFGHI" van random
# afkortingen). Presidio compileert case-insensitief; we verifiëren
# in ``analyze``.
_IDCARD_REGEX = r"\b[A-Z0-9]{9}\b"


class NlIdCardRecognizer(PatternRecognizer):
    """ID-kaart / paspoortnummer (9-char alfanumeriek, mét label)."""

    DEFAULT_SCORE: ClassVar[float] = 0.9

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_ID_CARD",
            patterns=[Pattern(name="nl_id_card", regex=_IDCARD_REGEX, score=0.2)],
            context=list(_IDCARD_MARKERS),
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
            # Mix van letters en cijfers vereist; anders is het of een
            # BSN/rijbewijs-achtig nummer (alleen cijfers, andere
            # recognizer) of willekeurige afkorting (alleen letters).
            has_letter = any(c.isalpha() for c in raw)
            has_digit = any(c.isdigit() for c in raw)
            if not (has_letter and has_digit):
                continue
            # Eis uppercase (ID-kaartnummers zijn altijd hoofdletters).
            if any(c.isalpha() and c.islower() for c in raw):
                continue
            if _preceded_by(text, r.start, _IDCARD_MARKERS, window=50):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# AGB-code: zorgverlener-identificatie. Formaat XX-XXXXXX (2-6 cijfers).
# ---------------------------------------------------------------------------
_AGB_MARKERS = ("agb-code", "agb code", "agbcode", "agb:")
_AGB_REGEX = r"\b\d{2}[-\s.]?\d{6}\b"


class NlAgbRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.9

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_AGB",
            patterns=[Pattern(name="nl_agb", regex=_AGB_REGEX, score=0.2)],
            context=list(_AGB_MARKERS),
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
            if _preceded_by(text, r.start, _AGB_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Rijbewijs: 10 cijfers (bij nieuwe uitgifte is het soms "5xxxxxxxxx").
# ---------------------------------------------------------------------------
_RIJBEWIJS_MARKERS = ("rijbewijs", "rijbewijsnummer")
_RIJBEWIJS_REGEX = r"\b\d{10}\b"


class NlRijbewijsRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_RIJBEWIJS",
            patterns=[Pattern(name="nl_rijbewijs", regex=_RIJBEWIJS_REGEX, score=0.2)],
            context=list(_RIJBEWIJS_MARKERS),
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
            if _preceded_by(text, r.start, _RIJBEWIJS_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# BTW-nummer: NL813195779B01 / BE0123.456.789.
# De patterns zijn strikt genoeg dat context optioneel is, maar we vereisen
# 'm voor de BE-variant omdat die op een datumreeks lijkt.
# ---------------------------------------------------------------------------
_BTW_NL_REGEX = r"\bNL\s?\d{9}B\s?\d{2}\b"
_BTW_BE_REGEX = r"\bBE\s?0\d{3}[.\s]?\d{3}[.\s]?\d{3}\b"


class NlBtwRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.9

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_BTW",
            patterns=[
                Pattern(name="nl_btw_nl", regex=_BTW_NL_REGEX, score=self.DEFAULT_SCORE),
                Pattern(name="nl_btw_be", regex=_BTW_BE_REGEX, score=self.DEFAULT_SCORE),
            ],
            context=["btw", "btw-nummer", "vat", "vat-nummer"],
            supported_language=supported_language,
        )


# ---------------------------------------------------------------------------
# Polisnummer zorgverzekeraar: 8-12 cijfers. Is een puur
# context-recognizer: zonder "Polis" label doen we niets.
# ---------------------------------------------------------------------------
_POLICY_MARKERS = (
    "polisnummer",
    "polis nummer",
    "polis:",
    "polis ",
    "zorgverzekering",
    "zorgpolis",
)
_POLICY_REGEX = r"\b\d(?:[\s-]?\d){7,15}\b"


class NlPolicyNumberRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.8

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="NL_POLICY_NUMBER",
            patterns=[Pattern(name="nl_policy", regex=_POLICY_REGEX, score=0.2)],
            context=list(_POLICY_MARKERS),
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
            if _preceded_by(text, r.start, _POLICY_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# ---------------------------------------------------------------------------
# Belgisch rijksregisternummer: YY.MM.DD-NNN.CC (met of zonder separators).
# ---------------------------------------------------------------------------
_RR_REGEX = r"\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-\s]?\d{3}[.\s]?\d{2}\b"
_RR_MARKERS = ("rijksregister", "rijksregisternummer", "rrn")


class BeRijksregisterRecognizer(PatternRecognizer):
    DEFAULT_SCORE: ClassVar[float] = 0.85

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entity="BE_RIJKSREGISTER",
            patterns=[Pattern(name="be_rrn", regex=_RR_REGEX, score=0.2)],
            context=list(_RR_MARKERS),
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
            if _preceded_by(text, r.start, _RR_MARKERS):
                r.score = self.DEFAULT_SCORE
                validated.append(r)
        return validated


# Type-guard voor linters.
for _cls in (
    NlKvkRecognizer,
    NlBigRecognizer,
    NlAgbRecognizer,
    NlRijbewijsRecognizer,
    NlBtwRecognizer,
    NlPolicyNumberRecognizer,
    BeRijksregisterRecognizer,
):
    assert issubclass(_cls, EntityRecognizer)

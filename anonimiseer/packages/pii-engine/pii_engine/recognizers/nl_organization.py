"""Pattern-based recognizer voor typische Nederlandse organisatie-namen.

spaCy-NL en SoNaR-BERT vangen veel bedrijven en overheden, maar missen
regelmatig gelegenheids-organisaties in zorg, onderwijs en welzijn —
precies de categorieën waar privacy het meest ingewikkeld is:

    - Zorgcentrum De Linde        (zorginstelling)
    - Basisschool De Regenboog    (onderwijs)
    - Stichting Jeugd & Gezin     (welzijn)
    - Verpleeghuis 't Anker       (ouderenzorg)

Patroon: één van een vaste lijst organisatie-aanduidingen, eventueel met
``De/Het/'t/'n`` als lidwoord, gevolgd door 1–4 woorden met hoofdletters of
speciale tekens (``&``, ``/``, cijfers). Eindigt op een woordgrens.

We gebruiken een bescheiden score (``0.7``) zodat we niet botsen met
precieze hits van Presidio's ``ORGANIZATION``-recognizer (spaCy).
Overlappende hits worden door de engine samengevoegd; de hoogste score
wint.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    Pattern,
    PatternRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["NlOrganizationRecognizer", "ORGANIZATION_PREFIXES"]


# Aanduidingen die bijna altijd het begin van een organisatie-naam markeren.
# Bewust inclusief: zorgkoepels, onderwijs, welzijn, overheden, kerken,
# sportverenigingen — categorieën die SoNaR-BERT regelmatig mist.
ORGANIZATION_PREFIXES: tuple[str, ...] = (
    "Zorgcentrum",
    "Verpleeghuis",
    "Verzorgingshuis",
    "Ziekenhuis",
    "Gezondheidscentrum",
    "Wijkcentrum",
    "Buurthuis",
    "Stichting",
    "Vereniging",
    "Coöperatie",
    "Cooperatie",
    "Instelling",
    "Instituut",
    "Gemeente",
    "Provincie",
    "Basisschool",
    "Middelbare school",
    "Hogeschool",
    "Universiteit",
    "School",
    "Kinderopvang",
    "Kinderdagverblijf",
    "Peuterspeelzaal",
    "Azc",
    "Jeugdzorg",
    "Reclassering",
    "Parochie",
    "Moskee",
    "Kerk",
    "Synagoge",
    "Politie",
    "Brandweer",
)

# Suffixen die bijna altijd een bedrijfsnaam afsluiten. We vangen zowel
# de canonieke notatie (B.V.) als variaties zonder punten (BV). ``\.?`` achter
# elke letter maakt dat optioneel. We behandelen suffixen apart van prefixen
# zodat namen als "Acme Nederland B.V." volledig meegaan — anders zou spaCy
# "Nederland" als ``LOCATION`` labelen en de naam in drieën knippen.
ORGANIZATION_SUFFIXES: tuple[str, ...] = (
    r"B\.?V\.?",
    r"N\.?V\.?",
    r"C\.?V\.?",
    r"V\.?O\.?F\.?",
    r"Holding",
    r"Group",
    r"Groep",
    r"Ltd\.?",
    r"Inc\.?",
    r"LLC",
    r"GmbH",
    r"S\.?A\.?",
    r"Limited",
    r"Corporation",
    r"Corp\.?",
)

# Regex samenstellen:
#   - niet-hoofdletter-gevoelige prefix-match per categorie-woord
#   - optioneel lidwoord ``de|het|'t|'n`` (Nederlandse verkleinvorm)
#   - 1..4 componenten: hoofdletter-woord met optionele tussenvoegsels
#     (Van/Van der/De), ampersand-woorden, of cijfers (bv. "Wijk 12").
_PREFIX_ALT = "|".join(re.escape(p) for p in ORGANIZATION_PREFIXES)
_NL_ORG_REGEX = re.compile(
    rf"\b(?:{_PREFIX_ALT})\b"
    r"(?:\s+(?:de|het|'t|'n|Van(?:\sder)?|der))?"
    r"(?:\s+(?:[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'\-]+|&|/|\d+)){1,4}",
    re.UNICODE,
)

# Suffix-matching: 1-5 hoofdletter-woorden gevolgd door een bedrijfssuffix.
# Toegestane tussenvoegsels: ``&``, ``/``, ``van``/``der``/``de``. We beginnen
# met een hoofdletter-woord zodat we geen losse "B.V." pakken.
_SUFFIX_ALT = "|".join(ORGANIZATION_SUFFIXES)
_NL_ORG_SUFFIX_REGEX = re.compile(
    r"\b(?:[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'\-]+)"
    r"(?:\s+(?:[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'\-]+|&|/|van|der|de)){0,4}"
    rf"\s+(?:{_SUFFIX_ALT})\b",
    re.UNICODE,
)


class NlOrganizationRecognizer(EntityRecognizer):
    """Vult ORGANIZATION-hits aan met typisch Nederlandse benamingen.

    Gebruikt dezelfde ``ORGANIZATION``-entity als spaCy/SoNaR zodat hits in
    de UI onder één categorie vallen. Score is bewust lager (``0.7``) dan
    NER-hits, want regex-matches zijn minder precies dan model-hits.
    """

    DEFAULT_SCORE: ClassVar[float] = 0.7

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["ORGANIZATION"],
            supported_language=supported_language,
            name="NlOrganizationRecognizer",
            version="0.1.0",
        )

    def load(self) -> None:  # pragma: no cover - niets te laden
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
        for match in _NL_ORG_REGEX.finditer(text):
            start, end = match.span()
            results.append(
                RecognizerResult(
                    entity_type="ORGANIZATION",
                    start=start,
                    end=end,
                    score=self.DEFAULT_SCORE,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.name,
                        original_score=self.DEFAULT_SCORE,
                        pattern_name="nl_org_prefix",
                        pattern="prefix_match",
                        textual_explanation=(
                            "Match op NL-organisatie-prefix (Zorgcentrum, "
                            "Stichting, School, …) + hoofdletter-woorden."
                        ),
                    ),
                )
            )
        # Suffix-match levert vaak betere hits dan spaCy voor namen als
        # "Acme Nederland B.V.", dus we geven 'm een iets hogere score.
        for match in _NL_ORG_SUFFIX_REGEX.finditer(text):
            start, end = match.span()
            results.append(
                RecognizerResult(
                    entity_type="ORGANIZATION",
                    start=start,
                    end=end,
                    score=0.85,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.name,
                        original_score=0.85,
                        pattern_name="nl_org_suffix",
                        pattern="suffix_match",
                        textual_explanation=(
                            "Bedrijfsnaam eindigt op suffix (B.V., N.V., "
                            "VOF, GmbH, Ltd, …); hele naam samen meegenomen."
                        ),
                    ),
                )
            )
        return results

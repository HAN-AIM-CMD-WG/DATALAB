"""Creditcard-meta: verloopdatum (MM/YY) en CVC/CVV-codes.

Een kaartnummer alleen is niet bruikbaar zonder verloopdatum en
beveiligingscode. Beide horen bij de zelfde transactiedata maar werden
tot nu toe niet gemarkeerd:

- ``verloopt 11/28``, ``vervaldatum 03/29``, ``Exp. 07/27``
- ``CVC 123``, ``CVV 456``, ``beveiligingscode 789`` (3-4 cijfers)

We vereisen **expliciete context-woorden** om false positives op
willekeurige ``MM/YY``-fragmenten of 3-cijferige getallen te vermijden:
``11/28`` zonder context is geen kaart-verloopdatum maar bv. een
bladzijde-aanduiding.

Beide outputs worden als ``CREDIT_CARD`` gemarkeerd zodat ze in de
financieel-categorie van de UI vallen.
"""

from __future__ import annotations

import re
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["CreditCardMetaRecognizer"]


# Verloopdatum: ``verloopt 11/28``, ``vervaldatum 03/29``, ``geldig tot 07/27``,
# ``Exp. 11/28``, ``valid thru 11/28``. Het MM/YY-formaat staat **direct**
# achter het label (eventueel met dubbele punt of streepje).
_EXPIRY_LABELS = (
    r"verloopt",
    r"vervaldatum",
    r"vervalt",
    r"geldig\s+tot",
    r"geldig\s+t/m",
    r"verloopdatum",
    r"expiry",
    r"exp(?:\.|iration|iry)?",
    r"valid\s+thru",
)
_EXPIRY_REGEX = re.compile(
    r"""(?ix)
    (?:""" + "|".join(_EXPIRY_LABELS) + r""")
    [^\S\n]* [:\-=]? [^\S\n]*
    (?P<value>(?:0[1-9]|1[0-2])[/\-\.](?:\d{2}|\d{4}))
    \b
    """,
)

# CVC/CVV: 3 of 4 cijfers, na een expliciet label.
_CVC_LABELS = (
    r"cvc",
    r"cvv",
    r"cvc2",
    r"cvv2",
    r"cid",
    r"beveiligingscode",
    r"verificatiecode",
    r"securitycode",
    r"security\s+code",
    r"card\s+verification\s+(?:value|code)",
)
_CVC_REGEX = re.compile(
    r"""(?ix)
    (?:""" + "|".join(_CVC_LABELS) + r""")
    [^\S\n]* [:\-=]? [^\S\n]*
    (?P<value>\d{3,4})
    \b
    """,
)


class CreditCardMetaRecognizer(EntityRecognizer):
    """Verloopdatum (MM/YY) en CVC/CVV → ``CREDIT_CARD``."""

    SUPPORTED: ClassVar[tuple[str, ...]] = ("CREDIT_CARD",)

    EXPIRY_SCORE: ClassVar[float] = 0.9
    CVC_SCORE: ClassVar[float] = 0.95

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=list(self.SUPPORTED),
            name="CreditCardMetaRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:  # pragma: no cover - Presidio interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if entities and "CREDIT_CARD" not in entities:
            return []
        out: list[RecognizerResult] = []
        for m in _EXPIRY_REGEX.finditer(text):
            start, end = m.span("value")
            out.append(
                self._mk(
                    start,
                    end,
                    self.EXPIRY_SCORE,
                    "expiry_after_label",
                    "Verloopdatum (MM/YY of MM/YYYY) achter label.",
                )
            )
        for m in _CVC_REGEX.finditer(text):
            start, end = m.span("value")
            out.append(
                self._mk(
                    start,
                    end,
                    self.CVC_SCORE,
                    "cvc_after_label",
                    "CVC/CVV-code (3-4 cijfers) achter label.",
                )
            )
        return out

    def _mk(
        self,
        start: int,
        end: int,
        score: float,
        name: str,
        explanation: str,
    ) -> RecognizerResult:
        return RecognizerResult(
            entity_type="CREDIT_CARD",
            start=start,
            end=end,
            score=score,
            analysis_explanation=AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=score,
                pattern_name=name,
                pattern="",
                validation_result=True,
                textual_explanation=explanation,
            ),
        )

"""Online identifiers: social handles, usernames en wachtwoorden.

We onderscheiden drie categorieën:

- ``SOCIAL_HANDLE``: ``@username`` op Twitter/X, BlueSky, Mastodon, Instagram.
  Gevonden waar een ``@`` direct aan een gebruikersnaam plakt zonder
  e-mail-context (anders is het een EMAIL_ADDRESS-fragment).
- ``USERNAME``: een gebruikersnaam achter een label als
  ``Gebruikersnaam:`` of ``Username:``. We willen specifiek de waarde
  pakken, niet het label.
- ``PASSWORD``: een wachtwoord achter een label als ``Wachtwoord:``,
  ``Password:``, ``Paswoord:``. Belangrijk voor testdocumenten waar
  fictieve wachtwoorden vóórkomen — we willen niet dat ze als
  ``PERSON`` of ``DATE_TIME`` getagd worden.

Implementatie: een custom :class:`EntityRecognizer` zodat we het
label kunnen matchen met een regex maar het *resultaat-bereik* alleen
de waarde markeert (label blijft in de tekst staan voor leesbaarheid).
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

__all__ = ["OnlineIdentifierRecognizer"]


# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------

# Social handle (``@jeroenvdm``). We eisen dat er vóór de ``@`` géén
# letter, cijfer, of ``.`` staat (anders is het een e-mail-fragment of
# een padonderdeel) en ná de naam géén ``.`` (zou e-mail-prefix zijn).
_HANDLE_REGEX = re.compile(
    r"(?<![A-Za-z0-9._@/])@(?P<value>[A-Za-z][A-Za-z0-9_]{2,29})(?![A-Za-z0-9._])"
)

# BlueSky-/AT-protocol-handle (``@jeroenvdm.bsky.social``,
# ``@alice.example.com``). Drie of meer alfanum-/hyphen-tokens
# gescheiden door ``.``. We trekken het hele handle in één span zodat
# de URL-recognizer niet het domein-deel apart pakt.
_BLUESKY_HANDLE_REGEX = re.compile(
    r"(?<![A-Za-z0-9._@/])"
    r"@(?P<value>[A-Za-z][A-Za-z0-9_-]{1,30}"
    r"(?:\.[A-Za-z0-9_-]{1,30}){1,4})"
    r"(?![A-Za-z0-9._])"
)

# Mastodon-style fediverse handle (``@user@mastodon.nl``).
_MASTODON_HANDLE_REGEX = re.compile(
    r"(?<![A-Za-z0-9._@/])"
    r"@(?P<value>[A-Za-z][A-Za-z0-9_.-]{1,30}"
    r"@[A-Za-z][A-Za-z0-9.-]{1,40}\.[A-Za-z]{2,10})"
    r"(?![A-Za-z0-9._])"
)

# Gebruikersnaam achter label. Captures alleen de waarde.
_USERNAME_LABELS = (
    r"gebruikersnaam",
    r"username",
    r"loginnaam",
    r"login",
    r"userid",
    r"user-?id",
    r"user-?name",
    r"account(?:naam)?",
    r"inlognaam",
)
_USERNAME_REGEX = re.compile(
    r"""(?ix)
    (?:^|[\s>*_\[\(\-])                 # begin of veilige scheider
    (?:"""
    + "|".join(_USERNAME_LABELS)
    + r""")
    [^\S\n]* [:\-=]                     # label-eindigt-in :, - of =
    [^\S\n]* \** [^\S\n]*               # optionele markdown ** + spaties
    (?P<value>[A-Za-z0-9][A-Za-z0-9._\-]{2,31})
    (?![A-Za-z0-9._\-])
    """,
)

# Wachtwoord achter label. Stopt op whitespace of einde regel zodat
# we geen trailing tekst meepakken. We vereisen min. 4 chars zodat we
# leestekens als ``-`` niet als wachtwoord oppikken.
_PASSWORD_LABELS = (
    r"wachtwoord",
    r"paswoord",
    r"password",
    r"passw(?:ord)?",
    r"pwd",
    r"pw",
)
_PASSWORD_REGEX = re.compile(
    r"""(?ix)
    (?:^|[\s>*_\[\(\-])
    (?:"""
    + "|".join(_PASSWORD_LABELS)
    + r""")
    [^\n]*?                              # optionele tussenwoorden (bv. ``(fictief!)``)
    [:\-=]
    [^\S\n]* \** [^\S\n]*                # optionele markdown ** en spaties
    (?P<value>\S{4,64}?)
    (?=\s|$|[*_<\)\]])                   # stop op whitespace of opmaak-einde
    """,
)


# ---------------------------------------------------------------------------
# Recognizer
# ---------------------------------------------------------------------------


class OnlineIdentifierRecognizer(EntityRecognizer):
    """Detecteert handles, gebruikersnamen en wachtwoorden.

    Geeft één van drie entity-types terug afhankelijk van het patroon:
    ``SOCIAL_HANDLE``, ``USERNAME``, of ``PASSWORD``.
    """

    SUPPORTED_ENTITIES: ClassVar[tuple[str, ...]] = (
        "SOCIAL_HANDLE",
        "USERNAME",
        "PASSWORD",
    )

    DEFAULT_SCORES: ClassVar[dict[str, float]] = {
        "SOCIAL_HANDLE": 0.85,
        "USERNAME": 0.8,
        "PASSWORD": 0.95,
    }

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=list(self.SUPPORTED_ENTITIES),
            name="OnlineIdentifierRecognizer",
            supported_language=supported_language,
        )

    def load(self) -> None:
        """Geen externe assets nodig."""

    def analyze(
        self,
        text: str,
        entities: list[str] | None = None,
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        wanted = set(entities) if entities else set(self.SUPPORTED_ENTITIES)
        out: list[RecognizerResult] = []

        if "SOCIAL_HANDLE" in wanted:
            # Match volgorde: éérst de meer-specifieke patronen
            # (Mastodon/BlueSky met meerdere segmenten) zodat hun grotere
            # span in de overlap-resolver van de eenvoudige
            # ``@username``-match wint.
            for regex, why in (
                (
                    _MASTODON_HANDLE_REGEX,
                    "Fediverse-handle (``@user@server.tld``).",
                ),
                (
                    _BLUESKY_HANDLE_REGEX,
                    "AT-protocol-handle (``@user.bsky.social``).",
                ),
                (
                    _HANDLE_REGEX,
                    "Social-media handle (``@username``); 3-30 alfanum tekens.",
                ),
            ):
                for m in regex.finditer(text):
                    start, end = m.span("value")
                    out.append(
                        self._make_result(
                            "SOCIAL_HANDLE",
                            start - 1,
                            end,
                            score=self.DEFAULT_SCORES["SOCIAL_HANDLE"],
                            explanation=why,
                        )
                    )

        if "USERNAME" in wanted:
            for m in _USERNAME_REGEX.finditer(text):
                start, end = m.span("value")
                out.append(
                    self._make_result(
                        "USERNAME",
                        start,
                        end,
                        score=self.DEFAULT_SCORES["USERNAME"],
                        explanation=(
                            "Gebruikersnaam-veld na expliciet label "
                            "(``Gebruikersnaam:``, ``Username:``, …)."
                        ),
                    )
                )

        if "PASSWORD" in wanted:
            for m in _PASSWORD_REGEX.finditer(text):
                start, end = m.span("value")
                out.append(
                    self._make_result(
                        "PASSWORD",
                        start,
                        end,
                        score=self.DEFAULT_SCORES["PASSWORD"],
                        explanation=(
                            "Wachtwoord-veld na expliciet label "
                            "(``Wachtwoord:``, ``Password:``, …)."
                        ),
                    )
                )
        return out

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    def _make_result(
        self,
        entity: str,
        start: int,
        end: int,
        *,
        score: float,
        explanation: str,
    ) -> RecognizerResult:
        return RecognizerResult(
            entity_type=entity,
            start=start,
            end=end,
            score=score,
            analysis_explanation=AnalysisExplanation(
                recognizer=self.__class__.__name__,
                original_score=score,
                pattern_name=entity.lower(),
                pattern="",
                validation_result=True,
                textual_explanation=explanation,
            ),
        )

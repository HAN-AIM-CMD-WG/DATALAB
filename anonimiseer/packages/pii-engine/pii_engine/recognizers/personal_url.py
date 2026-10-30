"""Links that point to a person: profile pages and pages named after someone.

Most links in documents point to organisations, so the generic URL category is
off by default. A link that identifies a person is personal data, though, and
is detected separately as ``PERSONAL_URL`` so it can be masked by default:

- a profile on a known site (``linkedin.com/in/…``, ``github.com/…``,
  ``instagram.com/…``), unless the path is one of the site's own pages;
- a page whose path holds a slug that starts with a known first name and
  continues with more words (``…/team/anna-de-vries``).
"""

from __future__ import annotations

import re
from typing import ClassVar
from urllib.parse import urlsplit

from presidio_analyzer import AnalysisExplanation, EntityRecognizer, RecognizerResult
from presidio_analyzer.nlp_engine import NlpArtifacts

from pii_engine.recognizers.nl_firstnames import _all_names

__all__ = ["PersonalUrlRecognizer"]

_PROFILE_HOSTS = (
    r"linkedin\.com|github\.com|gitlab\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|"
    r"tiktok\.com|youtube\.com|threads\.net|bsky\.app|medium\.com|reddit\.com"
)
_URL_CHARS = r"[^\s<>\"'()\[\]{}|]+"
_URL_RE = re.compile(
    rf"(?<![\w@./-])(?:https?://|www\.){_URL_CHARS}"
    rf"|(?<![\w@./-])(?:[a-z0-9-]+\.)?(?:{_PROFILE_HOSTS})/{_URL_CHARS}",
    flags=re.IGNORECASE,
)
_TRAILING = ".,;:!?'\""

# Per profile site: the path segment after which the account name follows.
# An empty prefix means the account is the first segment.
_PROFILE_PREFIXES: dict[str, tuple[str, ...]] = {
    "linkedin.com": ("in", "pub"),
    "bsky.app": ("profile",),
    "reddit.com": ("user", "u"),
    "youtube.com": ("", "c", "user"),
    "github.com": ("",),
    "gitlab.com": ("",),
    "instagram.com": ("",),
    "facebook.com": ("",),
    "x.com": ("",),
    "twitter.com": ("",),
    "tiktok.com": ("",),
    "threads.net": ("",),
    "medium.com": ("",),
}
# The sites' own pages, which are not accounts.
_SITE_PAGES = frozenset(
    {
        "about", "apps", "blog", "c", "channel", "collections", "company", "contact", "docs",
        "enterprise", "events", "explore", "features", "groups", "hashtag", "help", "home",
        "i", "in", "intent", "jobs", "legal", "login", "marketplace", "orgs", "p", "pages",
        "policies", "pricing", "privacy", "profile", "pub", "r", "reel", "reels", "results",
        "school", "search", "security", "settings", "share", "sharer", "sharer.php", "showcase",
        "signup", "site", "sponsors", "status", "stories", "team", "terms", "topics",
        "trending", "u", "user", "watch",
    }
)  # fmt: skip
# First names that are also common words in URL paths ("/job-vacatures").
_AMBIGUOUS_NAMES = frozenset(
    {"Amber", "Ben", "Bo", "Fleur", "Hope", "Iris", "Jade", "Job", "Joy", "June", "Kim"}
    | {"Mark", "Max", "May", "Rose", "Roos", "Sky", "Will"}
)
_SLUG_SPLIT = re.compile(r"[-_.+]")


def _profile_account(host: str, segments: list[str]) -> str | None:
    site = next((s for s in _PROFILE_PREFIXES if host == s or host.endswith("." + s)), None)
    if site is None:
        return None
    for prefix in _PROFILE_PREFIXES[site]:
        if not prefix:
            account = segments[0] if segments else ""
        elif len(segments) >= 2 and segments[0].lower() == prefix:
            account = segments[1]
        else:
            continue
        if account and account.lstrip("@").lower() not in _SITE_PAGES:
            return account
    return None


def _slug_starts_with_name(segment: str, names: frozenset[str]) -> bool:
    tokens = [t for t in _SLUG_SPLIT.split(segment) if t]
    if not 2 <= len(tokens) <= 5 or not tokens[0].isalpha():
        return False
    first = tokens[0][:1].upper() + tokens[0][1:].lower()
    return first in names and first not in _AMBIGUOUS_NAMES


class PersonalUrlRecognizer(EntityRecognizer):
    PROFILE_SCORE: ClassVar[float] = 0.85
    NAME_SCORE: ClassVar[float] = 0.75

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["PERSONAL_URL"],
            name="PersonalUrlRecognizer",
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
        if entities and "PERSONAL_URL" not in entities:
            return []
        names = _all_names()
        out: list[RecognizerResult] = []
        for match in _URL_RE.finditer(text):
            url = match.group(0).rstrip(_TRAILING)
            parts = urlsplit(url if "://" in url else f"https://{url}")
            host = (parts.hostname or "").lower()
            segments = [s for s in parts.path.split("/") if s]
            if _profile_account(host, segments):
                score, why = self.PROFILE_SCORE, "Profielpagina op een bekende site."
            elif any(_slug_starts_with_name(s, names) for s in segments):
                score, why = self.NAME_SCORE, "Pad bevat een voornaam gevolgd door meer woorden."
            else:
                continue
            start = match.start()
            out.append(
                RecognizerResult(
                    entity_type="PERSONAL_URL",
                    start=start,
                    end=start + len(url),
                    score=score,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=score,
                        pattern_name="personal_url",
                        pattern="",
                        validation_result=True,
                        textual_explanation=why,
                    ),
                )
            )
        return out

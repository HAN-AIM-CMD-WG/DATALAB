"""LLM-review van een geanonimiseerde tekst.

We sturen de geanonimiseerde tekst naar een lokaal Ollama-model en
vragen het model in JSON-vorm terug te geven of er nog zichtbare PII
in staat. Het model krijgt expliciet de instructie om pseudoniem-
placeholders (zoals ``[PERSON_1]`` of ``<EMAIL_REDACTED>``) te
negeren — die zijn juist de bewuste vervangingen.

Het oordeel is *adviserend*: de gebruiker blijft eindverantwoordelijk.
Vandaar dat we ook de raw response meeleveren voor transparantie.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from pii_engine.ollama_client import OllamaError, generate

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "Je bent een privacy-controleur. Je krijgt een tekst die al "
    "geanonimiseerd zou moeten zijn. Geef alleen JSON terug met "
    "de volgende structuur:\n"
    '{"verdict": "clean" | "suspect", "summary": "<korte uitleg in NL>", '
    '"findings": [{"snippet": "<verdacht fragment>", "category": '
    '"<NAME|EMAIL|PHONE|ADDRESS|ID|OTHER>", "explanation": "<reden in NL>"}]}\n'
    "Negeer placeholders die er duidelijk vervangen uitzien, zoals "
    "[PERSON_1], <NAAM>, [EMAIL] of XXX. Markeer alleen tekst die "
    "écht naar een persoon, organisatie of identificeerbare entiteit "
    "verwijst. Geef geen markdown — uitsluitend geldig JSON."
)


PROMPT_TEMPLATE = (
    "Hier is de geanonimiseerde tekst tussen <text>-tags. "
    "Onderzoek of er nog persoonlijke informatie in staat die per "
    "ongeluk niet gemaskeerd is.\n\n<text>\n{body}\n</text>\n\n"
    "Antwoord met geldig JSON volgens het hierboven beschreven schema."
)


@dataclass(frozen=True)
class ReviewFinding:
    snippet: str
    category: str
    explanation: str


@dataclass(frozen=True)
class ReviewResult:
    model: str
    verdict: str  # 'clean' | 'suspect' | 'unknown'
    summary: str
    findings: list[ReviewFinding]
    raw_response: str
    eval_duration_ms: int | None = None


_MAX_BODY_CHARS = 8_000
_VALID_VERDICTS = {"clean", "suspect"}


def review(text: str, model: str) -> ReviewResult:
    """Vraag het LLM om een second-opinion op de geanonimiseerde tekst.

    Bij grote documenten knippen we tot ``_MAX_BODY_CHARS`` om Ollama-
    context-limieten en latency in toom te houden. We vermelden dat in
    de summary zodat de gebruiker weet dat alleen het begin getoetst is.
    """

    body = text.strip()
    truncated = False
    if len(body) > _MAX_BODY_CHARS:
        body = body[:_MAX_BODY_CHARS]
        truncated = True

    prompt = PROMPT_TEMPLATE.format(body=body)
    try:
        result = generate(
            model=model,
            prompt=prompt,
            system=SYSTEM_PROMPT,
            json_mode=True,
            temperature=0.0,
            timeout_s=120.0,
        )
    except OllamaError as exc:
        return ReviewResult(
            model=model,
            verdict="unknown",
            summary=f"LLM-review niet uitgevoerd: {exc}",
            findings=[],
            raw_response="",
        )

    parsed = _parse_response(result.response)
    if parsed is None:
        return ReviewResult(
            model=model,
            verdict="unknown",
            summary=(
                "Het model gaf geen geldig JSON terug; controleer de ruwe "
                "respons hieronder en oordeel zelf."
            ),
            findings=[],
            raw_response=result.response,
            eval_duration_ms=result.eval_duration_ms,
        )

    summary = str(parsed["summary"])
    if truncated:
        summary = (
            f"{summary} (Let op: alleen de eerste {_MAX_BODY_CHARS} tekens "
            "zijn beoordeeld; controleer de rest handmatig.)"
        )

    return ReviewResult(
        model=model,
        verdict=str(parsed["verdict"]),
        summary=summary,
        findings=parsed["findings"],  # type: ignore[arg-type]
        raw_response=result.response,
        eval_duration_ms=result.eval_duration_ms,
    )


def _parse_response(raw: str) -> dict[str, object] | None:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Sommige modellen plakken Markdown-fences om JSON heen.
        cleaned = raw.strip().lstrip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
        cleaned = cleaned.rstrip("`").strip()
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    verdict = data.get("verdict")
    if verdict not in _VALID_VERDICTS:
        return None
    summary = data.get("summary")
    if not isinstance(summary, str):
        return None
    findings_raw = data.get("findings", [])
    findings: list[ReviewFinding] = []
    if isinstance(findings_raw, list):
        for item in findings_raw:
            if not isinstance(item, dict):
                continue
            snippet = item.get("snippet")
            category = item.get("category", "OTHER")
            explanation = item.get("explanation", "")
            if not isinstance(snippet, str) or not snippet.strip():
                continue
            findings.append(
                ReviewFinding(
                    snippet=snippet,
                    category=str(category)[:32],
                    explanation=str(explanation)[:280],
                )
            )
    return {"verdict": verdict, "summary": summary, "findings": findings}


__all__ = ["ReviewFinding", "ReviewResult", "review"]

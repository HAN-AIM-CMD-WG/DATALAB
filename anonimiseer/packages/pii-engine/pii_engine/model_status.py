"""What the detection pipeline really runs with, and what it is missing.

The settings say which models should be used; this module looks at what was
actually loaded. A spaCy model that was not found silently becomes an empty
Dutch pipeline without NER, and a SoNaR model that fails to load silently
finds nothing. Detection then gets worse while the app still says "Online".
The limitations listed here are shown to the user as "Beperkt".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from presidio_analyzer import AnalyzerEngine

    from pii_engine.config import Settings

ModelState = Literal["off", "loading", "loaded", "failed"]
SonarState = ModelState


@dataclass(frozen=True)
class PipelineStatus:
    #: The spaCy model actually loaded, or ``None`` for the empty fallback pipeline.
    spacy_model: str | None
    sonar_state: ModelState
    sonar_model: str | None
    pii_model_state: ModelState = "off"
    pii_model: str | None = None
    custom_terms_state: ModelState = "off"
    limitations: list[str] = field(default_factory=list)


def _model_state(
    analyzer: AnalyzerEngine,
    recognizer_name: str,
    enabled: bool,
    what: str,
    consequence: str,
    limitations: list[str],
) -> ModelState:
    """State of an optional model layer; a failure is added to ``limitations``."""
    if not enabled:
        return "off"
    recognizer = next(
        (r for r in analyzer.registry.recognizers if type(r).__name__ == recognizer_name),
        None,
    )
    if recognizer is None:
        limitations.append(
            f"{what} staat aan, maar deze installatie kan het niet draaien "
            f"(torch of transformers ontbreekt). {consequence}"
        )
        return "failed"
    state: ModelState = recognizer.state  # type: ignore[attr-defined]
    if state == "failed":
        limitations.append(
            f"{what} kon niet worden geladen: {recognizer.load_error}. {consequence}"  # type: ignore[attr-defined]
        )
    return state


def loaded_spacy_model(analyzer: AnalyzerEngine) -> str | None:
    """Name of the loaded spaCy model, or ``None`` when it has no NER component."""
    nlp = getattr(analyzer.nlp_engine, "nlp", {}).get("nl")
    if nlp is None or "ner" not in nlp.pipe_names:
        return None
    meta = nlp.meta
    return f"{meta.get('lang', 'nl')}_{meta.get('name', '')}"


def pipeline_status(analyzer: AnalyzerEngine, settings: Settings) -> PipelineStatus:
    limitations: list[str] = []

    spacy_model = loaded_spacy_model(analyzer)
    if spacy_model is None:
        limitations.append(
            f"Het taalmodel {settings.spacy_model} is niet geladen. Namen en plaatsen worden "
            "minder goed herkend."
        )

    sonar_state = _model_state(
        analyzer,
        "SonarRecognizer",
        settings.enable_sonar,
        "Het SoNaR-model",
        "Namen worden minder goed herkend.",
        limitations,
    )
    pii_model_state = _model_state(
        analyzer,
        "PiiModelRecognizer",
        settings.enable_pii_model,
        "Het extra PII-model",
        "Er wordt gezocht zonder deze extra laag.",
        limitations,
    )
    profile = settings.profile_name or "dit profiel"
    custom_terms_state = _model_state(
        analyzer,
        "CustomTermsRecognizer",
        bool(settings.custom_terms),
        f"Het model voor de eigen begrippen van {profile}",
        "Die begrippen worden nu niet gezocht.",
        limitations,
    )

    return PipelineStatus(
        spacy_model=spacy_model,
        sonar_state=sonar_state,
        sonar_model=settings.sonar_model if sonar_state != "off" else None,
        pii_model_state=pii_model_state,
        pii_model=settings.pii_model if pii_model_state != "off" else None,
        custom_terms_state=custom_terms_state,
        limitations=limitations,
    )

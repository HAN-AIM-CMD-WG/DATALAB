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

SonarState = Literal["off", "loading", "loaded", "failed"]


@dataclass(frozen=True)
class PipelineStatus:
    #: The spaCy model actually loaded, or ``None`` for the empty fallback pipeline.
    spacy_model: str | None
    sonar_state: SonarState
    sonar_model: str | None
    limitations: list[str] = field(default_factory=list)


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

    sonar = next(
        (r for r in analyzer.registry.recognizers if type(r).__name__ == "SonarRecognizer"),
        None,
    )
    sonar_state: SonarState
    if not settings.enable_sonar:
        sonar_state = "off"
    elif sonar is None:
        sonar_state = "failed"
        limitations.append(
            "Het SoNaR-model staat aan, maar deze installatie kan het niet draaien "
            "(torch of transformers ontbreekt). Namen worden minder goed herkend."
        )
    else:
        sonar_state = sonar.state  # type: ignore[attr-defined]
        if sonar_state == "failed":
            limitations.append(
                f"Het SoNaR-model kon niet worden geladen: {sonar.load_error}. "  # type: ignore[attr-defined]
                "Namen worden minder goed herkend."
            )

    return PipelineStatus(
        spacy_model=spacy_model,
        sonar_state=sonar_state,
        sonar_model=settings.sonar_model if sonar_state != "off" else None,
        limitations=limitations,
    )

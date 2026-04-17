# pii-engine

Gedeelde Python-microservice voor PII-detectie, -anonimisering en -pseudonimisering. Voedt de Electron-app (als PyInstaller-sidecar), de Open WebUI filter, en later de browser-extensie.

Status: **leeg skelet** — implementatie start in Fase 1.

## Voorgenomen stack

- FastAPI (async REST)
- Microsoft Presidio (analyzer + anonymizer) met NL-lokalisatie
- spaCy `nl_core_news_lg`
- HuggingFace Transformers / Optimum ONNX (`wietsedv/bert-base-dutch-cased-finetuned-sonar-ner`)
- Optioneel: GLiNER (`E3-JSI/gliner-multi-pii-domains-v1`), Ollama HTTP-client
- `huggingface_hub` voor model-downloads

## Voorgenomen endpoints

| Endpoint | Doel |
|---|---|
| `POST /analyze` | Detecteer entiteiten (Presidio-compatibel) |
| `POST /anonymize` | Vervang entiteiten door tokens of maskering |
| `POST /deanonymize` | Plaats originele waarden terug via mapping |
| `GET /models` | Lijst beschikbare + geïnstalleerde modellen |
| `POST /models/{id}/pull` | Download model (HF of Ollama) |
| `GET /models/jobs/{job_id}/stream` | SSE voortgangsbalk |
| `DELETE /models/{id}` | Verwijder lokaal |
| `POST /models/reload` | Hot-reload analyzer met nieuwe modellen |

Zie [`../../docs/architecture.md`](../../docs/architecture.md) voor details.

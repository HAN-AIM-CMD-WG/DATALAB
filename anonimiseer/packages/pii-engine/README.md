# `pii-engine` — Nederlandse PII-detectie en anonimisering

> Gedeelde Python-microservice voor de Anonimiseer-toolketen. Bouwt bovenop
> [Microsoft Presidio](https://github.com/microsoft/presidio) met Nederlandse
> recognizers voor BSN (met Elfproef), telefoon, postcode en studentnummer.
> Dient als backend voor zowel de Electron-app als de Open WebUI-filter.

## Wat er in zit (Fase 1 MVP)

| Recognizer | Entity type | Validatie |
|---|---|---|
| `BsnRecognizer` | `NL_BSN` | regex + **Elfproef-checksum** |
| `NlPhoneRecognizer` | `NL_PHONE_NUMBER` | mobiel/vast/internationaal regex |
| `NlPostcodeRecognizer` | `NL_POSTCODE` | `[1-9]\d{3}\s?[A-Z]{2}` excl. SA/SD/SS |
| `NlStudentnrRecognizer` | `NL_STUDENT_ID` | `S\d{7}`-prefix + context-gedreven generic |
| `SonarRecognizer` (optioneel) | `PERSON`, `LOCATION`, `ORGANIZATION` | SoNaR-BERT voor NL (zie Fase 1B) |
| Presidio built-ins (`nl`) | `EMAIL_ADDRESS`, `IBAN_CODE`, `CREDIT_CARD`, `URL`, … | native |

NLP-backend: spaCy met `nl_core_news_lg` (productie) of `nl_core_news_sm`
(CI/dev) via de `[nl-large]` / `[nl-small]` extras. Valt terug op een lege
`spacy.blank("nl")` pipeline als geen model geïnstalleerd is — dan werken alleen
regex-gebaseerde recognizers, niet de statistische NER.

### SoNaR-BERT (Fase 1B, optioneel)

Voor betere recall op Nederlandse persoonsnamen (met name met tussenvoegsels
zoals `van den Broek`, `ter Horst`, `van Dijk`) is er een optionele recognizer
rond het model
[`wietsedv/bert-base-dutch-cased-finetuned-sonar-ner`](https://huggingface.co/wietsedv/bert-base-dutch-cased-finetuned-sonar-ner)
(SoNaR-corpus, PER/LOC/ORG).

Aanzetten:

```bash
pip install -e ".[sonar]"                      # +torch, +transformers (~500 MB)
PII_ENGINE_ENABLE_SONAR=true pii-engine
```

Observatie uit A/B-test (tekst *"...mijn collega is ter Horst..."*):

| Stack                       | `ter Horst` wordt |
|-----------------------------|-------------------|
| spaCy `nl_core_news_lg`     | `LOCATION` (fout — `ter` lekt) |
| spaCy + SoNaR-BERT          | `PERSON` (correct) |

Kosten: ~440 MB modelcache, +0.5-1s cold-start, +50-150 ms per call (CPU).
Het model wordt lazy geladen bij de eerste analyse-call zodat startup niet
blokkeert. Zet bij voorkeur `HF_HOME` naar een cache-pad dat je proces kan
schrijven (default `~/.cache/huggingface/hub`).

## Installatie

### Lokaal (dev)

```bash
cd anonimiseer/packages/pii-engine
python -m venv .venv && source .venv/bin/activate
pip install -e ".[nl-small,dev]"      # of [nl-large] voor productie-achtig
pytest                                 # alle tests
pii-engine                             # start FastAPI op 127.0.0.1:8765
```

### Docker

```bash
cd anonimiseer/packages/pii-engine
docker build -t pii-engine .
docker run --rm -p 8765:8765 pii-engine
curl -s http://localhost:8765/health | jq
```

> **Let op**: bind in productie NIET aan `0.0.0.0` als de host publiek is. Zet
> de container achter een reverse proxy en beperk toegang tot het interne net.

## API

Alle endpoints accepteren alleen `language = "nl"` (uitbreiding later).

### `GET /health`

```json
{ "status": "ok", "version": "0.1.1", "recognizers": 50, "spacy_model": "nl_core_news_lg", "limitations": [], "proof": null }
```

`limitations` zegt in gewone taal waarom de detectie nu minder goed is dan ingesteld,
bijvoorbeeld een model dat niet geladen kon worden. De app toont dan "Beperkt".

### `POST /analyze`

```json
{
  "text": "Mijn BSN is 123456782 en mijn telefoon is 06-12345678.",
  "entities": ["NL_BSN", "NL_PHONE_NUMBER"],
  "score_threshold": 0.35
}
```

Response:

```json
{
  "items": [
    { "entity_type": "NL_BSN", "start": 12, "end": 21, "score": 1.0, "original": "123456782" },
    { "entity_type": "NL_PHONE_NUMBER", "start": 41, "end": 52, "score": 0.55, "original": "06-12345678" }
  ]
}
```

### `POST /anonymize`

Dezelfde request als `/analyze` plus `mode` (`"pseudonymize"` | `"redact"`) en
`preserve_mapping`. Bij `pseudonymize` krijg je consistente tokens per type:

```json
{
  "text": "Mijn BSN is NL_BSN_1 en mijn telefoon is NL_PHONE_NUMBER_1.",
  "items": [...],
  "mapping": [
    { "entity_type": "NL_BSN", "original": "123456782", "pseudonym": "NL_BSN_1" },
    { "entity_type": "NL_PHONE_NUMBER", "original": "06-12345678", "pseudonym": "NL_PHONE_NUMBER_1" }
  ]
}
```

## Environment variables

| Variabele | Default | Beschrijving |
|---|---|---|
| `PII_ENGINE_HOST` | `127.0.0.1` | Bind-host. |
| `PII_ENGINE_PORT` | `8765` | TCP-poort. |
| `PII_ENGINE_SPACY_MODEL` | `nl_core_news_lg` | spaCy-modelnaam. |
| `PII_ENGINE_ALLOW_BLANK_NLP_FALLBACK` | `true` | Val terug op blank NL als model mist. Zet op `false` in productie. |
| `PII_ENGINE_DEFAULT_SCORE_THRESHOLD` | `0.35` | Minimale confidence. |
| `PII_ENGINE_ENABLE_BSN` | `true` | Schakel individuele recognizers uit. |
| `PII_ENGINE_ENABLE_SONAR` | `false` | Laad SoNaR-BERT NER (vereist `[sonar]` extras). |
| `PII_ENGINE_SONAR_MODEL` | `wietsedv/bert-base-dutch-cased-finetuned-sonar-ner` | HF-id. |
| `PII_ENGINE_SONAR_SCORE_MIN` | `0.5` | Ondergrens modelvertrouwen. |
| `PII_ENGINE_ENABLE_PLAYGROUND` | `true` | Serveer de HTML-playground op `/`. De app zet hem uit. |
| `PII_ENGINE_CORS_ALLOW_ORIGINS` | `["http://localhost"]` | CORS-lijst. |
| `PII_ENGINE_AUTH_TOKEN` | leeg | Gedeeld geheim; gezet, dan eist elk endpoint behalve `/health` de header `X-Engine-Token`. De app zet een nieuw token per sessie. |
| `PII_ENGINE_EXIT_WITH_PARENT` | `false` | Stop zodra stdin sluit, zodat de engine meegaat als de app crasht. |

Buiten de bundel leest de engine ook een `.env` in de werkmap; de gebundelde engine niet.

## Overige endpoints

| Endpoint | Wat |
|---|---|
| `POST /document/extract` | DOCX, XLSX of PDF naar platte tekst plus blokken (alinea's, cellen, regels). Bijgehouden wijzigingen in Word worden eerst geaccepteerd. |
| `POST /document/apply` | Vervangingen toepassen, met behoud van opmaak; documenteigenschappen, opmerkingen en PDF-annotaties worden leeggemaakt. De header `X-Anonimiseer-Unreplaced` telt geaccepteerde teksten die nog in de uitvoer staan. |
| `POST /restore/text`, `POST /document/restore` | Pseudoniemen terugzetten met een mapping; het watermerk gaat eruit. PDF kan niet. |
| `GET /engine/active`, `POST /engine/config` | Wat er echt geladen is, en modellen wisselen. Alleen modellen uit de registry. |
| `GET /models`, `POST /models/install` | Modellen tonen en op verzoek downloaden. |
| `POST /engine/review` | Controle achteraf door een lokaal Ollama-model (geen cloud-modellen). |

## Architectuur-positie

```
  +---------------------+        +---------------------+
  | Electron-app        |        | Open WebUI Filter   |
  | (start de engine)   |        | (bevroren)          |
  +---------+-----------+        +----------+----------+
            |                               |
            |          HTTP (localhost)     |
            v                               v
       +----+-------------------------------+----+
       |              pii-engine                 |
       |  Presidio + spaCy + SoNaR-BERT          |
       |  + NL/EU-recognizers + postfilter       |
       |  [optioneel] Ollama-controle achteraf   |
       +-----------------------------------------+
```

## Kwaliteit & conventies

```bash
ruff check .
ruff format .
mypy pii_engine
pytest --cov=pii_engine
```

GitHub Actions draait dit automatisch op elke PR die `packages/pii-engine/**`
raakt — zie [`.github/workflows/pii-engine.yml`](../../../.github/workflows/pii-engine.yml).

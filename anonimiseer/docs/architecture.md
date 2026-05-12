# Architectuur

> Dit document is een levend uittreksel van het master-plan. Detailniveau groeit per fase.
> Master-plan: zie Cursor plan-bestand `anonimiseer-tooling_electron_+_openwebui`.

## Kern-principe

Één gedeelde **PII Engine** in Python (`packages/pii-engine/`) voedt drie front-ends:

1. **Electron-app** (sidecar, PyInstaller-gebundeld, offline-first)
2. **Open WebUI filter** (microservice naast bestaande OpenWebUI-deployment)
3. **Browser-extensie + hotkey-helper** (Fase 6, Native Messaging naar dezelfde sidecar)

## Detectie-pijplijn

Per tekstblok, met vroege-exit op hoge confidence:

1. **Regex + validatie**: BSN-Elfproef, IBAN mod-97, NL-telefoon met contextwoorden, NL-postcode, e-mail, IP, creditcard, studentnummer-patronen.
2. **Nederlandse NER**: spaCy `nl_core_news_lg` via Presidio NlpEngine + extra recall via Wietsedv SoNaR BERT (ONNX).
3. **Zero-shot GLiNER** (optioneel): `E3-JSI/gliner-multi-pii-domains-v1` met NL-support voor runtime-configureerbare entiteiten.
4. **LLM-pass** (optioneel): Ollama endpoint met GEITje-7B-ultra of Llama-3.1-8B, alleen op blokken waar vorige stappen weinig vonden.
5. **Merge + de-duplicatie** met confidence-weging.
6. **Pseudonimisering**: consistente per-document mapping, AES-256-GCM versleutelde `mapping.enc`, sleutel uit gebruikerswachtwoord (PBKDF2).

## Model Manager

Alle NER/NLP/LLM-modellen zijn pluggable en 1-klik downloadbaar:

- **HuggingFace**: `huggingface_hub.snapshot_download`
- **Ollama**: `POST /api/pull`

Profielen:

| Profiel | Grootte | Hardware | Modellen |
|---|---|---|---|
| Basis | ~150 MB | CPU | spaCy `nl_core_news_md` + regex/BSN/postcode |
| Plus | ~900 MB | CPU | + spaCy `nl_core_news_lg` + Wietsedv SoNaR BERT ONNX |
| Max | ~4-8 GB | GPU aanbevolen | + GLiNER-PII NL + GEITje-7B-ultra (Ollama) |

## Verantwoordelijkheidslagen

Op zes plekken wordt expliciet aan de gebruiker duidelijk gemaakt dat dit een hulpmiddel is, geen garantie:

1. First-run disclaimer met verplichte akkoord-checkbox
2. Permanente banner in Stap 3 (Controleren) die pas verdwijnt na scrollen-tot-eind
3. Context-gevoelige waarschuwingen (lage confidence, OCR-PDF, art. 9-trefwoorden, taal-mismatch)
4. Dubbele check-off in Stap 4 (Opslaan)
5. `DISCLAIMER.txt` + optionele footer-metadata bij elk output-bestand
6. Lokaal audit-log (`audit.jsonl`, geen PII) met retentie-beleid

Zie [`disclaimer-nl.md`](disclaimer-nl.md) voor de exacte teksten.

## Fases

0. Monorepo-setup + A5-subtree (huidige fase)
1. PII Engine MVP + Model Manager
2. Open WebUI filter
3. Electron-app met wizard-UI
4. LLM-versterking (optioneel)
5. Documentatie + pilot
6. Browser-extensie + hotkey-helper (optioneel, na pilot)

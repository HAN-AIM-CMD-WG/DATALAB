# Architectuur

## Kern-principe

De **desktop-app** is het product. Die bestaat uit twee processen:

1. **Electron-app** (`apps/electron-anonimiseer/`) — UI, wizard-flow, bestandsafhandeling.
2. **PII Engine** (`packages/pii-engine/`) — alle detectie- en anonimiseer-logica, als Python-sidecar op `127.0.0.1:8765`.

De splitsing is geen keuze maar een gevolg: de detectie leunt op Presidio, spaCy en
PyTorch, en die draaien niet binnen Node. De engine wordt daarom met PyInstaller
gebundeld en door het main-proces opgestart en bewaakt
([`engineProcess.ts`](../apps/electron-anonimiseer/src/main/engineProcess.ts)).

Daaruit volgt de belangrijkste regel voor deze codebase: **alle PII-kennis hoort
in de engine, de app blijft dom**. Wat de app wél zelf doet — het toepassen van
al-goedgekeurde vervangingen op `.md`/`.txt` — is een bewuste uitzondering, zodat
wat de gebruiker in stap 3 ziet letterlijk op disk belandt.

De [Open WebUI-filter](../apps/openwebui-filter/) hangt als bevroren tweede client
aan dezelfde HTTP-API. Die legt geen beperkingen op aan de app: hij deelt geen
code en heeft zijn eigen tests.

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

## Wat er staat

| Onderdeel | Status |
|---|---|
| PII Engine + Model Manager | Werkend, gedekt door pytest/mypy/ruff in CI |
| Electron-app met wizard-UI | Werkend, pilot v0.1.1 |
| LLM-versterking via Ollama | Optioneel, aanwezig (`ollama_review.py`) |
| Open WebUI filter | Werkend, bevroren |

## Wat we bewust niet bouwen

Een browser-extensie met Native Messaging-host stond eerder op de planning voor
ChatGPT, Claude, Gemini en Copilot. Dat is geschrapt: een extensie is door de
eindgebruiker uit te zetten of te omzeilen (andere browser, incognito, andere
laptop) en is dus geen afdwingbare compliance-laag, terwijl hij wel per site
onderhoud vraagt zodra die zijn DOM wijzigt. Wie afdwingbaarheid nodig heeft,
gebruikt de Open WebUI-route.

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

Een document wordt eerst platgeslagen tot blokken (alinea's, tabelcellen, kop- en
voetteksten, werkbladcellen, PDF-regels). Daarna:

1. **Patronen met validatie**: ruim 30 eigen herkenners voor NL/EU, waaronder BSN
   (Elfproef), IBAN (mod-97), telefoon, postcode (met adrescontext), adressen, kentekens,
   KvK/BIG/AGB/BTW, geboortedatums, links naar een persoon, plus Presidio's herkenners voor
   e-mail, IP, URL en creditcard.
2. **Nederlandse NER**: spaCy `nl_core_news_lg` via Presidio, plus SoNaR-BERT
   (`wietsedv/bert-base-dutch-cased-finetuned-sonar-ner`, PyTorch) voor betere recall op
   namen, plaatsen en organisaties.
3. **Postfilter**: treffers blijven binnen één blok, overlappende treffers worden
   samengevoegd of rond een sterkere treffer (postcode, e-mail) geknipt, veldlabels en ruis
   vallen weg.
4. **Controle door de gebruiker** in stap 3, daarna vervangen. Na het opslaan telt de engine
   of elke geaccepteerde vervanging ook echt in het bestand is beland.
5. **Controle achteraf door een lokaal taalmodel** (optioneel, standaard uit): een
   Ollama-model leest het resultaat en wijst op wat mogelijk gemist is.
6. **Pseudonimisering**: één consistente mapping voor alle bestanden van een run, opgeslagen
   als `mapping.bin`. Versleuteld met een sleutel van het besturingssysteem (Electron
   safeStorage: Keychain op macOS, DPAPI op Windows, Secret Service op Linux) en beveiligd
   met een HMAC-SHA256 tegen wijzigingen. Terugzetten ("Pseudoniemen terugzetten") kan alleen
   voor dezelfde gebruiker op dezelfde computer. Op Linux zonder keyring slaat de app geen
   mapping op.

## Modellen beheren

Modellen beheren is de enige plek waar je kiest welke modellen de engine gebruikt, en toont
wat er echt geladen is. Ontbreekt er iets, dan staat de engine in de kopbalk op "Beperkt",
met de reden.

- **spaCy**: klein, medium of large; large zit in de installer.
- **SoNaR-BERT**: zit in de installer, aan of uit te zetten.
- **Ollama**: lokale taalmodellen uit een catalogus, voor de controle achteraf.
  Cloud-varianten worden geweigerd, ook als je zelf een naam invoert.

Downloaden gebeurt alleen op verzoek: HuggingFace via `snapshot_download`, Ollama via
`POST /api/pull`. Een analyse haalt nooit zelf iets van internet; ontbreekt een model, dan
werkt de engine zonder en meldt dat.

## Verantwoordelijkheidslagen

Op deze plekken wordt de gebruiker erop gewezen dat dit een hulpmiddel is, geen garantie:

1. Onboarding met een verplicht akkoordvinkje.
2. Stap 3 (Controleren): elke treffer is te accepteren of over te slaan, gemiste tekst is
   handmatig te markeren.
3. Stap 4 (Opslaan): opslaan kan pas na het vinkje "Ik blijf zelf verantwoordelijk", en een
   vervanging die niet in het bestand is beland, levert een waarschuwing op.
4. `DISCLAIMER.txt` bij elke run en een watermerk in elk document.
5. Een lokaal audit-log (`audit.jsonl`) met instellingen, aantallen en bestandsnamen, zonder
   documentinhoud.

Zie [`disclaimer-nl.md`](disclaimer-nl.md) voor de exacte teksten.

## Wat er staat

| Onderdeel | Status |
|---|---|
| PII Engine + Model Manager | Werkend, gedekt door pytest/mypy/ruff in CI |
| Electron-app met wizard-UI | Werkend, pilot v0.1.1; v0.2.0 in ontwikkeling |
| Controle achteraf via Ollama | Optioneel, aanwezig (`ollama_review.py`) |
| Extra NER en twijfelrechter via Ollama | Nog niet; staan als "binnenkort" in Modellen beheren |
| Open WebUI filter | Werkend, bevroren |

## Wat we bewust niet bouwen

Een browser-extensie met Native Messaging-host stond eerder op de planning voor
ChatGPT, Claude, Gemini en Copilot. Dat is geschrapt: een extensie is door de
eindgebruiker uit te zetten of te omzeilen (andere browser, incognito, andere
laptop) en is dus geen afdwingbare compliance-laag, terwijl hij wel per site
onderhoud vraagt zodra die zijn DOM wijzigt. Wie afdwingbaarheid nodig heeft,
gebruikt de Open WebUI-route.

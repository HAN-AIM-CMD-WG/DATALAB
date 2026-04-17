# A5 baseline — code-review + verwachte NL-gaps

> Analytische baseline op basis van source-code inspectie van de upstream A5 PII Anonymizer (commit `3e5b229`, gesquasht op 2026-04-17). Een GUI-test met Nederlandse voorbeelddocumenten kan deze bevindingen verrijken; de structurele gaps hieronder staan sowieso vast.

## Architectuur van A5 (zoals we die overnamen)

- **Stack**: Electron 34 + `@xenova/transformers` (Transformers.js), `exceljs`, `mammoth`, `docx`, `pdf-parse`, `pdf-lib`.
- **Engine**: één Transformers.js-pipeline die lokaal (ONNX, niet-quantized) het model [`protectai/lakshyakh93-deberta_finetuned_pii-onnx`](https://huggingface.co/lakshyakh93/deberta_finetuned_pii) draait vanuit `apps/electron-anonimiseer/models/protectai/`.
- **Detectiestrategie**: pure token-classification → "aggressive merge" van opeenvolgende tokens van hetzelfde type → fuzzy regex om de originele spelling in de tekst te vervangen door pseudoniem `TYPE_N`.
- **Output**: nieuw bestand naast origineel, `-anon` suffix.
- **UI**: one-page, donkere theme, drag-drop + output-folder, Pro-modaal met device-ID + `MASTERTESTKEY`.

## Codefragmenten die we behouden vs. gaan vervangen

| Onderdeel | Locatie in subtree | Wat we doen |
|---|---|---|
| Electron shell, IPC-bridge | `main.js`, `preload` | **Vervangen**: `nodeIntegration: true, contextIsolation: false` is onveilig voor onze context. We rebuilden met `contextIsolation: true` + proper preload-bridge. |
| Drag-drop + file list | `renderer.js`, `index.html` | **Hergebruiken als inspiratie**, herschrijven in React/Tailwind + shadcn binnen wizard. |
| Document parsing heen-pad | `fileProcessor.js` (mammoth, pdf-parse, ExcelJS) | **Hergebruiken**, later eventueel vervangen door Docling voor betere layout. |
| Document writing terug-pad | `fileProcessor.js` (docx Packer, pdf-lib create) | **Vervangen**: huidige aanpak vernietigt layout (zie gap 4 hieronder). We gaan over op find-and-replace in-place of layout-preserving redactie. |
| PII-detectie | `fileProcessor.js` → Transformers.js + ONNX DeBERTa | **Volledig vervangen**: calls naar onze `pii-engine` sidecar over `127.0.0.1`. Model zelf (`models/protectai/`) wordt uit de bundle verwijderd. |
| Pseudonym mapping + fuzzy regex | `fileProcessor.js` bovenkant | **Vervangen**: mapping wordt server-side in de engine bijgehouden en AES-versleuteld opgeslagen. |
| Pro/dailyCount/`MASTERTESTKEY` logica | `renderer.js` onderkant | **Verwijderen** — niet relevant voor HAN-interne tool. |

## Gap-analyse: waarom A5 out-of-the-box niet voldoet voor NL-documenten

### Gap 1 — Engels-alleen detectiemodel

`protectai/lakshyakh93-deberta_finetuned_pii-onnx` is uitsluitend op Engelse PII-datasets getraind (zie de [upstream modelcard](https://huggingface.co/lakshyakh93/deberta_finetuned_pii)). Voor Nederlandse teksten betekent dit **structureel lage recall** op:

- Nederlandse persoonsnamen, zeker met tussenvoegsels (`van den Broek`, `de Vries`, `ter Horst`).
- Nederlandse locaties (`Ede`, `Lelystad`, `Tilburg`), vooral kortere toponiemen.
- Nederlandse organisatienamen (`Hogeschool van Arnhem en Nijmegen`, `Rijkswaterstaat`).

**Oplossing (Fase 1/3)**: spaCy `nl_core_news_lg` + Wietsedv `bert-base-dutch-cased-finetuned-sonar-ner` als extra Presidio `EntityRecognizer`. De werkende baseline voor dat laatste staat al in [`docs/onderzoek/NER_sonar.py`](onderzoek/NER_sonar.py).

### Gap 2 — Geen BSN-detectie (of fout-positief)

De DeBERTa-PII-taxonomie bevat generieke `ID_CARD` maar geen land-specifieke BSN-validatie. Een willekeurig 9-cijferig getal in een rapport (onderzoeks-ID, order-nummer) wordt óf gemist óf fout-positief als ID gemarkeerd.

**Oplossing (Fase 1)**: volledige `EntityRecognizer` class met Elfproef-checksum: alleen bij valide Elfproef-sum markeren als BSN (zie `packages/pii-engine/pii_engine/recognizers/bsn.py`).

### Gap 3 — Geen NL-specifieke patronen

Geen regex/patronen voor:

- NL telefoonformaten (`06-12345678`, `+31 6 1234 5678`, `0345-123456`).
- NL postcode (`6811 AA`).
- IBAN met mod-97 validatie (Presidio heeft dit out-of-the-box wel, A5 gebruikt het niet).
- Studentnummer-patronen (HAN: 8 cijfers, andere instellingen: eigen format).

**Oplossing (Fase 1)**: `PatternRecognizer` per entiteit met NL-contextwoorden voor `score_context_improvement`.

### Gap 4 — Destructieve output (layout-verlies)

Bij DOCX: `fileProcessor.js` extraheert raw text met `mammoth`, anonimiseert, en schrijft een **nieuwe minimal docx** met één `Paragraph` terug. Alle styling, kopteksten, tabellen, afbeeldingen, voetnoten en secties zijn weg.

Bij PDF: nog drastischer — een blanke pagina met `drawText(anonymizedText, { x: 50, y: 700, size: 12 })`. Totaal geen originele layout.

**Oplossing (Fase 3)**:
- DOCX: `python-docx` run-level find-and-replace door alle paragrafen/tabellen/headers/footers heen; behoud styling.
- PDF: twee opties afhankelijk van gebruikerskeuze:
  1. "Behoud layout" → `pymupdf` redaction annotations met `page.apply_redactions()` (zwarte balken, tekst forensisch verwijderd).
  2. "Schone pseudonymisering" → rebuild via Docling structured output met placeholders.
- XLSX: `openpyxl` per-cel iteratie, net als nu, maar met formule/styling-behoud.

### Gap 5 — Fuzzy regex mist multi-token matches cross-paragraph

De `buildFuzzyRegex` strategie van A5 pakt per match één occurrence en doet `replace()`. Pseudonym-consistentie werkt wel over een document (`pseudonymMapping` is een object-scope variabele), maar niet over batches of sessies.

**Oplossing (Fase 1/3)**: consistente mapping server-side in engine, met optionele persistentie naar encrypted `mapping.enc`.

### Gap 6 — Geen verantwoordelijkheidslaag

A5 heeft geen disclaimer, geen first-run akkoord, geen controle-stap met preview, geen audit-log, geen DISCLAIMER.txt naast output.

**Oplossing (Fase 3)**: de volledige 6-laags aanpak uit [`disclaimer-nl.md`](disclaimer-nl.md).

### Gap 7 — Geen kanaal naar Open WebUI / externe providers

A5 verwerkt alleen lokale bestanden. Onze tweede use-case — PII wegstrippen voor prompts naar OpenRouter via jullie Open WebUI — ontbreekt volledig in de upstream.

**Oplossing (Fase 2)**: `nl_pii_filter.py` als Filter Function die dezelfde engine aanroept.

### Gap 8 — Security: unsafe Electron defaults

In `main.js` staat:

```javascript
webPreferences: {
  nodeIntegration: true,
  contextIsolation: false,
}
```

Dit is de omgekeerde van wat Electron zelf aanbeveelt sinds versie ~10. Malicious content in een geopend document kan in principe Node-API's aanroepen.

**Oplossing (Fase 3)**: `contextIsolation: true`, `nodeIntegration: false`, preload-script met een smalle `contextBridge`-API.

## Hoe dit het plan verder stuurt

- Fase 1 bouwt de vervangende engine (Python + Presidio + NL), die A5's interne ONNX-engine overbodig maakt.
- Fase 3 hergebruikt A5's Electron-chassis maar herschrijft vrijwel alle JavaScript/HTML voor veiligheid, layout-behoud, wizard-UI en verantwoordelijkheidslagen.
- De upstream-sync (`git subtree pull`) zal na Fase 3 in de praktijk nauwelijks nog bruikbaar zijn omdat we te ver divergeren; we houden de mogelijkheid open voor kleine bug-fixes in de eerste maanden.

## Handmatige GUI-baseline (later uit te voeren)

Wanneer je zelf A5 upstream wilt uitproberen met een NL-document:

```bash
cd anonimiseer/apps/electron-anonimiseer
npm install
npm run dev
```

Noteer per testdocument: welke NL-namen gemist zijn (`van den X`, tussenvoegsels), of BSN onterecht/terecht gemarkeerd is, hoe de output-DOCX/-PDF eruit ziet (layout-behoud). Aanvulling op deze file is welkom.

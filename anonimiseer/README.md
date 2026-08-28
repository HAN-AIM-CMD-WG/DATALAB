# Anonimiseer

> Laagdrempelige, **100% lokale** tooling om documenten (DOCX, PDF, XLSX, TXT) en chat-prompts te anonimiseren of pseudonimiseren voordat ze gedeeld worden met externe AI-diensten.

[![Latest release](https://img.shields.io/github/v/release/HAN-AIM-CMD-WG/DATALAB?include_prereleases&label=download&color=blue)](https://github.com/HAN-AIM-CMD-WG/DATALAB/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)

Status: **pilot v0.1.1** — beschikbaar als pre-release voor interne HAN-test (19 mei 2026).

---

## ⬇️ Downloaden en starten (voor gebruikers)

> Geen Python, geen Node, geen installatie van losse onderdelen nodig. Alles zit in de download.

### Stap 1 — kies de juiste installer

👉 **[Open de Releases-pagina](https://github.com/HAN-AIM-CMD-WG/DATALAB/releases/latest)** en download het bestand dat bij jouw computer past:

| Jouw computer | Bestand op de Releases-pagina | Grootte |
| --- | --- | --- |
| **Mac met Apple Silicon** (M1/M2/M3/M4) | `Anonimiseer-x.y.z-arm64.dmg` | ~840 MB |
| **Mac met Intel-CPU** (~2015–2020) | `Anonimiseer-x.y.z.dmg` | ~840 MB |
| **Windows 10/11** (64-bit) | `Anonimiseer Setup x.y.z.exe` | ~700 MB |

> **Welke Mac heb ik?** Apple-menu → *"Over deze Mac"*. Staat er "Apple M1/M2/M3/M4 …"? Dan **arm64**. Staat er "Intel Core …"? Dan de DMG zonder suffix.

### Stap 2 — installeren

- **macOS**: open de `.dmg`, sleep `Anonimiseer.app` naar **Programma's**.
- **Windows**: dubbelklik de installer, kies een map (admin niet nodig).

### Stap 3 — eerste keer openen (eenmalig)

Omdat de app nog niet is **code-signed** (Apple Developer / Microsoft EV cert) krijg je éénmalig een waarschuwing:

| OS | Waarschuwing | Wat je doet |
|---|---|---|
| macOS | *"Anonimiseer kan niet worden geopend omdat de identiteit niet kan worden gecontroleerd"* | **Rechter-muisklik (Ctrl-klik) op de app → "Openen" → bevestig in dialoog.** Daarna nooit meer. |
| Windows | *"Windows beschermt uw pc — SmartScreen"* | Klik **"Meer info" → "Toch uitvoeren"**. Daarna nooit meer. |

Dat is verwacht gedrag bij ongesigneerde apps; de app zelf is veilig en draait volledig offline. Voor brede uitrol komt code-signing later.

### Verificatie (optioneel)

Bestand controleren tegen de SHA-256 op de Releases-pagina:

- macOS: `shasum -a 256 ~/Downloads/Anonimiseer-*.dmg`
- Windows (PowerShell): `Get-FileHash Anonimiseer*.exe -Algorithm SHA256`

### Wat de app doet

1. Sleep een document in het venster (DOCX, PDF, XLSX, TXT).
2. Kies wat je wilt maskeren (namen, BSN, adressen, IBAN, etc.) en hoe streng.
3. Bekijk de gemarkeerde gevallen vóór je ze opslaat.
4. Exporteer een schone versie + (optioneel) een versleutelde mapping om later terug te draaien.

**De inhoud van je documenten verlaat je laptop nooit.** Geen account nodig, geen telemetrie, geen automatische updates.

Internet heb je alleen nodig als je zelf een taalmodel downloadt. Dat gebeurt nooit vanzelf en nooit met documentinhoud. Houd er rekening mee dat het aanbevolen SoNaR-model niet in de installer zit: de eerste keer dat je het inschakelt wordt het opgehaald (~400 MB).

> **Belangrijk:** Anonimiseer is een **hulpmiddel**, geen garantie. Geen enkele automatische PII-detectie is 100% nauwkeurig. Loop de highlights altijd na vóór je een document deelt. Onder de AVG blijft de gebruiker zelf verwerkingsverantwoordelijke. Zie [`docs/disclaimer-nl.md`](docs/disclaimer-nl.md).

---

## Voor wie

Docenten, onderzoekers en ondersteuners (HAN en daarbuiten) die willen werken met ChatGPT, Claude, OpenRouter of andere externe LLM's, zonder persoonsgegevens (namen, e-mails, BSN, adressen, studentnummers, etc.) uit handen te geven.

## Wat zit er in deze repo

Het product is de **desktop-app**. Die bestaat uit twee delen die samen worden uitgeleverd:

| Onderdeel | Locatie | Beschrijving |
|---|---|---|
| **Electron-app** | [`apps/electron-anonimiseer/`](apps/electron-anonimiseer/) | Lokale desktop-tool met wizard-flow voor leken. **Dit is wat eindgebruikers downloaden.** |
| **PII-engine** | [`packages/pii-engine/`](packages/pii-engine/) | Python-sidecar met Presidio + spaCy + SoNaR-BERT, aangevuld met ruim 30 eigen NL/EU-recognizers. Draait als lokaal proces op `127.0.0.1:8765` en wordt meegebundeld in de app. |

Daarnaast staat er materiaal in de repo dat **niet in actieve ontwikkeling** is:

| Onderdeel | Locatie | Status |
|---|---|---|
| Open WebUI filter | [`apps/openwebui-filter/`](apps/openwebui-filter/) | Werkend en getest, maar bevroren. Filter Function die PII wegstript voordat prompts naar OpenRouter gaan. Praat over HTTP met dezelfde engine. |
| A5-referentie | [`apps/electron-anonimiseer-a5-reference/`](apps/electron-anonimiseer-a5-reference/) | Archief van de upstream [A5 PII Anonymizer](https://github.com/AgenticA5/A5-PII-Anonymizer) (MIT), bewaard voor attributie. Niet gebruiken voor ontwikkeling. |
| Onderzoek | [`docs/onderzoek/`](docs/onderzoek/) | Bronmateriaal en verkenningen. |

## Voor ontwikkelaars

Vereist Python 3.11 of 3.12 (niet nieuwer — daar zijn nog geen spaCy/Presidio-wheels voor) en Node 20. Alle paden hieronder zijn relatief aan de map `anonimiseer/`.

```bash
git clone https://github.com/HAN-AIM-CMD-WG/DATALAB.git
cd DATALAB/anonimiseer

# 1. Engine in dev mode
cd packages/pii-engine
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[nl-small,dev]"           # nl-small levert het spaCy-model mee
python -m pii_engine                       # → http://127.0.0.1:8765/health

# 2. Electron app in dev mode (in een tweede terminal)
cd apps/electron-anonimiseer
npm install
npm run dev

# 3. Tests
cd packages/pii-engine
pytest -m "not slow"                       # engine; zonder -m worden modellen gedownload
cd ../../apps/electron-anonimiseer && npm test   # app (pure logica)

# 4. Regressie-scoring tegen de gouden testset (engine moet draaien)
cd packages/pii-engine
python scripts/score.py                    # recall + precision op docs/examples/
```

### Een release bouwen

Zie [`apps/electron-anonimiseer/RELEASE.md`](apps/electron-anonimiseer/RELEASE.md) voor de stap-voor-stap procedure (build, tag, release uploaden).

## Architectuur

- **Detectie-pijplijn**: recognizers (Presidio + ruim 30 eigen NL/EU) → post-filter (overlap, label-FP) → anonymizer (pseudoniem of redact). Zie [`docs/architecture.md`](docs/architecture.md).
- **Privacy**: alle verwerking lokaal; engine luistert alleen op `127.0.0.1`; geen telemetrie.
- **Modelprofielen**: Basis (alleen spaCy), Plus (+ SoNaR-BERT, aanbevolen), Max (alle recognizers).

## Licentie en attributie

De **broncode in deze repo** staat onder [MIT](../LICENSE). De Electron-app is opgezet vanaf nul, geïnspireerd op [AgenticA5/A5-PII-Anonymizer](https://github.com/AgenticA5/A5-PII-Anonymizer) (ook MIT). Zie [`apps/electron-anonimiseer-a5-reference/NOTICE.md`](apps/electron-anonimiseer-a5-reference/NOTICE.md) voor de attributie van dat werk.

> **Let op — de gedistribueerde installer is niet volledig MIT.** De PDF-ondersteuning gebruikt [PyMuPDF](https://github.com/pymupdf/PyMuPDF), dat onder AGPL-3.0 valt (of onder een commerciële Artifex-licentie). De `.dmg` en `.exe` bevatten die code en zijn daarmee AGPL-3.0-verplicht: de volledige broncode van het geheel is beschikbaar in deze repo. We onderzoeken of PyMuPDF vervangen kan worden zodat de hele distributie MIT kan zijn. Zonder PDF-ondersteuning is de tool wél volledig MIT — DOCX, XLSX, Markdown en tekst gebruiken uitsluitend MIT-componenten.

## Vragen of issues?

- **Bug of feature-verzoek**: open een [Issue](https://github.com/HAN-AIM-CMD-WG/DATALAB/issues/new) met label `anonimiseer`.
- **HAN-medewerker met privacy-vraag**: contacteer DataLab via de gebruikelijke kanalen.

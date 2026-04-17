# Pilot-quickstart — zelf testen via Open WebUI

Deze gids beschrijft hoe je **vandaag nog** de PII-filter kan uittesten in een
Open WebUI. Je hebt geen Electron-app nodig; de UI die je gebruikt is gewoon de
Open WebUI die je al kent.

Er zijn drie paden, in volgorde van snelheid:

- **Scenario 0 — Ingebouwde playground** (30 seconden, geen Docker, geen Open
  WebUI; alleen de engine en je browser). Beste manier om in één oogopslag te
  zien wat er gedetecteerd wordt en of de kwaliteit voldoet.
- **Scenario A — Lokaal op je Mac** (~10 min, volledig geïsoleerd; test de
  complete Open WebUI-flow inclusief filter en disclaimer).
- **Scenario B — Op de SRC-workspace** (~20-30 min, pilot met collega's op de
  bestaande Open WebUI-omgeving).

Begin met **Scenario 0**. Overtuigt de detectie? Door naar A. Werkt A? Door
naar B.

> Laat tijdens het testen de echte productie-Open WebUI met rust. We testen in
> een eigen sandbox tot de pilot klaar is.

---

## Scenario A — Lokale sandbox op je Mac

### A1. Zorg dat de PII-engine draait

Start de engine **op alle interfaces** (`0.0.0.0`) — dit is noodzakelijk zodat
de Open WebUI-container hem via `host.docker.internal` kan bereiken. Luister
je alleen op `127.0.0.1`, dan ziet Docker hem niet.

```bash
cd /Users/wouter/Desktop/CURSOR/DATALAB/REPO/anonimiseer/packages/pii-engine
source .venv/bin/activate
PII_ENGINE_HOST=0.0.0.0 \
PII_ENGINE_SPACY_MODEL=nl_core_news_lg \
PII_ENGINE_ENABLE_BSN=true \
pii-engine
```

> Alle env-vars voor de engine beginnen met `PII_ENGINE_`. Zie
> `packages/pii-engine/README.md` voor het volledige overzicht.

Check vanaf een tweede terminal:

```bash
curl http://127.0.0.1:8765/health
# {"status":"ok","version":"0.1.0","recognizers":14,"spacy_model":"nl_core_news_lg"}

lsof -iTCP:8765 -sTCP:LISTEN
# moet `*:8765` (of `*:ultraseek-http`) tonen — NIET enkel `localhost:8765`
```

> Op je eigen Mac is `0.0.0.0` veilig: macOS-firewall blokkeert inkomend verkeer
> van buiten default, en de engine accepteert alleen POST/GET zonder
> authenticatie (dus ook niet publiekelijk open zetten op een server — voor de
> SRC-deploy in Scenario B binden we juist op `127.0.0.1`).

### A2. Start een lokale Open WebUI in Docker

```bash
docker run -d \
  --name anonimiseer-owui-sandbox \
  -p 3000:8080 \
  -v owui-sandbox-data:/app/backend/data \
  -e WEBUI_AUTH=true \
  ghcr.io/open-webui/open-webui:main
```

Open http://localhost:3000 en maak een admin-account aan (de eerste gebruiker
wordt automatisch admin — dit is een lokale sandbox, dus geen zorgen).

### A3. Upload de filter-functie

1. In Open WebUI → **Admin Panel → Functions → `+`**.
2. Kies **Import from file** en upload:
   `anonimiseer/apps/openwebui-filter/nl_pii_filter.py`
3. Na import verschijnt hij als **NL PII Anonimiseer (Presidio)**.
4. Klik op **Enable** (schakelaar rechtsboven).
5. Klik op **⚙️ (Valves)** en zet:
   - `pii_engine_url` → `http://host.docker.internal:8765`
     (dat is hoe de Docker-container jouw Mac bereikt)
   - Laat `mode: pseudonymize`, `fail_closed: true` staan.
6. Save.

### A4. Koppel de filter aan een model

De filter werkt alleen op modellen waar je hem expliciet aan hangt:

1. **Workspace → Models** → kies een model (of maak er een).
2. Scroll naar **Filters** → vink **NL PII Anonimiseer** aan → Save.

Voor de sandbox heb je geen Ollama nodig — je kunt gratis een OpenRouter-key
invoeren onder **Admin Panel → Settings → Connections** en daar modellen
toevoegen. Of zet snel een tijdelijke `glm4:9b` of `qwen3:14b` via Ollama
(zie `openwebui-src/beheer-setup.md`).

### A5. Test-prompts

Plak deze exact in een nieuwe chat en kijk wat er gebeurt:

**Prompt 1 — losse PII-items:**

```
Beste Jan de Vries, uw BSN 111222333 is gekoppeld aan uw dossier.
U kunt bellen naar 06-12345678 of mailen naar j.devries@example.nl.
Uw adres is Dorpsstraat 12, 6811 AA Arnhem. Studentnummer S1234567.
Vat dit bericht beknopt samen in één zin.
```

**Prompt 2 — casus-tekst (vervolg in dezelfde chat):**

```
Stel een kort feedbackbericht op voor Jan de Vries over zijn portfolio.
Noem zijn studentnummer en mailadres in de aanhef.
```

### A6. Wat je moet zien

- Boven de eerste assistent-reply verschijnt een **systeembanner**
  ("Alle invoer is automatisch geanonimiseerd…" — volledige tekst zie je in
  `docs/disclaimer-nl.md`).
- Het model antwoordt met de **pseudoniem-tokens**: `PERSON_1`, `NL_BSN_1`,
  `EMAIL_ADDRESS_1`, etc. Het heeft de echte BSN, naam of mail **nooit gezien**.
- In de tweede prompt blijft `Jan de Vries = PERSON_1` consistent (per-chat
  mapping).
- Zet je valve `deanonymize_in_outlet: true`, dan rehydrateert de outlet de
  antwoord-tekst terug naar de originele tokens in jouw UI — maar de LLM zag
  die originele waarden nog steeds niet.

### A7. Verifieer "fail-closed"

Doe één simpele sanity check:

```bash
pkill -f pii-engine     # of: kill <pid>
```

Stuur dan een prompt met "BSN 111222333". Je hoort een nette foutmelding in de
chat ("PII-filter onbereikbaar. Bericht geblokkeerd om datalek te voorkomen.")
in plaats van een antwoord. Dat is het gewenste gedrag: **liever blokkeren dan
lekken**. Start de engine weer en alles werkt direct door.

### A8. Opruimen

```bash
docker rm -f anonimiseer-owui-sandbox
docker volume rm owui-sandbox-data
```

De productie Open WebUI is nooit aangeraakt.

---

## Scenario B — Pilot op de SRC-workspace

Pas doen als Scenario A naar tevredenheid werkt. We zetten hier de pii-engine
naast de bestaande Open WebUI op de SURF-workspace.

### B1. PII-engine deployen op SRC

Op de workspace (via SSH, zie `openwebui-src/beheer-setup.md`):

```bash
# Eenmalig: clone de anonimiseer-repo
git clone <repo-url> ~/anonimiseer
cd ~/anonimiseer/packages/pii-engine

# Bouw als Docker image (aanbevolen — isoleert Python-deps)
docker build -t pii-engine:0.1.0 .

# Draai naast de bestaande Open WebUI
docker run -d --name pii-engine \
  --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -e PII_ENGINE_HOST=0.0.0.0 \
  -e PII_ENGINE_SPACY_MODEL=nl_core_news_lg \
  -e PII_ENGINE_ALLOW_BLANK_NLP_FALLBACK=false \
  pii-engine:0.1.0

# Sanity check
curl http://127.0.0.1:8765/health
```

> De engine luistert **alleen op localhost** van de workspace. Het is geen
> publiek endpoint. Als de Open WebUI zelf in Docker draait met een eigen
> netwerk, gebruik dan `--network=<owui-netwerk>` of zet `-p 8765:8765`.

### B2. Filter uploaden

Zelfde stappen als A3/A4, maar nu in de productie-Open WebUI:

- `pii_engine_url` → `http://127.0.0.1:8765` (Open WebUI en engine op dezelfde
  host), of `http://<host.docker.internal>:8765` als Open WebUI in Docker op
  die host draait.
- Koppel de filter eerst aan **één testmodel**, niet aan je productiemodellen.
  Maak bijvoorbeeld een kloon **Assistent (PII-pilot)** die identiek is aan je
  standaard assistent maar met filter aan en **Access: Private** voor de
  pilotgroep.

### B3. Pilot-groep

- Nodig 3-5 collega's uit via SRAM-collaboratie.
- Geef ze `docs/disclaimer-nl.md` vooraf te lezen.
- Verzamel 2 weken feedback: welke PII wordt gemist? welke false positives?
  welke flow voelt onlogisch?

### B4. Monitoring

```bash
# Laatste log-lines van de engine
docker logs --tail 100 pii-engine

# Cijfers
curl -s http://127.0.0.1:8765/health | python3 -m json.tool
```

---

## Bekende limieten in deze MVP

Wees eerlijk met testgebruikers over wat deze versie nog niet goed doet. De
**full write-up** staat in `docs/a5-baseline.md`. Kort samengevat:

- **Dutch NER leunt op spaCy `nl_core_news_lg`.** Goed voor duidelijk
  herkenbare namen en locaties, maar:
  - Zelden voorkomende achternamen, bijnamen en afkortingen worden soms gemist.
  - "Mijn BSN" kan heel incidenteel als PERSON getagd worden (score meestal <
    threshold, dus gefilterd, maar niet altijd).
  - Fase 1B vervangt dit met een SoNaR-BERT recognizer voor hogere recall.
- **Geen document-upload in deze filter.** Dit filter werkt op chat-tekst. Voor
  DOCX/PDF anonimiseren komt de Electron-app in Fase 3.
- **Pseudonym-mapping is per chat, niet per gebruiker.** Verstuur je dezelfde
  klant in twee chats, dan krijgt ze twee verschillende `PERSON_1`. Dat is
  bewust: minder kans op lekken via mapping-herkenning.
- **Assistent-output wordt standaard niet gefilterd.** Als het model zelf PII
  zou verzinnen of rehydrateren uit eerdere chats, zie je dat. Zet eventueel
  `deanonymize_in_outlet: false` + een eigen outlet-check indien gewenst.

## Als iets niet werkt

| Symptoom | Waarschijnlijke oorzaak | Check |
|---|---|---|
| `PII-filter onbereikbaar` in chat | Engine staat uit, luistert niet op `0.0.0.0`, of valve-URL klopt niet | Check `lsof -iTCP:8765 -sTCP:LISTEN` (moet `*:8765` tonen) + valve moet `http://host.docker.internal:8765` zijn |
| Banner verschijnt niet | Filter niet gekoppeld aan dit model | Workspace → Models → jouw model → Filters |
| BSN blijft staan | Nummer faalt Elfproef (geen geldige BSN) | Controleer of het een echte 8- of 9-cijferige BSN is |
| Naam blijft staan | spaCy herkent hem niet als PERSON | Noteer voorbeeld voor Fase 1B-training |
| `text: Field required` bij curl | Payload-schema verkeerd | Gebruik `{"text": "...", "mode": "...", ...}` (geen `items`-array) |

## Rapporteer je bevindingen

Open issues op de repo, of deel ze via het gebruikelijke feedback-kanaal. Ik
neem ze mee naar Fase 1B (betere NER) en Fase 3 (Electron-app).

# `openwebui-filter` — Nederlandse PII-filter voor Open WebUI

> Open WebUI Filter Function die Nederlandse PII (BSN, telefoon, postcode,
> studentnummer, persoonsnamen, e-mail, IBAN, ...) uit prompts strip voordat
> ze naar een externe LLM-provider zoals **OpenRouter** gaan. Houdt een
> stabiele mapping per chat bij zodat `Jan` in turn 3 hetzelfde pseudoniem
> krijgt als in turn 1. Fail-closed: als de [`pii-engine`](../../packages/pii-engine/)
> onbereikbaar is, wordt het bericht niet doorgestuurd.

## Architectuur

```
   Gebruiker -> Open WebUI (inlet)
                     |
                     v
              nl_pii_filter   --HTTP-->   pii-engine (:8765)
                     |                        |
                     v                        v
              body['messages'] aangepast:  Presidio + NL-NLP
              PII vervangen door pseudoniemen
                     |
                     v
              Open WebUI -> OpenRouter / OpenAI / Anthropic / ...
                     |
                     v
              (outlet: standaard pseudoniemen laten staan;
               optioneel: terug-mappen voor weergave)
```

## Installeren in Open WebUI (admin-paneel)

> Open WebUI Filter Functions worden als losse Python-bestanden beheerd via
> **Admin Panel → Functions → Add Function**.

1. Kopieer de volledige inhoud van [`nl_pii_filter.py`](nl_pii_filter.py).
2. In Open WebUI: **Admin → Functions → `+` Add Function**, plak de code.
3. Klik **Save**. Open WebUI installeert automatisch de `httpx`-dependency
   (die staat in de `requirements:`-regel van de docstring-header).
4. Activeer de filter door op het toggle-schuifje naast de naam te klikken.
5. Open de filter-instellingen (tandwiel) en vul minimaal in:
   - `pii_engine_url`: URL van de pii-engine (bv. `http://pii-engine:8765`
     binnen Docker, of `http://host.docker.internal:8765` vanaf Open WebUI
     in Docker naar een host-local engine).
6. Ga naar **Models → (kies model) → Filters** en vink "Nederlandse
   PII-filter" aan voor de modellen waarop je het wil toepassen (typisch
   alleen je externe OpenRouter-modellen).

## Valves (instellingen)

| Valve | Default | Beschrijving |
|---|---|---|
| `pii_engine_url` | `http://pii-engine:8765` | Basis-URL van de engine. |
| `mode` | `pseudonymize` | `pseudonymize` of `redact`. |
| `entities` | `[NL_BSN, NL_PHONE_NUMBER, NL_POSTCODE, NL_STUDENT_ID, PERSON, LOCATION, EMAIL_ADDRESS, IBAN_CODE, CREDIT_CARD, IP_ADDRESS, URL]` | Welke types worden gefilterd. |
| `score_threshold` | `0.35` | Minimale confidence. Zet hoger om false-positives te beperken. |
| `request_timeout_s` | `15.0` | HTTP-timeout naar engine. |
| `show_disclaimer_banner` | `true` | Injecteer eenmalig een system-bericht per chat. |
| `disclaimer_text` | "Let op: de berichten in deze chat ..." | Volledige waarschuwingstekst. |
| `deanonymize_in_outlet` | `false` | **GEVAARLIJK**: laat pseudoniemen in de reply staan of vertaal ze terug. Laat aan tenzij je weet wat je doet. |
| `fail_closed` | `true` | Bij engine-storing: `true` blokkeert het bericht, `false` stuurt ongefilterd door. |
| `priority` | `0` | Filter-volgorde (lager = eerder, t.o.v. andere filters). |

## Veiligheidsmodel & beperkingen

**Wat deze filter WEL doet:**

- Vervangt gedetecteerde PII in het user-bericht door pseudoniemen voordat
  het bericht de localhost verlaat.
- Injecteert eenmalig per chat een system-bericht met disclaimer en
  verantwoordelijkheidsclausule (te configureren).
- Weigert berichten door te sturen als de engine onbereikbaar is
  (`fail_closed=true`).

**Wat deze filter NIET doet:**

- **Geen 100% garantie.** Moderne NER mist altijd dingen — vooral zeldzame
  namen, typo's, schrijffouten of creatieve obfuscation. Gebruikers moeten
  hun input zelf blijven controleren.
- **Geen bescherming voor bijlagen.** Filters werken op `body.messages`.
  Als Open WebUI RAG-bijlagen of afbeeldingen naar de LLM stuurt, worden
  die niet aangeraakt.
- **Geen cross-proces mapping-persistentie.** De per-chat-mapping leeft in
  het Open WebUI-proces en overleeft een herstart niet. In multi-worker
  deployments kan dezelfde chat door verschillende workers worden bediend,
  waardoor `Jan` in turn 3 een ander pseudoniem krijgt dan in turn 1.
  Geschikt voor MVP; voor productie is Redis-persistentie gepland.
- **Geen bescherming tegen de aanbieder.** De pseudoniemen gaan alsnog naar
  OpenRouter/OpenAI/... in plaintext — we beschermen wel identiteit, niet
  *inhoud*.

## Lokaal testen (zonder Open WebUI)

```bash
cd anonimiseer/apps/openwebui-filter
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest                    # unit-tests met gemockte engine
```

Integratietest tegen een draaiende `pii-engine` (in andere shell):

```bash
# Shell 1: start engine
cd anonimiseer/packages/pii-engine
source .venv/bin/activate
PII_ENGINE_SPACY_MODEL=nl_core_news_sm pii-engine

# Shell 2: roep het filter rechtstreeks aan
cd anonimiseer/apps/openwebui-filter
source .venv/bin/activate
python -c "
import sys; sys.path.insert(0, '.')
import nl_pii_filter
flt = nl_pii_filter.Filter()
flt.valves.pii_engine_url = 'http://127.0.0.1:8765'
body = {'chat_id': 'test', 'messages': [
    {'role': 'user', 'content': 'Mijn BSN is 123456782.'}
]}
import json; print(json.dumps(flt.inlet(body), indent=2, ensure_ascii=False))
"
```

## Docker-deployment

Zie [`docker-compose.example.yml`](docker-compose.example.yml) in deze map
voor een volledige stack met Open WebUI, pii-engine en een reverse proxy.

```bash
cd anonimiseer/apps/openwebui-filter
docker compose -f docker-compose.example.yml up -d
# Open webUI op http://localhost:3000
```

## Integratie met bestaande Open WebUI-installatie

Als je al Open WebUI draait, hoef je alleen de **pii-engine** ernaast te
zetten op hetzelfde netwerk. Binnen Docker:

```yaml
services:
  pii-engine:
    image: pii-engine:0.1.0
    container_name: pii-engine
    restart: unless-stopped
    expose:
      - "8765"
    networks:
      - openwebui-net

  open-webui:
    # ... jullie bestaande config
    networks:
      - openwebui-net

networks:
  openwebui-net:
    external: true
```

Dan in de Valve: `pii_engine_url = http://pii-engine:8765`.

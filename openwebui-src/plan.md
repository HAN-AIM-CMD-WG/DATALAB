# Plan: Private LLM Omgeving voor HAN Docenten op SURF ResearchCloud

## Context

HAN wil een veilige, private LLM-omgeving opzetten voor 5-20 docenten die willen experimenteren met (geanonimiseerde) studentdata. De use cases zijn primair tekstanalyse (samenvatten, classificeren) en tekstgeneratie (feedback, toetsvragen), later mogelijk ook code-assistentie. Er is al toegang tot SURF ResearchCloud (SRC). We gebruiken de UU Open WebUI repo als referentie/basis.

---

## Antwoorden op je vragen

### 1. Kan ik de UU repo als basis gebruiken?

**Ja, absoluut.** De UU repo (`src-component-openwebui`) is geen UU-specifieke customization maar een generieke Ansible deployment voor SRC. De repo:
- Installeert Ollama + Open WebUI via Ansible playbooks
- Configureert Nginx reverse proxy met SRAM-authenticatie (werkt voor alle NL instellingen)
- Is modulair opgezet met configureerbare variabelen
- Is GPL-3.0 gelicenseerd

**Wat je moet aanpassen:**
- `ollama_serve_model` → je gewenste modellen instellen
- `workspace_fqdn` → je eigen SRC workspace domein
- Eventueel `expose_api` → of je de Ollama API wilt exposen

**Wat je NIET hoeft te herbouwen:** authenticatie, reverse proxy, service management — dat zit er allemaal al in.

### 2. De `uusrc.general` rollen — relevant voor HAN?

**Ja, zeer relevant.** Dit is geen UU-only tooling. Het is een Ansible collection met 59 herbruikbare rollen voor SRC, waaronder:
- `nginx_reverse_proxy` — HTTPS + SRAM auth (wordt direct gebruikt door de OpenWebUI component)
- `fact_workspace_info` — workspace metadata
- `security_updates` — automatische security patches
- `robotuser` / `transferuser` — voor geautomatiseerde toegang

De collection is GPL-3.0 en institutie-agnostisch. HAN kan dit gewoon als dependency gebruiken via `requirements.yml`:
```yaml
collections:
  - name: uusrc.general
    type: git
    source: https://github.com/UtrechtUniversity/researchcloud-items.git
    version: v2.3.0  # Pin op een specifieke release-tag voor reproduceerbaarheid
```

### 3. Welke modellen? (onderzoek maart 2026)

**Aanpak: 1 groot model tegelijk + 1 klein embedding model (CPU) voor RAG.**
Ollama wisselt automatisch — selecteer een ander model in Open WebUI en het vorige wordt unloaded.

#### Modelonderzoek: alle kandidaten op een rij

We hebben de volledige Ollama library (https://ollama.com/search) doorlopen. Dit zijn de modellen die passen op een A10 (24 GB VRAM) en relevant zijn voor jullie use case (RAG, Nederlands, onderwijs, nakijken, toetsen):

| Model | Params | VRAM (Q4) | Context | NL support | Pulls | Sterkte |
|-------|--------|-----------|---------|-----------|-------|---------|
| **Qwen3.5:27B** | 27B | ~17 GB | 256K | 201 talen ✓ | 3.1M | Nieuwst, allround best, multimodal |
| **GLM-4.7-Flash** | 30B MoE | ~19 GB | 198K | Meertalig (26+ talen) | 861K | **1.3% hallucinatie bij RAG**, sterk gestructureerde output |
| **Qwen3:30B** | 30B MoE | ~16 GB | 256K | 100+ talen ✓ | 24.8M | Bewezen stabiel, enorme community |
| **DeepSeek-R1:14B** | 14B | ~9 GB | 128K | Matig | 80.8M | Top redeneren (93.9% MATH-500) |
| **Gemma3:27B** | 27B | ~17 GB | 128K | 140+ talen ✓ | 34.1M | Google, multimodal, efficiënt |
| **Mistral-Small:24B** | 24B | ~14 GB | 32K | NL bevestigd ✓ | 2.6M | Gestructureerde output, JSON, function calling |
| **Cogito:14B** | 14B | ~9 GB | 128K | 30+ talen | 1.7M | Extended thinking, redeneren |
| **Fietje-2B** | 2.7B | ~3.8 GB | 32K | Beste NL ✓✓ | Klein | Verslaat 7B modellen op NL benchmarks |

**Niet geschikt:** Phi-4 (te Engels-georiënteerd), Llama 3.3 (alleen 70B op Ollama), Devstral (code-only).

#### Nederlandse taal benchmarks

Op basis van de Open Dutch LLM Leaderboard en ScandEval:
- **Fietje-2B** presteert het best per parameter op Nederlands (getraind op 28B NL tokens)
- **Qwen-familie** scoort het hoogst op multilingual MMLU inclusief Nederlands
- **DeepSeek-R1** is minder geoptimaliseerd voor NL maar compenseert met redeneervermogen
- **GLM-4.7-Flash** heeft geen specifieke NL benchmarks maar de lage hallucinatiegraad maakt het aantrekkelijk voor onderwijs

#### Aanbeveling: wissel per taak

| Taak | Model | Waarom |
|------|-------|--------|
| **Dagelijks** (RAG, vragen, materiaal maken) | **Qwen3.5:27B** | Allround best, 256K context, multimodal |
| **Nakijken/beoordelen** (rubric-based) | **GLM-4.7-Flash** | Laagste hallucinatiegraad (1.3%), sterke Markdown output |
| **Diep redeneren/analyseren** | **DeepSeek-R1:14B** | Sterkste logisch redeneren, snel (slechts 9 GB) |
| **Snel NL-specifiek** (korte taken) | **Fietje-2B** | Snelst, beste NL, kan naast groot model draaien |

**Start met Qwen3.5:27B.** Test daarna GLM-4.7-Flash voor nakijktaken — de 1.3% hallucinatiegraad is bijzonder relevant als je studentwerk beoordeelt.

#### Embedding model (voor RAG — draait op CPU)

| Model | Dims | Draait op | Ollama |
|-------|------|-----------|--------|
| **Nomic Embed Text v2** (aanbevolen) | 768 | CPU | `nomic-embed-text` |
| **Qwen3 Embedding** (alternatief) | — | CPU | Beschikbaar via Ollama |

Draait prima op CPU: embedding is eenmalig (bij upload), het model is klein (~270M params), en een query embedden duurt milliseconden.

#### Image generation (optioneel)

Qwen3.5 is **multimodal/vision** — het kan afbeeldingen analyseren (foto's van toetsen, grafieken, diagrammen). Voor het **genereren** van afbeeldingen heb je een apart model nodig.

Open WebUI ondersteunt image gen via ComfyUI of AUTOMATIC1111:

| Image gen model | VRAM | Kwaliteit | Ollama |
|-----------------|------|-----------|--------|
| **FLUX.2 Klein 4B** | ~6-8 GB | Goed, snel | `flux.2-klein` (experimenteel) |
| **SDXL** | ~8 GB | Zeer goed, groot ecosystem | Via ComfyUI |
| **SD 3.5 Large** | ~10 GB | Beste tekst-in-beeld | Via ComfyUI |

**Let op VRAM:** Qwen3.5:27B (~17 GB) + image gen model (~8 GB) = 25 GB → past niet tegelijk op A10 (24 GB). Oplossingen:
1. **Sequentieel wisselen** (aanbevolen): Ollama/ComfyUI unloadt het LLM, genereert beeld, herlaadt LLM. ~5-10 sec extra per wissel.
2. **Kleiner LLM:** Gebruik Qwen3.5:9B (~6.6 GB) + FLUX.2 Klein (~8 GB) = ~14 GB → past wél concurrent. Maar lagere LLM-kwaliteit.
3. **Geen image gen nodig?** Dan hoef je hier niets mee — Qwen3.5:27B is prima standalone.

**Configuratie:** Admin Panel → Settings → Images → ComfyUI engine selecteren, base URL instellen.

#### VRAM budget op A10 (24 GB)

```
Optie A: Alleen LLM (aanbevolen start)
  Qwen3.5:27B (GPU):  ~17 GB
  Embedding (CPU):      0 GB
  OS + overhead:       ~ 2 GB
  Vrij:                ~ 5 GB  ✓

Optie B: LLM + image gen (sequentieel wisselen)
  Qwen3.5:27B OF FLUX.2 Klein — nooit tegelijk
  Werkt automatisch via Ollama/ComfyUI memory management

Optie C: Klein LLM + image gen (concurrent)
  Qwen3.5:9B (GPU):   ~ 6.6 GB
  FLUX.2 Klein (GPU):  ~ 8 GB
  Embedding (CPU):      0 GB
  OS + overhead:       ~ 2 GB
  Vrij:                ~ 7.4 GB  ✓
```

### 3b. RAG voor onderwijs

Open WebUI heeft ingebouwde RAG-support:

**Wat kan het?**
- **Knowledge Bases aanmaken** per vak/cursus — upload PDF, DOCX, PPTX, Excel
- **Hybrid search**: BM25 full-text + semantische vector search + CrossEncoder re-ranking
- **Citaties**: laat zien uit welk document het antwoord komt
- **#-referentie**: docenten typen `#Cursus-AI` in hun prompt om die knowledge base te gebruiken
- **256K context window** (bij Qwen3.5): hele documenten passen in 1 prompt

**Use cases voor jullie:**

| Use case | Hoe met RAG |
|----------|-------------|
| **Toetsvragen genereren** | Upload lesmateriaal → vraag "Genereer 10 meerkeuzevragen over hoofdstuk 3" |
| **Nakijken** | Upload rubric + studentantwoorden → vraag "Beoordeel dit antwoord volgens de rubric" |
| **Onderwijsmateriaal maken** | Upload bronmateriaal → vraag "Maak een samenvatting voor 2e-jaars studenten" |
| **Feedback genereren** | Upload beoordelingscriteria → vraag "Geef formatieve feedback op dit werkstuk" |

**Configuratie in Open WebUI:**
1. Admin Panel → Settings → Documents → Embedding model instellen op `nomic-embed-text`
2. Workspace → Knowledge → nieuwe Knowledge Base aanmaken per vak
3. Documenten uploaden (PDF, DOCX, etc.)
4. In chat: `#KennisBase-naam` om te verwijzen naar specifiek materiaal

**Model-evaluatieprotocol:** Stel een standaard testset samen van ~20 Nederlandse onderwijscases (samenvatten, feedback genereren, toetsvragen). Beoordeel het model op:
- Kwaliteit antwoorden (1-5 schaal)
- Hallucinatiegraad (feitelijke correctheid)
- Toon en geschiktheid voor onderwijscontext
- Privacy-compliance (lekt het model geen trainingsdata?)

Een nieuw model mag pas breed beschikbaar worden gesteld als het ≥3.5 scoort op de scorekaart.

### 4. Welke server capaciteit?

**Aanbevolen SRC configuratie voor 5-20 gebruikers met mix van 7B modellen:**

| Resource | Minimum | Aanbevolen |
|----------|---------|------------|
| **GPU** | 1x A10 (24 GB VRAM) | 1x A10 (24 GB VRAM) |
| **CPU** | 8 cores | 11+ cores (standaard bij A10 flavor) |
| **RAM** | 32 GB | 88 GB (standaard bij A10 flavor) |
| **Disk** | 50 GB | 100 GB+ (modellen ~5 GB per stuk) |

**Waarom A10?**
- 24 GB VRAM = ruim genoeg voor meerdere 7B modellen tegelijk
- Beschikbaar op SRC (HPC Cloud, Azure, Oracle)
- Goede prijs/kwaliteit verhouding
- Als je later 70B modellen wilt: upgrade naar A100 (80 GB)

**Let op:** Ollama laadt modellen on-demand in VRAM. Met 24 GB kun je ~3-4 Q4-gekwantiseerde 7B modellen tegelijk serveren.

**Kostenbewaking:**
- Stel een maandbudget vast voor GPU-uren en opslag
- Configureer alerting in SRC als verbruik >80% budget bereikt
- Plan na 3 maanden pilot een beslismoment: "Blijft A10 voldoende?" Meetcriteria: gemiddelde responstijd bij piekbelasting, wachtrij-diepte, gebruikerstevredenheid

### 5. Anonimisatie (twee lagen)

#### Laag 1: DEDUCE — automatisch vangnet (rule-based)
**DEDUCE als standaard pipeline filter in Open WebUI:**
- Speciaal gebouwd voor Nederlandse teksten
- Herkent: namen, BSN, adressen, postcodes, telefoonnummers, datums, e-mail, etc.
- `pip install deduce`
- Draait als verplichte pre-processing stap — scant elke input vóórdat het naar het LLM gaat
- Output: waarschuwing + automatische vervanging (`Jan de Vries` → `[PERSOON-1]`, `123456789` → `[BSN-1]`)
- Betrouwbaar en voorspelbaar (geen hallucinaties, deterministisch)

**Aanvullend:** Presidio (Microsoft) + spaCy Nederlands NER model (`nl_core_news_lg`) als extra laag voor entiteiten die DEDUCE mist.

**Integratie:** Implementeer als Open WebUI pipeline/filter die standaard actief is. Alleen geautoriseerde beheerders kunnen de anonimisatielaag bypassen. Docenten zien een waarschuwing als potentieel herleidbare gegevens worden gedetecteerd.

#### Laag 2: LLM-gebaseerde anonimisatie (voor bulk/documenten)
Docenten kunnen het LLM model ook direct gebruiken om documenten te anonimiseren:
- Upload document via RAG of plak tekst in de chat
- Prompt: *"Anonimiseer alle persoonsgegevens in deze tekst. Vervang namen door [PERSOON-1], adressen door [ADRES-1], studentnummers door [STUDENTNR-1], etc. Behoud de rest van de tekst ongewijzigd."*
- Qwen3-14B is hier goed in en begrijpt context (bijv. dat "Van den Berg" een naam is, niet een locatie)
- **Niet 100% waterdicht** — altijd menselijk controleren, daarom als aanvulling op DEDUCE, niet als vervanging

#### Anonimisatie-flow voor docenten
```
Ruwe data → DEDUCE filter (automatisch) → LLM check (optioneel) → Docent review → Gebruik in RAG/chat
```

**Praktisch voorbeeld:**
1. Docent wil 30 studentverslagen analyseren op kwaliteit
2. Upload verslagen → DEDUCE vervangt automatisch namen/nummers
3. Optioneel: vraag LLM om resterende PII te detecteren
4. Docent controleert steekproef
5. Geanonimiseerde verslagen → Knowledge Base → "Geef feedback per verslag volgens deze rubric"

---

## Randvoorwaarden & Governance

### Data-classificatie & gebruiksbeleid
- **Wel toegestaan:** geanonimiseerde data, synthetische data, openbare onderwijsmaterialen, eigen teksten
- **Niet toegestaan:** ruwe persoonsgegevens (namen, studentnummers, BSN, contactgegevens), medische gegevens, bijzondere persoonsgegevens (AVG art. 9)
- **Verantwoordelijkheid docent:** data moet vóór invoer geanonimiseerd zijn; de anonimisatiefilter is een vangnet, geen vervanging van eigen beoordeling
- **Output disclaimer:** LLM-output altijd menselijk controleren — nooit ongecontroleerd overnemen voor beoordelingen of communicatie met studenten

### DPIA (Data Protection Impact Assessment)
- Voer vóór de pilot een lichte DPIA uit (of check met de HAN FG/privacy officer of een volledige DPIA nodig is)
- Documenteer: welke data wordt verwerkt, waar wordt het opgeslagen, wie heeft toegang, wat zijn de risico's
- SRC-infrastructuur staat in Nederland (SURF), wat helpt voor AVG-compliance

### Eigenaarschap & rollen
| Rol | Verantwoordelijkheid |
|-----|---------------------|
| **Functioneel beheerder** | Gebruikersbeheer, model-selectie, usage policy handhaving |
| **Technisch beheerder** | SRC workspace, updates, monitoring, backups |
| **Security contact** | Incidentafhandeling, DPIA, privacy officer afstemming |
| **Pilotcoördinator** | Feedback verzamelen, go/no-go beslissingen per fase |

### Bewaartermijnen
- **Chatgeschiedenis:** standaard UIT (geen opslag van prompts/outputs), tenzij docent dit expliciet aanzet voor eigen sessies
- **Audit logs:** alleen metadata (wie, wanneer, welk model) — bewaren voor max 6 maanden
- **Model-artefacten:** geen fine-tuning op studentdata, dus geen afgeleide modellen om te bewaren

### Gebruikersinstructie voor docenten
Stel een korte (1 A4) usage policy op:
1. Geen ruwe persoonsgegevens invoeren — altijd eerst anonimiseren
2. LLM-output altijd menselijk controleren vóór gebruik
3. Niet gebruiken voor formele beoordelingsbeslissingen zonder menselijke review
4. Bij twijfel over data-classificatie: vraag de functioneel beheerder
5. Meld onverwacht gedrag (hallucinaties, ongepaste output) aan de pilotcoördinator

---

## Risico's & mitigerende maatregelen

| Risico | Impact | Mitigatie |
|--------|--------|-----------|
| **Hallucinaties** in feedback/toetsvragen | Onjuiste beoordeling studenten | Usage policy: output altijd menselijk reviewen. Model-evaluatieprotocol. |
| **Onbedoelde invoer herleidbare data** | Privacy-schending (AVG) | DEDUCE als default-on filter + waarschuwing bij detectie. Training docenten. |
| **GPU-node uitval** | Dienst onbeschikbaar | Herstartscript + monitoring. Communiceer verwachte hersteltijd (SLA SRC). Geen mission-critical afhankelijkheid. |
| **Single point of failure beheerder** | Geen support bij problemen | Minimaal 2 personen met technisch beheer-kennis. Documentatie in repo. |
| **Model-update breekt kwaliteit** | Onverwacht slechtere output | Pin modelversies. Nieuwe versies pas na evaluatieprotocol. |
| **Performance bij piekbelasting** | Lange wachttijden | Monitor responstijd. Max concurrent users instellen in Open WebUI. Schaal op als nodig. |
| **Kosten lopen op** | Budgetoverschrijding | Maandbudget + alerting. Workspace uitzetten buiten kantooruren als besparingsmaatregel. |

---

## Security-hardening checklist

- [ ] **OS hardening:** Gebruik SRC's standaard Ubuntu image + `uusrc.general.security_updates` rol
- [ ] **Firewall/IP-allowlist:** Beperk toegang tot HAN IP-ranges of gebruik SRAM-auth als poort
- [ ] **SSH:** Key-only authenticatie, geen wachtwoord-login
- [ ] **Fail2ban:** Installeren en configureren voor SSH brute-force bescherming
- [ ] **Secrets management:** Geen secrets in de Git repo — gebruik SRC component parameters of environment variables
- [ ] **HTTPS:** Altijd via Nginx reverse proxy (standaard in de UU repo)
- [ ] **Open WebUI admin:** Beperk admin-rechten tot functioneel/technisch beheerders
- [ ] **API exposure:** `expose_api: false` tenzij er een concrete use case is
- [ ] **Automatische updates:** `security_updates` rol inschakelen voor unattended security patches

---

## Back-up & herstelplan

| Wat | Hoe | Frequentie |
|-----|-----|------------|
| **Ansible configuratie** | Git repo (is al versiebeheerd) | Bij elke wijziging |
| **Open WebUI data** (users, settings) | Snapshot van `/var/www/openwebui/` of SRC workspace snapshot | Wekelijks |
| **Modellen** | Niet backuppen — opnieuw pullen via `ollama pull` is sneller | N.v.t. |
| **Audit logs** | Exporteren naar externe opslag indien bewaard | Maandelijks |

**Restore-test:** 1x per kwartaal een restore uitvoeren op een test-workspace om te valideren dat backups werken.

---

## Operationele SLO's (Service Level Objectives)

| Metric | Target |
|--------|--------|
| **Beschikbaarheid** | 95% tijdens kantooruren (ma-vr 8-18u) |
| **Responstijd** | <30 sec voor 7B model bij ≤10 gelijktijdige users |
| **Hersteltijd bij storing** | <4 uur (workspace herstarten/opnieuw deployen) |
| **Escalatiepad** | Technisch beheerder → SURF servicedesk → Security contact (bij data-incident) |

---

## Stappenplan: Hoe start je?

### Fase 0: Voorbereiding (week 1-2)
- [ ] DPIA-check met HAN privacy officer
- [ ] Functioneel & technisch beheerder aanwijzen
- [ ] Usage policy schrijven (1 A4)
- [ ] Maandbudget vaststellen voor SRC GPU-uren
- [ ] **Developer-rol aanvragen** bij CO-admin van je SRAM Collaboration (nodig voor eigen component registratie in Fase 3)
- [ ] Git repo is al aangemaakt: https://github.com/HAN-AIM-CMD-WG/src-component-openwebui (done)

### Fase 1: Quick start via UU catalog item (week 2-3)
> Je hebt nog geen Developer-rol nodig. Start direct via het bestaande UU catalog item.

**Stap 1: Workspace starten via UU catalog item**
- Log in op [SURF ResearchCloud](https://portal.live.surfresearchcloud.nl/)
- Zoek het Open WebUI catalog item van Utrecht University
- Selecteer **A10 - 1 GPU** flavor:
  - 11 cores (Intel Xeon Gold 6342 @ 2.80GHz)
  - 88 GB RAM
  - 1x NVIDIA A10 (24 GB VRAM)
  - 1450 GB ephemeral storage
- Stel parameter `model` in op `qwen3:14b`
- Stel parameter `expose_api` in op `false`
- Klik Submit → workspace draait binnen ~10-15 min

**Stap 2: Modellen toevoegen**
SSH naar de workspace en pull het chat model + embedding model:
```bash
# Chat model (27B, ~17 GB VRAM, 201 talen, multimodal, 256K context)
/opt/ollama/bin/ollama pull qwen3.5:27b

# Embedding model voor RAG
/opt/ollama/bin/ollama pull nomic-embed-text
```

**Stap 3: RAG configureren**
- Open WebUI → Admin Panel → Settings → Documents
- Stel Embedding Model in op `nomic-embed-text`
- Maak een eerste Knowledge Base aan (Workspace → Knowledge)
- Upload testdocumenten (lesmateriaal, rubrics)

**Stap 3: Security-hardening doorlopen** (zie checklist hierboven)

**Stap 4: Anonimisatie-pipeline inrichten**
- Installeer DEDUCE als Open WebUI pipeline/filter (standaard actief)
- Test met voorbeeldteksten met fictieve studentdata
- Configureer waarschuwingsmelding bij PII-detectie

### Fase 2: Pilot (week 4-7) — 3-5 docenten
**Acceptatiecriteria:**
- [ ] SRAM-login werkt voor alle pilotgebruikers
- [ ] Minimaal 2 modellen bruikbaar voor Nederlandse prompts
- [ ] Anonimisatiefilter detecteert testcases correct
- [ ] 5 gelijktijdige sessies met acceptabele responstijd (<30 sec)
- [ ] Usage policy gelezen en ondertekend door pilotgebruikers

**Exit-criteria voor volgende fase:**
- Geen kritieke privacy-incidenten
- Gebruikerstevredenheid ≥3.5/5
- Technisch stabiel (geen onverklaarde crashes)

### Fase 3: Eigen component registreren (zodra Developer-rol is verkregen)
> Vanaf hier gebruik je jullie eigen HAN fork i.p.v. het UU catalog item.

**Stap 1: Component aanmaken op SRC**
- Development → Components → "+"
- Script type: Ansible Playbook
- Git URL: `https://github.com/HAN-AIM-CMD-WG/src-component-openwebui.git`
- Script path: `playbook.yml`
- Branch: `main`
- Parameters instellen (model, ollama_version, expose_api, ollama_use_external_storage)

**Stap 2: Catalog item aanmaken**
- Development → Catalog items → "+"
- Components: SURF Nginx + jouw HAN Open WebUI component
- Cloud provider: SURF HPC Cloud
- OS: Ubuntu
- Access: HTTPS (443)

**Stap 3: Nieuwe workspace starten vanuit eigen catalog item**
- Dezelfde A10 flavor, maar nu met HAN-specifieke defaults (API dicht, user role, etc.)

### Fase 4: Controlled rollout (week 8-12) — 10 docenten
**Exit-criteria:**
- 10 gelijktijdige sessies met acceptabele responstijd
- Model-evaluatieprotocol uitgevoerd op alle aangeboden modellen
- Back-up en restore succesvol getest
- Kostenoverzicht eerste maand past binnen budget

### Fase 5: Breed gebruik (week 13+) — 20+ docenten
- Eventueel opschalen naar 2x A10 of A100
- Extra modellen toevoegen op basis van evaluatie
- Evalueren of A10 nog voldoet of upgrade nodig is

---

## Verificatie / Testen

1. **Deployment check:** Na `ansible-playbook` → browse naar workspace URL, SRAM login moet werken
2. **Model check:** In Open WebUI → selecteer een model → stel een vraag in het Nederlands
3. **Anonimisatie check:** Voer tekst in met fictieve namen/BSN → DEDUCE moet waarschuwen/filteren
4. **Multi-user check:** Laat 5+ collega's tegelijk inloggen en queries draaien
5. **Performance check:** Monitor GPU gebruik via `nvidia-smi` op de workspace
6. **Security check:** Controleer HTTPS, SRAM-auth, SSH key-only, fail2ban actief
7. **Restore check:** Test workspace-herstel vanuit backup (1x per kwartaal)

---

## Belangrijke bestanden (UU repo)

- `playbook.yml` — hoofd-playbook, orkestreert alle rollen
- `requirements.yml` — Ansible dependencies (uusrc.general) — **pin op release-tag!**
- `roles/ollama-serve/defaults/main.yml` — Ollama configuratie (model, versie, opslag)
- `roles/openwebui/defaults/main.yml` — Open WebUI configuratie (poort, URL)
- `roles/ollama-serve/templates/ollama-serve.service.j2` — systemd service template
- `roles/openwebui/templates/openwebui-serve.service.j2` — systemd service template

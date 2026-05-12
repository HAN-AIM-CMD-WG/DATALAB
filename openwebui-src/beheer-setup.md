# HAN AI Omgeving — Beheer & Setup Guide

Dit document beschrijft hoe de omgeving from scratch opgezet wordt, inclusief alle configuratie-wijzigingen. Gebruik dit om de omgeving exact te reproduceren na een crash of bij het opzetten van een nieuwe workspace.

Laatst bijgewerkt: 2026-03-24

---

## 1. SRC Workspace starten

1. Log in op [SURF ResearchCloud](https://portal.live.surfresearchcloud.nl/)
2. Kies het **Open WebUI** catalog item (Utrecht University)
3. Selecteer **A10 - 1 GPU** flavor:
   - 11 cores (Intel Xeon Gold 6342 @ 2.80GHz)
   - 88 GB RAM
   - 1x NVIDIA A10 (24 GB VRAM)
   - 1450 GB ephemeral storage
4. Parameter `model` → `qwen3:14b`
5. Parameter `expose_api` → `false`
6. SRAM Collaboration: gebruik de HAN onderwijs-collaboration
7. Submit → workspace draait binnen ~10-15 min

---

## 2. SSH toegang

```bash
ssh <sram-gebruikersnaam>@<workspace-ip>
```

SSH key moet gekoppeld zijn aan je SRC-profiel.

---

## 3. Modellen pullen

```bash
# Chat model 1: Qwen3 14B (~9 GB VRAM)
/opt/ollama/bin/ollama pull qwen3:14b

# Chat model 2: GLM-4 9B (~5.5 GB VRAM)
/opt/ollama/bin/ollama pull glm4:9b

# Embedding model voor RAG (~0.7 GB VRAM)
/opt/ollama/bin/ollama pull nomic-embed-text
```

Totaal VRAM: ~15.5 GB van 23 GB beschikbaar.

---

## 4. Modellen permanent in VRAM laden

### Ollama keep_alive instellen (permanent)

```bash
sudo systemctl edit ollama-serve
```

Voeg toe:
```
[Service]
Environment="OLLAMA_KEEP_ALIVE=-1"
```

```bash
sudo systemctl daemon-reload
```

### Modellen laden

```bash
curl -X POST http://localhost:11434/api/generate -d '{"model": "qwen3:14b", "keep_alive": -1}'
curl -X POST http://localhost:11434/api/generate -d '{"model": "glm4:9b", "keep_alive": -1}'
curl -X POST http://localhost:11434/api/embed -d '{"model": "nomic-embed-text", "input": "warmup", "keep_alive": -1}'
```

Na reboot worden modellen bij eerste gebruik geladen en blijven permanent in VRAM.

---

## 5. Open WebUI — Admin instellingen

### Admin Panel → Settings → Documents

| Instelling | Waarde |
|---|---|
| Content Extraction Engine | Default |
| PDF Extract Images (OCR) | Aan |
| Markdown Header Text Splitter | Aan |
| Chunk Size | 1500 |
| Chunk Overlap | 200 |
| Embedding Model Engine | Ollama |
| Embedding Model | nomic-embed-text |
| Embedding Batch Size | 1 |
| Async Embedding Processing | Aan |
| Full Context Mode | Uit |
| Hybrid Search | Aan |
| Reranking Engine | Default (SentenceTransformers) |
| Reranking Model | BAAI/bge-reranker-v2-m3 |
| Top K | 5 |
| Top K Reranker | 3 |
| BM25 Weight | 0.5 (midden) |

---

## 6. Workspace Models aanmaken

### 6a. HAN Assistent

- **Workspace → Models → + nieuw model**
- **Naam:** HAN Assistent
- **Base model:** qwen3:14b
- **Beschrijving:** Krachtig allround model met 128K context window. Voor RAG, lesmateriaal maken, toetsvragen genereren en creatieve taken.
- **System prompt:**
```
Je bent een AI-assistent voor HAN docenten en onderzoekers. Antwoord in het Nederlands tenzij anders gevraagd. Wees beknopt en duidelijk.

Je bent vooral sterk in:
- Toetsvragen en opdrachten genereren op basis van lesmateriaal
- Lesmateriaal samenvatten of herschrijven voor een ander niveau
- RAG: vragen beantwoorden over geüploade documenten (#KennisBase)
- Creatieve taken: casussen schrijven, scenario's bedenken
- Meertalig: 100+ talen, sterk in Nederlands en Engels

Gebruik #KennisBase-naam om documenten te raadplegen. Verwijs altijd naar de bron als je uit documenten citeert.

Als de gebruiker om hulp vraagt die je niet kunt bieden, verwijs naar het HAN Datalab Teams-kanaal of datalab@han.nl.
```
- **Capabilities:** Vision, File Upload, File Context, Citations, Status Updates, Builtin Tools — aan. Rest uit.
- **Builtin Tools:** Time & Calculation, Memory, Chat History, Notes, Knowledge Base, Channels — aan. Rest uit.
- **Access:** Public

### 6b. HAN Nakijker

- **Workspace → Models → + nieuw model**
- **Naam:** HAN Nakijker
- **Base model:** glm4:9b
- **Beschrijving:** Snel en betrouwbaar model met laag hallucinatiepercentage. Ideaal voor nakijken, beoordelen en gestructureerde output.
- **System prompt:**
```
Je bent een AI-assistent voor HAN docenten en onderzoekers. Antwoord in het Nederlands tenzij anders gevraagd. Wees beknopt, feitelijk en duidelijk.

Je bent vooral sterk in:
- Nakijken en beoordelen van studentwerk aan de hand van rubrics
- Gestructureerde output genereren (tabellen, lijsten, Markdown)
- Feitelijke samenvattingen met minimale hallucinaties
- Feedback formuleren op basis van beoordelingscriteria

Voeg GEEN informatie toe die niet in de brondata staat. Als je iets niet weet, zeg dat eerlijk.

Als de gebruiker om hulp vraagt die je niet kunt bieden, verwijs naar het HAN Datalab Teams-kanaal of datalab@han.nl.
```
- **Capabilities:** Vision, File Upload, File Context, Citations, Status Updates, Builtin Tools — aan. Rest uit.
- **Builtin Tools:** Time & Calculation, Memory, Chat History, Notes, Knowledge Base, Channels — aan. Rest uit.
- **Access:** Public

### 6c. Onboarding

- **Workspace → Models → + nieuw model**
- **Naam:** Onboarding
- **Base model:** glm4:9b
- **Beschrijving:** Welkom! Ik help je op weg met de HAN AI omgeving. Vraag me hoe je documenten uploadt, welk model je moet kiezen, of hoe je toetsvragen genereert. Typ / voor snelle opties.
- **System prompt:**
```
Je bent de onboarding-assistent voor de HAN AI omgeving van het Datalab. Beantwoord vragen op basis van de kennisbank. Als het antwoord niet in de documenten staat, zeg: "Dat weet ik niet. Stel je vraag in het HAN Datalab Teams-kanaal of mail naar datalab@han.nl."

De beschikbare modellen zijn:
- HAN Assistent (Qwen3 14B) — slimste model, denkt na, voor complexe taken
- HAN Nakijker (GLM-4 9B) — snel, betrouwbaar, voor nakijken en beoordelen
- Onboarding (dit model) — vragen over deze omgeving

Dit is een experimenteeromgeving. Benadruk bij vragen over data of opslag altijd dat gebruikers belangrijke output moeten exporteren naar hun eigen systeem.

Antwoord in het Nederlands. Wees vriendelijk, kort en praktisch.
```
- **Knowledge:** koppel `HAN AI Handleiding` (Knowledge Base met welkom-docenten.md)
- **Knowledge Base instelling:** "Using Entire Document" → aan
- **Capabilities:** Citations — aan. Rest uit.
- **Builtin Tools:** Knowledge Base — aan. Rest uit.
- **Access:** Public
- **Prompts:** Aangepast met:
  1. RAG uitleg / Documenten uploaden en gebruiken
  2. Spelregels / Privacy en gebruiksregels
  3. Toetsvragen maken / Genereer vragen over je lesmateriaal

---

## 7. Knowledge Base aanmaken

1. **Werkplaats → Kennis → + Kennis aanmaken**
2. **Naam:** HAN AI Handleiding
3. **Beschrijving:** Handleiding, spelregels en FAQ voor de HAN AI Assistent omgeving. Bevat instructies over modellen, RAG, voorbeeldprompts en privacy.
4. **Toegang:** Public
5. **Upload:** `welkom-docenten.md`
6. **Instelling:** "Using Entire Document" → aan
7. **Koppel aan:** Onboarding model (via model Knowledge sectie)

---

## 8. Rauwe modellen configureren

De basis Ollama-modellen (qwen3:14b, glm4:9b) blijven zichtbaar als "Private Model" zodat power users ze kunnen testen. Stel in:

- **Access:** Public (zichtbaar voor iedereen, maar zonder HAN-instellingen)
- **nomic-embed-text:** Access → Private (verbergen, is alleen voor RAG embedding)

Eventuele oude/ongebruikte modellen verwijderen:
```bash
/opt/ollama/bin/ollama rm smollm:135m
/opt/ollama/bin/ollama rm bramvanroy/fietje-2b-instruct:f16
/opt/ollama/bin/ollama rm bramvanroy/fietje-2b-instruct:Q8_0
/opt/ollama/bin/ollama rm deepseek-r1:32b
```

---

## 9. Overige instellingen

### DEFAULT_USER_ROLE
Staat in de Ansible config: `DEFAULT_USER_ROLE: user`
Nieuwe gebruikers krijgen automatisch de rol `user` (niet admin).

### ENABLE_SIGNUP
Staat op `False` — alleen toegang via SRAM-authenticatie.

### expose_api
Staat op `false` — Ollama API niet publiek toegankelijk.

### Arena Model
Uitzetten via Admin Panel → Settings → Interface (of Models).

---

## 10. Monitoring

```bash
# GPU status
nvidia-smi

# Welke modellen geladen?
curl -s http://localhost:11434/api/ps | python3 -m json.tool

# Alle modellen op disk
/opt/ollama/bin/ollama list

# Services herstarten
sudo systemctl restart ollama-serve
sudo systemctl restart openwebui-serve
```

---

## 11. Checklist na setup

- [ ] Workspace draait op SRC met A10 GPU
- [ ] SSH toegang werkt
- [ ] qwen3:14b, glm4:9b en nomic-embed-text gepulld
- [ ] OLLAMA_KEEP_ALIVE=-1 ingesteld
- [ ] Alle drie modellen geladen in VRAM (~15.5 GB)
- [ ] Documents settings geconfigureerd (Chunk 1500, Top K 5, Hybrid Search, nomic-embed-text)
- [ ] HAN Assistent workspace model aangemaakt (Public)
- [ ] HAN Nakijker workspace model aangemaakt (Public)
- [ ] Onboarding workspace model aangemaakt (Public, met Knowledge Base)
- [ ] HAN AI Handleiding Knowledge Base aangemaakt (Public, welkom-docenten.md)
- [ ] nomic-embed-text verborgen (Private)
- [ ] Rauwe modellen zichtbaar als test-optie
- [ ] Arena model uitgeschakeld
- [ ] Test: onboarding bot geeft correcte info met citaties
- [ ] Test: HAN Assistent antwoordt in het Nederlands
- [ ] Test: HAN Nakijker antwoordt direct zonder thinking
- [ ] Test: RAG werkt met Knowledge Base (#-referentie)

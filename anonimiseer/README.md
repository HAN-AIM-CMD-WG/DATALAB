# Anonimiseer

Laagdrempelige tooling om documenten (DOCX, PDF, XLSX, TXT) en chat-prompts te anonimiseren of pseudonimiseren voordat ze gedeeld worden met externe AI-diensten.

Status: **in ontwikkeling** (Fase 0).

## Voor wie

Docenten, onderzoekers en ondersteuners die willen werken met ChatGPT, Claude, OpenRouter of andere externe LLM's, zonder persoonsgegevens (namen, e-mails, BSN, adressen, studentnummers, etc.) uit de hand te geven.

## Wat zit erin

| Onderdeel | Locatie | Beschrijving |
|---|---|---|
| PII-engine | [`packages/pii-engine/`](packages/pii-engine/) | Gedeelde Python-microservice met Presidio NL + spaCy + SoNaR NER + optioneel GLiNER/Ollama |
| Electron-app | [`apps/electron-anonimiseer/`](apps/electron-anonimiseer/) | Lokale desktop-tool met wizard-flow voor leken (fork van [A5 PII Anonymizer](https://github.com/AgenticA5/A5-PII-Anonymizer), MIT) |
| Open WebUI filter | [`apps/openwebui-filter/`](apps/openwebui-filter/) | Filter Function die PII wegstript voordat prompts naar OpenRouter gaan |
| Browser-extensie | [`apps/browser-extension/`](apps/browser-extension/) | Manifest V3 extensie voor ChatGPT, Claude, Gemini, Copilot (Fase 6) |
| Native Messaging host | [`apps/native-host/`](apps/native-host/) | Brug tussen browser-extensie en lokale engine (Fase 6) |
| Deploy | [`deploy/`](deploy/) | Docker Compose voor engine naast bestaande OpenWebUI |
| Onderzoek | [`docs/onderzoek/`](docs/onderzoek/) | Bronmateriaal en verkenningen die aan dit project voorafgingen |

## Belangrijk: eigen verantwoordelijkheid

Deze tooling is een **hulpmiddel**, geen garantie. Geen enkele automatische PII-detectie is 100% nauwkeurig. De gebruiker (en de organisatie) blijft onder de AVG zelf verwerkingsverantwoordelijke. Zie [`docs/disclaimer-nl.md`](docs/disclaimer-nl.md) voor de volledige tekst die in de app, de filter en op output-bestanden verschijnt.

## Architectuur

Zie [`docs/architecture.md`](docs/architecture.md) voor de uitgewerkte architectuur, detectie-pijplijn, Model Manager en verantwoordelijkheidslagen.

## Licentie en attributie

Dit project staat onder MIT. De Electron-app is gebaseerd op [AgenticA5/A5-PII-Anonymizer](https://github.com/AgenticA5/A5-PII-Anonymizer) (ook MIT). Zie [`apps/electron-anonimiseer/NOTICE.md`](apps/electron-anonimiseer/NOTICE.md).

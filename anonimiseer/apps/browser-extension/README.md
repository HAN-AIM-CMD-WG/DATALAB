# browser-extension

Manifest V3 extensie die PII wegstript op `chatgpt.com`, `claude.ai`, `gemini.google.com` en `copilot.microsoft.com` voordat een prompt verzonden wordt, en LLM-antwoorden de-anonymiseert tijdens streaming.

Status: **leeg skelet** — implementatie start in Fase 6 (na pilot van Electron-app en Open WebUI-filter).

## Belangrijke caveat

Een extensie kan door de eindgebruiker uitgezet of omzeild worden (andere browser, incognito, andere laptop). Dit is een **hulpmiddel**, geen afgedwongen compliance-laag. De enige echt afdwingbare route blijft Open WebUI met Always-On filter. Dit wordt expliciet in de extensie-onboarding én in de README getoond.

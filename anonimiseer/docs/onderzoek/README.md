# Onderzoek — bronmateriaal

Verkenning die aan dit project voorafging.

| Bestand | Wat is het |
|---|---|
| [`dr_prompt.md`](dr_prompt.md) | Oorspronkelijke Deep Research-prompt: "ken jij een automatisch proces van anonimiseren..." |
| [`collega-tips.md`](collega-tips.md) | Tips van collega's: A5 PII Anonymizer, ARX, Azure DLP, Presidio, gemeente Arnhem |
| [`Lokale Anonimisering met Ollama Gids.pdf`](Lokale%20Anonimisering%20met%20Ollama%20Gids.pdf) | Deep Research-output (24 pagina's): Presidio, GLiNER, SLMs via Ollama, BSN-Elfproef, Open WebUI filters, RAG |
| [`NER_sonar.py`](NER_sonar.py) | Werkend minimal script dat `wietsedv/bert-base-dutch-cased-finetuned-sonar-ner` aanroept via HF Transformers — basis voor de Nederlandse NER-laag in `pii-engine` |

## Belangrijkste bevindingen die het plan stuurden

1. **Hybride architectuur wint**: combineer regex + checksum (BSN Elfproef, IBAN mod-97) voor snelheid en precisie met NER (spaCy NL + Wietsedv SoNaR BERT) voor naam/locatie/org-recall, optioneel GLiNER en/of LLM voor de laatste semantische gaten.
2. **A5 PII Anonymizer bestaat al** (MIT, Electron, ONNX built-in, PDF/DOCX/XLSX/TXT, mapping-mode) en dekt ~80% van de UX-wens — vandaar de keuze om het als subtree te forken en de Engelstalige engine te vervangen.
3. **Open WebUI Filter Functions** met `inlet`/`outlet`-hooks zijn het officiële uitbreidingspunt om prompts te onderscheppen vóór een externe provider (OpenRouter) wordt aangeroepen. Voor zware detectie-engines is een Pipeline (aparte Docker-container) de aanbevolen vorm.
4. **Nederlandse lokalisatie vereist eigen werk**: BSN-Elfproef als volledige `EntityRecognizer`, NL-telefoonregex met contextwoorden, `nl_core_news_lg` als NLP-engine, en eventueel GLiNER-modellen met expliciete NL-support (`E3-JSI/gliner-multi-pii-domains-v1`).

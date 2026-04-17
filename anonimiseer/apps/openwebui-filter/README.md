# openwebui-filter

Open WebUI Filter Function (`nl_pii_filter.py`) die prompts scrubbed vóór ze naar een externe provider (met name OpenRouter) gaan, en optioneel de-anonymiseert bij terugkomst.

Status: **leeg skelet** — implementatie start in Fase 2.

## Werking (gepland)

1. Filter wordt geüpload in Open WebUI via Admin → Workspace → Functions.
2. `inlet(body)`: stuurt laatste user-message naar `pii-engine` (`/anonymize`), vervangt content in-place, slaat mapping op in `body["metadata"]["_pii_mapping"]`.
3. `outlet(body)`: leest mapping, de-anonymiseert LLM-respons voordat de UI het toont.
4. `valves` voor admin-config: engine-URL, taal, modes, gevoeligheid, uit te sluiten entiteiten.
5. **Always-On** op externe connecties (OpenRouter), niet uitschakelbaar door eindgebruiker.

## Referentie

Patroon geleend van de officiële community-filter: [presidio_filter_pipeline.py](https://github.com/open-webui/pipelines/blob/main/examples/filters/presidio_filter_pipeline.py).

# Archief: A5 PII Anonymizer (upstream referentie)

> **Niet actief onderhouden** — deze map staat hier als historische
> referentie en attributie van het oorspronkelijke project waarvan deze
> Anonimiseer-tool is geïnspireerd.

## Wat is dit

Deze map bevat de onveranderde upstream van
[A5 PII Anonymizer](https://github.com/arbab-mughal05/pii-anonymizer) commit
`3e5b229`, ingeladen op 2026-04-17 via `git subtree add --squash`.

## Waarom een aparte map

We hebben A5 aanvankelijk als vertrekpunt gebruikt. Bij de code-review
(zie [`docs/a5-baseline.md`](../../docs/a5-baseline.md)) bleek echter dat
nagenoeg **elke runtime-component vervangen moet worden** voor onze
Nederlandse use-case en ons beveiligings­beleid:

- Engels-alleen detectiemodel → vervangen door `pii-engine` sidecar (Python/Presidio).
- Destructieve document-output (layout verlies) → vervangen door layout-preserving
  DOCX/PDF/XLSX flows.
- Onveilige Electron defaults (`nodeIntegration: true`, `contextIsolation: false`)
  → vervangen door `contextIsolation: true` + preload-bridge.
- Geen BSN-detectie / NL-patronen / verantwoordelijkheidslaag.

Daarom is de **nieuwe app** opgezet vanaf nul in
[`apps/electron-anonimiseer/`](../electron-anonimiseer/), met een moderne,
secure-by-default stack (Electron + Vite + React + TS + Tailwind + shadcn).
Deze map (`electron-anonimiseer-a5-reference`) blijft als:

1. **Attributie** — de MIT-licentie in [`LICENSE`](LICENSE) en
   [`NOTICE.md`](NOTICE.md) moeten bewaard blijven.
2. **Referentiemateriaal** — we kijken soms terug naar de drag-drop-UX
   en document-parsing-aanroepen als design-inspiratie.
3. **Archiefwaarde** — als we later toch een detail uit de upstream
   willen mergen kan dat.

## Licentie en attributie

A5 is vrijgegeven onder MIT. Zie [`LICENSE`](LICENSE) en [`NOTICE.md`](NOTICE.md).
Elke afgeleide die wij publiceren noemt dit upstream-werk correct.

## Niet gebruiken voor ontwikkeling

Pointers voor nieuwe ontwikkeling:

- Electron-app work: `anonimiseer/apps/electron-anonimiseer/`
- PII-engine work: `anonimiseer/packages/pii-engine/`
- Open WebUI filter work: `anonimiseer/apps/openwebui-filter/`

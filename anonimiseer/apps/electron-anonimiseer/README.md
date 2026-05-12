# Anonimiseer desktop-app

> Electron-app voor niet-technische collega's om lokaal DOCX, PDF en XLSX
> te anonimiseren. Roept de gedeelde
> [`packages/pii-engine`](../../packages/pii-engine) sidecar aan voor alle
> detectie — geen enkel model of document verlaat de machine.

## Status

Fase 3.1 — **Scaffolding + veilige Electron-shell**. De wizard-stappen
(Bestand kiezen → Instellingen → Controleren → Opslaan) staan op de roadmap
maar zijn nog niet geïmplementeerd. Wat werkt:

- Electron + Vite + React + TypeScript + Tailwind stack, secure-by-default.
- Live engine-status indicator (pollt `http://127.0.0.1:8765/health`).
- Disclaimer-banner en footer met verantwoordelijkheids-boodschap.
- Strict CSP op de renderer (alleen eigen assets + 127.0.0.1:8765).

Voor de daadwerkelijke detectie-demo gebruik voorlopig de
[playground in de engine](http://127.0.0.1:8765/playground).

## Waarom geen A5-upstream

A5 is gearchiveerd onder
[`apps/electron-anonimiseer-a5-reference/`](../electron-anonimiseer-a5-reference/ARCHIVE_NOTE.md).
Samengevat: ~6 van de 7 runtime-componenten moesten vervangen worden plus
onveilige Electron defaults. Zie [`docs/a5-baseline.md`](../../docs/a5-baseline.md)
voor de volledige gap-analyse.

## Beveiligingsuitgangspunten

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Alle main ↔ renderer communicatie via een gecontroleerde
  `contextBridge`-API in [`src/preload/index.ts`](src/preload/index.ts).
- Renderer mag alleen connecten naar `http://127.0.0.1:8765` (de lokale
  pii-engine); externe hosts worden door de CSP geweigerd.
- Externe links openen in de OS-browser via `shell.openExternal`, nooit
  in een Electron-venster.

## Stack

| Tool | Waarvoor |
|---|---|
| Electron 33 | desktop shell |
| electron-vite | dev-server, HMR, TS-build voor main/preload/renderer |
| React 18 + TS | UI |
| Tailwind CSS v3 + shadcn-design-tokens | styling |
| lucide-react | iconen |
| electron-builder | installer builds (komt in 3.8) |

## Lokaal draaien

```bash
cd anonimiseer/apps/electron-anonimiseer
npm install
npm run dev
```

Zorg dat de pii-engine op `127.0.0.1:8765` draait — anders zie je
rechtsboven "Engine niet bereikbaar":

```bash
cd anonimiseer/packages/pii-engine
source .venv/bin/activate
PII_ENGINE_ENABLE_BSN=true PII_ENGINE_ENABLE_SONAR=true pii-engine
```

## Projectstructuur

```
apps/electron-anonimiseer/
├── electron.vite.config.ts      Build-config voor main/preload/renderer
├── tailwind.config.ts
├── tsconfig.*.json
├── package.json
└── src/
    ├── main/                    Node-proces (BrowserWindow, app lifecycle)
    │   └── index.ts
    ├── preload/                 contextBridge-API: smalle oppervlakte
    │   └── index.ts
    ├── shared/                  TypeScript-types die main + renderer delen
    │   └── api.ts
    └── renderer/                React-app (UI)
        ├── index.html           CSP hier
        └── src/
            ├── App.tsx
            ├── main.tsx
            ├── styles.css
            ├── components/
            │   ├── DisclaimerBanner.tsx
            │   └── EngineStatus.tsx
            └── lib/
                └── utils.ts     cn() helper voor Tailwind
```

## Roadmap

Volgende blokken (in volgorde):

- **3.2 Engine-bridge** — sidecar spawnen in het main-proces i.p.v.
  via een extern terminal-venster, met graceful shutdown.
- **3.3 Onboarding** — first-run 3-stappen flow (welkom/privacy →
  modelprofiel → klaar).
- **3.4 Wizard 4-stappen** — Bestand kiezen → Instellingen → Controleren → Opslaan.
- **3.5 Document-parsing** — DOCX/PDF/XLSX met layout-behoud.
- **3.6 Accountability** — first-run-akkoord, banner stap 3, checkbox
  stap 4, watermerk, audit-log.
- **3.7 Model Manager** — 1-klik downloads vanuit HF en Ollama.
- **3.8 Build + distributie** — electron-builder via GitHub Actions.

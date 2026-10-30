# Anonimiseer desktop-app

> Electron-app voor niet-technische collega's om lokaal Word, Excel, PDF, Markdown en
> tekst te anonimiseren of te pseudonimiseren. Alle detectie gebeurt in de gedeelde
> [`packages/pii-engine`](../../packages/pii-engine), die de app zelf start. De inhoud van
> documenten verlaat de computer niet.

Gebruikers installeren de app via [`INSTALL.md`](INSTALL.md). Dit document is voor
ontwikkelaars.

## Wat de app doet

- **Wizard in vier stappen**: bestanden kiezen → instellingen (categorieën, gevoeligheid,
  pseudoniemen of anonimiseren) → treffers controleren en zelf markeren → opslaan.
- **Opslaan**: per run een nieuwe map met de bewerkte bestanden, `DISCLAIMER.txt`,
  `audit.jsonl` en bij pseudonimiseren een versleutelde `mapping.bin`. De map is alleen
  leesbaar voor de gebruiker (0700, bestanden 0600). Een vervanging die niet in het bestand
  is beland, levert een waarschuwing op.
- **Pseudoniemen terugzetten** met de `mapping.bin` van een run (Markdown, tekst, Word en
  Excel; een PDF niet).
- **Modellen beheren**: spaCy, SoNaR-BERT en lokale Ollama-modellen; toont wat er echt
  geladen is, en de kopbalk zegt "Beperkt" als er iets ontbreekt.

## Beveiligingsuitgangspunten

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Alle communicatie tussen main en renderer loopt via een smalle, getypeerde
  `contextBridge`-API in [`src/preload/index.ts`](src/preload/index.ts).
- De renderer praat nooit zelf met de engine: de CSP staat alleen eigen assets toe
  (`connect-src 'self'`). Het main-proces doet alle engine-aanroepen.
- De app start de engine zelf op `127.0.0.1` met een geheim token per sessie, en
  controleert via een HMAC-handshake dat ze met haar eigen engine praat.
- Bestanden worden alleen gelezen en geschreven op plekken die de gebruiker in een dialoog
  heeft gekozen.
- Externe links openen alleen als `http:`- of `https:`-adres, in de OS-browser.

## Stack

| Tool | Waarvoor |
|---|---|
| Electron 33 | desktop shell |
| electron-vite | dev-server, HMR, TS-build voor main/preload/renderer |
| React 18 + TS | UI |
| Tailwind CSS v3 + shadcn-design-tokens | styling |
| lucide-react | iconen |
| electron-builder | installers; zie [`RELEASE.md`](RELEASE.md) |
| vitest, Playwright | unittests en de end-to-end-test in [`e2e/`](e2e/) |

## Lokaal draaien

In een ontwikkelbuild start de app de engine niet zelf. Start die eerst:

```bash
cd anonimiseer/packages/pii-engine
source .venv/bin/activate
PII_ENGINE_ENABLE_SONAR=true pii-engine
```

Dan de app:

```bash
cd anonimiseer/apps/electron-anonimiseer
npm install
npm run dev
```

Een gebouwde app met eigen engine maak je met `npm run bundle:engine` en daarna
`npx electron-builder --dir`; zie [`RELEASE.md`](RELEASE.md).

## Testen

```bash
npm run typecheck
npm test                 # vitest
npm run e2e              # end-to-end, zie e2e/README.md
```

## Projectstructuur

```
apps/electron-anonimiseer/
├── e2e/                         End-to-end- en crashtest (Playwright)
├── resources/                   Ollama-catalogus die met de app meegaat
└── src/
    ├── main/                    Node-proces: engine starten, bridges, bestanden schrijven
    ├── preload/                 contextBridge-API
    ├── shared/                  Types die main en renderer delen
    └── renderer/                React-app
        ├── index.html           CSP
        └── src/components/      Wizard, Modellen beheren, Hulp, Terugzetten
```

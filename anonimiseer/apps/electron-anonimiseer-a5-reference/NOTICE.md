# NOTICE

Deze Electron-applicatie is afgeleid van **A5 PII Anonymizer** van AgenticA5.

- Upstream: https://github.com/AgenticA5/A5-PII-Anonymizer
- Upstream-licentie: MIT (zie [`LICENSE`](LICENSE))
- Origineel copyright: Copyright (c) 2025 A5

## Integratie in deze monorepo

De code is toegevoegd via `git subtree` op 2026-04-17 (squashed):

```bash
git subtree add \
  --prefix=anonimiseer/apps/electron-anonimiseer \
  https://github.com/AgenticA5/A5-PII-Anonymizer.git main --squash
```

Upstream-updates kunnen later opgehaald worden met:

```bash
git subtree pull \
  --prefix=anonimiseer/apps/electron-anonimiseer \
  https://github.com/AgenticA5/A5-PII-Anonymizer.git main --squash
```

## Wijzigingen ten opzichte van upstream

Deze fork zal substantieel afwijken van de upstream. Globaal plan:

1. Behouden: Electron shell, document-parsing (`fileProcessor.js`), mapping-UI-patronen, packaging-config.
2. Vervangen: ingebouwde `@xenova/transformers`-engine en Engelstalige entiteiten-taxonomie → calls naar de lokale `pii-engine` Python-sidecar van dit project.
3. Toevoegen: Nederlandstalige UI, wizard-flow, onboarding, Model Manager, disclaimer-systeem, audit-log.

De bulk van de uiteindelijke codebase zal eigen werk zijn van DataLab; de A5-attributie blijft staan voor de initieel hergebruikte delen.

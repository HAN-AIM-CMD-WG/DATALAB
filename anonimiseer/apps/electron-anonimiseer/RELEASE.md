# Release-procedure — Anonimiseer Desktop

Stappenplan om een nieuwe versie van de Electron-app te bouwen, taggen en
publiceren als GitHub Release in de DATALAB-monorepo. Doelgroep: ontwikkelaar
met push-rechten op `HAN-AIM-CMD-WG/DATALAB`.

> **Tag-conventie:** alle anonimiseer-releases gebruiken het prefix
> `anonimiseer-vX.Y.Z`. Zo ontstaan er geen conflicten met andere
> projecten in de monorepo (`reachy-vX.Y.Z`, `openwebui-vX.Y.Z`).

---

## 0. Voorwaarden

| Vereiste | Versie / opmerking |
|---|---|
| Python | 3.11 of 3.12 (geen 3.14 — geen presidio/spaCy wheels) |
| Node.js | 20 LTS |
| Mac-build | macOS host (cross-compile niet supported door electron-builder voor Mac) |
| Windows-build | Windows host **of** macOS+Wine (`brew install wine-stable`) |
| Schijfruimte | ~3 GB tijdens build (PyInstaller bundelt torch + spaCy-model) |
| Tijd | ~10 min per platform op moderne hardware |

---

## 1. Pre-flight checks

```bash
cd packages/pii-engine
pytest --ignore=tests/test_sonar.py     # 40/40 passed verwacht
cd ../..
python score.py                         # 100% recall + precision verwacht
```

Update versienummer in:
- `apps/electron-anonimiseer/package.json` → `"version"`
- `packages/pii-engine/pyproject.toml` → `version`

Commit als `chore(release): bump versies naar vX.Y.Z`.

---

## 2. Engine-bundel + app builden

### Mac (.dmg)

```bash
cd apps/electron-anonimiseer
npm install                             # alleen eerste keer / na lock-update
npm run dist:mac:all                    # bundle:engine + dist:mac
```

Output: `apps/electron-anonimiseer/release/Anonimiseer-X.Y.Z.dmg`
(arm64 + x64 in één bestand, ~700 MB-1 GB).

### Windows (.exe)

```bash
cd apps/electron-anonimiseer
npm run dist:win:all                    # vereist Wine op macOS
```

Output: `apps/electron-anonimiseer/release/Anonimiseer-Setup-X.Y.Z.exe`.

### Linux (.AppImage) — optioneel

```bash
npm run dist:linux
```

### Smoke-test

Open de gegenereerde installer/dmg lokaal:
1. App installeren / drag-naar-Applications.
2. Eerste keer openen (Gatekeeper-omweg op Mac, SmartScreen op Windows).
3. Test-document slepen (`test.v2.md` uit ANONIMISER-workspace).
4. Verwacht: ~225 hits gevonden, geen crashes in DevTools-console.

---

## 3. Tag + push

```bash
# In de repo-root (DATALAB)
VERSION="0.1.0"
git tag -a "anonimiseer-v${VERSION}" -m "Anonimiseer v${VERSION}"
git push origin "anonimiseer-v${VERSION}"
```

---

## 4. GitHub Release publiceren

### Via GitHub CLI (aanbevolen)

```bash
VERSION="0.1.0"
cd apps/electron-anonimiseer/release

gh release create "anonimiseer-v${VERSION}" \
    --repo HAN-AIM-CMD-WG/DATALAB \
    --title "Anonimiseer v${VERSION}" \
    --notes-file ../RELEASE_NOTES_TEMPLATE.md \
    Anonimiseer-${VERSION}.dmg \
    Anonimiseer-Setup-${VERSION}.exe
```

### Via GitHub web UI

1. Ga naar [Releases → Draft a new release](https://github.com/HAN-AIM-CMD-WG/DATALAB/releases/new).
2. **Tag**: `anonimiseer-v0.1.0` (kies de bestaande tag).
3. **Title**: `Anonimiseer v0.1.0`.
4. **Description**: kopieer uit `RELEASE_NOTES_TEMPLATE.md` en pas aan.
5. Sleep `.dmg` + `.exe` (+ optioneel `.AppImage`) erin.
6. Vink **"Set as the latest release"** aan (mits het echt de nieuwste van álle DATALAB-projecten is — anders alleen de tag-prefix laten doen wat hij doet).
7. Klik **"Publish release"**.

---

## 5. Communiceren

- README-badge ververst automatisch (verwijst naar laatste `anonimiseer-*` tag).
- Stuur korte aankondiging naar pilot-gebruikers met directe download-link (Mac vs Windows).
- Mooi om bij te voegen: 1 GIF van eerste-keer-openen per OS (zie `docs/onboarding-screenshots/`, indien beschikbaar).

---

## 6. Release-notes-template

Sjabloon staat in [`RELEASE_NOTES_TEMPLATE.md`](./RELEASE_NOTES_TEMPLATE.md).
Per release: **Wat is er nieuw**, **Bug fixes**, **Bekende beperkingen**,
**Download-instructie** (incl. Gatekeeper/SmartScreen), **Hash van assets**
(SHA-256, voor verifieerbaarheid).

---

## 7. Achteraf — als er iets stuk is

Recall? GitHub heeft geen "unrelease" knop, maar wel:
- **Trek een nieuwe patch-release** (v0.1.1) met de fix; markeer de oude
  als *pre-release* of *draft* via de release-edit-pagina.
- Update de README-badge automatisch via de filter `anonimiseer-*`.

Nooit een tag forceren overschrijven (`git push --force-with-lease tags`)
op een gepubliceerde release: gebruikers die al gedownload hebben krijgen
een ander hash-resultaat dan wat in de release-notes staat.

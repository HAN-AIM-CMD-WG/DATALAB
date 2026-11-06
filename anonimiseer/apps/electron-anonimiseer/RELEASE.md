# Release-procedure — Anonimiseer Desktop

Stappenplan om een nieuwe versie te bouwen, te testen en als GitHub Release te publiceren
in de DATALAB-monorepo. Doelgroep: ontwikkelaar met push-rechten op `HAN-AIM-CMD-WG/DATALAB`.

> **Tag-conventie:** anonimiseer-releases gebruiken het prefix `anonimiseer-vX.Y.Z`. Zo
> botsen ze niet met andere projecten in de monorepo, en alleen deze tags starten de
> installer-workflow.

---

## 0. Voorwaarden

| Vereiste | Versie / opmerking |
|---|---|
| Python | 3.11 of 3.12 |
| Node.js | 24 LTS |
| Mac-build | Mac met Apple-chip. Intel-Macs worden niet ondersteund: PyTorch levert sinds versie 2.3 geen pakketten meer voor macOS op Intel. |
| Windows-build | Windows; in de praktijk via CI |
| Schijfruimte | ~5 GB tijdens de build (torch, spaCy-model en het PII-model van ~1,1 GB) |

---

## 1. Pre-flight checks

```bash
cd packages/pii-engine
pytest && ruff check . && ruff format --check . && mypy pii_engine

cd ../../apps/electron-anonimiseer
npm run typecheck && npm test
```

De detectiemeting staat in [`packages/pii-engine/bench/README.md`](../../packages/pii-engine/bench/README.md);
leg de uitkomst vast in [`docs/benchmarks.md`](../../docs/benchmarks.md).

Versienummer bijwerken in `apps/electron-anonimiseer/package.json` en
`packages/pii-engine/pyproject.toml`; commit als `chore(release): vX.Y.Z`.

---

## 2. Lokaal bouwen en testen (macOS)

```bash
cd apps/electron-anonimiseer
npm ci
npm run bundle:engine                                   # engine, modellen, licentieoverzicht
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac      # ongesigneerd
```

`bundle:engine` bouwt de engine met PyInstaller, haalt de meegeleverde modellen op
(`build/prepare-hf-seed.py`, vaste versies), controleert dat PyMuPDF niet in de bundel zit en
schrijft het licentieoverzicht (`scripts/third_party_notices.py`).

Daarna de end-to-end- en crashtest tegen de gebouwde app (zie [`e2e/README.md`](e2e/README.md));
alles moet PASS zijn. Controleer ook met de hand: kopbalk "Engine · Online", niet "Beperkt";
de versie onderaan klopt; PDF-ondersteuning downloaden in Modellen beheren werkt.

---

## 3. Release via CI

1. Tag en push:

   ```bash
   VERSION="X.Y.Z"
   git tag -a "anonimiseer-v${VERSION}" -m "Anonimiseer v${VERSION}"
   git push origin "anonimiseer-v${VERSION}"
   ```

2. Publiceer een release voor die tag, met de notities uit
   [`RELEASE_NOTES_TEMPLATE.md`](RELEASE_NOTES_TEMPLATE.md):

   ```bash
   gh release create "anonimiseer-v${VERSION}" --repo HAN-AIM-CMD-WG/DATALAB \
       --title "Anonimiseer v${VERSION}" --notes-file RELEASE_NOTES_TEMPLATE.md
   ```

3. De workflow `electron-installer` bouwt dan de installers voor macOS (Apple-chip) en
   Windows. Hij draait op elk ervan de end-to-end-test, op macOS ook de crashtest, en hangt
   de installers met `SHA256SUMS.txt` aan de release. Faalt een test, dan komt er niets aan
   de release.

4. Pas daarna de release als **latest** markeren, niet als pre-release, zodat
   `releases/latest` werkt.

---

## 4. Code-signing

### macOS

De workflow signeert en notariseert vanzelf zodra deze repository-secrets bestaan; zonder
blijft de build ongesigneerd:

| Secret | Inhoud |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application-certificaat als `.p12`, base64 |
| `MAC_CSC_KEY_PASSWORD` | wachtwoord van dat `.p12`-bestand |
| `APPLE_ID` | Apple ID van het ontwikkelaarsaccount |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specifiek wachtwoord voor die Apple ID |
| `APPLE_TEAM_ID` | Team ID van het ontwikkelaarsaccount |

Notarisatie vraagt de hardened runtime; de rechten die de engine daarbij nodig heeft
staan in [`build/entitlements.mac.plist`](build/entitlements.mac.plist), met de reden.
**Nog niet getest met een echt certificaat.** Controleer bij de eerste gesigneerde build:
`codesign --verify --deep --strict` op de app, `spctl -a -vv`, en dat PDF-ondersteuning
na het downloaden nog laadt.

### Windows

Certificaten voor code-signing staan sinds 2023 op een hardware- of cloudsleutel; een
`.pfx` in CI volstaat niet meer. electron-builder ondersteunt cloudsigning (bijvoorbeeld
via `win.azureSignOptions`). Welke dienst het wordt, is nog niet gekozen; tot dan blijft
de Windows-installer ongesigneerd.

---

## 5. Als er iets stuk is

GitHub heeft geen "unrelease": trek een nieuwe patch-release met de fix en markeer de oude
als pre-release. Een gepubliceerde tag nooit overschrijven: wie al gedownload heeft, krijgt
dan een andere hash dan in `SHA256SUMS.txt` staat.

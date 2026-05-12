# Anonimiseer vX.Y.Z

Lokale, privacy-vriendelijke PII-anonimisering voor Nederlandse documenten.
Geen account, geen cloud, geen Python/Node nodig — alles zit in de download.

## ⬇️ Downloaden

| OS | Bestand | Wat doe je ermee? |
|---|---|---|
| **macOS** (Apple Silicon + Intel) | `Anonimiseer-X.Y.Z.dmg` | Open de `.dmg`, sleep de app naar **Programma's**. |
| **Windows 10/11** (64-bit) | `Anonimiseer-Setup-X.Y.Z.exe` | Dubbelklik de installer (admin niet nodig). |
| Linux | `Anonimiseer-X.Y.Z.AppImage` | `chmod +x`, dubbelklik. |

### Eerste keer openen

Omdat de app niet code-signed is, krijg je éénmalig een waarschuwing:

- **macOS** → rechts-klik → Openen → "Open"
- **Windows** → "Meer info" → "Toch uitvoeren"

Daarna start de app gewoon vanaf je Dock / Start-menu.

## ✨ Wat is er nieuw

<!-- Vul aan vanuit `git log` sinds vorige tag -->

- 

## 🐛 Bug fixes

- 

## ⚠️ Bekende beperkingen

- App is nog niet code-signed (Gatekeeper / SmartScreen-warning bij eerste opening).
- Engine-startup duurt ~5-10s bij eerste run (spaCy-model laden).
- Beide installers ~700 MB-1 GB door embedded Python-runtime + NLP-modellen (offline-werking).

## 🔒 Privacy

- Detectie en pseudonimisering vinden **volledig op je eigen apparaat** plaats.
- De app luistert alleen op `127.0.0.1` (localhost) en doet geen externe calls.
- Geen telemetrie. Geen accounts. Geen logging van content.

## 🔢 SHA-256 checksums

```
<vul aan na build>
```

Verifieer met:
```bash
shasum -a 256 Anonimiseer-X.Y.Z.dmg
certutil -hashfile Anonimiseer-Setup-X.Y.Z.exe SHA256
```

## 📚 Documentatie

- README: <https://github.com/HAN-AIM-CMD-WG/DATALAB/tree/main/anonimiseer>
- Architectuur: [`docs/architecture.md`](https://github.com/HAN-AIM-CMD-WG/DATALAB/blob/main/anonimiseer/docs/architecture.md)
- Disclaimer: [`docs/disclaimer-nl.md`](https://github.com/HAN-AIM-CMD-WG/DATALAB/blob/main/anonimiseer/docs/disclaimer-nl.md)

## 🙏 Verantwoordelijkheid

Anonimiseer is een **hulpmiddel** — geen 100%-garantie. Loop de gemarkeerde
spans altijd na voor je een document deelt. Onder de AVG blijft de
gebruiker verwerkingsverantwoordelijke.

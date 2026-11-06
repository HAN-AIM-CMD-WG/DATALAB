# Anonimiseer vX.Y.Z

Lokale, privacy-vriendelijke PII-anonimisering voor Nederlandse documenten.
Geen account, geen cloud, geen Python/Node nodig — alles zit in de download.

## ⬇️ Downloaden

| OS | Bestand | Wat doe je ermee? |
|---|---|---|
| **macOS** (Apple-chip: M1 of nieuwer) | `Anonimiseer-X.Y.Z-arm64.dmg` | Open de `.dmg`, sleep de app naar **Programma's**. |
| **Windows 10/11** (64-bit) | `Anonimiseer Setup X.Y.Z.exe` | Dubbelklik de installer (admin niet nodig). |

Macs met een Intel-processor worden niet ondersteund.

### Eerste keer openen

Zolang de app niet code-signed is, krijg je éénmalig een waarschuwing:

- **macOS** → rechts-klik → Openen → "Open"
- **Windows** → "Meer info" → "Toch uitvoeren"

Daarna start de app gewoon vanaf je Dock / Start-menu.

## ✨ Wat is er nieuw

<!-- Vul aan vanuit `git log` sinds vorige tag -->

- 

## 🐛 Bug fixes

- 

## ⚠️ Bekende beperkingen

- De eerste analyse duurt langer: de taalmodellen worden dan eenmalig geladen.
- Het meegeleverde PII-model gebruikt ~3 GB werkgeheugen; uitzetten kan in Modellen beheren.
- PDF-ondersteuning is een aparte download van ~24 MB (licentie AGPL-3.0), in Modellen beheren.

## 🔒 Privacy

- Detectie en pseudonimisering vinden **volledig op je eigen apparaat** plaats.
- De app luistert alleen op `127.0.0.1` (localhost). Internet alleen als je zelf iets
  downloadt in Modellen beheren, en nooit met documentinhoud.
- Geen telemetrie. Geen accounts. Geen logging van content.

## 🔢 SHA-256 checksums

Staan in `SHA256SUMS.txt` bij deze release. Verifieer met:

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing          # macOS
certutil -hashfile "Anonimiseer Setup X.Y.Z.exe" SHA256   # Windows
```

## 📚 Documentatie

- README: <https://github.com/HAN-AIM-CMD-WG/DATALAB/tree/main/anonimiseer>
- Architectuur: [`docs/architecture.md`](https://github.com/HAN-AIM-CMD-WG/DATALAB/blob/main/anonimiseer/docs/architecture.md)
- Licenties van derden: [`THIRD-PARTY-NOTICES.md`](https://github.com/HAN-AIM-CMD-WG/DATALAB/blob/main/anonimiseer/THIRD-PARTY-NOTICES.md)
- Disclaimer: [`docs/disclaimer-nl.md`](https://github.com/HAN-AIM-CMD-WG/DATALAB/blob/main/anonimiseer/docs/disclaimer-nl.md)

## 🙏 Verantwoordelijkheid

Anonimiseer is een **hulpmiddel** — geen 100%-garantie. Loop de gemarkeerde
spans altijd na voor je een document deelt. Onder de AVG blijft de
gebruiker verwerkingsverantwoordelijke.

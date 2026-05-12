# Security & privacy

Anonimiseer is een hulpmiddel om persoonsgegevens te beschermen. Dit document
beschrijft hoe wij datzelfde principe op de **broncode en testdata in deze repo**
toepassen, hoe je een kwetsbaarheid kunt melden, en welke garanties wel/niet
gelden voor de gepubliceerde binaries.

## Geen echte persoonsgegevens in deze repo

Alle voorbeelden, fixtures en testdata in dit project gebruiken **fictieve of
ongeldige PII**. We controleren dat actief:

| Categorie | Hoe we het garanderen |
| --- | --- |
| **BSN's** | Alleen Elfproef-test-waardes (`123456782`, `111222333`, `234567880`, `999995571`). Geen enkele test gebruikt een echt persoonsgebonden BSN. |
| **Telefoonnummers** | Standaard placeholder-formats: `06-12345678`, `+31 6 1234 5678`, `0345-123456`. |
| **E-mailadressen** | Domeinen `example.com`, `example.nl`, `voorbeeld.nl` (gereserveerd voor documentatie per RFC 2606 / vergelijkbaar voor `.nl`). Plus de officiële mailbox `datalab@han.nl` voor support-referenties. |
| **Persoonsnamen** | Fictief (`Jan de Vries`, `Anna Jansen`, `Fatima El Amrani`, `Mevrouw van den Broek`, etc.). Geen verwijzingen naar echte HAN-collega's, studenten of klanten. Publieke figuren (`Mark Rutte` in een DR-demo) waar relevant. |
| **IBAN** | Test-IBAN's met geldige MOD-97 maar zonder echte rekeninghouder. |
| **Adressen** | Bestaande straatnamen (`Ruitenberglaan 26`, `Dorpsstraat 12`) maar met fictieve bewoners. |
| **Studentnummers** | Pattern-demo's zoals `s1234567` — gegenereerd, niet uit Osiris/iSAS. |
| **Credentials/tokens** | Geen. CI-secrets staan in GitHub Actions Secrets, niet in de repo. |

Als je toch een verdacht gegeven aantreft: open een **private security advisory**
via `Security → Report a vulnerability` op de repo-pagina, of mail
`datalab@han.nl`. Maak géén public issue aan.

## Wat de gepubliceerde app wel/niet doet

| Aspect | Status |
| --- | --- |
| Data-verwerking | **Volledig lokaal**: PII-engine luistert standaard op `127.0.0.1`, geen uitgaande verbindingen. |
| Telemetrie | Geen. Geen analytics, crash-reporting of "phone home". |
| Auto-updates | Uitgeschakeld in v0.1.0. Updates vereisen handmatige download. |
| Ollama-review (optioneel) | Praat alleen met `127.0.0.1:11434` (lokaal Ollama-daemon). Niets buiten de Mac. |
| Code-signing | **Niet gesigneerd** voor v0.1.0 (pilot-fase). Gebruikers krijgen eenmalig een Gatekeeper/SmartScreen-waarschuwing. |
| SHA-256-verificatie | Hashes staan in de [release-notes](https://github.com/HAN-AIM-CMD-WG/DATALAB/releases/latest). |

## Bekende beperkingen (security-relevant)

- **Engine bind-adres in scenario B**: de pilot-quickstart beschrijft hoe je de
  engine op `0.0.0.0` start zodat Docker'd Open WebUI erbij kan. Doe dit
  **alleen op een development-machine** — voor server-deploys bind je op
  `127.0.0.1` en zet je auth/TLS ervoor.
- **Geen authenticatie op de PII-engine API**: bewust weggelaten voor de pilot
  zodat de Electron-app lokaal kan praten zonder gedoe. Niet blootstellen aan
  het internet.
- **PII-detectie is geen garantie**: ondanks 48 recognizers + checksum + NER
  blijft het een hulpmiddel. Loop highlights altijd handmatig na voor je een
  document deelt. Zie ook [`docs/disclaimer-nl.md`](docs/disclaimer-nl.md).

## AVG / GDPR

De HAN is verwerkingsverantwoordelijke voor data die je met deze tool verwerkt.
Anonimiseer-developers verwerken geen persoonsgegevens van eindgebruikers; alle
verwerking gebeurt lokaal op het apparaat van de gebruiker. Voor vragen over
verwerkers-overeenkomsten of impact-assessments: contacteer DataLab via de
HAN-kanalen.

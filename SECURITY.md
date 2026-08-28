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
| **BSN's** | Verzonnen testwaardes. Een deel is Elfproef-geldig (`123456782`, `111222333`, `234567880`, `999995571`) om detectie te toetsen, een deel is bewust Elfproef-ongeldig (`987654321`, `123456789`, `111111111`) om false-positives te toetsen. Geen enkele test gebruikt een echt persoonsgebonden BSN. |
| **Telefoonnummers** | Standaard placeholder-formats: `06-12345678`, `+31 6 1234 5678`, `0345-123456`. |
| **E-mailadressen** | Domeinen `example.com`, `example.nl`, `voorbeeld.nl` (gereserveerd voor documentatie per RFC 2606 / vergelijkbaar voor `.nl`). Plus de officiële mailbox `datalab@han.nl` voor support-referenties. |
| **Persoonsnamen** | Fictief (`Jan de Vries`, `Anna Jansen`, `Fatima El Amrani`, `Mevrouw van den Broek`, etc.). Geen verwijzingen naar echte HAN-collega's, studenten of klanten. Publieke figuren (`Mark Rutte` in een DR-demo) waar relevant. |
| **IBAN** | Test-IBAN's met geldige MOD-97 maar zonder echte rekeninghouder. |
| **Adressen** | Bestaande straatnamen (`Ruitenberglaan 26`, `Dorpsstraat 12`) maar met fictieve bewoners. |
| **Studentnummers** | Pattern-demo's zoals `s1234567` — gegenereerd, niet uit Osiris/iSAS. |
| **Credentials/tokens** | Geen. De CI gebruikt uitsluitend de automatisch verstrekte `GITHUB_TOKEN`; er zijn geen eigen repository-secrets in gebruik. |

## Een kwetsbaarheid of verdacht gegeven melden

Mail **`datalab@han.nl`** met "security" in de onderwerpregel, of open een
private security advisory via `Security → Report a vulnerability` op de
repo-pagina. Maak géén public issue aan.

Je krijgt binnen **5 werkdagen** een ontvangstbevestiging. We streven naar een
oplossing of een onderbouwd standpunt binnen **90 dagen**, en stemmen het moment
van openbaarmaking met je af.

In scope: de Electron-app, de PII-engine en de build- en releaseketen in deze
repo. Buiten scope: de infrastructuur van de HAN zelf, en de nauwkeurigheid van
de PII-detectie (dat is geen kwetsbaarheid maar een bekende beperking, zie
onderaan).

## Wat de gepubliceerde app wel/niet doet

| Aspect | Status |
| --- | --- |
| Data-verwerking | **Volledig lokaal**: de PII-engine luistert op `127.0.0.1` en de inhoud van je documenten verlaat je apparaat nooit. |
| Uitgaande verbindingen | Alleen op jouw initiatief, en nooit met documentinhoud. Het downloaden van een taalmodel gaat naar HuggingFace of (via je eigen Ollama-daemon) naar de Ollama-registry. Let op: het aanbevolen SoNaR-model zit **niet** in de installer, dus de eerste keer dat je het gebruikt wordt het opgehaald (~400 MB). |
| Telemetrie | Geen. Geen analytics, crash-reporting of "phone home". |
| Auto-updates | Uitgeschakeld tijdens de pilot. Updates vereisen handmatige download. |
| Ollama-review (optioneel) | Praat alleen met `127.0.0.1:11434` (lokaal Ollama-daemon). Niets buiten de Mac. |
| Code-signing | **Niet gesigneerd** tijdens de pilot. Gebruikers krijgen eenmalig een Gatekeeper/SmartScreen-waarschuwing. |
| SHA-256-verificatie | Hashes staan in de [release-notes](https://github.com/HAN-AIM-CMD-WG/DATALAB/releases/latest). |

## Bekende beperkingen (security-relevant)

- **Engine bind-adres in scenario B**: de pilot-quickstart beschrijft hoe je de
  engine op `0.0.0.0` start zodat Docker'd Open WebUI erbij kan. Doe dit
  **alleen op een development-machine** — voor server-deploys bind je op
  `127.0.0.1` en zet je auth/TLS ervoor.
- **Geen authenticatie op de PII-engine API**: bewust weggelaten voor de pilot
  zodat de Electron-app lokaal kan praten zonder gedoe. Niet blootstellen aan
  het internet.
- **Authenticatie tussen app en engine**: de app geeft de engine bij het
  starten een geheim token mee. Alle endpoints behalve `/health` eisen dat
  token, en `/health` bewijst via een HMAC over een meegestuurde nonce dat het
  écht de engine van deze app is. Daarmee kan een ander lokaal proces zich niet
  als de engine voordoen. Start je de engine handmatig zonder token — zoals in
  development — dan is er geen authenticatie; doe dat alleen op een
  ontwikkelmachine.
- **PII-detectie is geen garantie**: ondanks tientallen recognizers, checksums
  en NER blijft het een hulpmiddel. Loop highlights altijd handmatig na voor je
  een document deelt. Zie ook
  [`anonimiseer/docs/disclaimer-nl.md`](anonimiseer/docs/disclaimer-nl.md).

## AVG / GDPR

De HAN is verwerkingsverantwoordelijke voor data die je met deze tool verwerkt.
Anonimiseer-developers verwerken geen persoonsgegevens van eindgebruikers; alle
verwerking gebeurt lokaal op het apparaat van de gebruiker. Voor vragen over
verwerkers-overeenkomsten of impact-assessments: contacteer DataLab via de
HAN-kanalen.

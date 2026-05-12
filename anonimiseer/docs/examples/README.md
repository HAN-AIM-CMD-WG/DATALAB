# Voorbeeld- en testdocumenten

Bestanden hier zijn **volledig fictief** en bedoeld om Anonimiseer-functionaliteit
te demonstreren of automatisch te testen. Geen enkele entiteit (naam, BSN, IBAN,
adres, social-media-handle, etc.) verwijst naar een werkelijk persoon.

## Bestanden

| Bestand | Wat is het | Voor wie |
| --- | --- | --- |
| [`test-document.md`](test-document.md) | Markdown met ~150 verzonnen PII-instanties verdeeld over 10 secties (NL/BE/DE/FR/UK personen, banken, identifiers, online-handles, HAN-specifiek, edge-cases, negatieve gevallen). | Eindgebruikers + developers |
| [`test-document.expected.jsonl`](test-document.expected.jsonl) | Per-regel JSON met de verwachte entiteit-spans (start/end/type) van het testdocument. Gebruikt door regressie-scoring. | Developers (PII-engine) |

## Hoe gebruik je het testdocument?

### Voor pilot-gebruikers (Electron-app)

1. Download `test-document.md` (zie release-pagina of klik direct in deze folder).
2. Start Anonimiseer, sleep het bestand in stap 1 van de wizard.
3. Loop de geanonimiseerde output na — alle 150+ entiteiten zouden gemaskeerd
   moeten zijn, terwijl de "negatieve gevallen" in sectie 10 (HTTP-status 404,
   versienummers, jaartallen) ongemoeid blijven.

### Voor developers

```bash
cd anonimiseer/packages/pii-engine
# Engine starten met aanbevolen profiel
PII_ENGINE_ENABLE_BSN=true PII_ENGINE_ENABLE_SONAR=true pii-engine &

# Document analyseren en met de verwachte spans vergelijken
python score.py \
  --document ../../docs/examples/test-document.md \
  --expected ../../docs/examples/test-document.expected.jsonl
```

Verwacht resultaat: 100% recall + 100% precision met de strenge instelling +
HAN-profiel + SoNaR aan. Wijkt dit af, dan is er een regressie in de
recognizers of in `postfilter.py`.

## Toevoegen aan de testset

Bij het toevoegen van nieuwe PII-categorieën:

1. Voeg de testregels **onderaan** toe aan `test-document.md` (strikt-additief
   zodat bestaande regelnummers stabiel blijven).
2. Voeg de bijbehorende spans toe aan `test-document.expected.jsonl`.
3. Herhaal `python score.py …` — fix wat nog niet wordt gepakt.

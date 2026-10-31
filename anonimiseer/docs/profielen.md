# Profielen voor je organisatie

Een profiel bepaalt twee dingen:

- of de **onderwijsherkenners** meedoen (klas-, cursus-, CROHO- en personeelsnummers);
- welke **eigen begrippen** Anonimiseer zoekt: dingen die voor jouw organisatie vertrouwelijk
  zijn maar in geen enkele standaardlijst staan, zoals een dossiernummer of een projectcode.

Je kiest het profiel in *Modellen beheren*, onder *Profiel van je organisatie*. Anonimiseer
onthoudt de keuze, ook na een herstart.

## Ingebouwde profielen

| Profiel | Onderwijsherkenners | Eigen begrippen |
|---|---|---|
| Algemeen | uit | geen |
| HAN-onderwijs | aan | geen |

Zolang je niets kiest, gebruikt Anonimiseer *HAN-onderwijs*.

## Een eigen profiel

Een eigen profiel is een JSON-bestand dat de beheerder bij jouw organisatie maakt en verspreidt.
Je importeert het met *Profiel importeren…*; Anonimiseer bewaart een kopie in zijn eigen map op
je computer. Een voorbeeld, met verzonnen begrippen:
[`examples/profiel-voorbeeld.json`](examples/profiel-voorbeeld.json).

```json
{
  "anonimiseerProfiel": 1,
  "naam": "Voorbeeldorganisatie",
  "omschrijving": "Profiel met de eigen nummers van de afdeling Dossiers.",
  "onderwijsherkenners": false,
  "begrippen": [
    {
      "label": "dossiernummer",
      "omschrijving": "Nummer van een dossier: een D, een jaartal en vier cijfers, bijvoorbeeld D-2024-0012"
    }
  ]
}
```

| Veld | Verplicht | Regels |
|---|---|---|
| `anonimiseerProfiel` | ja | altijd `1` |
| `naam` | ja | hoogstens 60 tekens; zo heet het profiel in de app |
| `omschrijving` | nee | hoogstens 300 tekens |
| `onderwijsherkenners` | nee | `true` of `false` (standaard `false`) |
| `begrippen` | nee | hoogstens 25; elk met een `label` (1–40 tekens: letters, cijfers, spaties, `-` en `/`) en een `omschrijving` (hoogstens 300 tekens) |

### Hoe eigen begrippen werken

Eigen begrippen worden gezocht door het model *GLiNER2-PII (eigen begrippen)*. Dat model
download je één keer in *Modellen beheren* (ongeveer 1,1 GB); zonder dat model worden de
begrippen niet gezocht en staat de engine op "Beperkt".

Het model zoekt alleen op het label en de omschrijving; het hoeft niet getraind te worden.
Zolang het profiel actief is, worden de begrippen in elk document gezocht. Een gevonden begrip
wordt vervangen door een pseudoniem met het label erin, bijvoorbeeld `TERM_DOSSIERNUMMER_1`.

**Schrijf een smalle omschrijving.** Noem de vorm, met een verzonnen voorbeeld. Een brede
omschrijving vangt ook andere codes: in onze test vond "Code van een project" ook cursuscodes.
Dat maskeert te veel, maar lekt niets.

## Wat niet in een profiel hoort

- Geen echte namen, nummers of andere persoonsgegevens, ook niet als voorbeeld in een
  omschrijving. Verzin een voorbeeld dat de vorm laat zien.
- Profielen van partners horen bij de partner, niet in deze repository.

# Disclaimer en verantwoordelijkheid

Centrale plek voor alle Nederlandstalige waarschuwingsteksten die in de app, de browser-extensie, de Open WebUI-filter en op output-artefacten verschijnen. Verandert deze tekst? Dan wordt de first-run-disclaimer in de app opnieuw aan de gebruiker voorgelegd.

## 1. First-run modal (Electron-app en browser-extensie)

**Titel**: Belangrijk voor je begint

> Deze tool helpt je om persoonsgegevens uit een document of chat-bericht te halen voordat je het deelt. Lees dit even door.
>
> - Deze tool is een **hulpmiddel**, geen garantie. Hij kan persoonsgegevens missen of per ongeluk gewone woorden markeren.
> - **Jij blijft verantwoordelijk** voor wat je deelt. Controleer elk resultaat vóór je het doorstuurt, publiceert of in een AI-chat plakt.
> - Modellen maken fouten, zeker bij bijnamen, afkortingen, slordige spelling, tabellen en gescande PDF's.
> - Pseudonimisering is omkeerbaar: bewaar het mapping-bestand **veilig en apart** van het geanonimiseerde document.
> - De app slaat niets op buiten jouw computer — tenzij je zelf een externe LLM aanzet. Dat doe je bewust.
> - Controleer extra zorgvuldig bij gevoelige categorieën (gezondheid, geloof, etniciteit, strafblad) — dat zijn bijzondere persoonsgegevens onder **artikel 9 AVG**.
> - Bij twijfel: niet delen. Raadpleeg je FG of privacy-coördinator.
> - Gebruik van deze tool valt onder het beleid van jouw organisatie.

Onderaan:

> ☐ Ik begrijp dat ik verantwoordelijk blijf voor het controleren van elk resultaat.
>
> `[ Annuleren ]` `[ Volgende ]` (Volgende is disabled tot aangevinkt)

## 2. Banner Stap 3 (Controleren)

> ⚠ **Controleer zorgvuldig.** De tool kan namen, data of nummers missen of onterecht markeren. Scrol door het volledige resultaat voordat je op "Opslaan" klikt.

Niet dismissible. Verdwijnt pas als de gebruiker tot het einde heeft gescrold.

## 3. Context-gevoelige waarschuwingen

| Trigger | Waarschuwing |
|---|---|
| Entiteit met confidence < 0.6 | Gele onderlijning + tooltip: "Weet niet zeker of dit een naam is. Controleer zelf." |
| Gescande/OCR-PDF gedetecteerd | "Dit PDF is via OCR ingelezen. Controleer extra goed op gemiste persoonsgegevens, vooral in tabellen." |
| Artikel 9-trefwoorden (medisch, religie, etniciteit, seksualiteit, vakbond, strafblad) | Rood: "Dit document bevat mogelijk bijzondere persoonsgegevens (art. 9 AVG). Wees extra voorzichtig." |
| Taaldetectie wijkt af van modelkeuze | "Document lijkt in het Engels, maar er is een Nederlands model gekozen. De kwaliteit kan lager zijn." |
| 0 entiteiten gevonden in lange tekst | "De tool heeft geen persoonsgegevens gevonden. Dat kán kloppen, maar controleer zelf of dat klopt met de inhoud." |
| Externe LLM aan | "Externe versterking staat aan. Dit stuurt tekst buiten je computer." |

## 4. Check-off Stap 4 (Opslaan)

Twee verplicht aan te vinken items, labels roteren tussen formuleringen om ritueel afvinken te ontmoedigen:

> ☐ Ik heb het resultaat in Stap 3 doorgelezen.
> ☐ Ik begrijp dat ik verantwoordelijk ben voor het eindresultaat.

## 5. DISCLAIMER.txt bij output-bestanden

```
Dit bestand is automatisch bewerkt met Anonimiseer v{versie} op {datum}.

Modus       : {anonimiseren | pseudonimiseren}
Modellen    : {ids + hashes}
Externe LLM : {ja/nee, endpoint}
Tellers     : {X namen, Y e-mails, Z BSN, ...}

Geen enkele automatische methode is 100% betrouwbaar. De gebruiker is zelf
verantwoordelijk voor controle en voor het verdere gebruik van dit bestand.

De originele tekst en (bij pseudonimisering) het mapping-bestand dienen apart
en beveiligd bewaard te worden. Deel het mapping-bestand nooit samen met
het geanonimiseerde document in dezelfde cloudmap of e-mail.
```

## 6. Open WebUI filter messaging

**System-message bij eerste chat per sessie** (niet naar het model, alleen aan gebruiker):

> ⚠ Filter actief: persoonsgegevens worden automatisch weggehaald voor ze naar het externe model gaan. Dit is een hulpmiddel — controleer je vraag en het antwoord zelf. Het filter kan dingen missen.

**Inline-annotatie onder user-bubble** bij > 3 verwijderingen:

> 12 persoonsgegevens verwijderd vóór verzending · [details](#)

**Footer onder LLM-antwoord**:

> Antwoord van extern model. Controleer zelf op juistheid en op eventueel teruggekeerde persoonsgegevens.

## 7. MAPPING_README.txt (bij pseudonimiseren)

```
BELANGRIJK: mapping-bestand voor pseudonimiseer-sessie

Dit bestand bevat de vertaaltabel tussen echte persoonsgegevens en de
codes (PERSOON_1, BSN_1, ...) in het geanonimiseerde document. Wie dit
bestand heeft, kan het geanonimiseerde document de-anonimiseren.

Regels:
- Bewaar dit bestand gescheiden van het geanonimiseerde document.
- Deel het nooit samen in dezelfde cloudmap, e-mail of chat.
- Verwijder het zodra je de originele gegevens niet meer nodig hebt.
- Verlies van het wachtwoord betekent dat het mapping onbruikbaar is — dat is ook de bedoeling.
```

---

**Open punt**: de uiteindelijke wettelijke frasering laten reviewen door de FG / privacy-coördinator vóór de pilot.

# HAN AI Assistent — Handleiding

Welkom! Dit is een private AI-omgeving van het HAN Datalab. De modellen draaien op onze eigen SURF ResearchCloud server in Nederland — je data blijft binnen de HAN.

Selecteer het model linksboven in het chatvenster.

---

## De modellen

### HAN Assistent (Qwen3 14B)
Het slimste en meest veelzijdige model. Denkt eerst na voordat het antwoordt — je ziet dan "Thought for X seconds" boven het antwoord. Klik erop om het denkproces in te klappen; het uiteindelijke antwoord staat eronder.

Dit model is het beste voor:
- Lesmateriaal maken of herschrijven voor een ander niveau
- Toetsvragen en opdrachten genereren
- Teksten samenvatten of vertalen
- Vragen beantwoorden over je geüploade documenten (RAG)
- Creatieve taken: casussen schrijven, scenario's bedenken
- Complexe analyses en vergelijkingen

Werkt goed in het Nederlands en 100+ andere talen. Heeft een groot geheugen (128K context) waardoor het ook lange documenten aankan.

### HAN Nakijker (GLM-4 9B)
Snel en betrouwbaar. Antwoordt direct zonder denkpauze. Verzint minder dingen dan andere modellen en is daarom extra geschikt voor beoordelen.

Dit model is het beste voor:
- Nakijken en beoordelen van studentwerk aan de hand van een rubric
- Gestructureerde feedback formuleren
- Tabellen, lijsten en overzichten genereren
- Snelle, feitelijke vragen waar je direct antwoord op wilt

### Onboarding (dit model)
Beantwoordt vragen over deze omgeving op basis van deze handleiding. Vraag hoe dingen werken of hoe je documenten uploadt.

### Wanneer welk model?

| Ik wil... | Gebruik |
|---|---|
| Toetsvragen maken op basis van mijn lesmateriaal | HAN Assistent + Knowledge Base |
| Studentwerk nakijken met een rubric | HAN Nakijker |
| Een tekst samenvatten of vertalen | HAN Assistent |
| Feedback schrijven op een werkstuk | HAN Nakijker |
| Een casus of scenario bedenken | HAN Assistent |
| Snel een feitelijk antwoord | HAN Nakijker |
| Hulp met deze omgeving | Onboarding |

**Tip:** maak een eerste versie met de HAN Assistent en laat de HAN Nakijker het controleren.

### Rauwe modellen
Je ziet ook de basis-modellen (Qwen3 14b, GLM4 9b) in de lijst. Dit zijn dezelfde modellen maar dan zonder HAN-instellingen — geen Nederlandse system prompt, geen vooringestelde instructies. Je kunt ze gebruiken om vrij te experimenteren of te vergelijken met de HAN-versies.

---

## Documenten gebruiken (RAG) — je eigen kennisbank

Je kunt eigen documenten uploaden en het model er vragen over laten beantwoorden. Denk aan lesmateriaal, rubrics, readers, toetsen of onderzoeksartikelen.

### Stap 1: Knowledge Base aanmaken
1. Klik op **Werkplaats** (linkermenu) → **Kennis**
2. Klik op **+ Kennis aanmaken**
3. Geef een duidelijke naam, bijv. `Cursus-AI-Jaar2` of `Rubric-Afstuderen`
4. Voeg een korte beschrijving toe

### Stap 2: Documenten uploaden
1. Open je Knowledge Base
2. Klik op **Bestanden uploaden**
3. Upload je bestanden (PDF, DOCX, PPTX, TXT)
4. Wacht tot de verwerking klaar is

### Stap 3: Gebruiken in chat
Typ `#` in het chatvenster → selecteer je Knowledge Base → stel je vraag.

**Voorbeeld:**
```
#Cursus-AI-Jaar2 Genereer 5 meerkeuzevragen over hoofdstuk 3
```

Het model zoekt automatisch in je documenten en verwijst naar de bron in het antwoord.

---

## Voorbeeldprompts — kopieer en pas aan

### Toetsvragen genereren
```
#KennisBase Genereer 10 meerkeuzevragen (4 opties) over het onderwerp
[onderwerp]. Niveau: 2e-jaars HBO. Voeg per vraag het juiste antwoord
en een korte toelichting toe.
```

### Feedback op studentwerk
```
Geef formatieve feedback op het volgende werkstuk. Gebruik deze criteria:
- Onderbouwing met bronnen
- Structuur en samenhang
- Taalgebruik en spelling

[plak hier het werkstuk]
```

### Nakijken met rubric
```
#Rubric-Afstuderen Beoordeel het volgende verslag aan de hand van de
rubric. Geef per criterium een score en toelichting.

[plak hier het verslag]
```

### Lesmateriaal samenvatten
```
#Lesmateriaal Maak een samenvatting van dit materiaal geschikt voor
1e-jaars HBO studenten. Maximaal 500 woorden. Gebruik opsommingstekens.
```

### Casussen schrijven
```
Schrijf een realistische casus over [onderwerp] voor 3e-jaars
[opleiding] studenten. De casus moet toepasbaar zijn voor een
groepsopdracht van 4 studenten.
```

### Open vragen genereren
```
#KennisBase Genereer 5 open vragen op analyseniveau (Bloom's taxonomie)
over [onderwerp]. Voeg per vraag een modelantwoord toe.
```

---

## Tips

- **Wees specifiek** — hoe meer context je geeft, hoe beter het antwoord
- **Geef het niveau aan** — "voor 1e-jaars HBO" levert ander resultaat dan "voor masterstudenten"
- **Itereer** — niet tevreden? Vraag: "Maak de vragen moeilijker" of "Voeg meer praktijkvoorbeelden toe"
- **Gebruik `#`** om je Knowledge Base te koppelen aan een chat
- **Geef feedback** — klik op het duimpje (omhoog of omlaag) onder elk antwoord. Zo helpen we de omgeving te verbeteren!

---

## Wat kan ik zelf?

- Chatten met alle beschikbare modellen
- Eigen Knowledge Bases aanmaken en documenten uploaden
- Je chatgeschiedenis bekijken in het linkermenu
- Prompts opslaan voor hergebruik (typ `/` in de chatbalk)

### Wat wordt bewaard?

- **Chatgeschiedenis** — blijft bewaard, je kunt eerdere gesprekken teruglezen
- **Knowledge Bases en documenten** — blijven bewaard zolang de omgeving draait
- **Instellingen** — worden voor je onthouden

**Let op: dit is een experimenteeromgeving.** We kunnen niet garanderen dat je data permanent bewaard blijft. De omgeving kan worden herstart of opnieuw opgezet. Exporteer of kopieer belangrijke output altijd naar je eigen systeem (bijv. Word, Teams, OneDrive). Beschouw elke sessie alsof het je laatste kan zijn.

### Wat kan ik niet?

- Modellen toevoegen, wijzigen of verwijderen
- Instellingen van de omgeving aanpassen
- Andere gebruikers beheren
- Een eigen model/bot aanmaken (dat doet het Datalab-team voor je)

Alles wat je nodig hebt is al ingesteld — je kunt direct aan de slag.

### Eigen "bot" maken met je eigen documenten

Je kunt geen apart model aanmaken, maar dat hoeft ook niet. Met een Knowledge Base bereik je hetzelfde:

1. Maak een Knowledge Base aan (bijv. `Rubric-CMD`)
2. Upload je documenten (rubric, lesmateriaal, etc.)
3. Typ in de chat `#Rubric-CMD` gevolgd door je vraag

Het model gebruikt dan automatisch jouw documenten als bron. Zo heb je in feite je eigen "vakbot" zonder dat er iets speciaals ingesteld hoeft te worden.

**Voorbeeld:** je uploadt je beoordelingsrubric en typt:
```
#Rubric-CMD Beoordeel dit werkstuk aan de hand van de rubric en geef per criterium feedback.
```

Wil je een écht apart model met een vaste system prompt en eigen instellingen? Vraag het Datalab-team — wij maken het voor je aan.

---

## Spelregels

Dit is een experimenteeromgeving. De modellen draaien lokaal op een HAN-server, dus je data is veilig. Wel gelden de HAN AI-spelregels:

- **Controleer altijd de output** — AI kan fouten maken of dingen verzinnen
- **Jij blijft verantwoordelijk** voor wat je doet met de output
- **Geen ruwe persoonsgegevens invoeren** — anonimiseer namen en studentnummers als dat nodig is

Meer weten? Lees het volledige [HAN Integraal AI-kader](https://www.han.nl/nieuws/2025/11/aan-de-slag-met-ai-de-han-helpt-je-op-weg/) (10 spelregels).

---

## Hulp nodig?

- **Vragen over deze omgeving?** Gebruik het **Onboarding** model
- **Teams:** [HAN DATALAB - Support](https://teams.microsoft.com/l/channel/19%3A0c8dffdaed59441ca04e7cda56c591bd%40thread.skype/HAN%20DATALAB%20-%20Support?groupId=4e0af524-9865-4e2d-856b-0ba8414ef885&tenantId=5d73e7b7-b3e1-4d00-b303-056140b2a3b4)
- **E-mail:** datalab@han.nl

---

## Veelgestelde vragen

**Kan het model mijn eerdere chats zien?**
Nee, elke chat is een apart gesprek. Het model onthoudt niets tussen sessies.

**Hoe groot mogen mijn bestanden zijn?**
PDF en DOCX tot ~50 MB. Grotere bestanden? Splits ze op in hoofdstukken.

**Kan ik het model in het Engels gebruiken?**
Ja, beide modellen werken goed in het Engels en Nederlands.

**Het model reageert niet of geeft een fout?**
Wacht even en probeer opnieuw. Blijft het zo? Meld het in het Teams-kanaal of mail datalab@han.nl.

**Waar worden mijn gegevens opgeslagen?**
Op een SURF ResearchCloud server in Nederland. Je data verlaat de HAN-omgeving niet.

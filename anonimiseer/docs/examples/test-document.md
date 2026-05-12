# Testdocument Anonimiseer — uitgebreide dekkingstest

> ⚠️ **Volledig fictief document.** Alle namen, BSN's, e-mails, telefoon-
> nummers, IBAN's, creditcardnummers, adressen, social-media handles en
> overige identifiers in dit bestand zijn **verzonnen** of zijn officiële
> test-/voorbeeldwaardes (zoals VISA's `4111-1111-1111-1111`, ABN AMRO's
> voorbeeld-IBAN `NL91ABNA0417164300`, en BSN's die voldoen aan de
> Elfproef maar niet aan een natuurlijk persoon zijn uitgegeven). Eventuele
> overeenkomst met een bestaand persoon of profiel is volledig toevallig.

Dit document is bedoeld om alle PII-detectie-modules van de Anonimiseer-tool
gecontroleerd te testen. Elke sectie test één of meer recognizers; bewust
opgenomen zijn ook **negatieve gevallen** (woorden die op PII lijken maar
het niet zijn).

> Bij het updaten van dit bestand: regel-/karakterposities staan vast in
> `test-document.expected.jsonl`. Strikt-additief wijzigen of beide
> bestanden gelijktijdig aanpassen.

---

## 1. Personen en contactgegevens (NL)

### Klant A — standaard NL
- **Naam:** Jeroen van der Meulen
- **Geboortedatum:** 14-03-1985
- **BSN:** 123456782
- **E-mail:** j.vandermeulen@voorbeeld.nl
- **Telefoon (mobiel):** +31 6 12345678
- **Telefoon (vast):** 020-5551234
- **Adres:** Keizersgracht 123-3, 1015 CJ Amsterdam
- **Werkgever:** Acme Nederland B.V.

### Klant B — niet-westerse achternaam met tussenvoegsel
- **Naam:** Fatima El Amrani
- **Geboortedatum:** 02/11/1992
- **BSN:** 987654321
- **E-mail:** fatima.elamrani@example.com
- **Telefoon:** +31-6-98765432
- **Adres:** Lange Voorhout 44, 2514 EE Den Haag
- **Werkgever:** Zorgcentrum De Linde

### Klant C — academische titel + dubbele achternaam
- **Naam:** dr. Pieter-Jan de Groot-Visser
- **Geboortedatum:** 30 juni 1978
- **BSN:** 111222333
- **E-mail:** pj.degroot@ziekenhuis-voorbeeld.nl
- **Telefoon:** 010 2345678
- **Adres:** Coolsingel 75, 3012 AG Rotterdam

### Klant D — Aziatisch
- **Naam:** Wei Liu
- **Geboortedatum:** 1990-08-22
- **E-mail:** wei.liu@voorbeeld.nl
- **Telefoon:** 06.12.34.56.78
- **Adres:** Stationsplein 4, 5211 AP 's-Hertogenbosch

### Klant E — genderneutrale voornaam, familienaam = woord
- **Naam:** Robin Klein
- **Geboortedatum:** 7 mei 1995
- **E-mail:** robin@voorbeeld.nl
- **Adres:** Korte Hoogstraat 12-II, 3011 GZ Rotterdam

### Klant F — initialen-only
- **Naam:** P. de Vries
- **Geboortedatum:** 1962-12-01
- **Telefoon:** 0345-123456

### Klant G — bijnaam in aanhalingstekens
- **Naam:** Wim "Pim" Fortuyn-de Boer

### Klant H — buitenlands (BE)
- **Naam:** Sophie Janssens
- **Rijksregisternummer:** 85.07.21-123.45
- **E-mail:** sophie.janssens@voorbeeld.be
- **Telefoon:** +32 475 12 34 56
- **Adres:** Rue de la Loi 200, 1040 Brussel

### Klant I — buitenlands (DE)
- **Naam:** Hans Müller
- **Geboortedatum:** 11.04.1975
- **Telefoon:** +49 30 12345678
- **Adres:** Bahnhofstraße 5, 50667 Köln

### Klant J — buitenlands (FR)
- **Naam:** Marie Dupont
- **Telefoon:** +33 1 42 34 56 78
- **Adres:** 1 rue de la République, 75001 Paris

### Klant K — buitenlands (UK)
- **Naam:** John Smith
- **Telefoon:** +44 20 7946 0958
- **Adres:** 10 Downing Street, London SW1A 2AA

---

## 2. Bankgegevens

| Persoon | IBAN | BIC | Bank |
|---|---|---|---|
| Jeroen van der Meulen | NL91ABNA0417164300 | ABNANL2A | ABN AMRO |
| Fatima El Amrani | NL20INGB0001234567 | INGBNL2A | ING |
| Pieter-Jan de Groot-Visser | NL44RABO0123456789 | RABONL2U | Rabobank |
| Wei Liu | NL63TRIO0212345678 | TRIONL2U | Triodos Bank |
| Sophie Janssens | BE68539007547034 | GKCCBEBB | Belfius |
| Hans Müller | DE89370400440532013000 | COBADEFFXXX | Commerzbank |
| Marie Dupont | FR1420041010050500013M02606 | BNPAFRPP | BNP Paribas |
| John Smith | GB29NWBK60161331926819 | NWBKGB2L | Barclays |

Creditcard op naam van J. van der Meulen: **4111 1111 1111 1111** (VISA), verloopt 11/28, CVC 123.
Alternatieve kaart: 5500-0000-0000-0004 (Mastercard), vervaldatum 03/29, beveiligingscode 456.
AmEx-kaart 3782 822463 10005 op naam van Robin Klein, verloopt 07/27.

---

## 3. Vrije tekst (lopende zin)

Vandaag, 17 april 2026, belde mevrouw El Amrani (fatima.elamrani@example.com, 06-98765432) met de vraag of haar betaling van € 1.245,50 vanaf IBAN NL20INGB0001234567 was ontvangen. Zij woont sinds kort op Lange Voorhout 44, 2514 EE Den Haag, samen met haar partner Youssef Bakker. Haar BSN 987654321 stond nog onjuist in het dossier.

De heer Van der Meulen (BSN 123456782, geboren 14-03-1985) heeft zijn adres gewijzigd van Prinsengracht 12, 1015 DK Amsterdam naar Keizersgracht 123-3, 1015 CJ Amsterdam. Zijn nieuwe werkgever is Acme Nederland B.V., KvK-nummer 34567890, BTW NL812345678B01.

Dr. De Groot-Visser schreef in zijn verwijsbrief: *"Patiënt P.J. de Groot-Visser, 47 jaar, wonend te Coolsingel 75 (3012 AG Rotterdam), werd op 12 januari 2026 gezien op de poli. Contact via pj.degroot@ziekenhuis-voorbeeld.nl of 010-2345678."*

Hoi Anna, ik heb je nieuwe nummer 06-87654321 ingevoerd. Mailen kan via anna.dejong@voorbeeld.nl. Bel Pieter morgen even terug.

---

## 4. Identificatienummers

- **Paspoortnummer (NL):** NX1234567
- **ID-kaart (NL):** IE9876543
- **Rijbewijs (NL):** 5612345678
- **KvK-nummer:** 34567890
- **BTW-nummer (NL):** NL812345678B01
- **BTW-nummer (BE):** BE0123.456.789
- **Polisnummer zorgverzekeraar:** 106543210
- **AGB-code zorgverlener:** 01-012345
- **BIG-nummer:** 19912345601
- **Patiëntnummer (intern):** PAT-2026-001234
- **Dossiernummer:** 2026-OND-09812
- **Voertuigkenteken:** 12-AB-3D
- **Ander kenteken:** AB-123-C

---

## 5. Online identifiers

- **Gebruikersnaam:** jvdmeulen85
- **Wachtwoord (fictief!):** Zomer2026!
- **Backup-wachtwoord:** Pa$$w0rd-Lente2026
- **IPv4:** 145.97.12.233
- **IPv6:** 2001:0db8:85a3:0000:0000:8a2e:0370:7334
- **MAC-adres:** 00:1A:2B:3C:4D:5E
- **Twitter/X:** @jeroenvdm
- **BlueSky:** @jeroenvdm.bsky.social
- **Mastodon:** @jeroenvdm@mastodon.nl
- **LinkedIn:** linkedin.com/in/fatima-el-amrani-8812
- **Website:** https://www.vandermeulen-advies.nl
- **GPS-locatie woning:** 52.0907° N, 5.1214° E

---

## 6. Onderwijs / HAN-specifieke data

Aan de Hogeschool van Arnhem en Nijmegen werken we met:

- **Studentnummer:** 1234567
- **Studentnummer (s-prefix):** s7654321
- **Medewerkernummer:** P9876543
- **Medewerkernummer (kort):** 654321
- **Klas:** HBO-ICT-1A, ook HBO-ICT-2C
- **Cursuscode:** OOABDK1, alternatief ICA-PROF
- **CROHO-code:** 34391
- **Mentor:** Pieter Jansen
- **SLB'er:** mw. Aisha El-Hassan
- **Examinator:** dr. Mark de Vries
- **Stagebedrijf:** TechCorp B.V.
- **OV-chipkaart:** 3528 0123 4567 8901 2

Studentportaal-URLs:
- https://osiris.han.nl/student/1234567/dashboard
- https://alluris.han.nl/portfolio/s7654321
- https://brightspace.han.nl/users/p9876543

---

## 7. Meerdere personen in één alinea (lange zin)

Op de vergadering van 3 maart 2026 waren aanwezig: Jeroen van der Meulen (voorzitter), Fatima El Amrani (secretaris), dr. Pieter-Jan de Groot-Visser (penningmeester), Aisha El-Hassan en als gast Hans Müller uit Keulen (Bahnhofstraße 5, 50667 Köln, Duitsland, +49 221 1234567, h.mueller@voorbeeld.de). Notulen worden verstuurd naar notulen@vereniging-test.nl. Volgende vergadering is op 14/05/2026 om 14:30u in zaal Keizer.

---

## 8. PII in code-blocks en quotes

> *"Ik ben Jeroen van der Meulen, geboren 14-03-1985, en mijn IBAN is NL91ABNA0417164300."*

```python
patient = {
    "naam": "Robin Klein",
    "bsn": "111222333",
    "telefoon": "06-12345678",
    "geboortedatum": "07-05-1995",
}
```

Inline `BSN 123456782` zou ook moeten worden gepakt.

---

## 9. PII over regelafbreking heen

De aanvraag is van Jeroen
van der Meulen, woonachtig op
Keizersgracht 123-3
1015 CJ Amsterdam.

---

## 10. Edge cases & negatieve gevallen

### Echte PII
- Naam met accenten: **Zoë Müller-Østergård**
- Naam met tussenvoegsel: **Anna van 't Hof-de Wit**
- Naam die ook een woord is: **Dhr. Bakker** (beroep bakker)
- Postcode zonder spatie: 1015CJ
- Telefoon in oud-formaat: 0031612345678
- E-mail met plus: jeroen+test@voorbeeld.nl
- IBAN zonder spaties: NL91ABNA0417164300
- IBAN met spaties: NL91 ABNA 0417 1643 00
- BSN met punten: 1.234.567.82
- Datum + tijd: 12/01/2026 14:30
- Datum kort: 14-03-85 (mét label hierna)
- Geboortedatum: 14-03-85
- Polisnummer met spatie: 1065 4321 0
- Lege waarde: BSN: —

### Géén PII (mogen NIET gemaskeerd worden)
- Order 12-34-99 staat klaar.
- Versie 1.2.3 build 4567
- Poort 8765 op localhost
- HTTP-statuscode 404
- Hoofdstuk 14 paragraaf 3
- Document 1985 in de bibliotheek
- Klas-code AB12 (geen kenteken want geen `-`)
- "1234 in voorraad" (geen postcode want geen 2 hoofdletters)
- Het jaar 2026 was bijzonder
- Pi = 3.14159

---

*Einde testdocument v2.*

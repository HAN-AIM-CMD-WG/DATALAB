# Anonimiseer installeren

Deze instructies zijn voor de pilot-versie. De app is nog niet voorzien van
een digitale handtekening, dus je besturingssysteem zal één keer waarschuwen.
Dat is bij deze versie verwacht gedrag.

> Alles draait lokaal. Documenten verlaten je laptop niet.

---

## Systeemvereisten

| | macOS | Windows |
|---|---|---|
| Minimum versie | macOS 12 Monterey | Windows 10 (64-bit) |
| Processor | Apple Silicon (M-serie) of Intel | x64 |
| Werkgeheugen | 8 GB (16 GB aanbevolen) | 8 GB (16 GB aanbevolen) |
| Schijfruimte | ~700 MB | ~700 MB |
| Internet | Niet nodig na installatie | Niet nodig na installatie |

De installer bevat alle noodzakelijke onderdelen inclusief het Nederlandse
taalmodel. Voor zwaardere modellen (SoNaR-BERT, Ollama LLM's) is eenmalig
internet nodig om ze te downloaden — dat kan later via de Model Manager.

---

## macOS

1. Download het bestand dat bij je Mac past van de release-pagina:
   - `Anonimiseer-0.1.0-arm64.dmg` voor **Apple Silicon** (M1, M2, M3, M4)
   - `Anonimiseer-0.1.0.dmg` voor **Intel**-Macs
2. Dubbelklik op de `.dmg` — een venster toont `Anonimiseer.app`.
3. Sleep `Anonimiseer.app` naar `Applications`.
4. Open `Applications` → rechtsklik op `Anonimiseer` → **Openen** (niet dubbelklikken,
   anders kom je niet langs Gatekeeper).
5. Een dialog meldt *"Kan niet worden geopend omdat de ontwikkelaar niet kan
   worden gecontroleerd"*. Klik nogmaals op **Openen**.
6. Dit hoeft maar één keer. Volgende keren start de app normaal.

Weet je niet welke chip je hebt?  **Apple-menu → Over deze Mac**. Bij "Chip"
zie je `Apple M…` (arm64) of `Intel` (x64).

---

## Windows

1. Download `Anonimiseer Setup 0.1.0.exe` van de release-pagina.
2. Dubbelklik op de installer.
3. SmartScreen toont een blauw venster *"Windows heeft uw pc beschermd"*.
   Klik op **Meer info** → **Toch uitvoeren**.
4. Volg de installatiestappen. Je kunt kiezen voor "Alleen voor mij" of
   "Voor alle gebruikers".
5. Na installatie staat Anonimiseer in het Start-menu.

Bij kantoorlaptops met strikt beleid kan SmartScreen de installer helemaal
blokkeren. Neem in dat geval contact op met je beheerder; verwijs hem door
naar deze handleiding en `docs/beheer-setup.md`.

---

## Eerste start

1. Start Anonimiseer.
2. Bij de eerste keer zie je een onboarding-scherm met uitleg en een
   disclaimer. Lees hem — die beschrijft waarom je nog steeds zelf moet
   controleren.
3. De app laadt de verwerkings-engine (pii-engine) op de achtergrond. Dat
   duurt bij de eerste keer 5 tot 15 seconden; volgende keren is dit sneller.
4. Daarna kun je een bestand kiezen via het stappenplan en anonimiseren.

---

## Engine kan niet starten

Als je bij het openen van de app de foutmelding *"PII-engine kon niet starten"*
krijgt, probeer dan in deze volgorde:

1. Sluit de app helemaal af (cmd-Q / rechtsklik tray).
2. Wacht 10 seconden en open hem opnieuw.
3. Als de fout blijft: herstart je laptop — er kan nog een achtergrond-
   proces op poort 8765 luisteren.
4. Als het dan nog blijft: herinstalleer de app. De PyInstaller-bundle zit in
   de app (mac: `Anonimiseer.app/Contents/Resources/pii-engine/`; Windows:
   `%LocalAppData%\Programs\Anonimiseer\resources\pii-engine\`).

Bij aanhoudende problemen: open een issue op de repository met:
- OS-versie (`About This Mac` / `winver`)
- Anonimiseer-versie (zichtbaar in de Help-knop)
- Screenshot van de foutmelding
- Inhoud van `~/.anonimiseer/engine.log` als die bestaat

---

## Waarom staat er "onbekende ontwikkelaar"?

Anonimiseer wordt uitgeleverd zónder code-signing in de pilot-fase.
Code-signing vereist betaalde certificaten (ca. €200–€500/jaar) en extra
infrastructuur voor notarisatie — dat is uitgesteld tot na de pilot om
tijdens de eerste gebruikersronde snel te kunnen itereren.

Zolang je de installer van een vertrouwde bron haalt (de officiële release-
pagina van DataLab), is er geen veiligheidsrisico. Het kost je één extra
klik; na die eerste start gedraagt de app zich net als elke andere.

---

## Deïnstalleren

- **macOS**: sleep `Anonimiseer.app` naar de prullenbak. Je anonimiseer-
  instellingen staan in `~/.anonimiseer/` — verwijder die map handmatig als
  je ook die kwijt wilt.
- **Windows**: `Instellingen → Apps → Anonimiseer → Verwijderen`. Daarna
  eventueel `%UserProfile%\.anonimiseer\` opruimen.

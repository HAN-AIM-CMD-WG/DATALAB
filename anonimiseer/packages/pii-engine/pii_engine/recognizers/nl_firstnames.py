"""Dictionary-based voornamen-recognizer voor Nederlandse documenten.

SpaCy's ``nl_core_news_lg`` mist regelmatig losstaande voornamen in
informele zinnen als "Bel Anna morgen" of "Mail Ahmed". Deze module
sluit dat gat met een gecureerde voornamen-set (zowel klassiek
Nederlands als gangbare Turks/Arabisch/Surinaams/Indisch/Afrikaans
voornamen die op de HAN en in de wijk-/zorgcontext vaak voorkomen).

Aanpak:

* We matchen een hoofdletter-woord (min. 3 tekens) dat in de set zit én
  niet aan begin-van-zin staat — wel in zins-midden of na een
  werkwoord/aanroep. Dit vermijdt generieke valse positieven op
  "Anna" als placeholder of "Piet" als voorbeeld aan zinsbegin
  *alleen als er geen andere werkwoord-context is*.
* Voor eerste-token-matches kijken we of ernaast een achternaam-achtig
  token volgt (tweede hoofdletter-woord); zo ja, toch PERSON.
* Score: 0.80 met werkwoord/label-context ("bel Anna", "spreek Ahmed
  aan"); 0.60 standalone.

De set is bewust compact (enkele honderden populaire vormen) zodat we
niet alle hoofdletter-woorden als naam tagen. Uitbreidbaar via een
env-var ``PII_EXTRA_FIRST_NAMES`` (komma-gescheiden).
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import ClassVar

from presidio_analyzer import (
    AnalysisExplanation,
    EntityRecognizer,
    RecognizerResult,
)
from presidio_analyzer.nlp_engine import NlpArtifacts

__all__ = ["NlFirstNameRecognizer", "FIRST_NAMES"]


# Basislijst: top-voornamen NL + populaire multi-etnische namen zoals
# in de pilot-context (HAN Arnhem/Nijmegen, zorg, gemeente). Klein
# genoeg om in RAM te houden, groot genoeg om de meeste echte namen
# te dekken. Alles in Title-Case; we vergelijken case-sensitief.
_BASE_NAMES = frozenset(
    {
        # Klassiek/modern NL — meisjes
        "Anna", "Anne", "Anneke", "Annemiek", "Annemieke", "Annemarie",
        "Annelies", "Anouk", "Bente", "Bo", "Brechtje", "Carla", "Cindy",
        "Claire", "Daphne", "Debbie", "Denise", "Diana", "Dieuwertje",
        "Dorien", "Eline", "Elke", "Ellen", "Els", "Elsa", "Emma",
        "Esmee", "Esther", "Eva", "Evelien", "Fleur", "Floor", "Floris",
        "Francien", "Gea", "Gerda", "Hanna", "Hannah", "Hanneke",
        "Heleen", "Helena", "Hilde", "Ilse", "Inez", "Ingrid", "Irene",
        "Iris", "Isa", "Isabella", "Isabelle", "Jacqueline", "Janine",
        "Jannie", "Jeanette", "Jeannette", "Jessica", "Jet", "Joanne",
        "Joke", "Jolanda", "Judith", "Julia", "Julie", "Karin", "Katja",
        "Kim", "Kirsten", "Laura", "Laurien", "Leonie", "Lianne",
        "Lieke", "Lieneke", "Lies", "Liesbeth", "Lisa", "Lisanne",
        "Liza", "Lobke", "Loes", "Lotte", "Louise", "Lynn", "Maaike",
        "Maartje", "Madelon", "Maike", "Manon", "Maria", "Marian",
        "Marianne", "Marieke", "Marije", "Marijke", "Marika", "Marit",
        "Marleen", "Marlies", "Marloes", "Martina", "Mechteld",
        "Meike", "Melanie", "Merel", "Mia", "Mieke", "Miranda",
        "Mirjam", "Mirthe", "Moniek", "Monique", "Nadine", "Nancy",
        "Natascha", "Natasja", "Nicolet", "Nicolette", "Nienke",
        "Nikki", "Noa", "Noor", "Nora", "Olga", "Paula", "Petra",
        "Pien", "Puck", "Rachel", "Renate", "Renée", "Rianne", "Rita",
        "Robin", "Rosa", "Rose", "Roxanne", "Saar", "Sabine", "Sam",
        "Sandra", "Sanne", "Sara", "Sarah", "Sascha", "Saskia",
        "Sharon", "Silvia", "Simone", "Sofia", "Sofie", "Sophie",
        "Stefanie", "Stephanie", "Suzanne", "Sylvia", "Tamara", "Tess",
        "Tessa", "Thea", "Tineke", "Trudy", "Vera", "Veronique",
        "Vivian", "Wendy", "Willeke", "Yara", "Yvonne", "Zoë", "Zoe",

        # Klassiek/modern NL — jongens
        "Aart", "Abel", "Adriaan", "Albert", "Alex", "Alexander",
        "Andreas", "André", "Andries", "Anton", "Antoon", "Arjan",
        "Arjen", "Arnaud", "Arnoud", "Arno", "Arthur", "Bart", "Bas",
        "Ben", "Benjamin", "Bernard", "Bernd", "Bert", "Berto", "Boaz",
        "Bram", "Brandon", "Brent", "Bryan", "Cas", "Casper", "Cees",
        "Christiaan", "Christian", "Daan", "Daniel", "Daniël", "David",
        "Dennis", "Dick", "Diederik", "Dirk", "Dominic", "Dylan",
        "Ed", "Eddy", "Edgar", "Edwin", "Egbert", "Ellis", "Emiel",
        "Eric", "Erik", "Erwin", "Evert", "Ewout", "Felix", "Ferdinand",
        "Ferry", "Finn", "Floris", "Frank", "Frans", "Frederik",
        "Freek", "Gerard", "Gerben", "Gerrit", "Gijs", "Glenn", "Guus",
        "Hans", "Harmen", "Harold", "Harrie", "Harry", "Hein", "Hendrik",
        "Henk", "Henri", "Henrik", "Herbert", "Herman", "Hubert", "Huib",
        "Hugo", "Huub", "Ian", "Ilja", "Ivan", "Ivo", "Jaap", "Jack",
        "Jacob", "Jan", "Janco", "Janwillem", "Jasper", "Jean", "Jelle",
        "Jelmer", "Jeroen", "Jim", "Jimmy", "Joep", "Joeri", "Johan",
        "Johannes", "Jordy", "Joris", "Jos", "Joshua", "Joost", "Juriaan",
        "Justin", "Kasper", "Kees", "Kenneth", "Kevin", "Klaas", "Koen",
        "Kris", "Kurt", "Lars", "Laurens", "Leander", "Leendert", "Leon",
        "Levi", "Lieven", "Loek", "Louis", "Luc", "Luca", "Lucas", "Luka",
        "Lukas", "Luuk", "Maarten", "Marc", "Marcel", "Marco", "Marcus",
        "Marinus", "Mark", "Marnix", "Martijn", "Martin", "Mathijs",
        "Mats", "Matthew", "Matthias", "Matthijs", "Maurits", "Max",
        "Maxim", "Melle", "Menno", "Michael", "Michel", "Michiel",
        "Milan", "Morris", "Nick", "Niek", "Niels", "Noud", "Olaf",
        "Oliver", "Onno", "Otto", "Owen", "Patrick", "Paul", "Peer",
        "Peter", "Philip", "Pier", "Pieter", "Piet", "Pim", "Quinten",
        "Raimond", "Ralph", "Ramon", "Randy", "Raymond", "Reinier",
        "Remco", "Remi", "Remko", "Renzo", "René", "Richard", "Rick",
        "Rik", "Rinus", "Rob", "Robbert", "Robbie", "Robert", "Robin",
        "Rogier", "Roland", "Rolf", "Ron", "Ronald", "Ronnie", "Roy",
        "Ruben", "Rudolf", "Rudy", "Sander", "Sebastian", "Sebastiaan",
        "Sem", "Sepp", "Siem", "Sietse", "Simon", "Sjaak", "Sjoerd",
        "Stan", "Stef", "Stefan", "Steven", "Stijn", "Sven", "Sybren",
        "Teun", "Theo", "Thijs", "Thom", "Thomas", "Tiemen", "Tijmen",
        "Tijn", "Tim", "Timo", "Tobias", "Tom", "Ton", "Tristan", "Twan",
        "Ulrich", "Valentijn", "Victor", "Vincent", "Walter", "Wesley",
        "Wessel", "Wiebe", "Wilbert", "Wilfred", "Willem", "William",
        "Wim", "Wouter", "Xander", "Yorick", "Youri", "Zeger",

        # Arabisch / Noord-Afrikaans / Turks (veelvoorkomend in NL)
        "Aaliyah", "Abdelkader", "Abdellah", "Abderrahim", "Abdul",
        "Abdullah", "Abdulrahman", "Adil", "Adnan", "Ahmad", "Ahmed",
        "Aisha", "Aishe", "Aleyna", "Ali", "Amina", "Amine", "Anas",
        "Anwar", "Asma", "Ayoub", "Ayse", "Aziz", "Aziza", "Badr",
        "Bahar", "Baran", "Behice", "Beyza", "Berkay", "Burak", "Cem",
        "Cemal", "Cengiz", "Derya", "Dilara", "Diyar", "Ebru", "Ela",
        "Elif", "Emine", "Emre", "Enes", "Erdem", "Esra", "Eyüp",
        "Fahima", "Faruk", "Fatih", "Fatima", "Fatiha", "Fatma",
        "Ferhat", "Furkan", "Gamze", "Gül", "Hakan", "Halil", "Halima",
        "Halime", "Hamza", "Hanan", "Hasan", "Hatice", "Hayrettin",
        "Hayriye", "Houssein", "Hussein", "Ibrahim", "Idris", "Ihsan",
        "Ilham", "Ilhan", "Imad", "Imane", "Iman", "Irfan", "Ishak",
        "Ismail", "Ismael", "Issam", "Jamal", "Jamila", "Jawad",
        "Jihad", "Kadir", "Kadriye", "Kamal", "Karim", "Kader",
        "Khadija", "Latifa", "Leila", "Leyla", "Lutfi", "Mahmoud",
        "Mehmet", "Mehdi", "Melek", "Meryem", "Mert", "Mesut",
        "Mohammad", "Mohammed", "Mohamed", "Moussa", "Muhammed",
        "Mustafa", "Nadia", "Najat", "Naima", "Nasir", "Nasrin",
        "Necla", "Nesrin", "Nihal", "Nour", "Omar", "Onur", "Orhan",
        "Osama", "Osman", "Ouafa", "Öykü", "Özgür", "Rachid", "Rafik",
        "Rahim", "Raja", "Rami", "Ramazan", "Rashid", "Redouan",
        "Reha", "Reyhan", "Salih", "Samir", "Samira", "Saskia",
        "Selim", "Selin", "Semra", "Serkan", "Seval", "Sevgi",
        "Sevil", "Sibel", "Sinan", "Soufiane", "Suleiman", "Süleyman",
        "Taha", "Taner", "Tarik", "Tarık", "Tayfun", "Ümit", "Veli",
        "Wafaa", "Yagmur", "Yasemin", "Yasin", "Yasmin", "Yasmine",
        "Yavuz", "Yusuf", "Yüksel", "Zahra", "Zeynep", "Zeinab",

        # Surinaams / Hindoestaans / Antilliaans (veelvoorkomend in NL)
        "Aarav", "Amar", "Amit", "Anand", "Anil", "Anita", "Anjali",
        "Anoushka", "Anushka", "Aryan", "Ashok", "Asif", "Ashwin",
        "Bhagwan", "Brian", "Charaine", "Chandra", "Daksh", "Darshan",
        "Deepak", "Devi", "Dev", "Diana", "Dinesh", "Dominique", "Edson",
        "Ella", "Ershad", "Giovanni", "Harish", "Irwan", "Jairo", "Jay",
        "Jayson", "Jessaï", "Jhonathan", "Jurenne", "Kamla", "Kavita",
        "Kishan", "Krishna", "Lakshmi", "Manoj", "Marvin", "Meera",
        "Mohit", "Mukesh", "Myrthe", "Naomi", "Nikhil", "Nitin",
        "Norbert", "Pavan", "Pooja", "Prakash", "Pramod", "Pratik",
        "Priya", "Radha", "Rahul", "Raj", "Rajesh", "Rakesh", "Rani",
        "Ravi", "Ricardo", "Riti", "Rohit", "Roshan", "Sachin",
        "Sahil", "Samir", "Sandeep", "Sanjay", "Sanjiv", "Satish",
        "Sheela", "Shivani", "Shreya", "Soraya", "Sujit", "Sunil",
        "Suresh", "Sushila", "Tanya", "Tara", "Vijay", "Vikas",
        "Vikram", "Vinay", "Vinod", "Vishal", "Vishnu",

        # Overig internationaal (gangbaar NL)
        "Adrian", "Adriana", "Alba", "Aleksander", "Alicja", "Alina",
        "Ana", "Andrei", "Anton", "Aura", "Bogdan", "Camille", "Carlos",
        "Carolina", "Chen", "Christina", "Cristian", "Diego", "Elena",
        "Elvis", "Fabio", "Gabriel", "Gabriela", "Giovanni", "Hector",
        "Ioana", "Isabella", "Ivana", "Javier", "Jorge", "Juan",
        "Julio", "Katarzyna", "Lilia", "Lina", "Luis", "Magdalena",
        "Marek", "Marta", "Mateusz", "Maya", "Miguel", "Milica",
        "Natalia", "Nikolay", "Olga", "Oscar", "Pablo", "Paulina",
        "Pedro", "Piotr", "Rafael", "Ricardo", "Roberto", "Sergej",
        "Sergey", "Sofia", "Stanislav", "Stefan", "Tomasz", "Viktor",
        "Vlad", "Vladimir", "Yuliya",
    }
)


@lru_cache(maxsize=1)
def _load_extra_names() -> frozenset[str]:
    raw = os.environ.get("PII_EXTRA_FIRST_NAMES", "")
    extras = {n.strip() for n in raw.split(",") if n.strip()}
    return frozenset(n[:1].upper() + n[1:] for n in extras if n)


@lru_cache(maxsize=1)
def _all_names() -> frozenset[str]:
    return _BASE_NAMES | _load_extra_names()


# Publieke set voor debuggen / unit-tests.
FIRST_NAMES = _BASE_NAMES

# Aanspreek-werkwoorden/-imperatieven die sterke context geven voor
# "directe benoeming" van een persoon: "Bel Anna", "Mail Ahmed",
# "Spreek Piet aan", "Vraag Sandra", enz. Allemaal kleine letters
# (case-insensitief gecheckt).
_ADDRESS_VERBS = frozenset(
    {
        "bel", "belt", "belde", "belden",
        "mail", "mailt", "mailde", "mailden", "email", "emailt",
        "spreek", "spreekt", "sprak", "spraken", "gesproken",
        "vraag", "vraagt", "vroeg", "vragen", "gevraagd",
        "zie", "ziet", "zag", "gezien",
        "groet", "groette", "gegroet",
        "schrijf", "schrijft", "schreef", "geschreven",
        "app", "appt", "appte", "appten",
        "sms", "smst", "smste",
        "stuur", "stuurt", "stuurde", "stuurden", "gestuurd",
        "volg", "volgt", "volgde", "gevolgd",
        "help", "helpt", "hielp", "geholpen",
        "ontmoet", "ontmoette", "ontmoetten",
        "nodig", "nodigt", "nodigde",
        "bezoek", "bezoekt", "bezocht",
        "begeleid", "begeleidt", "begeleidde",
        "beoordeel", "beoordeelt", "beoordeelde",
        "beantwoord", "antwoord", "antwoordt",
        "hoi", "hallo", "dag", "beste", "hi",
        "van", "door", "met", "aan", "bij", "voor",  # "brief van Anna"
    }
)

# Eenvoudige woord-token regex die hoofdletter-woord met min 3 tekens
# vindt. We pakken géén leestekens binnen het woord (dan gaat
# "Anna's" nog steeds als "Anna" gevonden worden door het woord-einde
# bij de apostrof).
_WORD_PATTERN = re.compile(
    r"(?<![A-Za-zÀ-ÿ])(?P<w>[A-ZÀ-Þ][a-zà-ÿ]{2,})(?![A-Za-zÀ-ÿ])"
)

# Tussenvoegsels en achternaam-tokens die we meenemen in de naam-span
# als ze direct achter een herkende voornaam volgen. Een achternaam
# vereist een hoofdletter gevolgd door MINSTENS ÉÉN kleine letter
# (``Meulen``, ``Janssens``, ``Müller``) zodat generieke afkortingen als
# ``NL``, ``DE``, ``ABNA`` of tokens uit een IBAN (``NL91ABNA…``) nooit
# als achternaam worden opgepikt. Ook sluiten we uit dat er meteen een
# cijfer achter zit (``Meulen42`` is geen naam).
_SURNAME_TOKEN = r"[A-ZÀ-Þ][a-zà-ÿ][A-Za-zÀ-ÿ'\-]*"
_SURNAME_PREFIX = re.compile(
    r"\s+(?:el|al|ibn|bin|de|den|der|van(?:\s+(?:de|der|den))?|te|ten|ter|'t|het|op\s+de?n?)"
    rf"\s+(?P<w>{_SURNAME_TOKEN})(?!\d)",
    flags=re.IGNORECASE,
)
_SURNAME_CAP_TOKEN = re.compile(
    rf"\s+(?P<w>{_SURNAME_TOKEN})(?!\d)"
)
# Een bijnaam tussen aanhalingstekens tussen voornaam en achternaam:
# ``Wim "Pim" Fortuyn-de Boer``. We slaan zo'n bijnaam over zodat de
# achternaam-expansie alsnog ``Fortuyn-de Boer`` meeneemt.
_NICKNAME_QUOTE = re.compile(r'\s+(?:"[^"\n]{1,30}"|\'[^\'\n]{1,30}\')(?=\s+[A-ZÀ-Þ])')


def _prev_word(text: str, start: int) -> str | None:
    """Haal het laatste alfabetische woord vóór ``start`` terug (lowercase)."""

    i = start - 1
    while i >= 0 and not text[i].isalpha():
        i -= 1
    if i < 0:
        return None
    j = i
    while j >= 0 and (text[j].isalpha() or text[j] in "'-"):
        j -= 1
    return text[j + 1 : i + 1].lower()


def _is_sentence_start(text: str, start: int) -> bool:
    """Is de match het eerste woord van een zin / de tekst?"""

    i = start - 1
    while i >= 0 and text[i] in " \t":
        i -= 1
    if i < 0:
        return True
    return text[i] in ".!?\n"


class NlFirstNameRecognizer(EntityRecognizer):
    """Matcht bekende NL-voornamen als ``PERSON``.

    Strategie:

    * Woord moet exact in de namenlijst zitten (case-sensitief — we
      vergelijken Title-Case).
    * Als het woord een aanspreek-werkwoord of ``van/door/met/hi``
      direct vóór zich heeft → hoge score (0.80).
    * Als het op zichzelf staat (niet aan zinsbegin) én gevolgd wordt
      door een tweede hoofdletter-woord (achternaam) → hoge score
      (0.85).
    * Staat het aan zinsbegin én zonder achternaam → skip (te veel
      kans op placeholder of werkwoord-achtig woord).
    """

    STRONG_SCORE: ClassVar[float] = 0.85
    VERB_SCORE: ClassVar[float] = 0.8
    WEAK_SCORE: ClassVar[float] = 0.55

    def __init__(self, supported_language: str = "nl") -> None:
        super().__init__(
            supported_entities=["PERSON"],
            supported_language=supported_language,
            name="NlFirstNameRecognizer",
        )

    def load(self) -> None:  # pragma: no cover — interface
        return None

    def analyze(
        self,
        text: str,
        entities: list[str],
        nlp_artifacts: NlpArtifacts | None = None,
    ) -> list[RecognizerResult]:
        if "PERSON" not in entities:
            return []
        names = _all_names()
        results: list[RecognizerResult] = []

        for match in _WORD_PATTERN.finditer(text):
            word = match.group("w")
            if word not in names:
                continue

            start = match.start("w")
            end = match.end("w")
            prev = _prev_word(text, start)
            sentence_start = _is_sentence_start(text, start)

            score: float | None = None
            why = ""

            # Probeer de span door te trekken over tussenvoegsels en
            # losse hoofdletter-tokens. Zo groeit ``Fatima`` door tot
            # ``Fatima El Amrani`` of ``Jan de Vries-Smit`` en
            # ``Willem van der Berg``. We kappen op max 4 extra tokens
            # en stoppen zodra er geen kandidaat meer is.
            expanded_end = end
            for _ in range(5):
                tail = text[expanded_end:]
                # Eerst eventuele bijnaam tussen aanhalingstekens overslaan
                # zodat de achternaam erna nog wordt meegepakt.
                m_nick = _NICKNAME_QUOTE.match(tail)
                if m_nick:
                    expanded_end += m_nick.end()
                    continue
                m_pref = _SURNAME_PREFIX.match(tail)
                if m_pref:
                    expanded_end += m_pref.end()
                    continue
                m_cap = _SURNAME_CAP_TOKEN.match(tail)
                if m_cap:
                    tok = m_cap.group("w")
                    # Als de volgende token zélf een bekende voornaam is
                    # stoppen we: het is dan waarschijnlijk een opsomming
                    # ("Anna Piet") en geen achternaam.
                    if tok in names:
                        break
                    expanded_end += m_cap.end()
                    continue
                break

            if expanded_end > end:
                score = self.STRONG_SCORE
                why = "voornaam + achternaam-token(s) + tussenvoegsels"
                end = expanded_end
            elif prev in _ADDRESS_VERBS:
                score = self.VERB_SCORE
                why = "voornaam na aanspreek-/aanroep-werkwoord"
            elif not sentence_start:
                score = self.WEAK_SCORE
                why = "bekende voornaam midden in zin"
            # else: sentence_start zonder achternaam → skip (te
            # onzeker, placeholder/werkwoord-vorm-kans).

            if score is None:
                continue

            results.append(
                RecognizerResult(
                    entity_type="PERSON",
                    start=start,
                    end=end,
                    score=score,
                    analysis_explanation=AnalysisExplanation(
                        recognizer=self.__class__.__name__,
                        original_score=score,
                        pattern_name="nl_first_name",
                        pattern=_WORD_PATTERN.pattern,
                        validation_result=True,
                        textual_explanation=why,
                    ),
                )
            )
        return results

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Layers,
  Lightbulb,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Help-venster met uitleg in lekentaal + concrete voorbeelden.
 *
 * Ontwerpregels:
 *  - Nederlands op B1-niveau — geen jargon zonder uitleg.
 *  - Bekende valkuilen staan in het <em>eerste</em> paneel, niet diep verstopt.
 *  - Voorbeelden lopen parallel aan de onboarding-profielen + Modellenscherm,
 *    zodat een lezer weet waar de knop echt zit.
 *  - Geen externe links die data versturen — alle uitleg is offline.
 *
 * De sectie-state (welke zijn uitgeklapt) bewaren we alleen in het
 * component-geheugen: een help-venster mag vrijblijvend zijn.
 */

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

type SectionId =
  | 'quick-start'
  | 'pipeline'
  | 'models'
  | 'pseudo-vs-anon'
  | 'ollama'
  | 'troubleshoot'
  | 'glossary';

interface Section {
  id: SectionId;
  title: string;
  subtitle: string;
  icon: JSX.Element;
  render: () => JSX.Element;
}

export function HelpPanel({ open, onClose }: HelpPanelProps): JSX.Element | null {
  const [openSection, setOpenSection] = useState<SectionId | null>('pipeline');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sections: Section[] = [
    {
      id: 'quick-start',
      title: 'Snel aan de slag',
      subtitle: 'Vier stappen naar een geanonimiseerd document.',
      icon: <Sparkles className="h-4 w-4" aria-hidden />,
      render: QuickStart,
    },
    {
      id: 'pipeline',
      title: 'Hoe vindt de app PII?',
      subtitle: 'Wat doet spaCy, wat doet SoNaR, en waarom is er altijd één basis.',
      icon: <Layers className="h-4 w-4" aria-hidden />,
      render: PipelineExplanation,
    },
    {
      id: 'models',
      title: 'Welke modellen kies ik?',
      subtitle: 'Sweet spot voor Nederlands, en waarom BERTje geen knop heeft.',
      icon: <Search className="h-4 w-4" aria-hidden />,
      render: ModelGuide,
    },
    {
      id: 'pseudo-vs-anon',
      title: 'Pseudonimiseren versus anonimiseren',
      subtitle: 'Het verschil met voorbeelden — en waarom de keuze telt.',
      icon: <ShieldCheck className="h-4 w-4" aria-hidden />,
      render: PseudoVsAnon,
    },
    {
      id: 'ollama',
      title: 'Ollama: drie rollen voor een lokaal LLM',
      subtitle: 'Review, Extra-NER, Borderline — wat doen ze en wanneer zet je ze aan?',
      icon: <Lightbulb className="h-4 w-4" aria-hidden />,
      render: OllamaGuide,
    },
    {
      id: 'troubleshoot',
      title: 'Als iets mis gaat',
      subtitle: 'Engine offline, model laadt niet, laptop hijgt.',
      icon: <AlertTriangle className="h-4 w-4" aria-hidden />,
      render: Troubleshoot,
    },
    {
      id: 'glossary',
      title: 'Begrippen-lijst',
      subtitle: 'PII, NER, recognizer, tokenisatie, pseudoniem.',
      icon: <BookOpen className="h-4 w-4" aria-hidden />,
      render: Glossary,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Hulp en uitleg"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-border bg-background shadow-xl ring-1 ring-black/5">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpen className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight">Hulp &amp; uitleg</h2>
              <p className="text-xs text-muted-foreground">
                Kort, in gewone taal, met concrete voorbeelden. Niets verlaat je computer.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Sluiten"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-3 px-6 py-5">
          <WhatIsPii />

          <LocalOnlyBadge />

          {sections.map((s) => (
            <HelpSection
              key={s.id}
              section={s}
              isOpen={openSection === s.id}
              onToggle={() =>
                setOpenSection((cur) => (cur === s.id ? null : s.id))
              }
            />
          ))}

          <p className="pt-2 text-[11px] text-muted-foreground/80">
            Mist er iets in deze uitleg? Laat het weten aan degene die de app voor je
            installeerde — de hulp is onderdeel van de app, dus hij kan hem aanvullen.
          </p>
        </div>
      </div>
    </div>
  );
}

function WhatIsPii(): JSX.Element {
  const examples = [
    'Namen',
    'E-mailadressen',
    'Telefoonnummers',
    'Adressen',
    'BSN',
    'IBAN',
    'Geboortedatum',
    'Studentnummers',
  ];
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="font-heading text-sm font-semibold tracking-tight">Wat is PII?</h3>
          <p className="mt-1 text-xs leading-relaxed text-foreground/80">
            <span className="font-medium">PII</span> staat voor{' '}
            <em>Personally Identifiable Information</em>: alle gegevens waarmee je een
            persoon kunt herkennen of terugvinden. Anonimiseer spoort die gegevens in je
            document op en vervangt ze, zodat je het kunt delen zonder iemands privacy te
            schenden. Jij houdt de eindcontrole.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {examples.map((ex) => (
              <span
                key={ex}
                className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] text-foreground/70"
              >
                {ex}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LocalOnlyBadge(): JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-2 text-[11px] text-success-foreground dark:text-success">
      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>
        Alle detectie en anonimisering gebeurt op <span className="font-medium">deze laptop</span>.
        Documenten, namen en mappings worden niet naar een server gestuurd. Jij blijft eindverantwoordelijk
        voor het controleren van de uitvoer.
      </span>
    </div>
  );
}

function HelpSection({
  section,
  isOpen,
  onToggle,
}: {
  section: Section;
  isOpen: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border bg-card/40 transition-colors',
        isOpen ? 'border-border shadow-[0_1px_3px_rgba(0,0,0,0.05)]' : 'border-border/60'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
              isOpen ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            {section.icon}
          </span>
          <div>
            <p className="text-sm font-semibold">{section.title}</p>
            <p className="text-[11px] text-muted-foreground">{section.subtitle}</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-border/60 px-4 py-4 text-xs leading-relaxed text-foreground/90">
          {section.render()}
        </div>
      )}
    </section>
  );
}

function QuickStart(): JSX.Element {
  return (
    <ol className="list-decimal space-y-2 pl-5">
      <li>
        <span className="font-medium">Stap 1 — Bestanden kiezen.</span>{' '}
        Sleep DOCX, PDF, MD of TXT de app in, of kies ze via de knop. Meerdere tegelijk mag.
      </li>
      <li>
        <span className="font-medium">Stap 2 — Instellingen.</span>{' '}
        Kies <em>Pseudonimiseren</em> (namen worden consistent vervangen, je kunt het terugdraaien)
        of <em>Anonimiseren</em> (namen worden definitief onleesbaar, niet terug te draaien).
      </li>
      <li>
        <span className="font-medium">Stap 3 — Controleren.</span>{' '}
        De app toont wat hij heeft gevonden. Elke hit kun je <em>accepteren</em>,{' '}
        <em>overslaan</em> (niet vervangen) of op de <em>whitelist</em> zetten
        (nooit vervangen, ook niet in andere bestanden). Via de categorie-filter
        rechts kun je gericht door één type tegelijk lopen (bijvoorbeeld alleen
        de organisatienamen). Mist de detector iets?{' '}
        <em>Selecteer de tekst</em> in het venster en klik op{' '}
        <em>Markeer handmatig</em> — kies via het pijltje eventueel een
        specifieke categorie. Klik op een handmatige markering om hem weer te
        verwijderen.
      </li>
      <li>
        <span className="font-medium">Stap 4 — Opslaan.</span>{' '}
        Kies een map. Je krijgt de geanonimiseerde bestanden, een{' '}
        <span className="font-mono">AUDIT.jsonl</span>, een{' '}
        <span className="font-mono">DISCLAIMER.txt</span>, en — bij pseudonimiseren —
        een versleuteld mapping-bestand zodat je later nog kunt terugdraaien.
      </li>
    </ol>
  );
}

function PipelineExplanation(): JSX.Element {
  return (
    <div className="space-y-3">
      <p>
        De detectie werkt in twee lagen die elkaar aanvullen:
      </p>

      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary">
            1
          </span>
          Basis-pipeline (spaCy) — altijd precies één
        </p>
        <p className="mt-1">
          Breekt de tekst op in woorden, herkent zinsgrenzen, en geeft een eerste ronde
          namen/locaties/organisaties. Alle andere regels (BSN, postcode, IBAN, telefoon…)
          bouwen hierop door. Daarom kun je niet "nul" kiezen — de motor heeft één
          basis nodig. De installer levert <em>large</em> standaard mee (het krachtigste
          spaCy-NL-model); medium is een alternatief voor minder RAM-gebruik.
        </p>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="flex items-center gap-2 text-xs font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary">
            2
          </span>
          Aanvullende NER (SoNaR-BERT) — standaard aan
        </p>
        <p className="mt-1">
          Draait <em>naast</em> spaCy en voegt hits toe die spaCy heeft gemist
          (vooral Nederlandse persoonsnamen in formele context). Overlappende hits worden
          samengevoegd, dus geen dubbele markeringen. Zit in de installer meegeleverd en
          staat direct aan. Nadeel: eerste analyse duurt 10–30 seconden extra omdat het
          model eenmalig geladen wordt; kost ~600 MB RAM zolang de app open is.
        </p>
      </div>

      <p className="rounded-md border border-success/30 bg-success/5 p-2 text-success-foreground dark:text-success">
        <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden />
        <span className="font-medium">Standaard na installatie:</span>{' '}
        spaCy-large + SoNaR-BERT allebei actief — de sweet spot voor Nederlandse NER.
        Alles zit in de installer; geen extra downloads of internet nodig.
      </p>
    </div>
  );
}

function ModelGuide(): JSX.Element {
  return (
    <div className="space-y-3">
      <p className="font-medium">spaCy NL — large (standaard) / medium</p>
      <p>
        <span className="font-medium">Large</span> zit in de installer en is direct
        actief — het krachtigste spaCy-NL-model, herkent ook complexere namen als
        "Dr. Anna van der Heide-Janssen". <span className="font-medium">Medium</span>{' '}
        gebruikt ~500 MB minder RAM maar mist vaker samengestelde namen; alleen
        wisselen als je machine krap zit. Je kunt er maar één spaCy-pipeline tegelijk
        gebruiken — klik <em>Gebruik</em> om te wisselen.
      </p>

      <p className="font-medium">SoNaR-BERT NER — standaard aan</p>
      <p>
        Een BERT-model dat specifiek op Nederlandse NER is getraind. Vangt een paar
        procent extra hits op die spaCy mist, vooral in formele teksten en met
        ongebruikelijke namen. Zit in de installer en is meteen aan. Je kunt 'm
        uitzetten via Model Manager → Opnieuw/Uitschakelen, bijvoorbeeld om RAM
        te besparen (~600 MB) op een krappe laptop.
      </p>

      <p className="font-medium">Ollama-modellen (Qwen, Gemma, Llama…)</p>
      <p>
        Dit zijn algemene taalmodellen, geen PII-detectors. Ze kunnen wel een aantal
        extra rollen spelen als je ze activeert — zie de sectie{' '}
        <span className="font-medium">Ollama: drie rollen</span>.
      </p>
    </div>
  );
}

function PseudoVsAnon(): JSX.Element {
  const original = '"Anna Jansen (a.jansen@voorbeeld.nl) werkt bij Gemeente Utrecht."';
  const pseudo = '"[PERSON_1] ([EMAIL_1]) werkt bij [ORG_1]."';
  const anon = '"[PERSON] ([EMAIL]) werkt bij [ORG]."';
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Origineel
        </p>
        <p className="mt-1 font-mono text-[11px]">{original}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-success/30 bg-success/5 p-3">
          <p className="text-[11px] font-semibold text-success-foreground dark:text-success">
            Pseudonimiseren
          </p>
          <p className="mt-1 font-mono text-[11px]">{pseudo}</p>
          <p className="mt-2 text-[11px]">
            Elke <em>unieke</em> waarde krijgt een stabiel label. Dezelfde persoon krijgt
            overal <span className="font-mono">[PERSON_1]</span>.{' '}
            <span className="font-medium">Terugdraaien kan</span> met het versleutelde
            mapping-bestand dat ernaast wordt opgeslagen.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Goed voor: samenwerking, data-analyse, verzamelde logs delen.
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/30 p-3">
          <p className="text-[11px] font-semibold">Anonimiseren</p>
          <p className="mt-1 font-mono text-[11px]">{anon}</p>
          <p className="mt-2 text-[11px]">
            Alle personen worden platgeslagen tot hetzelfde label. Je kunt het{' '}
            <span className="font-medium">niet terugdraaien</span> — er is geen mapping.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Goed voor: publicatie, externe deling, onherleidbaar moeten maken.
          </p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Beide modi vervangen alleen wat de detectie heeft gevonden. Loop in
        stap 3 nog even door wat er gemarkeerd is — de app helpt, jij beslist.
      </p>
    </div>
  );
}

function OllamaGuide(): JSX.Element {
  return (
    <div className="space-y-3">
      <p>
        Ollama is een aparte gratis tool waarmee je een lokaal taalmodel (LLM) naast
        Anonimiseer draait. Volledig opt-in. De app kan zo'n model in drie rollen gebruiken:
      </p>

      <ul className="space-y-2">
        <li className="rounded-md border border-success/30 bg-success/5 p-3">
          <p className="font-semibold">Review-laag <span className="text-[10px] font-normal text-success-foreground dark:text-success">· aanbevolen · nu beschikbaar</span></p>
          <p className="mt-1">
            Ná de anonimisering laat je het LLM de geanonimiseerde tekst lezen met de
            vraag: "is er nog PII overgebleven?" Een extra vangnet dat de detectie zelf
            niet verandert.
          </p>
        </li>
        <li className="rounded-md border border-border/60 bg-muted/30 p-3">
          <p className="font-semibold">Extra NER-detector <span className="text-[10px] font-normal text-muted-foreground">· in volgende release</span></p>
          <p className="mt-1">
            Het LLM scant mee in stap 3 en voegt hits toe. Kan zeldzame patronen vangen
            maar geeft ook vals-positieven.
          </p>
        </li>
        <li className="rounded-md border border-border/60 bg-muted/30 p-3">
          <p className="font-semibold">Borderline-rechter <span className="text-[10px] font-normal text-muted-foreground">· in volgende release</span></p>
          <p className="mt-1">
            Alleen bij twijfelhits (lage zekerheid) vraagt de app het LLM om ja/nee.
            Minste latency, slimme combi.
          </p>
        </li>
      </ul>

      <p className="text-[11px] text-muted-foreground">
        Kies een model dat bij je laptop past — 4B-modellen vragen minimaal
        8 GB RAM, 7B-modellen 16 GB. De fit-indicator in Modellen beheren
        helpt je daarbij.
      </p>
    </div>
  );
}

function Troubleshoot(): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-xs font-semibold">"Engine offline" in de header</p>
        <p className="mt-1">
          De lokale detectie-service draait niet. In deze ontwikkelingsversie start hij mee
          met de app; start de app opnieuw. Productie-versies bevatten de engine ingebakken.
        </p>
      </div>
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-xs font-semibold">Laptop wordt traag of luidruchtig</p>
        <p className="mt-1">
          Waarschijnlijk draait er een zwaar model: SoNaR-BERT (~600 MB RAM, standaard
          aan) of een Ollama LLM (enkele GB, alleen als je deze hebt geactiveerd).
          Schakel ze uit in Modellen beheren als je ze niet nodig hebt. Eén analyse
          kan de eerste keer 30–60 seconden duren — daarna sneller dankzij caching.
        </p>
      </div>
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-xs font-semibold">Model download faalt met "permission denied"</p>
        <p className="mt-1">
          Dat betekent meestal dat de cache-map geen schrijfrechten heeft. De app gebruikt{' '}
          <span className="font-mono">~/.anonimiseer/huggingface</span> als eigen cache. Sluit
          de app, verwijder die map, en probeer opnieuw.
        </p>
      </div>
      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
        <p className="text-xs font-semibold">Een naam wordt niet herkend</p>
        <p className="mt-1">
          Selecteer in stap 3 de naam in het tekstvenster en klik op{' '}
          <em>Markeer handmatig</em> — hij wordt dan als persoonsnaam vervangen.
          Werkt dat structureel niet voor één type? Zet in stap 2 (Geavanceerd)
          de <em>drempelwaarde</em> iets lager. Standaard zijn spaCy-large én
          SoNaR-BERT al actief; controleer in Modellen beheren dat je ze niet
          per ongeluk hebt uitgezet.
        </p>
      </div>
    </div>
  );
}

function Glossary(): JSX.Element {
  const items: Array<{ term: string; def: string }> = [
    {
      term: 'PII',
      def: 'Personally Identifiable Information — gegevens waarmee een persoon herleidbaar is. Namen, adressen, BSN, e-mail, telefoon, foto\'s, etc.',
    },
    {
      term: 'NER',
      def: 'Named Entity Recognition — automatisch herkennen van namen, organisaties en locaties in tekst.',
    },
    {
      term: 'Recognizer',
      def: 'Een losse regel die één type PII zoekt. BsnRecognizer checkt 9-cijferige nummers met de elfproef; EmailRecognizer zoekt e-mailadressen, etc.',
    },
    {
      term: 'Tokenisatie',
      def: 'De tekst opknippen in woorden (tokens). Nodig voordat enig model betekenis kan toekennen.',
    },
    {
      term: 'spaCy',
      def: 'Open-source NLP-bibliotheek. Levert tokenisatie + een basis-NER-model dat Anonimiseer als motor gebruikt.',
    },
    {
      term: 'SoNaR',
      def: 'Groot Nederlands tekstcorpus waarop het NER-model van Wietse de Vries is getraind (wietsedv/bert-base-dutch-cased-finetuned-sonar-ner).',
    },
    {
      term: 'Pseudoniem',
      def: 'Een neutrale tijdelijke naam (bv. [PERSON_1]). Dezelfde echte naam krijgt altijd hetzelfde pseudoniem, zodat context behouden blijft.',
    },
    {
      term: 'Mapping',
      def: 'Het versleutelde bestand dat koppelt welk pseudoniem bij welke echte waarde hoort. Nodig om later terug te draaien.',
    },
    {
      term: 'Drempelwaarde',
      def: 'Vanaf welke zekerheid (0–1) de app een hit accepteert. Lager = meer hits, meer ruis; hoger = minder hits, meer kans op gemiste PII.',
    },
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.term} className="rounded-md border border-border/60 bg-muted/20 p-2">
          <dt className="text-xs font-semibold">{i.term}</dt>
          <dd className="mt-0.5 text-[11px] text-muted-foreground">{i.def}</dd>
        </div>
      ))}
    </dl>
  );
}

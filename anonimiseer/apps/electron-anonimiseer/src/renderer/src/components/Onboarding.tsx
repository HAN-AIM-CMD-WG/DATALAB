import { useState } from 'react';
import {
  ShieldCheck,
  EyeOff,
  FileLock2,
  AlertTriangle,
  ArrowRight,
  Check,
} from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * First-run onboarding.
 *
 * Twee stappen:
 *   1. Welkom — wat Anonimiseer is en wat het *niet* is.
 *   2. Privacy & verantwoordelijkheid — lokaal verwerken, akkoordvinkje.
 *
 * Modellen kies je niet hier maar in Modellen beheren, de enige plek die de
 * engine ook echt aanstuurt.
 *
 * Resultaat wordt via ``onComplete`` teruggegeven aan de App, die het
 * atomisch opslaat in de settings-store en vervolgens de hoofd-UI toont.
 */

type StepId = 'welcome' | 'responsibility';
const STEPS: StepId[] = ['welcome', 'responsibility'];

export function Onboarding({
  onComplete,
}: {
  onComplete: (data: { acceptedResponsibility: true }) => Promise<void> | void;
}): JSX.Element {
  const [step, setStep] = useState<StepId>('welcome');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const lastStep = step === 'responsibility';

  const canGoNext = (): boolean => (step === 'responsibility' ? accepted : true);

  const next = async (): Promise<void> => {
    if (!canGoNext()) return;
    if (step === 'welcome') {
      setStep('responsibility');
      return;
    }
    setSubmitting(true);
    try {
      await onComplete({ acceptedResponsibility: true });
    } finally {
      setSubmitting(false);
    }
  };

  const back = (): void => {
    if (step === 'responsibility') setStep('welcome');
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/40">
      <header className="border-b border-border/60 bg-card/60 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Anonimiseer</h1>
            <p className="text-xs text-muted-foreground">Eerste-keer instelling</p>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <Stepper current={stepIndex} />

        <section className="rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
          {step === 'welcome' && <WelcomeStep />}
          {step === 'responsibility' && (
            <ResponsibilityStep accepted={accepted} onChange={setAccepted} />
          )}
        </section>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 'welcome' || submitting}
            className="rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            Terug
          </button>
          <button
            type="button"
            onClick={() => void next()}
            disabled={!canGoNext() || submitting}
            className={cn(
              'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
              'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40'
            )}
          >
            {lastStep ? (
              submitting ? (
                <>Bezig…</>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  Afronden en openen
                </>
              )
            ) : (
              <>
                Volgende
                <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

function Stepper({ current }: { current: number }): JSX.Element {
  const labels = ['Welkom', 'Privacy'];
  return (
    <ol className="flex items-center gap-3 text-xs text-muted-foreground">
      {labels.map((label, idx) => {
        const state = idx < current ? 'done' : idx === current ? 'active' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium',
                state === 'active' && 'border-primary bg-primary text-primary-foreground',
                state === 'done' && 'border-primary/30 bg-primary/10 text-primary',
                state === 'todo' && 'border-border/60 bg-background text-muted-foreground'
              )}
            >
              {state === 'done' ? <Check className="h-3 w-3" aria-hidden /> : idx + 1}
            </span>
            <span
              className={cn(
                state === 'active' && 'text-foreground',
                state === 'done' && 'text-foreground/80'
              )}
            >
              {label}
            </span>
            {idx < labels.length - 1 && (
              <span className="mx-1 h-px w-8 bg-border/60" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WelcomeStep(): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Welkom bij Anonimiseer</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Een lokale hulp om Nederlandse documenten (DOCX, PDF, XLSX)
            te anonimiseren voordat je ze deelt of naar een LLM-dienst
            stuurt.
          </p>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        <Bullet
          icon={<EyeOff className="h-4 w-4" aria-hidden />}
          title="100% lokaal"
          description="Tekst verlaat tijdens detectie nooit jouw machine."
        />
        <Bullet
          icon={<FileLock2 className="h-4 w-4" aria-hidden />}
          title="Pseudo- of anonimisering"
          description="Vervang met tokens (omkeerbaar) of redigeer onomkeerbaar."
        />
        <Bullet
          icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          title="Ontworpen voor NL"
          description="BSN (Elfproef), NL-telefoon, postcode, studentnummers."
        />
        <Bullet
          icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
          title="Preview — geen garantie"
          description="Je controleert de output altijd zelf. Daar helpen we bij."
        />
      </ul>

      <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <strong className="text-foreground">PDF&apos;s?</strong> PDF-ondersteuning zit vanwege
        de licentie (AGPL-3.0) niet in de installer. Download het één keer (~24 MB) in{' '}
        <em>Modellen beheren</em>; Word, Excel, Markdown en tekst werken meteen.
      </p>

      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Anonimiseer is <strong className="text-foreground">geen</strong> vervanging voor menselijke
        controle of juridisch advies. Automatische detectie kan fouten
        maken (false negatives én false positives).
      </p>
    </div>
  );
}

function ResponsibilityStep({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-warning/15 text-warning-foreground dark:text-warning">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Privacy &amp; verantwoordelijkheid
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Anonimiseer is een hulpmiddel. Jij blijft verantwoordelijk
            voor wat je deelt.
          </p>
        </div>
      </div>

      <dl className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-4 text-sm">
        <Fact
          title="Lokale verwerking"
          body="Detectie en vervanging gebeuren op jouw computer. Er wordt standaard geen data naar een server gestuurd."
        />
        <Fact
          title="Opslag van mappings"
          body="Bij pseudonimisering wordt de mapping versleuteld opgeslagen, met een sleutel van je besturingssysteem. Alleen jij kunt de pseudoniemen daarmee terugzetten, en alleen op deze computer."
        />
        <Fact
          title="Niet feilloos"
          body="Modellen missen soms namen of markeren andere woorden ten onrechte. Loop de highlights altijd na in stap 3 van de wizard."
        />
        <Fact
          title="Jouw verantwoordelijkheid"
          body="Voordat je een bestand verstuurt of archiveert, ben jij degene die controleert of het geschikt is voor het doel."
        />
      </dl>

      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors',
          accepted
            ? 'border-success/40 bg-success/5'
            : 'border-border/70 hover:bg-muted/40'
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-primary"
          checked={accepted}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-sm">
          Ik begrijp dat Anonimiseer een hulpmiddel is en dat{' '}
          <strong>ik zelf verantwoordelijk blijf</strong> voor het
          controleren van de output voordat ik documenten deel of
          archiveer.
        </span>
      </label>
    </div>
  );
}

function Bullet({
  icon,
  title,
  description,
}: {
  icon: JSX.Element;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3">
      <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </li>
  );
}

function Fact({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <div>
      <dt className="text-sm font-medium text-foreground">{title}</dt>
      <dd className="text-xs text-muted-foreground">{body}</dd>
    </div>
  );
}

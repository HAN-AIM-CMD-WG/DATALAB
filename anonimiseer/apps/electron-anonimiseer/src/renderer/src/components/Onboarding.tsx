import { useState } from 'react';
import {
  ShieldCheck,
  EyeOff,
  FileLock2,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Check,
  Gauge,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { ModelProfile } from '@shared/api';
import { cn } from '../lib/utils';

/**
 * First-run onboarding (Fase 3.3).
 *
 * Drie stappen:
 *   1. Welkom — wat Anonimiseer is en wat het *niet* is.
 *   2. Privacy & verantwoordelijkheid — lokaal verwerken, akkoordvinkje.
 *   3. Modelprofiel — Basis / Plus / Max (Plus is default).
 *
 * Resultaat wordt via ``onComplete`` teruggegeven aan de App, die het
 * atomisch opslaat in de settings-store en vervolgens de hoofd-UI toont.
 */

type StepId = 'welcome' | 'responsibility' | 'profile';
const STEPS: StepId[] = ['welcome', 'responsibility', 'profile'];

export function Onboarding({
  initialProfile = 'plus',
  onComplete,
}: {
  initialProfile?: ModelProfile;
  onComplete: (data: {
    acceptedResponsibility: true;
    modelProfile: ModelProfile;
  }) => Promise<void> | void;
}): JSX.Element {
  const [step, setStep] = useState<StepId>('welcome');
  const [accepted, setAccepted] = useState(false);
  const [profile, setProfile] = useState<ModelProfile>(initialProfile);
  const [submitting, setSubmitting] = useState(false);

  const stepIndex = STEPS.indexOf(step);

  const canGoNext = (): boolean => {
    if (step === 'welcome') return true;
    if (step === 'responsibility') return accepted;
    if (step === 'profile') return true;
    return false;
  };

  const next = async (): Promise<void> => {
    if (!canGoNext()) return;
    if (step === 'welcome') setStep('responsibility');
    else if (step === 'responsibility') setStep('profile');
    else if (step === 'profile') {
      setSubmitting(true);
      try {
        await onComplete({ acceptedResponsibility: true, modelProfile: profile });
      } finally {
        setSubmitting(false);
      }
    }
  };

  const back = (): void => {
    if (step === 'responsibility') setStep('welcome');
    else if (step === 'profile') setStep('responsibility');
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
          {step === 'profile' && (
            <ProfileStep value={profile} onChange={setProfile} />
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
            {step === 'profile' ? (
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
  const labels = ['Welkom', 'Privacy', 'Modelprofiel'];
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
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
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
          body="Bij pseudonimisering wordt de mapping lokaal versleuteld opgeslagen. Verlies het wachtwoord niet — dan is de tekst niet meer herleidbaar."
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
            ? 'border-emerald-500/40 bg-emerald-500/5'
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

function ProfileStep({
  value,
  onChange,
}: {
  value: ModelProfile;
  onChange: (value: ModelProfile) => void;
}): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Gauge className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Kies een modelprofiel</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bepaalt welke modellen Anonimiseer later zelf opstart.
            Je kunt dit altijd wijzigen bij <em>Instellingen</em>.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <ProfileCard
          id="basis"
          label="Basis"
          icon={<Zap className="h-4 w-4" aria-hidden />}
          tagline="Licht & snel"
          description="Alleen spaCy. Lichte CPU, snelle startup. Minder nauwkeurig bij namen met tussenvoegsels (van den Broek, ter Horst)."
          selected={value === 'basis'}
          onSelect={onChange}
          recommended={false}
        />
        <ProfileCard
          id="plus"
          label="Plus"
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          tagline="Aanbevolen"
          description="spaCy + SoNaR-BERT voor betere NL-personen/locaties/organisaties. ~440 MB eenmalige download."
          selected={value === 'plus'}
          onSelect={onChange}
          recommended
        />
        <ProfileCard
          id="max"
          label="Max"
          icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
          tagline="Hoogste recall"
          description="Plus-stack met alle aanvullende NL-recognizers (BSN-Elfproef, studentnr, uitgebreide patronen). Zwaarder, trager."
          selected={value === 'max'}
          onSelect={onChange}
          recommended={false}
        />
      </div>

      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Tijdens deze preview draait de engine extern; je profielkeuze wordt
        bewaard en toegepast zodra Anonimiseer de engine zelf opstart (Fase
        3.8: PyInstaller-bundeling).
      </p>
    </div>
  );
}

function ProfileCard({
  id,
  label,
  icon,
  tagline,
  description,
  selected,
  onSelect,
  recommended,
}: {
  id: ModelProfile;
  label: string;
  icon: JSX.Element;
  tagline: string;
  description: string;
  selected: boolean;
  onSelect: (value: ModelProfile) => void;
  recommended: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/70 hover:border-border hover:bg-muted/40'
      )}
      aria-pressed={selected}
    >
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md',
          selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {recommended && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              Aanbevolen
            </span>
          )}
          <span className="text-xs text-muted-foreground">· {tagline}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <span
        className={cn(
          'mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
        )}
        aria-hidden
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
    </button>
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

import { ShieldCheck, FileCheck2, EyeOff, RotateCcw } from 'lucide-react';
import { EngineStatus } from './components/EngineStatus';
import { EngineOfflinePanel } from './components/EngineOfflinePanel';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { Onboarding } from './components/Onboarding';
import { useEngineHealth } from './hooks/useEngineHealth';
import { useSettings } from './hooks/useSettings';
import type { AppSettings } from '@shared/api';

export function App(): JSX.Element {
  const health = useEngineHealth();
  const { settings, update, reload } = useSettings();

  // Initial load: hou leeg totdat settings beschikbaar zijn om flitser
  // tussen onboarding en main UI te voorkomen.
  if (!settings) {
    return <div className="flex min-h-screen items-center justify-center text-xs text-muted-foreground">Laden…</div>;
  }

  if (!settings.onboardingCompletedAt) {
    return (
      <Onboarding
        initialProfile={settings.modelProfile}
        onComplete={async ({ acceptedResponsibility, modelProfile }) => {
          await update({
            acceptedResponsibility,
            modelProfile,
            onboardingCompletedAt: new Date().toISOString(),
          });
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        state={health}
        settings={settings}
        onResetOnboarding={async () => {
          await window.anonimiseer.settings.reset();
          await reload();
        }}
      />
      <DisclaimerBanner />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        {health.status === 'down' && <EngineOfflinePanel health={health} />}
        <Placeholder settings={settings} />
      </main>
      <Footer />
    </div>
  );
}

function Header({
  state,
  settings,
  onResetOnboarding,
}: {
  state: ReturnType<typeof useEngineHealth>;
  settings: AppSettings;
  onResetOnboarding: () => Promise<void>;
}): JSX.Element {
  return (
    <header className="border-b border-border/60 bg-card/60 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Anonimiseer</h1>
            <p className="text-xs text-muted-foreground">
              Lokale PII-anonimisering · profiel{' '}
              <span className="font-medium text-foreground/80 capitalize">
                {settings.modelProfile}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EngineStatus state={state} />
          <button
            type="button"
            onClick={() => void onResetOnboarding()}
            title="Onboarding opnieuw doorlopen (reset alle instellingen)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Onboarding opnieuw"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}

function Placeholder({ settings }: { settings: AppSettings }): JSX.Element {
  return (
    <section className="rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
      <div className="mx-auto max-w-2xl space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileCheck2 className="h-7 w-7" aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            Welkom bij Anonimiseer
          </h2>
          <p className="text-sm text-muted-foreground">
            Je bent klaar om bestanden te anonimiseren. De 4-stappen wizard
            (Bestand kiezen → Instellingen → Controleren → Opslaan) komt in
            de volgende iteraties. Instellingen zijn opgeslagen op{' '}
            <time dateTime={settings.onboardingCompletedAt ?? undefined}>
              {settings.onboardingCompletedAt
                ? new Date(settings.onboardingCompletedAt).toLocaleString('nl-NL')
                : '—'}
            </time>
            .
          </p>
        </div>
        <ul className="mx-auto grid max-w-xl gap-3 text-left text-sm text-muted-foreground sm:grid-cols-2">
          <Feature
            icon={<EyeOff className="h-4 w-4" aria-hidden />}
            title="100% lokaal"
            description="Geen tekst verlaat jouw machine tijdens detectie."
          />
          <Feature
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
            title="Ontworpen voor NL"
            description="BSN (Elfproef), NL telefoon, postcode, studentnummers."
          />
        </ul>
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/40 p-5 text-left text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Wizard nog in aanbouw</p>
          <p className="mt-1">
            Je hebt profiel{' '}
            <strong className="capitalize text-foreground/90">
              {settings.modelProfile}
            </strong>{' '}
            gekozen. Testen kan nu al in de browser via de Playground op{' '}
            <code className="rounded bg-background px-1 py-0.5">
              http://127.0.0.1:8765/playground
            </code>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

function Feature({
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
        <p className="text-xs">{description}</p>
      </div>
    </li>
  );
}

function Footer(): JSX.Element {
  const v = window.anonimiseer?.version;
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-6 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Verwerking gebeurt lokaal. Jij blijft verantwoordelijk voor het controleren van de output.</span>
        <span>
          v{v?.app ?? '0.0.0'} · Electron {v?.electron ?? '—'} · {v?.platform ?? '—'}
        </span>
      </div>
    </footer>
  );
}

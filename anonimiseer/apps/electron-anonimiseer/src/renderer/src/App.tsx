import { useState } from 'react';
import { ShieldCheck, RotateCcw, Package, HelpCircle } from 'lucide-react';
import { EngineStatus } from './components/EngineStatus';
import { EngineOfflinePanel } from './components/EngineOfflinePanel';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { Onboarding } from './components/Onboarding';
import { ModelManager } from './components/ModelManager';
import { HelpPanel } from './components/HelpPanel';
import { Wizard } from './components/wizard/Wizard';
import { useEngineHealth } from './hooks/useEngineHealth';
import { useSettings } from './hooks/useSettings';
import type { AppSettings } from '@shared/api';

export function App(): JSX.Element {
  const health = useEngineHealth();
  const { settings, update, reload } = useSettings();
  const [showModels, setShowModels] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
        onOpenModels={() => setShowModels(true)}
        onOpenHelp={() => setShowHelp(true)}
      />
      <DisclaimerBanner />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        {health.status === 'down' && <EngineOfflinePanel health={health} />}
        <Wizard appSettings={settings} />
      </main>
      <Footer />
      <ModelManager open={showModels} onClose={() => setShowModels(false)} />
      <HelpPanel open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

function Header({
  state,
  settings,
  onResetOnboarding,
  onOpenModels,
  onOpenHelp,
}: {
  state: ReturnType<typeof useEngineHealth>;
  settings: AppSettings;
  onResetOnboarding: () => Promise<void>;
  onOpenModels: () => void;
  onOpenHelp: () => void;
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
            onClick={onOpenHelp}
            title="Hulp & uitleg (pipeline, modellen, veelgestelde vragen)"
            className="flex h-7 items-center gap-1 rounded-md border border-border/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Hulp en uitleg openen"
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Hulp</span>
          </button>
          <button
            type="button"
            onClick={onOpenModels}
            title="Modellen beheren (downloads, versies)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Modellen beheren"
          >
            <Package className="h-3.5 w-3.5" aria-hidden />
          </button>
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

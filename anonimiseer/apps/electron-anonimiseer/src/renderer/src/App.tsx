import { ShieldCheck, FileCheck2, EyeOff } from 'lucide-react';
import { EngineStatus } from './components/EngineStatus';
import { EngineOfflinePanel } from './components/EngineOfflinePanel';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { useEngineHealth } from './hooks/useEngineHealth';

export function App(): JSX.Element {
  const health = useEngineHealth();

  return (
    <div className="flex min-h-screen flex-col">
      <Header state={health} />
      <DisclaimerBanner />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        {health.status === 'down' && <EngineOfflinePanel health={health} />}
        <Placeholder />
      </main>
      <Footer />
    </div>
  );
}

function Header({
  state,
}: {
  state: ReturnType<typeof useEngineHealth>;
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
              Lokale PII-anonimisering voor Nederlandse documenten
            </p>
          </div>
        </div>
        <EngineStatus state={state} />
      </div>
    </header>
  );
}

function Placeholder(): JSX.Element {
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
            Deze applicatie draait volledig lokaal op je eigen machine en
            helpt je Nederlandse DOCX-, PDF- en XLSX-bestanden te
            anonimiseren voordat je ze deelt, archiveert of naar een
            LLM-dienst stuurt.
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
            De 4-stappen flow (Bestand kiezen → Instellingen → Controleren →
            Opslaan) wordt de komende iteraties gebouwd. Wat je nu ziet is
            de veilige Electron-shell die straks de wizard host. Testen kan
            in de browser via de Playground op{' '}
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

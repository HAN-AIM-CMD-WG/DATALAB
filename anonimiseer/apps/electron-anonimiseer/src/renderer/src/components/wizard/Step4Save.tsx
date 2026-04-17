import { useEffect, useMemo, useState } from 'react';
import {
  Save,
  FolderOpen,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FolderCheck,
  KeyRound,
  FileWarning,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import type { AppSettings, WriteRunResponse } from '@shared/api';
import { cn } from '../../lib/utils';
import { buildRun } from './anonymizeLocal';
import type { ReviewState } from './reviewTypes';
import {
  SENSITIVITY_THRESHOLDS,
  resolveEntities,
  resolveThreshold,
  type WizardSettings,
} from './settingsTypes';
import type { WizardFileEntry } from './wizardTypes';

/**
 * Wizard-stap 4: Opslaan.
 *
 * Bouwt de geanonimiseerde bestanden lokaal op (geen extra engine-call)
 * en laat de Electron main process ze atomisch wegschrijven. Toont
 * daarna een success-scherm met snelkoppelingen naar de outputmap.
 */
export function Step4Save({
  files,
  settings,
  review,
  appSettings,
  onReset,
}: {
  files: WizardFileEntry[];
  settings: WizardSettings;
  review: ReviewState;
  appSettings: AppSettings;
  onReset: () => void;
}): JSX.Element {
  const [outputParent, setOutputParent] = useState<string | null>(null);
  const [encAvailable, setEncAvailable] = useState<boolean | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<WriteRunResponse | null>(null);

  useEffect(() => {
    void window.anonimiseer.output
      .encryptionAvailable()
      .then(setEncAvailable)
      .catch(() => setEncAvailable(false));
  }, []);

  const run = useMemo(
    () => buildRun(files, review, settings.mode),
    [files, review, settings.mode]
  );

  const pickFolder = async (): Promise<void> => {
    const dir = await window.anonimiseer.output.pickFolder();
    if (dir) setOutputParent(dir);
  };

  const save = async (): Promise<void> => {
    if (!outputParent) return;
    setSaving(true);
    try {
      const response = await window.anonimiseer.output.writeRun({
        outputParent,
        context: {
          mode: settings.mode,
          sensitivity: settings.sensitivity,
          entities: resolveEntities(settings),
          threshold: resolveThreshold(settings),
          whitelist: review.whitelist,
          modelProfile: appSettings.modelProfile,
          startedAt: new Date().toISOString(),
        },
        files: run.files,
        skipped: run.skipped,
        mapping: run.mapping,
      });
      setResult(response);
    } finally {
      setSaving(false);
    }
  };

  if (result && result.ok) {
    return (
      <SuccessView
        result={result}
        mode={settings.mode}
        onReset={onReset}
      />
    );
  }

  const hasProcessable = run.files.length > 0;

  return (
    <div className="space-y-5">
      <Header />

      <Summary run={run} settings={settings} review={review} />

      {!hasProcessable && (
        <Notice tone="amber" icon={<FileWarning className="h-4 w-4" aria-hidden />}>
          <strong>Niets om op te slaan.</strong> Geen van de gekozen bestanden
          is klaar om opgeslagen te worden. Ga terug naar stap 1/3 en zorg dat
          er minstens één bestand succesvol is geanalyseerd.
        </Notice>
      )}

      {hasProcessable && (
        <>
          <OutputPicker dir={outputParent} onPick={pickFolder} />

          {settings.mode === 'pseudonymize' && encAvailable === false && (
            <Notice tone="amber" icon={<KeyRound className="h-4 w-4" aria-hidden />}>
              <strong>Let op — mapping niet versleuteld opslaanbaar.</strong> De
              OS-keychain is niet beschikbaar op dit systeem, dus we kunnen de
              mapping niet veilig versleutelen. Je bestanden worden wel
              gepseudonimiseerd, maar je kunt de originelen straks{' '}
              <em>niet</em> terughalen. Overweeg modus "Anonimiseren" in stap 2.
            </Notice>
          )}

          <ResponsibilitySection checked={agreed} onChange={setAgreed} />

          {result && !result.ok && (
            <Notice tone="red" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
              <strong>Opslaan mislukt.</strong> {result.error}
            </Notice>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={!outputParent || !agreed || saving}
              className={cn(
                'inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
                'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Bezig met opslaan…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" aria-hidden />
                  Opslaan
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Header(): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Save className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Opslaan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kies een map, accepteer de disclaimer en sla de geanonimiseerde
          bestanden op. Bij pseudonimiseren slaan we een versleutelde mapping
          op in dezelfde map.
        </p>
      </div>
    </div>
  );
}

function Summary({
  run,
  settings,
  review,
}: {
  run: ReturnType<typeof buildRun>;
  settings: WizardSettings;
  review: ReviewState;
}): JSX.Element {
  const totalAccepted = run.files.reduce((acc, f) => acc + f.stats.accepted, 0);
  const totalSkipped = run.files.reduce((acc, f) => acc + f.stats.skipped, 0);
  const threshold = SENSITIVITY_THRESHOLDS[settings.sensitivity];

  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/30 p-4 sm:grid-cols-2">
      <SummaryRow label="Modus">
        {settings.mode === 'pseudonymize'
          ? 'Pseudonimiseren (omkeerbaar)'
          : 'Anonimiseren (onomkeerbaar)'}
      </SummaryRow>
      <SummaryRow label="Gevoeligheid">
        {settings.sensitivity} (drempel {threshold.toFixed(2)})
      </SummaryRow>
      <SummaryRow label="Bestanden verwerkt">
        {run.files.length}
        {run.skipped.length > 0 && (
          <span className="ml-1 text-muted-foreground">
            — {run.skipped.length} overgeslagen
          </span>
        )}
      </SummaryRow>
      <SummaryRow label="Hits">
        <strong className="text-foreground">{totalAccepted}</strong> vervangen
        {totalSkipped > 0 && (
          <>
            <span className="mx-1">·</span>
            <span className="text-muted-foreground">{totalSkipped} overgeslagen</span>
          </>
        )}
      </SummaryRow>
      {review.whitelist.length > 0 && (
        <SummaryRow label="Whitelist" className="sm:col-span-2">
          {review.whitelist.join(', ')}
        </SummaryRow>
      )}
      {run.skipped.length > 0 && (
        <details className="sm:col-span-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            Overgeslagen bestanden ({run.skipped.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {run.skipped.map((s) => (
              <li key={s.sourcePath}>
                <span className="font-medium text-foreground">{s.sourceName}</span>
                {' — '}
                {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('text-sm', className)}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}

function OutputPicker({
  dir,
  onPick,
}: {
  dir: string | null;
  onPick: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FolderOpen className="h-4 w-4" aria-hidden />
        Doelmap
      </div>
      <p className="text-xs text-muted-foreground">
        We maken hierbinnen een submap met tijdstempel, zodat meerdere runs
        elkaar niet overschrijven.
      </p>
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex-1 truncate rounded-md border border-border/60 bg-background px-3 py-2 text-xs',
            dir ? 'text-foreground' : 'text-muted-foreground italic'
          )}
          title={dir ?? undefined}
        >
          {dir ?? 'Nog geen map gekozen'}
        </div>
        <button
          type="button"
          onClick={onPick}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border/60 px-3 text-xs transition-colors hover:bg-muted"
        >
          <FolderOpen className="h-3.5 w-3.5" aria-hidden />
          Kies map…
        </button>
      </div>
    </div>
  );
}

function ResponsibilitySection({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-card p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none rounded border-border/80 accent-primary"
      />
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-500" aria-hidden />
          Ik blijf zelf verantwoordelijk voor het resultaat
        </div>
        <p className="text-xs text-muted-foreground">
          Ik weet dat automatische anonymisatie fouten kan maken (false
          positives én false negatives). Ik controleer het geanonimiseerde
          bestand zelf voordat ik het deel, publiceer of naar een externe
          dienst stuur.
        </p>
      </div>
    </label>
  );
}

function SuccessView({
  result,
  mode,
  onReset,
}: {
  result: Extract<WriteRunResponse, { ok: true }>;
  mode: 'pseudonymize' | 'anonymize';
  onReset: () => void;
}): JSX.Element {
  const reveal = (path: string): void => {
    void window.anonimiseer.output.revealPath(path);
  };

  const written = result.files.filter((f) => f.status === 'written');
  const errors = result.files.filter((f) => f.status === 'error');

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Klaar! {written.length}{' '}
            bestand{written.length === 1 ? '' : 'en'} opgeslagen.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open de map en controleer de resultaten voordat je ze deelt.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <FolderCheck className="h-4 w-4" aria-hidden />
          <span className="truncate" title={result.runDir}>
            {result.runDir}
          </span>
          <button
            type="button"
            onClick={() => reveal(result.runDir)}
            className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-border/60 px-2 text-xs transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Map openen
          </button>
        </div>
        <ul className="mt-3 space-y-1 text-xs">
          {result.files.map((f) => (
            <li
              key={f.sourceName}
              className={cn(
                'flex items-center gap-2',
                f.status === 'error' && 'text-red-600 dark:text-red-400'
              )}
            >
              {f.status === 'written' ? (
                <CheckCircle2
                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="truncate">
                {f.outputPath ?? f.sourceName}
                {f.error && <span className="ml-1 opacity-80">— {f.error}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <QuickLink onClick={() => reveal(result.disclaimerPath)} label="DISCLAIMER.txt" />
          <QuickLink onClick={() => reveal(result.auditPath)} label="audit.jsonl" />
          {mode === 'pseudonymize' && result.mapping.status === 'saved' && (
            <QuickLink onClick={() => reveal(result.mapping.status === 'saved' ? result.mapping.path : '')} label="mapping.bin (versleuteld)" />
          )}
        </div>
      </div>

      {mode === 'pseudonymize' && result.mapping.status === 'skipped-no-encryption' && (
        <Notice tone="amber" icon={<KeyRound className="h-4 w-4" aria-hidden />}>
          <strong>Mapping niet opgeslagen.</strong> {result.mapping.reason}{' '}
          Je bestanden zijn wel gepseudonimiseerd, maar niet omkeerbaar.
        </Notice>
      )}

      {errors.length > 0 && (
        <Notice tone="red" icon={<AlertTriangle className="h-4 w-4" aria-hidden />}>
          <strong>{errors.length} bestand{errors.length === 1 ? '' : 'en'}</strong>{' '}
          konden niet geschreven worden. Zie de lijst hierboven voor details.
        </Notice>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          Nieuwe run starten
        </button>
      </div>
    </div>
  );
}

function QuickLink({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted"
    >
      <ExternalLink className="h-3 w-3" aria-hidden />
      {label}
    </button>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: 'red' | 'amber';
  icon: JSX.Element;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-3 text-sm',
        tone === 'red'
          ? 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
      )}
    >
      <span className="mt-0.5 flex-none">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

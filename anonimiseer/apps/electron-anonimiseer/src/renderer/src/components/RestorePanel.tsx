import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  FolderOpen,
  KeyRound,
  Loader2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  RestoreMappingResponse,
  RestoreRunResponse,
  RestoreSourceFile,
} from '@shared/api';
import { cn } from '../lib/utils';
import { statusIcon, statusPanel } from '../lib/statusStyles';

/**
 * Pseudoniemen terugzetten met de mapping.bin van een eerdere run.
 *
 * De mapping zelf blijft in het main-proces; dit scherm ziet alleen hoeveel
 * vervangingen erin staan. Het resultaat bevat weer persoonsgegevens, dus de
 * gebruiker bevestigt dat eerst.
 */
export function RestorePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [mapping, setMapping] = useState<RestoreMappingResponse | null>(null);
  const [files, setFiles] = useState<RestoreSourceFile[]>([]);
  const [outputParent, setOutputParent] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RestoreRunResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const api = window.anonimiseer.restore;
  const mappingOk = mapping?.ok === true;
  const canRun = mappingOk && files.length > 0 && outputParent !== null && agreed && !running;

  const pickMapping = async (): Promise<void> => {
    const res = await api.openMapping();
    if (res !== null) {
      setMapping(res);
      setResult(null);
    }
  };
  const pickFiles = async (): Promise<void> => {
    const picked = await api.pickFiles();
    if (picked.length > 0) {
      setFiles(picked);
      setResult(null);
    }
  };
  const pickFolder = async (): Promise<void> => {
    const dir = await window.anonimiseer.output.pickFolder();
    if (dir) setOutputParent(dir);
  };
  const run = async (): Promise<void> => {
    if (!canRun || outputParent === null) return;
    setRunning(true);
    try {
      setResult(await api.run({ files: files.map((f) => f.path), outputParent }));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pseudoniemen terugzetten"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-border bg-background shadow-xl ring-1 ring-black/5">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Undo2 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight">
                Pseudoniemen terugzetten
              </h2>
              <p className="text-xs text-muted-foreground">
                Zet PERSON_1 en dergelijke terug naar de originele gegevens, met de mapping
                van die run.
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

        <div className="space-y-4 px-6 py-5 text-sm">
          <div className={statusPanel('warning', 'flex gap-2 p-3 text-xs')}>
            <AlertTriangle className={cn('mt-0.5 h-4 w-4 flex-none', statusIcon('warning'))} aria-hidden />
            <p>
              Het resultaat bevat weer persoonsgegevens. Bewaar het net zo zorgvuldig als het
              originele bestand. Terugzetten werkt alleen op de computer en met het account
              waarmee je hebt gepseudonimiseerd.
            </p>
          </div>

          <Step
            number={1}
            title="Mapping"
            hint="De mapping.bin uit de map van die run."
            action={
              <PickButton icon={<KeyRound className="h-3.5 w-3.5" aria-hidden />} onClick={pickMapping}>
                Kies mapping.bin
              </PickButton>
            }
          >
            {mapping?.ok === true && (
              <p className="text-xs text-muted-foreground">
                <CheckCircle2 className={cn('mr-1 inline h-3.5 w-3.5', statusIcon('success'))} aria-hidden />
                {mapping.entries} vervanging{mapping.entries === 1 ? '' : 'en'}
                {mapping.createdAt ? `, gemaakt op ${formatDate(mapping.createdAt)}` : ''}.
                {!mapping.verified && (
                  <span className="mt-1 block text-foreground">
                    Deze mapping komt uit een oudere versie van Anonimiseer en kan niet op
                    wijzigingen worden gecontroleerd.
                  </span>
                )}
              </p>
            )}
            {mapping?.ok === false && (
              <p className={cn('text-xs', statusIcon('destructive'))}>{mapping.error}</p>
            )}
          </Step>

          <Step
            number={2}
            title="Bestanden"
            hint="Tekst, Word en Excel. Een PDF kan niet worden teruggezet."
            action={
              <PickButton icon={<FileText className="h-3.5 w-3.5" aria-hidden />} onClick={pickFiles}>
                Kies bestanden
              </PickButton>
            }
          >
            {files.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {files.map((f) => (
                  <li key={f.path} className="truncate">
                    {f.name}
                  </li>
                ))}
              </ul>
            )}
          </Step>

          <Step
            number={3}
            title="Doelmap"
            hint="Hierin komt een nieuwe map met de teruggezette bestanden."
            action={
              <PickButton icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden />} onClick={pickFolder}>
                Kies map
              </PickButton>
            }
          >
            {outputParent && (
              <p className="truncate text-xs text-muted-foreground" title={outputParent}>
                {outputParent}
              </p>
            )}
          </Step>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-card p-3 text-xs">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none rounded border-border/80 accent-primary"
            />
            Ik begrijp dat de teruggezette bestanden weer persoonsgegevens bevatten.
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canRun}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Terugzetten
            </button>
          </div>

          {result && <RestoreResult result={result} />}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'short' });
}

function Step({
  number,
  title,
  hint,
  action,
  children,
}: {
  number: number;
  title: string;
  hint: string;
  action: JSX.Element;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">
            {number}. {title}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </section>
  );
}

function PickButton({
  icon,
  onClick,
  children,
}: {
  icon: JSX.Element;
  onClick: () => Promise<void>;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs transition-colors hover:bg-muted"
    >
      {icon}
      {children}
    </button>
  );
}

function RestoreResult({ result }: { result: RestoreRunResponse }): JSX.Element {
  if (!result.ok) {
    return <p className={cn('text-xs', statusIcon('destructive'))}>{result.error}</p>;
  }
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="truncate font-medium text-foreground" title={result.runDir}>
          {result.runDir}
        </span>
        <button
          type="button"
          onClick={() => void window.anonimiseer.output.revealPath(result.runDir)}
          className="ml-auto inline-flex h-7 flex-none items-center gap-1 rounded-md border border-border/60 px-2 hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Map openen
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {result.files.map((f) => (
          <li key={f.sourceName} className={cn(f.error && statusIcon('destructive'))}>
            <span className="font-medium">{f.sourceName}</span>
            {f.error ? (
              <> — {f.error}</>
            ) : (
              <>
                {' '}
                — {f.restored} teruggezet
                {f.unknown > 0 && (
                  <span className={statusIcon('warning')}>
                    , {f.unknown} pseudoniem{f.unknown === 1 ? '' : 'en'} niet in deze mapping
                    (van een andere run?)
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

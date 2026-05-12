import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Eye,
  Loader2,
  RefreshCw,
  AlertTriangle,
  FileWarning,
  Shield,
  ShieldOff,
  Ban,
  Check,
  X,
} from 'lucide-react';
import type { AnalyzeHit } from '@shared/api';
import { cn } from '../../lib/utils';
import { FileIcon } from './FileIcon';
import { styleForEntity } from './entityPalette';
import {
  hitId,
  type FileReview,
  type HitDecision,
  type ReviewState,
  type ReviewHit,
} from './reviewTypes';
import { resolveEntities, resolveThreshold, type WizardSettings } from './settingsTypes';
import { formatBytes } from './validation';
import { type WizardFileEntry } from './wizardTypes';

/**
 * Wizard-stap 3: Controleren.
 *
 * Roept per bestand ``/analyze`` aan en laat de hits zien op de echte
 * tekst. De gebruiker kan per hit accepteren (wordt vervangen) of
 * overslaan (blijft staan), en bijzonder vaak gemiste false-positives
 * op een whitelist zetten zodat ze ook in andere bestanden genegeerd
 * worden.
 *
 * De eindberekening (pseudoniemen toekennen, nieuwe tekst bouwen)
 * gebeurt pas in stap 4.
 */

const TEXT_READABLE_EXTS = new Set(['.md', '.txt']);
const DOCUMENT_EXTS = new Set(['.docx', '.xlsx', '.pdf']);

function kindForExtension(ext: string): 'text' | 'document' | null {
  if (TEXT_READABLE_EXTS.has(ext)) return 'text';
  if (DOCUMENT_EXTS.has(ext)) return 'document';
  return null;
}

function settingsKey(settings: WizardSettings): string {
  return JSON.stringify({
    entities: resolveEntities(settings).slice().sort(),
    threshold: resolveThreshold(settings),
  });
}

export function Step3Review({
  files,
  settings,
  state,
  onStateChange,
}: {
  files: WizardFileEntry[];
  settings: WizardSettings;
  state: ReviewState;
  /**
   * We nemen React's zelfde shape als ``useState``-setter. Belangrijk:
   * gebruik de updater-vorm (``prev => next``) voor alle asynchrone of
   * volgorde-gevoelige updates. Anders werken parallelle patches op
   * stale snapshots en overschrijven ze elkaars velden.
   */
  onStateChange: Dispatch<SetStateAction<ReviewState>>;
}): JSX.Element {
  const validFiles = useMemo(() => files.filter((f) => !f.error), [files]);
  const currentKey = useMemo(() => settingsKey(settings), [settings]);

  // Initialiseer/synchroniseer de state wanneer bestanden veranderen of
  // de settings-key verandert. Bestaande decisions en whitelist blijven
  // intact; alleen `hits`/`status` worden gereset.
  useEffect(() => {
    onStateChange((prev) => {
      const paths = new Set(validFiles.map((f) => f.info.path));
      const nextFiles: Record<string, FileReview> = {};
      let dirty = false;

      for (const f of validFiles) {
        const existing = prev.files[f.info.path];
        if (!existing) {
          const kind = kindForExtension(f.info.extension);
          nextFiles[f.info.path] = {
            path: f.info.path,
            name: f.info.name,
            extension: f.info.extension,
            kind: kind ?? 'text',
            status: kind ? 'pending' : 'unsupported',
            decisions: {},
          };
          dirty = true;
        } else if (
          existing.status !== 'unsupported' &&
          existing.analyzedWith &&
          existing.analyzedWith !== currentKey
        ) {
          // Settings veranderd sinds laatste analyse → markeer als pending
          // zodat het useEffect hieronder opnieuw gaat ophalen. Decisions
          // blijven staan op hun id; hits die nog steeds gevonden worden
          // houden daardoor hun accept/skip.
          nextFiles[f.info.path] = {
            ...existing,
            status: 'pending',
            hits: undefined,
            error: undefined,
          };
          dirty = true;
        } else {
          nextFiles[f.info.path] = existing;
        }
      }

      const removedSome = Object.keys(prev.files).some((p) => !paths.has(p));
      if (!dirty && !removedSome) {
        if (!prev.activePath && Object.keys(nextFiles).length > 0) {
          return { ...prev, activePath: Object.keys(nextFiles)[0] };
        }
        return prev;
      }

      const activePath =
        prev.activePath && nextFiles[prev.activePath]
          ? prev.activePath
          : (Object.keys(nextFiles)[0] ?? null);
      return { ...prev, files: nextFiles, activePath };
    });
  }, [validFiles, currentKey, onStateChange]);

  const runAnalysisForPath = useCallback(
    async (path: string, kind: FileReview['kind']): Promise<void> => {
      // Elke patch past ``prev`` aan — dus volgende patches zien altijd
      // de accumulatie van eerdere. Dit is cruciaal: anders overschrijft
      // de 'done'-patch de 'analyzing+text'-patch en is ``text``
      // verdwenen tegen de tijd dat we bij stap 4 zijn.
      const patch = (partial: Partial<FileReview>): void => {
        onStateChange((prev) => {
          const existing = prev.files[path];
          if (!existing) return prev;
          if (existing.status === 'unsupported') return prev;
          return {
            ...prev,
            files: {
              ...prev.files,
              [path]: { ...existing, ...partial },
            },
          };
        });
      };

      patch({ status: 'loading', error: undefined });

      let text: string;
      let blocks: FileReview['blocks'];
      if (kind === 'document') {
        const extractResult = await window.anonimiseer.document.extract(path);
        if (!extractResult.ok) {
          patch({ status: 'error', error: `Kan document niet lezen: ${extractResult.error}` });
          return;
        }
        text = extractResult.flatText;
        blocks = extractResult.blocks;
      } else {
        const readResult = await window.anonimiseer.file.readText(path);
        if (!readResult.ok) {
          patch({ status: 'error', error: `Kan bestand niet lezen: ${readResult.error}` });
          return;
        }
        text = readResult.text;
      }

      patch({ status: 'analyzing', text, blocks });

      const entities = resolveEntities(settings);
      const threshold = resolveThreshold(settings);
      const analysis = await window.anonimiseer.engine.analyze({
        text,
        language: 'nl',
        entities,
        threshold,
      });
      if (!analysis.ok) {
        patch({ status: 'error', error: `Analyse mislukt: ${analysis.error}` });
        return;
      }

      const hits: ReviewHit[] = analysis.items
        .slice()
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .map((h) => ({ ...h, id: hitId(h) }));
      patch({ status: 'done', hits, analyzedWith: currentKey });
    },
    [settings, onStateChange, currentKey]
  );

  // Wanneer een bestand op "pending" staat, trap een analyse af. We
  // gebruiken een ref om dubbele fetches in StrictMode te voorkomen.
  const inflight = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const file of Object.values(state.files)) {
      if (file.status === 'pending' && !inflight.current.has(file.path)) {
        inflight.current.add(file.path);
        void runAnalysisForPath(file.path, file.kind).finally(() => {
          inflight.current.delete(file.path);
        });
      }
    }
  }, [state.files, runAnalysisForPath]);

  const activeFile = state.activePath ? state.files[state.activePath] : null;

  const setActive = (path: string): void => {
    onStateChange((prev) => ({ ...prev, activePath: path }));
  };

  const setDecision = (path: string, id: string, decision: HitDecision): void => {
    onStateChange((prev) => {
      const file = prev.files[path];
      if (!file) return prev;
      const nextDecisions = { ...file.decisions, [id]: decision };
      return {
        ...prev,
        files: { ...prev.files, [path]: { ...file, decisions: nextDecisions } },
      };
    });
  };

  const toggleDecision = (path: string, hit: ReviewHit): void => {
    const current = effectiveDecision(hit, state.files[path], state.whitelist);
    setDecision(path, hit.id, current === 'accept' ? 'skip' : 'accept');
  };

  const addToWhitelist = (value: string): void => {
    const v = value.trim().toLowerCase();
    if (!v) return;
    onStateChange((prev) =>
      prev.whitelist.includes(v) ? prev : { ...prev, whitelist: [...prev.whitelist, v] }
    );
  };

  const removeFromWhitelist = (value: string): void => {
    onStateChange((prev) => ({
      ...prev,
      whitelist: prev.whitelist.filter((v) => v !== value),
    }));
  };

  const reanalyzeAll = (): void => {
    onStateChange((prev) => {
      const next = { ...prev.files };
      for (const p of Object.keys(next)) {
        if (next[p].status !== 'unsupported') {
          next[p] = { ...next[p], status: 'pending', hits: undefined, error: undefined };
        }
      }
      return { ...prev, files: next };
    });
  };

  return (
    <div className="space-y-5">
      <Header onReanalyze={reanalyzeAll} />

      <ReviewResponsibilityBanner />

      {validFiles.length > 1 && (
        <FileTabs
          files={Object.values(state.files)}
          activePath={state.activePath}
          onSelect={setActive}
        />
      )}

      {activeFile && (
        <FileView
          file={activeFile}
          whitelist={state.whitelist}
          onToggle={(hit) => toggleDecision(activeFile.path, hit)}
          onSetDecision={(hit, d) => setDecision(activeFile.path, hit.id, d)}
          onAddToWhitelist={addToWhitelist}
        />
      )}

      <WhitelistPanel
        whitelist={state.whitelist}
        onAdd={addToWhitelist}
        onRemove={removeFromWhitelist}
      />
    </div>
  );
}

function ReviewResponsibilityBanner(): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <p className="leading-snug">
        <strong className="font-semibold">Loop alle markeringen na.</strong>{' '}
        Automatische detectie mist soms een naam (false negative) of
        markeert ten onrechte iets onschuldigs (false positive).
        Wat je hier accepteert, wordt straks vervangen — wat je
        overslaat blijft staan in het uiteindelijke bestand.
      </p>
    </div>
  );
}

function Header({ onReanalyze }: { onReanalyze: () => void }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Eye className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Controleren</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bekijk wat Anonimiseer heeft gevonden. Klik op een markering
            om 'm over te slaan, of zet 'n woord op de whitelist om hem
            ook in andere bestanden te negeren.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onReanalyze}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Opnieuw analyseren
      </button>
    </div>
  );
}

function FileTabs({
  files,
  activePath,
  onSelect,
}: {
  files: FileReview[];
  activePath: string | null;
  onSelect: (path: string) => void;
}): JSX.Element {
  return (
    <nav className="-mx-1 flex flex-wrap items-center gap-1">
      {files.map((f) => {
        const active = f.path === activePath;
        return (
          <button
            key={f.path}
            type="button"
            onClick={() => onSelect(f.path)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <FileIcon extension={f.extension} />
            <span className="truncate max-w-[180px]" title={f.path}>
              {f.name}
            </span>
            <StatusDot status={f.status} />
          </button>
        );
      })}
    </nav>
  );
}

function StatusDot({ status }: { status: FileReview['status'] }): JSX.Element {
  if (status === 'loading' || status === 'analyzing' || status === 'pending') {
    return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
  }
  if (status === 'error') {
    return <AlertTriangle className="h-3 w-3 text-red-500" aria-hidden />;
  }
  if (status === 'unsupported') {
    return <FileWarning className="h-3 w-3 text-amber-500" aria-hidden />;
  }
  return <Check className="h-3 w-3 text-emerald-500" aria-hidden />;
}

function FileView({
  file,
  whitelist,
  onToggle,
  onSetDecision,
  onAddToWhitelist,
}: {
  file: FileReview;
  whitelist: string[];
  onToggle: (hit: ReviewHit) => void;
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
}): JSX.Element {
  if (file.status === 'unsupported') {
    return (
      <Notice
        tone="amber"
        icon={<FileWarning className="h-4 w-4" aria-hidden />}
        title="Bestandstype nog niet ondersteund"
        body={`${file.name} (${file.extension}) kunnen we niet automatisch verwerken. Verwijder het bestand in stap 1 of negeer deze waarschuwing — het wordt dan overgeslagen bij het opslaan.`}
      />
    );
  }
  if (file.status === 'loading' || file.status === 'analyzing' || file.status === 'pending') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>
          {file.status === 'loading' && 'Bestand inlezen…'}
          {file.status === 'analyzing' && 'Analyseren via lokale engine…'}
          {file.status === 'pending' && 'In de wachtrij…'}
        </span>
      </div>
    );
  }
  if (file.status === 'error') {
    return (
      <Notice
        tone="red"
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        title={`Kon ${file.name} niet verwerken`}
        body={file.error ?? 'Onbekende fout.'}
      />
    );
  }
  const hits = file.hits ?? [];
  if (!file.text) return <></>;

  const acceptedCount = hits.filter(
    (h) => effectiveDecision(h, file, whitelist) === 'accept'
  ).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatBytes(new Blob([file.text]).size)} tekst</span>
          <span>
            <strong className="text-foreground">{acceptedCount}</strong> van{' '}
            {hits.length} hit{hits.length === 1 ? '' : 's'} wordt straks vervangen
          </span>
        </div>
        <TextViewer
          text={file.text}
          hits={hits}
          file={file}
          whitelist={whitelist}
          onToggle={onToggle}
        />
      </div>
      <HitsPanel
        hits={hits}
        file={file}
        whitelist={whitelist}
        onSetDecision={onSetDecision}
        onAddToWhitelist={onAddToWhitelist}
      />
    </div>
  );
}

function TextViewer({
  text,
  hits,
  file,
  whitelist,
  onToggle,
}: {
  text: string;
  hits: ReviewHit[];
  file: FileReview;
  whitelist: string[];
  onToggle: (hit: ReviewHit) => void;
}): JSX.Element {
  // Knip de tekst in stukjes plain + hit. Hits zijn al gesorteerd op start.
  const parts: Array<{ key: string; content: JSX.Element | string }> = [];
  let cursor = 0;
  hits.forEach((hit, idx) => {
    if (hit.start < cursor) return; // overlappend; veilig negeren
    if (hit.start > cursor) {
      parts.push({ key: `t-${idx}`, content: text.slice(cursor, hit.start) });
    }
    const decision = effectiveDecision(hit, file, whitelist);
    parts.push({
      key: `h-${idx}`,
      content: (
        <HitMark
          hit={hit}
          decision={decision}
          onClick={() => onToggle(hit)}
          text={text.slice(hit.start, hit.end)}
        />
      ),
    });
    cursor = hit.end;
  });
  if (cursor < text.length) {
    parts.push({ key: 'tail', content: text.slice(cursor) });
  }

  return (
    <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/70 bg-background p-4 text-sm leading-relaxed">
      <pre className="whitespace-pre-wrap break-words font-sans">
        {parts.map((p) => (
          <span key={p.key}>{p.content}</span>
        ))}
      </pre>
    </div>
  );
}

function HitMark({
  hit,
  decision,
  text,
  onClick,
}: {
  hit: ReviewHit;
  decision: HitDecision;
  text: string;
  onClick: () => void;
}): JSX.Element {
  const style = styleForEntity(hit.entity_type);
  const accepted = decision === 'accept';
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${style.label} · score ${hit.score.toFixed(2)} · klik om ${accepted ? 'over te slaan' : 'te accepteren'}`}
      className={cn(
        'rounded px-0.5 py-[1px] transition-colors',
        accepted ? style.highlight : 'bg-transparent text-muted-foreground line-through decoration-dotted'
      )}
    >
      {text}
    </button>
  );
}

function HitsPanel({
  hits,
  file,
  whitelist,
  onSetDecision,
  onAddToWhitelist,
}: {
  hits: ReviewHit[];
  file: FileReview;
  whitelist: string[];
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
}): JSX.Element {
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, { label: string; total: number; accepted: number }>();
    for (const hit of hits) {
      const style = styleForEntity(hit.entity_type);
      const prev = counts.get(style.categoryId) ?? {
        label: style.label,
        total: 0,
        accepted: 0,
      };
      prev.total += 1;
      if (effectiveDecision(hit, file, whitelist) === 'accept') prev.accepted += 1;
      counts.set(style.categoryId, prev);
    }
    return Array.from(counts.values());
  }, [hits, file, whitelist]);

  if (hits.length === 0) {
    return (
      <aside className="rounded-xl border border-border/70 bg-muted/30 p-4 text-xs text-muted-foreground">
        Geen PII gevonden in dit bestand met de huidige instellingen.
        Ga terug naar stap 2 om andere categorieën aan te zetten als je
        denkt dat er wel iets mist.
      </aside>
    );
  }

  return (
    <aside className="flex max-h-[60vh] flex-col gap-3 overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="text-xs font-medium text-foreground">Per categorie</div>
        <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          {categoryCounts.map((c) => (
            <li key={c.label} className="flex items-center justify-between">
              <span>{c.label}</span>
              <span className="tabular-nums">
                {c.accepted}/{c.total}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex-1 overflow-auto">
        {hits.map((hit) => (
          <HitRow
            key={hit.id}
            hit={hit}
            file={file}
            whitelist={whitelist}
            onSetDecision={onSetDecision}
            onAddToWhitelist={onAddToWhitelist}
          />
        ))}
      </ul>
    </aside>
  );
}

function HitRow({
  hit,
  file,
  whitelist,
  onSetDecision,
  onAddToWhitelist,
}: {
  hit: ReviewHit;
  file: FileReview;
  whitelist: string[];
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
}): JSX.Element {
  const style = styleForEntity(hit.entity_type);
  const decision = effectiveDecision(hit, file, whitelist);
  const isWhitelisted = whitelist.includes(hit.original.toLowerCase());

  return (
    <li className="border-t border-border/50 px-3 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
            style.pill
          )}
        >
          {style.label}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {(hit.score * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-1 truncate text-sm text-foreground" title={hit.original}>
        {hit.original}
      </p>
      {isWhitelisted && (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Staat op de whitelist — altijd overslaan.
        </p>
      )}
      <div className="mt-2 flex items-center gap-1">
        <DecisionButton
          active={decision === 'accept'}
          onClick={() => onSetDecision(hit, 'accept')}
          icon={<Shield className="h-3 w-3" aria-hidden />}
          label="Vervangen"
          tone="primary"
          disabled={isWhitelisted}
        />
        <DecisionButton
          active={decision === 'skip'}
          onClick={() => onSetDecision(hit, 'skip')}
          icon={<ShieldOff className="h-3 w-3" aria-hidden />}
          label="Overslaan"
          tone="muted"
        />
        {!isWhitelisted && (
          <button
            type="button"
            onClick={() => onAddToWhitelist(hit.original)}
            title="Voeg de exacte tekst toe aan de whitelist zodat hij ook in andere bestanden niet vervangen wordt"
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Ban className="h-3 w-3" aria-hidden />
            Whitelist
          </button>
        )}
      </div>
    </li>
  );
}

function DecisionButton({
  active,
  onClick,
  icon,
  label,
  tone,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  label: string;
  tone: 'primary' | 'muted';
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? tone === 'primary'
            ? 'border-primary/50 bg-primary/10 text-primary'
            : 'border-border/80 bg-muted text-foreground'
          : 'border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function WhitelistPanel({
  whitelist,
  onAdd,
  onRemove,
}: {
  whitelist: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const submit = (): void => {
    onAdd(value);
    setValue('');
  };
  return (
    <section className="rounded-xl border border-border/70 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-medium text-foreground">Whitelist</h3>
        <span className="text-xs text-muted-foreground">
          ({whitelist.length} {whitelist.length === 1 ? 'term' : 'termen'})
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Woorden of zinnen die Anonimiseer <em>nooit</em> mag vervangen — ook
        niet in andere bestanden. Denk aan de naam van je organisatie of
        een functietitel die ten onrechte als persoonsnaam werd gezien.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="Typ een exacte term en druk Enter"
          className="h-8 flex-1 rounded-md border border-border/60 bg-background px-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          Toevoegen
        </button>
      </div>
      {whitelist.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {whitelist.map((w) => (
            <li key={w}>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] text-foreground">
                {w}
                <button
                  type="button"
                  onClick={() => onRemove(w)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Verwijder ${w} van whitelist`}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Notice({
  tone,
  icon,
  title,
  body,
}: {
  tone: 'red' | 'amber';
  icon: JSX.Element;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border p-4 text-sm',
        tone === 'red'
          ? 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-100'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100'
      )}
    >
      <span className="mt-0.5 flex-none">{icon}</span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm opacity-90">{body}</p>
      </div>
    </div>
  );
}

/**
 * Kies het effectieve besluit voor een hit: whitelist > expliciete decision
 * > default 'accept'. Whitelist checkt op exact gelijke (lowercased) original.
 */
export function effectiveDecision(
  hit: AnalyzeHit,
  file: FileReview,
  whitelist: string[]
): HitDecision {
  if (whitelist.includes(hit.original.toLowerCase())) return 'skip';
  return file.decisions[hitId(hit)] ?? 'accept';
}


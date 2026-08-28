import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
  ChevronDown,
  Hand,
  Trash2,
  X,
} from 'lucide-react';
import type { AnalyzeHit } from '@shared/api';
import { cn } from '../../lib/utils';
import { statusIcon, statusNotice, type StatusTone } from '../../lib/statusStyles';
import { FileIcon } from './FileIcon';
import { styleForEntity } from './entityPalette';
import {
  hitId,
  isManualHitId,
  manualHitId,
  type FileReview,
  type HitDecision,
  type ReviewState,
  type ReviewHit,
} from './reviewTypes';
import {
  ENTITY_CATEGORIES,
  resolveEntities,
  resolveThreshold,
  type EntityCategory,
  type WizardSettings,
} from './settingsTypes';
import { formatBytes } from './validation';
import { type WizardFileEntry } from './wizardTypes';

/** Quick-knop default: meest voorkomende manual addition is "een naam
 *  die de detector miste". Vervangen door PERSON-pseudoniem in stap 4. */
const QUICK_CATEGORY_ID = 'personen';

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
          // houden daardoor hun accept/skip. Handmatig toegevoegde hits
          // bewaren we expliciet — die zijn niet van de engine afkomstig
          // en horen niet verloren te gaan bij een threshold-wijziging.
          const keptManual = existing.hits?.filter((h) => isManualHitId(h.id));
          nextFiles[f.info.path] = {
            ...existing,
            status: 'pending',
            hits: keptManual && keptManual.length > 0 ? keptManual : undefined,
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

      const apiHits: ReviewHit[] = analysis.items
        .slice()
        .sort((a, b) => a.start - b.start || a.end - b.end)
        .map((h) => ({ ...h, id: hitId(h) }));

      // Belangrijk: manual hits worden NIET door de engine gegenereerd
      // dus we moeten ze hier overleven aan de re-analyse. We mergen ze
      // erin op basis van wat er bij de vorige snapshot al stond.
      onStateChange((prev) => {
        const existing = prev.files[path];
        if (!existing || existing.status === 'unsupported') return prev;
        const manualHits =
          existing.hits?.filter((h) => isManualHitId(h.id)) ?? [];
        // Skip manual hits die volledig overlappen met een nieuwe API-hit:
        // de detector heeft 'm nu zelf gevonden, dus dubbele markering is
        // verwarrend. Voor partial-overlap blijven we 't manuele
        // behouden — de gebruiker had er expliciet voor gekozen.
        const filteredManual = manualHits.filter(
          (m) => !apiHits.some((a) => a.start === m.start && a.end === m.end)
        );
        const merged = [...apiHits, ...filteredManual].sort(
          (a, b) => a.start - b.start || a.end - b.end
        );
        return {
          ...prev,
          files: {
            ...prev.files,
            [path]: {
              ...existing,
              status: 'done',
              hits: merged,
              analyzedWith: currentKey,
              error: undefined,
            },
          },
        };
      });
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
    // Voor handmatig toegevoegde markeringen heeft "accept/skip toggelen"
    // geen betekenis (je hebt 'm bewust zelf toegevoegd). Klikken op de
    // markering in de tekst verwijdert 'm dus i.p.v. te togglen.
    if (isManualHitId(hit.id)) {
      removeManualHit(path, hit.id);
      return;
    }
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

  /**
   * Voeg een handmatig gemarkeerde span toe aan het actieve bestand.
   * Skipt selecties die exact samenvallen met een bestaande hit (geen
   * duplicaten), maar staat partial-overlap wel toe omdat de gebruiker
   * dan bewust kiest om iets specifieker te markeren.
   */
  const addManualHit = (
    path: string,
    span: { start: number; end: number; text: string },
    category: EntityCategory
  ): void => {
    onStateChange((prev) => {
      const file = prev.files[path];
      if (!file || !file.text) return prev;
      if (span.start < 0 || span.end > file.text.length || span.start >= span.end) {
        return prev;
      }
      const existing = file.hits ?? [];
      // Exact duplicate? Skip, maar laat ‘m wel als 'accept' staan zodat
      // er geen verrassing is.
      const duplicate = existing.find(
        (h) => h.start === span.start && h.end === span.end
      );
      if (duplicate) {
        return {
          ...prev,
          files: {
            ...prev.files,
            [path]: {
              ...file,
              decisions: { ...file.decisions, [duplicate.id]: 'accept' },
            },
          },
        };
      }
      const entityType = category.entityTypes[0] ?? 'PERSON';
      const hit: ReviewHit = {
        entity_type: entityType,
        start: span.start,
        end: span.end,
        score: 1,
        original: span.text,
        id: manualHitId({ entity_type: entityType, start: span.start, end: span.end }),
      };
      const merged = [...existing, hit].sort(
        (a, b) => a.start - b.start || a.end - b.end
      );
      return {
        ...prev,
        files: {
          ...prev.files,
          [path]: {
            ...file,
            hits: merged,
            decisions: { ...file.decisions, [hit.id]: 'accept' },
          },
        },
      };
    });
  };

  const removeManualHit = (path: string, id: string): void => {
    if (!isManualHitId(id)) return;
    onStateChange((prev) => {
      const file = prev.files[path];
      if (!file) return prev;
      const nextHits = (file.hits ?? []).filter((h) => h.id !== id);
      const nextDecisions = { ...file.decisions };
      delete nextDecisions[id];
      return {
        ...prev,
        files: {
          ...prev.files,
          [path]: { ...file, hits: nextHits, decisions: nextDecisions },
        },
      };
    });
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
          onAddManualHit={(span, category) =>
            addManualHit(activeFile.path, span, category)
          }
          onRemoveManualHit={(id) => removeManualHit(activeFile.path, id)}
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
            om hem over te slaan, of zet een woord op de whitelist om
            hem ook in andere bestanden te negeren. De detector mist
            soms iets of markeert ten onrechte — jij beslist zelf wat
            vervangen wordt.
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
    return <AlertTriangle className={cn('h-3 w-3', statusIcon('destructive'))} aria-hidden />;
  }
  if (status === 'unsupported') {
    return <FileWarning className={cn('h-3 w-3', statusIcon('warning'))} aria-hidden />;
  }
  return <Check className={cn('h-3 w-3', statusIcon('success'))} aria-hidden />;
}

function FileView({
  file,
  whitelist,
  onToggle,
  onSetDecision,
  onAddToWhitelist,
  onAddManualHit,
  onRemoveManualHit,
}: {
  file: FileReview;
  whitelist: string[];
  onToggle: (hit: ReviewHit) => void;
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
  onAddManualHit: (
    span: { start: number; end: number; text: string },
    category: EntityCategory
  ) => void;
  onRemoveManualHit: (id: string) => void;
}): JSX.Element {
  if (file.status === 'unsupported') {
    return (
      <Notice
        tone="warning"
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
        tone="destructive"
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
    // Op lg+ geven we de hele row een vaste hoogte, zodat beide kolommen
    // exact even hoog zijn en elk hun eigen interne scrollbar krijgen.
    // Onder lg stacken de twee onder elkaar en gelden hun eigen max-h's.
    <div className="grid gap-4 lg:h-[65vh] lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex flex-none items-center justify-between text-xs text-muted-foreground">
          <span>{formatBytes(new Blob([file.text]).size)} tekst</span>
          <span>
            <strong className="text-foreground">{acceptedCount}</strong> van{' '}
            {hits.length} hit{hits.length === 1 ? '' : 's'} wordt straks vervangen
          </span>
        </div>
        <p className="flex-none text-[11px] text-muted-foreground">
          <Hand className="mr-1 inline h-3 w-3" aria-hidden />
          Mist de detector iets? <strong className="font-medium text-foreground">Selecteer de tekst</strong> hieronder
          en markeer hem handmatig. Klik op een handmatige markering om
          deze weer te verwijderen.
        </p>
        <TextViewer
          text={file.text}
          hits={hits}
          file={file}
          whitelist={whitelist}
          onToggle={onToggle}
          onAddManualHit={onAddManualHit}
        />
      </div>
      <HitsPanel
        hits={hits}
        file={file}
        whitelist={whitelist}
        onSetDecision={onSetDecision}
        onAddToWhitelist={onAddToWhitelist}
        onRemoveManualHit={onRemoveManualHit}
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
  onAddManualHit,
}: {
  text: string;
  hits: ReviewHit[];
  file: FileReview;
  whitelist: string[];
  onToggle: (hit: ReviewHit) => void;
  onAddManualHit: (
    span: { start: number; end: number; text: string },
    category: EntityCategory
  ) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    start: number;
    end: number;
    text: string;
    // Positie t.o.v. de container, zodat de popover meeschaalt met scroll.
    x: number;
    // y = bovenkant selectie; yBottom = onderkant. Op basis van welke
    // ruimte er over is binnen de viewer plaatsen we de popover boven of
    // onder de selectie.
    y: number;
    yBottom: number;
  } | null>(null);

  // Knip de tekst in stukjes plain + hit. Hits zijn al gesorteerd op start.
  // Per span zetten we ``data-offset`` zodat we bij een selectie de
  // globale tekst-offset kunnen achterhalen, ook al loopt de selectie
  // door meerdere DOM-spans heen.
  const parts: Array<{ key: string; offset: number; content: JSX.Element | string }> = [];
  let cursor = 0;
  hits.forEach((hit, idx) => {
    if (hit.start < cursor) return;
    if (hit.start > cursor) {
      parts.push({
        key: `t-${idx}`,
        offset: cursor,
        content: text.slice(cursor, hit.start),
      });
    }
    const decision = effectiveDecision(hit, file, whitelist);
    parts.push({
      key: `h-${idx}`,
      offset: hit.start,
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
    parts.push({ key: 'tail', offset: cursor, content: text.slice(cursor) });
  }

  const handleMouseUp = (): void => {
    // Geef de browser even tijd om de selectie te finaliseren (Safari
    // is hier traag mee). 1 rAF is doorgaans voldoende.
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPendingSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container = preRef.current;
      if (!container) return;
      if (
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer)
      ) {
        setPendingSelection(null);
        return;
      }
      const startOffset = nodeToGlobalOffset(container, range.startContainer, range.startOffset);
      const endOffset = nodeToGlobalOffset(container, range.endContainer, range.endOffset);
      if (startOffset == null || endOffset == null) {
        setPendingSelection(null);
        return;
      }
      const [s, e] =
        startOffset <= endOffset ? [startOffset, endOffset] : [endOffset, startOffset];
      if (s >= e) {
        setPendingSelection(null);
        return;
      }
      const selected = text.slice(s, e);
      // Negeer puur whitespace-selecties; krimp tot zinvolle tekst.
      const leading = selected.match(/^\s*/)?.[0].length ?? 0;
      const trailing = selected.match(/\s*$/)?.[0].length ?? 0;
      const trimmedStart = s + leading;
      const trimmedEnd = e - trailing;
      if (trimmedStart >= trimmedEnd) {
        setPendingSelection(null);
        return;
      }
      // Positie van de selectie t.o.v. de scroll-container.
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) {
        setPendingSelection(null);
        return;
      }
      const scrollTop = containerRef.current?.scrollTop ?? 0;
      const scrollLeft = containerRef.current?.scrollLeft ?? 0;
      setPendingSelection({
        start: trimmedStart,
        end: trimmedEnd,
        text: text.slice(trimmedStart, trimmedEnd),
        x: rect.left - containerRect.left + scrollLeft + rect.width / 2,
        y: rect.top - containerRect.top + scrollTop,
        yBottom: rect.bottom - containerRect.top + scrollTop,
      });
    });
  };

  const dismiss = (): void => {
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const confirmManual = (category: EntityCategory): void => {
    if (!pendingSelection) return;
    onAddManualHit(
      {
        start: pendingSelection.start,
        end: pendingSelection.end,
        text: pendingSelection.text,
      },
      category
    );
    dismiss();
  };

  // Sluit popover bij Escape of klik buiten de container.
  useEffect(() => {
    if (!pendingSelection) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss();
    };
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node;
      // Klikken in de container (waar de popover bovenop ligt) laten we
      // de eigen handlers van de popover afhandelen.
      if (containerRef.current && containerRef.current.contains(target)) return;
      dismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pendingSelection]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative overflow-auto rounded-xl border border-border/70 bg-background p-4 text-sm leading-relaxed',
        // Onder lg een vaste max-hoogte zodat 't venster niet eindeloos
        // groeit; op lg+ wordt 'ie flex-1 binnen de kolom (zie FileView).
        'max-h-[60vh] lg:max-h-none lg:min-h-0 lg:flex-1'
      )}
      onMouseUp={handleMouseUp}
    >
      <pre ref={preRef} className="whitespace-pre-wrap break-words font-sans">
        {parts.map((p) =>
          typeof p.content === 'string' ? (
            <span key={p.key} data-offset={p.offset}>
              {p.content}
            </span>
          ) : (
            <span key={p.key} data-offset={p.offset}>
              {p.content}
            </span>
          )
        )}
      </pre>
      {pendingSelection && (
        <ManualSelectionPopover
          selection={pendingSelection}
          containerRef={containerRef}
          onConfirm={confirmManual}
          onCancel={dismiss}
        />
      )}
    </div>
  );
}

/**
 * Bereken de globale offset in ``file.text`` op basis van een DOM-node
 * en lokale offset. Klimt omhoog tot een span met ``data-offset``
 * gevonden is en accumuleert de tekstlengte van eerdere siblings binnen
 * die span. Voor onze parts (waarin spans alleen plain text bevatten,
 * of een button met text-content) werkt dit betrouwbaar.
 */
function nodeToGlobalOffset(
  container: Element,
  node: Node,
  offset: number
): number | null {
  // Zoek de dichtstbijzijnde ancestor met data-offset.
  let cursor: Node | null = node;
  let withinOffset = 0;
  // Als de node een text-node is: tel `offset` mee als beginpunt.
  if (node.nodeType === Node.TEXT_NODE) {
    withinOffset = offset;
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // Bij een element-node duidt offset op het aantal childNodes voor de
    // cursor. Tel daarvan de tekstlengtes op.
    const el = node as Element;
    for (let i = 0; i < offset && i < el.childNodes.length; i += 1) {
      withinOffset += textLengthOf(el.childNodes[i]);
    }
  } else {
    return null;
  }
  // Klim omhoog en accumuleer tekstlengte van voorafgaande siblings.
  while (cursor && cursor !== container) {
    const parent: Node | null = cursor.parentNode;
    if (!parent) return null;
    if (
      cursor.nodeType === Node.ELEMENT_NODE &&
      (cursor as HTMLElement).dataset?.offset !== undefined
    ) {
      const base = Number.parseInt((cursor as HTMLElement).dataset.offset!, 10);
      if (!Number.isFinite(base)) return null;
      return base + withinOffset;
    }
    let sib: Node | null = cursor.previousSibling;
    while (sib) {
      withinOffset += textLengthOf(sib);
      sib = sib.previousSibling;
    }
    cursor = parent;
  }
  return null;
}

function textLengthOf(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node as Text).data.length;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as HTMLElement).textContent?.length ?? 0;
  }
  return 0;
}

function ManualSelectionPopover({
  selection,
  containerRef,
  onConfirm,
  onCancel,
}: {
  selection: { start: number; end: number; text: string; x: number; y: number; yBottom: number };
  containerRef: React.RefObject<HTMLDivElement>;
  onConfirm: (category: EntityCategory) => void;
  onCancel: () => void;
}): JSX.Element {
  const [showMenu, setShowMenu] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);
  // Bereken klemmig + placement (boven/onder selectie) op basis van
  // beschikbare ruimte in de scroll-container.
  const [layout, setLayout] = useState<{
    x: number;
    top: number;
    placement: 'above' | 'below';
  }>({ x: selection.x, top: selection.y - 6, placement: 'above' });
  useLayoutEffect(() => {
    const container = containerRef.current;
    const pop = popRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scrollTop = container.scrollTop;
    const ph = pop?.offsetHeight ?? 44;
    const pw = pop?.offsetWidth ?? 220;
    // Horizontaal klemmen.
    const minX = pw / 2 + 8;
    const maxX = Math.max(minX, cw - pw / 2 - 8);
    const x = Math.max(minX, Math.min(maxX, selection.x));
    // Verticale placement: bovenop selectie tenzij er onvoldoende ruimte
    // boven is binnen het zichtbare deel van de container.
    const spaceAbove = selection.y - scrollTop;
    const spaceBelow = scrollTop + ch - selection.yBottom;
    const placement: 'above' | 'below' =
      spaceAbove >= ph + 8 || spaceAbove >= spaceBelow ? 'above' : 'below';
    const top = placement === 'above' ? selection.y - 6 : selection.yBottom + 6;
    setLayout({ x, top, placement });
  }, [selection.x, selection.y, selection.yBottom, containerRef, showMenu]);

  // Sluit menu bij klik buiten.
  useEffect(() => {
    if (!showMenu) return;
    const onDown = (e: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showMenu]);

  const quickCategory =
    ENTITY_CATEGORIES.find((c) => c.id === QUICK_CATEGORY_ID) ?? ENTITY_CATEGORIES[0];
  const preview =
    selection.text.length > 40 ? `${selection.text.slice(0, 40)}…` : selection.text;

  const above = layout.placement === 'above';

  return (
    <div
      ref={popRef}
      className={cn(
        'absolute z-30 -translate-x-1/2',
        above ? '-translate-y-full' : ''
      )}
      style={{ left: layout.x, top: layout.top }}
      onMouseDown={(e) => {
        // Voorkom dat een mousedown binnen de popover de selectie wist.
        e.preventDefault();
      }}
    >
      {/* Pijltje bovenaan als de popover onder de selectie staat. */}
      {!above && (
        <div
          aria-hidden
          className="mx-auto h-0 w-0 border-x-4 border-b-4 border-x-transparent border-b-border"
        />
      )}
      <div className="rounded-lg border border-border bg-card shadow-lg">
        <div className="flex items-center divide-x divide-border/60">
          <button
            type="button"
            onClick={() => onConfirm(quickCategory)}
            title={`Markeer "${preview}" als ${quickCategory.label.toLowerCase()}. Pijltje voor een andere categorie.`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Hand className="h-3.5 w-3.5 text-primary" aria-hidden />
            Markeer handmatig
          </button>
          <button
            type="button"
            onClick={() => setShowMenu((v) => !v)}
            title="Kies een specifieke categorie (e-mail, adres, organisatie, …)"
            className="inline-flex items-center px-1.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onCancel}
            title="Annuleer"
            className="inline-flex items-center px-1.5 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Annuleer"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
        {showMenu && (
          <ul
            role="menu"
            className="max-h-72 overflow-auto border-t border-border/60 py-1 text-xs"
          >
            {ENTITY_CATEGORIES.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onConfirm(cat)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-foreground hover:bg-muted"
                >
                  <span
                    className={cn(
                      'inline-flex h-2 w-2 flex-none rounded-full',
                      styleForEntity(cat.entityTypes[0] ?? 'PERSON').strong
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{cat.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Pijltje onderaan als de popover boven de selectie staat. */}
      {above && (
        <div
          aria-hidden
          className="mx-auto h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-border"
        />
      )}
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
  const isManual = isManualHitId(hit.id);
  const title = isManual
    ? `${style.label} · handmatig toegevoegd · klik om te verwijderen`
    : `${style.label} · score ${hit.score.toFixed(2)} · klik om ${accepted ? 'over te slaan' : 'te accepteren'}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded px-0.5 py-[1px] transition-colors',
        accepted
          ? cn(
              style.highlight,
              // Subtiel onderscheid voor handmatige markeringen: gestippelde
              // onderlijn zodat je in één oogopslag ziet dat 't door jou is.
              isManual && 'underline decoration-dotted underline-offset-2'
            )
          : 'bg-transparent text-muted-foreground line-through decoration-dotted'
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
  onRemoveManualHit,
}: {
  hits: ReviewHit[];
  file: FileReview;
  whitelist: string[];
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
  onRemoveManualHit: (id: string) => void;
}): JSX.Element {
  // Categorie waarop nu gefilterd wordt (null = alles tonen). Reset
  // wanneer de gebruiker naar een ander bestand wisselt.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  useEffect(() => {
    setActiveCategory(null);
  }, [file.path]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<
      string,
      { id: string; label: string; entityType: string; total: number; accepted: number }
    >();
    for (const hit of hits) {
      const style = styleForEntity(hit.entity_type);
      const prev = counts.get(style.categoryId) ?? {
        id: style.categoryId,
        label: style.label,
        entityType: hit.entity_type,
        total: 0,
        accepted: 0,
      };
      prev.total += 1;
      if (effectiveDecision(hit, file, whitelist) === 'accept') prev.accepted += 1;
      counts.set(style.categoryId, prev);
    }
    return Array.from(counts.values()).sort((a, b) => b.total - a.total);
  }, [hits, file, whitelist]);

  const totalAccepted = useMemo(
    () =>
      hits.filter((h) => effectiveDecision(h, file, whitelist) === 'accept').length,
    [hits, file, whitelist]
  );

  const displayedHits = useMemo(() => {
    if (!activeCategory) return hits;
    return hits.filter((h) => styleForEntity(h.entity_type).categoryId === activeCategory);
  }, [hits, activeCategory]);

  if (hits.length === 0) {
    return (
      <aside className="rounded-xl border border-border/70 bg-muted/30 p-4 text-xs text-muted-foreground">
        Geen PII gevonden in dit bestand met de huidige instellingen.
        Ga terug naar stap 2 om andere categorieën aan te zetten als je
        denkt dat er wel iets mist.
      </aside>
    );
  }

  const activeLabel = activeCategory
    ? (categoryCounts.find((c) => c.id === activeCategory)?.label ?? activeCategory)
    : null;

  return (
    <aside
      className={cn(
        'flex flex-col gap-0 overflow-hidden rounded-xl border border-border/70 bg-card',
        // Onder lg: aside is een eigen stack onder de tekstviewer met
        // eigen max-hoogte. Op lg+ wordt 'ie naast de tekstviewer
        // gerenderd en lijnen we hem netjes uit (zelfde hoogte als de
        // tekstviewer-kolom) door de grid-cell helemaal te vullen.
        'max-h-[60vh] lg:h-full lg:max-h-none'
      )}
    >
      {/* Sectie 1: filter per categorie. Klikbaar; actieve categorie
          krijgt een primary-achtige highlight zodat duidelijk is dat hij
          aan staat. Beperkt in hoogte met eigen scrollbar zodat de
          hits-lijst eronder altijd zichtbaar blijft op kleine vensters. */}
      <div className="flex flex-none flex-col border-b border-border/60 bg-muted/30">
        <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Filter per categorie
          </div>
          {activeCategory && (
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-2.5 w-2.5" aria-hidden />
              Filter wissen
            </button>
          )}
        </div>
        <ul className="max-h-44 space-y-0.5 overflow-y-auto px-3 pb-2.5">
          <li>
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] transition-colors',
                activeCategory === null
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
              aria-pressed={activeCategory === null}
            >
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 flex-none rounded-full bg-foreground/40" aria-hidden />
                Alle categorieën
              </span>
              <span className="tabular-nums">
                {totalAccepted}/{hits.length}
              </span>
            </button>
          </li>
          {categoryCounts.map((c) => {
            const isActive = activeCategory === c.id;
            const style = styleForEntity(c.entityType);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveCategory(isActive ? null : c.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] transition-colors',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                  aria-pressed={isActive}
                  title={
                    isActive
                      ? 'Filter uit (toon alle categorieën)'
                      : `Toon alleen ${c.label.toLowerCase()}`
                  }
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn('h-2 w-2 flex-none rounded-full', style.strong)}
                      aria-hidden
                    />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className="tabular-nums">
                    {c.accepted}/{c.total}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Sectie 2: de eigenlijke hits-lijst, optioneel gefilterd. */}
      <div className="flex flex-none items-center justify-between border-b border-border/40 px-3 py-1.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {activeCategory ? `Markeringen — ${activeLabel}` : 'Alle markeringen'}
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {displayedHits.length}
        </span>
      </div>
      {/* min-h-0 is cruciaal binnen een flex-col met overflow-auto, anders
          krijgt de ul de "intrinsic" hoogte van z'n inhoud en duwt 'm de
          categorie-sectie weg in plaats van zelf te scrollen. */}
      <ul className="min-h-0 flex-1 overflow-auto">
        {displayedHits.map((hit) => (
          <HitRow
            key={hit.id}
            hit={hit}
            file={file}
            whitelist={whitelist}
            onSetDecision={onSetDecision}
            onAddToWhitelist={onAddToWhitelist}
            onRemoveManualHit={onRemoveManualHit}
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
  onRemoveManualHit,
}: {
  hit: ReviewHit;
  file: FileReview;
  whitelist: string[];
  onSetDecision: (hit: ReviewHit, decision: HitDecision) => void;
  onAddToWhitelist: (value: string) => void;
  onRemoveManualHit: (id: string) => void;
}): JSX.Element {
  const style = styleForEntity(hit.entity_type);
  const decision = effectiveDecision(hit, file, whitelist);
  const isWhitelisted = whitelist.includes(hit.original.toLowerCase());
  const isManual = isManualHitId(hit.id);

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
        {isManual && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            title="Door jou handmatig toegevoegd"
          >
            <Hand className="h-2.5 w-2.5" aria-hidden />
            Handmatig
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {isManual ? '—' : `${(hit.score * 100).toFixed(0)}%`}
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
        {isManual ? (
          <button
            type="button"
            onClick={() => onRemoveManualHit(hit.id)}
            title="Verwijder deze handmatig toegevoegde markering"
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Verwijder
          </button>
        ) : (
          !isWhitelisted && (
            <button
              type="button"
              onClick={() => onAddToWhitelist(hit.original)}
              title="Voeg de exacte tekst toe aan de whitelist zodat hij ook in andere bestanden niet vervangen wordt"
              className="ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border/60 px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Ban className="h-3 w-3" aria-hidden />
              Whitelist
            </button>
          )
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
  tone: Extract<StatusTone, 'destructive' | 'warning'>;
  icon: JSX.Element;
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className={statusNotice(tone, 'p-4')}>
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


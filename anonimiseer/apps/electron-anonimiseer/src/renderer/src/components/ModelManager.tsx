import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Cpu,
  Download,
  ExternalLink,
  GraduationCap,
  HardDrive,
  Info,
  Loader2,
  Package,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  ActiveEngineInfo,
  EngineConfigPatch,
  ModelInfo,
  ModelTask,
  OllamaCatalogEntry,
  OllamaPresence,
  SystemInfo,
} from '@shared/api';
import { ollamaInstalled } from './ollamaCatalog';
import { cn } from '../lib/utils';

interface ModelManagerProps {
  open: boolean;
  onClose: () => void;
}

interface RowState {
  task?: ModelTask;
  busy: boolean;
  error?: string;
}

type FitLevel = 'fits' | 'tight' | 'too-large' | 'unknown';

interface FitVerdict {
  level: FitLevel;
  message: string;
}

interface PipelineAction {
  label: string;
  icon: 'power' | 'power-off';
  /** 'toggle' = echte aan/uit (SoNaR); 'select' = kies-deze (spaCy-pipeline). */
  variant: 'toggle' | 'select';
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

/**
 * Geef een advies of een model met de gevraagde minRamMb past op
 * de huidige machine. Marges:
 *  - past comfortabel als (totaal - 2GB OS-overhead) >= 1.5x minRamMb
 *  - krap als (totaal - 2GB) >= minRamMb
 *  - te zwaar daarbuiten
 */
/**
 * Embedding-modellen (bge, nomic-embed, mxbai-embed, …) ondersteunen
 * geen ``/api/generate``. Ollama wijst zo'n call af met HTTP 400.
 * We filteren ze daarom uit voor "Activeer voor LLM-rollen". De lijst
 * is opzettelijk conservatief: bij twijfel laten we de gebruiker
 * gewoon proberen — Ollama zelf valideert daarna nog een keer.
 */
const _EMBEDDING_PATTERNS: RegExp[] = [
  /^bge[-_]/i,
  /^nomic-embed/i,
  /^mxbai-embed/i,
  /^snowflake-arctic-embed/i,
  /^all-minilm/i,
  /^paraphrase-/i,
  /^e5[-_]/i,
  /^embeddinggemma/i,
  /^granite-embedding/i,
  /-embed(?:ding)?(?::|$)/i,
];

function looksLikeEmbeddingModel(name: string): boolean {
  return _EMBEDDING_PATTERNS.some((re) => re.test(name));
}

/**
 * Sorteer een catalogus zodat modellen die op deze machine passen
 * bovenaan staan, daarna de krappe, dan te zware, dan onbekend. Binnen
 * elke groep: kleinste eerst (zo komt de "lichtgewicht aanbevolen"
 * keuze meteen bovenaan).
 */
function sortCatalogByFit(
  entries: OllamaCatalogEntry[],
  system: SystemInfo | null,
): OllamaCatalogEntry[] {
  const order: Record<FitLevel, number> = { fits: 0, tight: 1, 'too-large': 2, unknown: 3 };
  return [...entries].sort((a, b) => {
    const fa = evaluateFit(a.minRamMb, system).level;
    const fb = evaluateFit(b.minRamMb, system).level;
    if (order[fa] !== order[fb]) return order[fa] - order[fb];
    return a.sizeMb - b.sizeMb;
  });
}

/**
 * Kies een model dat we bovenaan willen aanraden voor deze machine:
 * het eerste model dat past (``fits``-level). Als de catalogus zelf
 * een ``recommended: true`` heeft staan en die past, krijgt die
 * voorrang. Geeft ``null`` als systeeminfo nog ontbreekt of niets
 * comfortabel past.
 */
function pickRecommendedForMachine(
  entries: OllamaCatalogEntry[],
  system: SystemInfo | null,
): OllamaCatalogEntry | null {
  if (!system) return null;
  const fitting = entries.filter(
    (e) => evaluateFit(e.minRamMb, system).level === 'fits',
  );
  if (fitting.length === 0) return null;
  const sweetSpot = fitting.find((e) => e.recommended);
  if (sweetSpot) return sweetSpot;
  return [...fitting].sort((a, b) => a.sizeMb - b.sizeMb)[0] ?? null;
}

function evaluateFit(minRamMb: number, system: SystemInfo | null): FitVerdict {
  if (minRamMb <= 0) return { level: 'unknown', message: 'Geen RAM-richtlijn opgegeven.' };
  if (!system) return { level: 'unknown', message: 'Systeeminfo wordt nog opgehaald.' };
  const usable = Math.max(system.totalMemMb - 2048, 0);
  if (usable >= minRamMb * 1.5) {
    return {
      level: 'fits',
      message: `Past comfortabel (${gb(system.totalMemMb)} GB beschikbaar, ${gb(minRamMb)} GB nodig).`,
    };
  }
  if (usable >= minRamMb) {
    return {
      level: 'tight',
      message: `Werkt waarschijnlijk, maar krap (${gb(system.totalMemMb)} GB totaal, ${gb(minRamMb)} GB nodig). Sluit andere apps.`,
    };
  }
  return {
    level: 'too-large',
    message: `Te zwaar voor deze machine (${gb(system.totalMemMb)} GB totaal, ${gb(minRamMb)} GB nodig).`,
  };
}

export function ModelManager({ open, onClose }: ModelManagerProps): JSX.Element | null {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [activeEngine, setActiveEngine] = useState<ActiveEngineInfo | null>(null);
  const [activeEngineError, setActiveEngineError] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [ollama, setOllama] = useState<{
    available: boolean | null;
    models: Array<{ name: string; size: number }>;
    error?: string;
  }>({ available: null, models: [] });
  const [ollamaPresence, setOllamaPresence] = useState<OllamaPresence | null>(null);
  const [catalogEntries, setCatalogEntries] = useState<OllamaCatalogEntry[]>([]);
  const [catalogMeta, setCatalogMeta] = useState<{
    version: string;
    source: 'cache' | 'bundled';
    updatedAt: number | null;
    remoteUrl: string | null;
  } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [ollamaSelection, setOllamaSelection] = useState<string>('');
  const [ollamaCustom, setOllamaCustom] = useState<string>('');
  const [showCustomOllama, setShowCustomOllama] = useState(false);
  const [ollamaPullBusy, setOllamaPullBusy] = useState(false);
  const [ollamaPullMessage, setOllamaPullMessage] = useState<string | null>(null);
  const [ollamaPanelOpen, setOllamaPanelOpen] = useState(false);
  const [ollamaActionBusy, setOllamaActionBusy] = useState<null | 'install' | 'start'>(null);
  const [ollamaRemovingName, setOllamaRemovingName] = useState<string | null>(null);

  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const reload = useCallback(async () => {
    setError(null);
    const res = await window.anonimiseer.models.list();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setModels(res.models);
  }, []);

  const reloadOllama = useCallback(async () => {
    const [presence, status] = await Promise.all([
      window.anonimiseer.models.ollama.detect(),
      window.anonimiseer.models.ollama.status(),
    ]);
    setOllamaPresence(presence);
    if (status.ok) {
      setOllama({ available: true, models: status.models });
    } else {
      setOllama({ available: false, models: [], error: status.error });
    }
  }, []);

  const installOllama = useCallback(async () => {
    setOllamaActionBusy('install');
    setOllamaPullMessage(null);
    const res = await window.anonimiseer.models.ollama.openInstaller();
    setOllamaActionBusy(null);
    if (!res.ok) {
      setOllamaPullMessage(`Kon installer-pagina niet openen: ${res.error}`);
    } else {
      setOllamaPullMessage(
        'Officiële downloadpagina geopend in je browser. Doorloop de installatie en kom hier terug — gebruik daarna "Vernieuwen".'
      );
    }
  }, []);

  const startOllama = useCallback(async () => {
    setOllamaActionBusy('start');
    setOllamaPullMessage(null);
    const res = await window.anonimiseer.models.ollama.start();
    setOllamaActionBusy(null);
    if (!res.ok) {
      setOllamaPullMessage(`Starten lukte niet: ${res.error}`);
    } else {
      setOllamaPullMessage('Ollama-daemon draait nu.');
      void reloadOllama();
    }
  }, [reloadOllama]);

  const removeOllamaModel = useCallback(
    async (name: string) => {
      const confirmed = window.confirm(
        `Weet je zeker dat je het Ollama-model "${name}" wilt verwijderen? Dit maakt schijfruimte vrij maar je moet hem opnieuw downloaden om hem weer te gebruiken.`
      );
      if (!confirmed) return;
      setOllamaRemovingName(name);
      setOllamaPullMessage(null);
      const res = await window.anonimiseer.models.ollama.remove(name);
      setOllamaRemovingName(null);
      if (!res.ok) {
        setOllamaPullMessage(`Verwijderen mislukte: ${res.error}`);
      } else {
        setOllamaPullMessage(`${name} verwijderd.`);
        void reloadOllama();
      }
    },
    [reloadOllama]
  );

  const applyCatalogResponse = useCallback(
    (
      res: Awaited<ReturnType<typeof window.anonimiseer.catalog.ollama.get>>,
      onError?: (msg: string) => void
    ) => {
      if (!res.ok) {
        setCatalogError(res.error);
        onError?.(res.error);
        return;
      }
      setCatalogError(null);
      setCatalogEntries(res.catalog.models);
      setCatalogMeta({
        version: res.catalog.version,
        source: res.source,
        updatedAt: res.updatedAt,
        remoteUrl: res.remoteUrl,
      });
      setOllamaSelection((current) => {
        if (current && res.catalog.models.some((m) => m.name === current)) return current;
        return res.catalog.models[0]?.name ?? '';
      });
    },
    []
  );

  const loadCatalog = useCallback(async () => {
    const res = await window.anonimiseer.catalog.ollama.get();
    applyCatalogResponse(res);
  }, [applyCatalogResponse]);

  const refreshCatalog = useCallback(async () => {
    setCatalogRefreshing(true);
    const res = await window.anonimiseer.catalog.ollama.refresh();
    setCatalogRefreshing(false);
    applyCatalogResponse(res);
  }, [applyCatalogResponse]);

  const reloadActive = useCallback(async () => {
    const res = await window.anonimiseer.engine.active();
    if (res.ok) {
      setActiveEngine(res.info);
      setActiveEngineError(null);
    } else {
      setActiveEngine(null);
      setActiveEngineError(res.error);
    }
  }, []);

  const applyPipeline = useCallback(
    async (patch: EngineConfigPatch, busyKey: string, successMsg: string) => {
      setPipelineBusy(busyKey);
      setPipelineMessage(null);
      const res = await window.anonimiseer.engine.setConfig(patch);
      setPipelineBusy(null);
      if (res.ok) {
        setActiveEngine(res.info);
        setActiveEngineError(null);
        setPipelineMessage({ kind: 'ok', text: successMsg });
      } else {
        setPipelineMessage({ kind: 'error', text: res.error });
      }
    },
    []
  );

  const resetPipeline = useCallback(async () => {
    setPipelineBusy('reset');
    setPipelineMessage(null);
    const res = await window.anonimiseer.engine.resetConfig();
    setPipelineBusy(null);
    if (res.ok) {
      setActiveEngine(res.info);
      setActiveEngineError(null);
      setPipelineMessage({
        kind: 'ok',
        text: 'Pipeline teruggezet naar standaard.',
      });
    } else {
      setPipelineMessage({ kind: 'error', text: res.error });
    }
  }, []);

  const reloadSystem = useCallback(async () => {
    try {
      const info = await window.anonimiseer.system.info();
      setSystem(info);
      setSystemError(null);
    } catch (err) {
      setSystemError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
    void reloadOllama();
    void reloadSystem();
    void reloadActive();
    void loadCatalog();
  }, [open, reload, reloadOllama, reloadSystem, reloadActive, loadCatalog]);

  useEffect(() => {
    if (open) return;
    for (const interval of pollers.current.values()) {
      clearInterval(interval);
    }
    pollers.current.clear();
  }, [open]);

  // Zodra zowel de catalogus als systeeminfo binnen zijn, kiezen we het
  // model dat het beste bij deze machine past als default. Doel: de
  // gebruiker zonder Ollama-kennis krijgt een veilige eerste keuze
  // (kleinste model dat comfortabel past) i.p.v. het eerste catalogus-
  // item — wat vaak een te zware 4B is.
  useEffect(() => {
    if (catalogEntries.length === 0 || !system) return;
    setOllamaSelection((current) => {
      const currentEntry = catalogEntries.find((e) => e.name === current);
      const currentFits =
        currentEntry && evaluateFit(currentEntry.minRamMb, system).level === 'fits';
      if (currentFits) return current;
      const recommended = pickRecommendedForMachine(catalogEntries, system);
      if (recommended) return recommended.name;
      return current || catalogEntries[0]?.name || '';
    });
  }, [catalogEntries, system]);

  const startPolling = useCallback(
    (descriptorId: string, taskId: string) => {
      const existing = pollers.current.get(descriptorId);
      if (existing) clearInterval(existing);
      const interval = setInterval(async () => {
        const res = await window.anonimiseer.models.task(taskId);
        if (!res.ok) {
          setRowState((prev) => ({
            ...prev,
            [descriptorId]: { ...prev[descriptorId], busy: false, error: res.error },
          }));
          clearInterval(interval);
          pollers.current.delete(descriptorId);
          return;
        }
        const task = res.task;
        setRowState((prev) => ({
          ...prev,
          [descriptorId]: {
            task,
            busy: task.state === 'pending' || task.state === 'running',
            error: task.state === 'error' ? task.message : undefined,
          },
        }));
        if (task.state === 'done' || task.state === 'error') {
          clearInterval(interval);
          pollers.current.delete(descriptorId);
          if (task.state === 'done') {
            void reload();
          }
        }
      }, 1500);
      pollers.current.set(descriptorId, interval);
    },
    [reload]
  );

  const install = useCallback(
    async (descriptor: ModelInfo) => {
      setRowState((prev) => ({
        ...prev,
        [descriptor.id]: { busy: true, error: undefined },
      }));
      const res = await window.anonimiseer.models.install(descriptor.id);
      if (!res.ok) {
        setRowState((prev) => ({
          ...prev,
          [descriptor.id]: { busy: false, error: res.error },
        }));
        return;
      }
      setRowState((prev) => ({
        ...prev,
        [descriptor.id]: { task: res.task, busy: true },
      }));
      startPolling(descriptor.id, res.task.taskId);
    },
    [startPolling]
  );

  const activeModelIds = useMemo<Set<string>>(
    () => new Set(activeEngine?.activeModels.map((m) => m.id) ?? []),
    [activeEngine]
  );

  const sonarRepoActive = activeEngine?.sonarModel ?? null;

  const activateSpacy = useCallback(
    (model: ModelInfo) =>
      applyPipeline(
        { spacyModel: model.installTarget },
        `activate:${model.id}`,
        `Pipeline schakelt over naar ${model.label}. Volgende analyse gebruikt dit model.`
      ),
    [applyPipeline]
  );

  const toggleSonar = useCallback(
    (model: ModelInfo) => {
      const isCurrentlyActive =
        Boolean(activeEngine?.sonarEnabled) && sonarRepoActive === model.installTarget;
      if (isCurrentlyActive) {
        return applyPipeline(
          { enableSonar: false },
          `toggle:${model.id}`,
          'SoNaR-NER uitgezet. Pipeline gebruikt alleen spaCy.'
        );
      }
      return applyPipeline(
        { enableSonar: true, sonarModel: model.installTarget },
        `toggle:${model.id}`,
        `${model.label} aangezet — eerstvolgende analyse laadt het model (kan 30s duren).`
      );
    },
    [activeEngine, applyPipeline, sonarRepoActive]
  );

  const toggleHanEdu = useCallback(
    (next: boolean) =>
      applyPipeline(
        { enableHanEdu: next },
        'toggle:han-edu',
        next
          ? 'HAN-/onderwijsprofiel ingeschakeld: klas-, cursus-, CROHO-, medewerker- en mentor-/docent-herkenners zijn actief.'
          : 'HAN-/onderwijsprofiel uitgeschakeld: alleen de algemene NL-detecties draaien.',
      ),
    [applyPipeline],
  );

  const activateOllama = useCallback(
    (name: string) =>
      // Bewust géén auto-enable van Review: een 4B-model dat cold-start
      // op een laptop onder druk kan tot 60s laden + extra geheugendruk
      // veroorzaken. Gebruiker schakelt zelf in via de rol-badge in de
      // active-engine card of in de rollen-kaart hieronder.
      applyPipeline(
        { ollamaModel: name },
        `ollama-activate:${name}`,
        `${name} is gekozen als Ollama-model. Klik bij "Lokaal LLM" op Review om de privacy-controle aan te zetten.`,
      ),
    [applyPipeline],
  );

  const toggleOllamaRole = useCallback(
    (role: 'review' | 'extra-ner' | 'borderline', enabled: boolean) => {
      const patch: EngineConfigPatch =
        role === 'review'
          ? { ollamaReviewEnabled: enabled }
          : role === 'extra-ner'
            ? { ollamaExtraNerEnabled: enabled }
            : { ollamaBorderlineEnabled: enabled };
      const niceName =
        role === 'review'
          ? 'Privacy-controle achteraf'
          : role === 'extra-ner'
            ? 'Extra NER-detector'
            : 'Borderline-rechter';
      return applyPipeline(
        patch,
        `ollama-role:${role}`,
        enabled
          ? `${niceName} ingeschakeld.`
          : `${niceName} uitgeschakeld.`,
      );
    },
    [applyPipeline],
  );

  const ollamaActiveName = activeEngine?.ollama?.model ?? null;
  const ollamaPipelineBusy = pipelineBusy;

  const selectedOllamaEntry = useMemo<OllamaCatalogEntry | null>(
    () => catalogEntries.find((e) => e.name === ollamaSelection) ?? null,
    [catalogEntries, ollamaSelection]
  );

  const ollamaName = showCustomOllama ? ollamaCustom.trim() : ollamaSelection;
  const ollamaFit = useMemo<FitVerdict | null>(() => {
    if (showCustomOllama || !selectedOllamaEntry) return null;
    return evaluateFit(selectedOllamaEntry.minRamMb, system);
  }, [selectedOllamaEntry, showCustomOllama, system]);

  const pullOllama = useCallback(async () => {
    const target = ollamaName;
    if (!target) return;
    setOllamaPullBusy(true);
    setOllamaPullMessage(`Bezig met ophalen van ${target} — dit kan minuten duren…`);
    const res = await window.anonimiseer.models.ollama.pull(target);
    setOllamaPullBusy(false);
    if (res.ok) {
      setOllamaPullMessage(`Klaar — ${target} is binnen.`);
      void reloadOllama();
    } else {
      const lower = res.error.toLowerCase();
      let hint = '';
      if (lower.includes('tls') || lower.includes('x509') || lower.includes('certificate')) {
        hint =
          ' — Tip: TLS-fout in de Ollama-daemon. Sluit Ollama af en start opnieuw (Ollama-icoon → Quit → Open). Als het blijft falen, update Ollama via ollama.com/download.';
      } else if (lower.includes('manifest') && lower.includes('not found')) {
        hint =
          ' — Tip: deze tag bestaat niet (meer) in de Ollama-library. Check ollama.com/library voor geldige tags.';
      } else if (lower.includes('no space') || lower.includes('disk full')) {
        hint = ' — Tip: schijf zit vol. Verwijder eerst een ander model.';
      }
      setOllamaPullMessage(`Mislukt: ${res.error}${hint}`);
    }
  }, [ollamaName, reloadOllama]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6 backdrop-blur-sm">
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-border bg-background shadow-xl ring-1 ring-black/5">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight">Modellen beheren</h2>
              <p className="text-xs text-muted-foreground">
                Download de modellen die Anonimiseer offline gebruikt. Eén keer ophalen — daarna werkt het zonder internet.
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

        <div className="space-y-8 px-6 py-6">
          <ActiveEnginePanel
            info={activeEngine}
            error={activeEngineError}
            onReload={() => void reloadActive()}
            onReset={() => void resetPipeline()}
            resetBusy={pipelineBusy === 'reset'}
            message={pipelineMessage}
            onToggleHanEdu={(next) => void toggleHanEdu(next)}
            hanEduBusy={pipelineBusy === 'toggle:han-edu'}
            onToggleOllamaReview={(next) => void toggleOllamaRole('review', next)}
            ollamaReviewBusy={pipelineBusy === 'ollama-role:review'}
          />

          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="font-heading text-sm font-semibold tracking-tight">
                  Detectie-modellen
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Kies welke spaCy-pipeline draait en of SoNaR-BERT meedoet.
                  Download wat je nodig hebt — daarna werkt alles offline.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void reload();
                  void reloadActive();
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" aria-hidden /> Vernieuwen
              </button>
            </div>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                Kon modellen niet ophalen: {error}
              </p>
            )}
            {models === null && !error && (
              <p className="text-xs text-muted-foreground">Laden…</p>
            )}
            {models && models.length === 0 && (
              <p className="text-xs text-muted-foreground">Geen modellen geconfigureerd.</p>
            )}
            {models &&
              models.length > 0 &&
              (() => {
                const isSonarModel = (m: ModelInfo): boolean =>
                  m.kind === 'hf' && m.installTarget.includes('sonar');
                const renderRow = (m: ModelInfo): JSX.Element => {
                  const isSpacy = m.kind === 'spacy';
                  const isSonar = isSonarModel(m);
                  // BERTje en vrienden zijn base-modellen zonder NER-hoofd.
                  const isBaseModel = m.kind === 'hf' && !isSonar;
                  const isActive = activeModelIds.has(m.id);
                  const sonarOnDifferentRepo =
                    isSonar &&
                    Boolean(activeEngine?.sonarEnabled) &&
                    sonarRepoActive !== m.installTarget;
                  let activate: PipelineAction | null = null;
                  let roleNote: string | null = null;
                  if (isSpacy) {
                    activate = {
                      label: isActive ? 'In gebruik' : 'Activeren',
                      icon: 'power',
                      variant: 'select',
                      busy: pipelineBusy === `activate:${m.id}`,
                      disabled: !m.installed || isActive || pipelineBusy !== null,
                      onClick: () => void activateSpacy(m),
                    };
                  } else if (isSonar) {
                    activate = {
                      label: isActive ? 'Uitschakelen' : 'Inschakelen',
                      icon: isActive ? 'power-off' : 'power',
                      variant: 'toggle',
                      busy: pipelineBusy === `toggle:${m.id}`,
                      disabled: !m.installed || pipelineBusy !== null || sonarOnDifferentRepo,
                      onClick: () => void toggleSonar(m),
                    };
                  } else if (isBaseModel) {
                    roleNote =
                      'Basis-model zonder NER-hoofd — niet zelfstandig bruikbaar. Het is het fundament waarop SoNaR-BERT is getraind.';
                  }
                  return (
                    <ModelRow
                      key={m.id}
                      model={m}
                      state={rowState[m.id]}
                      fit={evaluateFit(m.minRamMb, system)}
                      isActive={isActive}
                      activate={activate}
                      roleNote={roleNote}
                      onInstall={() => void install(m)}
                    />
                  );
                };

                const spacyModels = models.filter((m) => m.kind === 'spacy');
                const sonarModels = models.filter(isSonarModel);
                const baseModels = models.filter(
                  (m) => m.kind === 'hf' && !isSonarModel(m)
                );

                return (
                  <div className="space-y-4">
                    <ModelGroup
                      tone="always"
                      title="Basis-pipeline (spaCy)"
                      badge="Draait altijd"
                      description="Leest de tekst en vindt namen, plaatsen en organisaties. Er draait er altijd precies één — kies hieronder welke."
                    >
                      {spacyModels.map(renderRow)}
                    </ModelGroup>

                    {sonarModels.length > 0 && (
                      <ModelGroup
                        tone="optional"
                        title="Extra laag (SoNaR-BERT)"
                        badge="Optioneel · aanbevolen"
                        description="Draait náást spaCy en vangt Nederlandse namen die spaCy mist. Laat 'm aan voor de beste recall; uitzetten kan om RAM te besparen."
                      >
                        {sonarModels.map(renderRow)}
                      </ModelGroup>
                    )}

                    {baseModels.length > 0 && (
                      <ModelGroup
                        tone="advanced"
                        title="Fundament-modellen"
                        badge="Geavanceerd"
                        description="Niet zelfstandig bruikbaar — dit is de basis waarop SoNaR-BERT is getraind. Meestal hoef je hier niets mee."
                      >
                        {baseModels.map(renderRow)}
                      </ModelGroup>
                    )}
                  </div>
                );
              })()}
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                Twijfel je wat een model precies doet? Open{' '}
                <span className="font-medium text-foreground">Hulp</span> rechtsboven
                voor uitleg en voorbeelden.
              </span>
            </p>
          </section>

          <OllamaAdvancedPanel
            open={ollamaPanelOpen}
            onToggle={() => setOllamaPanelOpen((v) => !v)}
            presence={ollamaPresence}
            ollama={ollama}
            system={system}
            actionBusy={ollamaActionBusy}
            removingName={ollamaRemovingName}
            pullBusy={ollamaPullBusy}
            pullMessage={ollamaPullMessage}
            selection={ollamaSelection}
            onSelectionChange={setOllamaSelection}
            customName={ollamaCustom}
            onCustomChange={setOllamaCustom}
            showCustom={showCustomOllama}
            onToggleCustom={() => {
              setShowCustomOllama((v) => !v);
              setOllamaPullMessage(null);
            }}
            selectedEntry={selectedOllamaEntry}
            ollamaName={ollamaName}
            ollamaFit={ollamaFit}
            catalogEntries={catalogEntries}
            catalogMeta={catalogMeta}
            catalogError={catalogError}
            catalogRefreshing={catalogRefreshing}
            onCatalogRefresh={() => void refreshCatalog()}
            onPull={() => void pullOllama()}
            onInstall={() => void installOllama()}
            onStart={() => void startOllama()}
            onRemove={(name) => void removeOllamaModel(name)}
            onReload={() => void reloadOllama()}
            activeOllamaModel={ollamaActiveName}
            ollamaState={activeEngine?.ollama ?? null}
            /* bovenstaande kan undefined zijn bij een oude engine-response; de panel-code handelt null al af */
            onActivateOllama={(name) => void activateOllama(name)}
            onToggleRole={(role, enabled) => void toggleOllamaRole(role, enabled)}
            pipelineBusy={ollamaPipelineBusy}
          />

          <SystemPanel system={system} error={systemError} onReload={() => void reloadSystem()} />
        </div>
      </div>
    </div>
  );
}

function ActiveEnginePanel({
  info,
  error,
  onReload,
  onReset,
  resetBusy,
  message,
  onToggleHanEdu,
  hanEduBusy,
  onToggleOllamaReview,
  ollamaReviewBusy,
}: {
  info: ActiveEngineInfo | null;
  error: string | null;
  onReload: () => void;
  onReset: () => void;
  resetBusy: boolean;
  message: { kind: 'ok' | 'error'; text: string } | null;
  onToggleHanEdu: (next: boolean) => void;
  hanEduBusy: boolean;
  onToggleOllamaReview: (next: boolean) => void;
  ollamaReviewBusy: boolean;
}): JSX.Element {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>
            <Cpu className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="font-heading text-sm font-semibold tracking-tight">
              Actieve configuratie
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Wat Anonimiseer nu gebruikt om PII te vinden. Wijzigingen worden
              meteen actief — geen herstart nodig.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReset}
            disabled={resetBusy}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Verwijder al je pipeline-keuzes; engine valt terug op standaard."
          >
            {resetBusy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-3 w-3" aria-hidden />
            )}{' '}
            Standaard
          </button>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3 w-3" aria-hidden /> Vernieuwen
          </button>
        </div>
      </div>

      {message && (
        <p
          className={cn(
            'mt-3 flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px]',
            message.kind === 'ok'
              ? 'border-border/60 bg-muted/50 text-foreground/80'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          )}
        >
          {message.kind === 'ok' ? (
            <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          {message.text}
        </p>
      )}

      {error && (
        <p className="mt-2 text-[11px] text-destructive">
          <XCircle className="inline h-3 w-3" aria-hidden /> Engine niet bereikbaar: {error}
        </p>
      )}

      {!info && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">Ophalen…</p>
      )}

      {info && (
        <div className="mt-4 space-y-3 text-xs">
          <ul className="space-y-1.5">
            {info.activeModels.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="font-medium text-foreground">{m.label}</span>
                <span className="text-muted-foreground">
                  {m.role === 'nlp'
                    ? 'Hoofdmodel — vindt namen, plaatsen en organisaties'
                    : 'Extra laag — vindt wat het hoofdmodel mist'}
                </span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground/80">
                  {m.id}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-muted/40 px-3 py-2 text-muted-foreground">
            <span>
              Drempelwaarde{' '}
              <span className="font-semibold text-foreground">{info.scoreThreshold.toFixed(2)}</span>
            </span>
            <span className="h-3 w-px bg-border" aria-hidden />
            <span>
              <span className="font-semibold text-foreground">{info.recognizers.length}</span>{' '}
              herkenningsregels
            </span>
            <span className="h-3 w-px bg-border" aria-hidden />
            <span className="inline-flex items-center gap-1.5">
              SoNaR-BERT
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                  info.sonarEnabled
                    ? 'border-border/70 bg-background text-foreground/70'
                    : 'border-border/60 bg-muted/40 text-muted-foreground'
                )}
              >
                {info.sonarEnabled && (
                  <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
                )}
                {info.sonarEnabled ? 'Aan' : 'Uit'}
              </span>
            </span>
            {info.recognizers.length > 0 && (
              <details className="group ml-auto w-full sm:w-auto">
                <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    className="h-3 w-3 transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  Technische details bekijken
                </summary>
                <p className="mt-1.5 w-full break-words font-mono text-[10px] leading-relaxed text-muted-foreground/80">
                  {info.recognizers.join(', ')}
                </p>
              </details>
            )}
          </div>

          <HanEduProfileBlock
            enabled={info.hanEduEnabled}
            onToggle={onToggleHanEdu}
            busy={hanEduBusy}
          />

          <OllamaStatusBlock
            ollama={info.ollama}
            onToggleReview={onToggleOllamaReview}
            reviewBusy={ollamaReviewBusy}
          />
          </div>
      )}
    </section>
  );
}

/** iOS-stijl aan/uit-schakelaar: je ziet in één oogopslag wat aan staat. */
function ToggleSwitch({
  checked,
  onChange,
  busy = false,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  busy?: boolean;
  disabled?: boolean;
  label: string;
}): JSX.Element {
  const isDisabled = disabled || busy;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      disabled={isDisabled}
      className={cn(
        'relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        checked ? 'bg-primary' : 'bg-muted-foreground/30',
        isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      )}
    >
      <span
        className={cn(
          'inline-flex h-[18px] w-[18px] transform items-center justify-center rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
        )}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />}
      </span>
    </button>
  );
}

/** Instellingsrij: titel + uitleg links, schakelaar met Aan/Uit-tekst rechts. */
function SettingRow({
  icon,
  title,
  description,
  state,
  control,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  state: boolean;
  control: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && (
          <span className="mt-px text-muted-foreground" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            'w-6 text-right text-[11px] font-semibold',
            state ? 'text-primary' : 'text-muted-foreground'
          )}
        >
          {state ? 'Aan' : 'Uit'}
        </span>
        {control}
      </div>
    </div>
  );
}

function HanEduProfileBlock({
  enabled,
  onToggle,
  busy,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
  busy: boolean;
}): JSX.Element {
  return (
    <SettingRow
      icon={<GraduationCap className="h-4 w-4" aria-hidden />}
      title="HAN-/onderwijsprofiel"
      description="Herkent ook studentnummers, personeelsnummers, klas- en cursuscodes en namen na mentor-/docent-labels. Zet uit buiten het hoger onderwijs."
      state={enabled}
      control={
        <ToggleSwitch
          checked={enabled}
          onChange={onToggle}
          busy={busy}
          label="HAN-/onderwijsprofiel aan of uit"
        />
      }
    />
  );
}

// De engine kan (met een oude response) ``ollama`` weglaten; daarom
// normaliseren we hier en renderen we altijd een veilige representatie.
function OllamaStatusBlock({
  ollama,
  onToggleReview,
  reviewBusy,
}: {
  ollama: ActiveEngineInfo['ollama'] | undefined;
  onToggleReview: (next: boolean) => void;
  reviewBusy: boolean;
}): JSX.Element {
  const state = ollama ?? {
    model: null,
    daemonRunning: false,
    modelPresent: false,
    reviewEnabled: false,
    extraNerEnabled: false,
    borderlineEnabled: false,
  };
  const reviewClickable = Boolean(state.model && state.daemonRunning && state.modelPresent);
  const extras = [
    state.extraNerEnabled && 'extra zoekronde',
    state.borderlineEnabled && 'twijfelgevallen',
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Bot className="h-3.5 w-3.5" aria-hidden />
          Lokaal taalmodel
        </span>
        {state.model ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/75">
            <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
            {state.model}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">geen model gekozen</span>
        )}
      </div>

      {state.model ? (
        <>
          <SettingRow
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
            title="Privacy-nacontrole"
            description={
              reviewClickable
                ? `Na het anonimiseren controleert ${state.model} of er nog persoonsgegevens zijn blijven staan.`
                : 'Beschikbaar zodra het model én de Ollama-daemon actief zijn (zie paneel hieronder).'
            }
            state={state.reviewEnabled}
            control={
              <ToggleSwitch
                checked={state.reviewEnabled}
                onChange={onToggleReview}
                busy={reviewBusy}
                disabled={!reviewClickable}
                label="Privacy-nacontrole door LLM aan of uit"
              />
            }
          />

          {extras.length > 0 && (
            <p className="px-0.5 text-[11px] text-muted-foreground">
              Ook aan (beheer in het Ollama-paneel): {extras.join(' · ')}.
            </p>
          )}

          {state.daemonRunning ? (
            state.modelPresent ? null : (
              <p className="flex items-start gap-1.5 px-0.5 text-[11px] text-warning-foreground dark:text-warning">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                Model staat niet (meer) in <span className="font-mono">ollama list</span>.
                Pull hem opnieuw of kies een ander.
              </p>
            )
          ) : (
            <p className="flex items-start gap-1.5 px-0.5 text-[11px] text-warning-foreground dark:text-warning">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Ollama-daemon draait niet. Start hem via het paneel hieronder.
            </p>
          )}
        </>
      ) : (
        <p className="px-0.5 text-[11px] text-muted-foreground/80">
          Open <span className="font-medium">Geavanceerd: Ollama</span> hieronder,
          download een model en druk op <span className="font-medium">Activeer</span>.
        </p>
      )}
    </div>
  );
}

function SystemPanel({
  system,
  error,
  onReload,
}: {
  system: SystemInfo | null;
  error: string | null;
  onReload: () => void;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-border/50 bg-muted/15 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Cpu className="h-3.5 w-3.5" aria-hidden />
          Deze computer
        </div>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Hardware opnieuw detecteren"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          <span className="sr-only">Vernieuwen</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-destructive">Kon systeeminfo niet ophalen: {error}</p>
      )}
      {!system && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">Detecteren…</p>
      )}
      {system && (
        <dl className="mt-2 grid grid-cols-1 gap-x-5 gap-y-1.5 text-xs sm:grid-cols-3">
          <SystemStat
            icon={<Cpu className="h-3.5 w-3.5" aria-hidden />}
            label="CPU"
            value={`${system.cpuModel} (${system.cpuCores} cores)`}
          />
          <SystemStat
            icon={<HardDrive className="h-3.5 w-3.5" aria-hidden />}
            label="RAM"
            value={`${gb(system.totalMemMb)} GB · ${gb(system.freeMemMb)} GB vrij`}
          />
          <SystemStat
            icon={<Zap className="h-3.5 w-3.5" aria-hidden />}
            label="GPU"
            value={
              system.gpu
                ? `${system.gpu.name}${
                    system.gpu.vramMb
                      ? ` · ${gb(system.gpu.vramMb)} GB${
                          system.gpu.kind === 'apple-silicon' ? ' (unified)' : ''
                        }`
                      : ''
                  }`
                : 'Geen aparte GPU — CPU wordt gebruikt.'
            }
          />
        </dl>
      )}
    </section>
  );
}

function SystemStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-muted-foreground/70" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {label}
        </dt>
        <dd className="truncate text-foreground" title={value}>
          {value}
        </dd>
      </div>
    </div>
  );
}

function FitLine({ fit }: { fit: FitVerdict }): JSX.Element {
  const cls =
    fit.level === 'too-large'
      ? 'text-destructive'
      : fit.level === 'tight'
      ? 'text-warning-foreground dark:text-warning'
      : fit.level === 'fits'
      ? 'text-success-foreground dark:text-success'
      : 'text-muted-foreground';
  const Icon =
    fit.level === 'too-large'
      ? XCircle
      : fit.level === 'tight'
      ? AlertTriangle
      : fit.level === 'fits'
      ? CheckCircle2
      : Info;
  return (
    <p className={`mt-1 ${cls}`}>
      <Icon className="inline h-3 w-3" aria-hidden /> {fit.message}
    </p>
  );
}

/** Groepskop boven een set modellen: maakt de rol (altijd-aan / optioneel) meteen duidelijk. */
function ModelGroup({
  title,
  badge,
  tone,
  description,
  children,
}: {
  title: string;
  badge: string;
  tone: 'always' | 'optional' | 'advanced';
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  const badgeClass =
    tone === 'always'
      ? 'border-primary/30 bg-primary/10 text-primary'
      : tone === 'optional'
      ? 'border-border/70 bg-background text-foreground/70'
      : 'border-border/60 bg-muted/40 text-muted-foreground';
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-foreground/80">
          {title}
        </h4>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
            badgeClass
          )}
        >
          {badge}
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[11px] leading-snug text-muted-foreground">
        {description}
      </p>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function ModelRow({
  model,
  state,
  fit,
  isActive,
  activate,
  roleNote,
  onInstall,
}: {
  model: ModelInfo;
  state: RowState | undefined;
  fit: FitVerdict;
  isActive: boolean;
  activate: PipelineAction | null;
  /** Voor base-modellen zonder eigen rol: uitleg waarom er geen knop staat. */
  roleNote: string | null;
  onInstall: () => void;
}): JSX.Element {
  const task = state?.task;
  const isRunning = state?.busy ?? false;
  const isInstalled = model.installed && !isRunning;

  const showActiveBadge = isActive && activate?.variant !== 'toggle';

  return (
    <li
      className={cn(
        'rounded-xl border p-3.5 transition-all',
        isActive
          ? 'border-primary/40 bg-primary/[0.04] ring-1 ring-inset ring-primary/15'
          : 'border-border/60 bg-card/40 hover:border-border'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge installed={model.installed} task={task} />
            <p className="truncate text-sm font-medium">{model.label}</p>
            <span className="text-[11px] text-muted-foreground">
              · {model.kind === 'spacy' ? 'spaCy' : 'HuggingFace'} · ~{model.sizeMb} MB
            </span>
            {showActiveBadge && <ActiveBadge />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
          {roleNote && (
            <p className="mt-1 flex items-start gap-1 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>{roleNote}</span>
            </p>
          )}
          {model.minRamMb > 0 && <FitLine fit={fit} />}
          {task && (task.state === 'running' || task.state === 'pending') && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              <Loader2 className="inline h-3 w-3 animate-spin" aria-hidden /> {task.message || 'Bezig…'}
            </p>
          )}
          {state?.error && (
            <p className="mt-1 break-words text-[11px] text-destructive">
              <XCircle className="inline h-3 w-3" aria-hidden /> {state.error}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {activate && model.installed && activate.variant === 'toggle' && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[11px] font-semibold',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {isActive ? 'Aan' : 'Uit'}
              </span>
              <ToggleSwitch
                checked={isActive}
                onChange={() => activate.onClick()}
                busy={activate.busy}
                disabled={activate.disabled}
                label={`${model.label} aan of uit`}
              />
            </div>
          )}
          {activate && model.installed && activate.variant === 'select' && !isActive && (
            <button
              type="button"
              onClick={activate.onClick}
              disabled={activate.disabled}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-60"
              title="Wissel direct over naar dit model."
            >
              {activate.busy ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Power className="h-3 w-3" aria-hidden />
              )}
              {activate.label}
            </button>
          )}
          <button
            type="button"
            onClick={onInstall}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Bezig
              </>
            ) : isInstalled ? (
              <>
                <Download className="h-3 w-3" aria-hidden /> Opnieuw
              </>
            ) : (
              <>
                <Download className="h-3 w-3" aria-hidden /> Downloaden
              </>
            )}
          </button>
        </div>
      </div>
    </li>
  );
}

/** Duidelijke "ingeschakeld"-markering in merkkleur. */
function ActiveBadge(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Ingeschakeld
    </span>
  );
}

function StatusBadge({
  installed,
  task,
}: {
  installed: boolean;
  task: ModelTask | undefined;
}): JSX.Element {
  if (task && (task.state === 'running' || task.state === 'pending')) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />;
  }
  if (task?.state === 'error') {
    return <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />;
  }
  if (installed) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />;
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function gb(mbValue: number): string {
  if (mbValue <= 0) return '0';
  return (mbValue / 1024).toFixed(mbValue >= 10240 ? 0 : 1);
}

interface OllamaAdvancedPanelProps {
  open: boolean;
  onToggle: () => void;
  presence: OllamaPresence | null;
  ollama: {
    available: boolean | null;
    models: Array<{ name: string; size: number }>;
    error?: string;
  };
  system: SystemInfo | null;
  actionBusy: null | 'install' | 'start';
  removingName: string | null;
  pullBusy: boolean;
  pullMessage: string | null;
  selection: string;
  onSelectionChange: (name: string) => void;
  customName: string;
  onCustomChange: (name: string) => void;
  showCustom: boolean;
  onToggleCustom: () => void;
  selectedEntry: OllamaCatalogEntry | null;
  ollamaName: string;
  ollamaFit: FitVerdict | null;
  catalogEntries: OllamaCatalogEntry[];
  catalogMeta: {
    version: string;
    source: 'cache' | 'bundled';
    updatedAt: number | null;
    remoteUrl: string | null;
  } | null;
  catalogError: string | null;
  catalogRefreshing: boolean;
  onCatalogRefresh: () => void;
  onPull: () => void;
  onInstall: () => void;
  onStart: () => void;
  onRemove: (name: string) => void;
  onReload: () => void;
  /** Nu geactiveerde Ollama-tag (voor "Actief"-badge). */
  activeOllamaModel: string | null;
  /** Drie rol-toggles + daemon/model-status. */
  ollamaState: {
    model: string | null;
    daemonRunning: boolean;
    modelPresent: boolean;
    reviewEnabled: boolean;
    extraNerEnabled: boolean;
    borderlineEnabled: boolean;
  } | null;
  onActivateOllama: (name: string) => void;
  onToggleRole: (
    role: 'review' | 'extra-ner' | 'borderline',
    enabled: boolean,
  ) => void;
  /** Als een `applyPipeline` draait, wordt deze key gezet (voor spinner-state). */
  pipelineBusy: string | null;
}

function OllamaAdvancedPanel(props: OllamaAdvancedPanelProps): JSX.Element {
  const {
    open,
    onToggle,
    presence,
    ollama,
    system,
    actionBusy,
    removingName,
    pullBusy,
    pullMessage,
    selection,
    onSelectionChange,
    customName,
    onCustomChange,
    showCustom,
    onToggleCustom,
    selectedEntry,
    ollamaName,
    ollamaFit,
    catalogEntries,
    catalogMeta,
    catalogError,
    catalogRefreshing,
    onCatalogRefresh,
    onPull,
    onInstall,
    onStart,
    onRemove,
    onReload,
    activeOllamaModel,
    ollamaState,
    onActivateOllama,
    onToggleRole,
    pipelineBusy,
  } = props;

  const summary =
    presence === null
      ? 'detecteren…'
      : !presence.installed
      ? 'niet geïnstalleerd'
      : !presence.daemonRunning
      ? 'geïnstalleerd, maar niet actief'
      : `actief — ${ollama.models.length} model${ollama.models.length === 1 ? '' : 'len'}`;

  return (
    <section className="rounded-lg border border-border/60 bg-card/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold">Geavanceerd: Ollama (lokale LLM)</p>
            <p className="text-[11px] text-muted-foreground">
              Optioneel — alleen nodig als je naast NER ook een lokaal taalmodel wilt
              gebruiken. Status: {summary}.
            </p>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">{open ? 'Inklappen' : 'Openen'}</span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 py-4 space-y-4">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Vernieuwen
            </button>
          </div>

          <OllamaPresenceCard
            presence={presence}
            actionBusy={actionBusy}
            onInstall={onInstall}
            onStart={onStart}
          />

          {presence?.daemonRunning && (
            <>
              <OllamaInstalledList
                models={ollama.models}
                removingName={removingName}
                onRemove={onRemove}
                activeModel={activeOllamaModel}
                onActivate={onActivateOllama}
                pipelineBusy={pipelineBusy}
              />
              {activeOllamaModel && ollamaState && (
                <OllamaRolesCard
                  state={ollamaState}
                  onToggleRole={onToggleRole}
                  pipelineBusy={pipelineBusy}
                />
              )}
              <CatalogBar
                meta={catalogMeta}
                error={catalogError}
                refreshing={catalogRefreshing}
                onRefresh={onCatalogRefresh}
              />
              <OllamaPullCard
                ollama={ollama}
                system={system}
                pullBusy={pullBusy}
                pullMessage={pullMessage}
                selection={selection}
                onSelectionChange={onSelectionChange}
                customName={customName}
                onCustomChange={onCustomChange}
                showCustom={showCustom}
                onToggleCustom={onToggleCustom}
                selectedEntry={selectedEntry}
                ollamaName={ollamaName}
                ollamaFit={ollamaFit}
                catalogEntries={catalogEntries}
                onPull={onPull}
              />
            </>
          )}

          {!presence?.daemonRunning && pullMessage && (
            <p className="text-[11px] text-muted-foreground">{pullMessage}</p>
          )}
        </div>
      )}
    </section>
  );
}

function OllamaPresenceCard({
  presence,
  actionBusy,
  onInstall,
  onStart,
}: {
  presence: OllamaPresence | null;
  actionBusy: null | 'install' | 'start';
  onInstall: () => void;
  onStart: () => void;
}): JSX.Element {
  if (presence === null) {
    return (
      <p className="text-[11px] text-muted-foreground">
        <Loader2 className="inline h-3 w-3 animate-spin" aria-hidden /> Detecteren of Ollama
        op deze computer staat…
      </p>
    );
  }

  if (!presence.installed) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground dark:text-warning space-y-2">
        <p className="font-medium">Ollama is niet gevonden op deze computer.</p>
        <p>
          Ollama is een gratis, lokaal draaiende LLM-runtime van een externe partij. Wij
          installeren hem niet automatisch — je doorloopt zelf de officiële installer
          zodat je weet wat er op je systeem komt.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onInstall}
            disabled={actionBusy === 'install'}
            className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-1.5 text-xs font-medium text-white hover:bg-warning/90 disabled:opacity-60"
          >
            {actionBusy === 'install' ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <ExternalLink className="h-3 w-3" aria-hidden />
            )}
            Open downloadpagina van Ollama
          </button>
        </div>
      </div>
    );
  }

  if (!presence.daemonRunning) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground dark:text-warning space-y-2">
        <p className="font-medium">Ollama is geïnstalleerd, maar de service draait niet.</p>
        <p className="opacity-80">CLI-pad: <span className="font-mono">{presence.cliPath}</span></p>
        <button
          type="button"
          onClick={onStart}
          disabled={actionBusy === 'start'}
          className="inline-flex items-center gap-2 rounded-md bg-warning px-3 py-1.5 text-xs font-medium text-white hover:bg-warning/90 disabled:opacity-60"
        >
          {actionBusy === 'start' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Play className="h-3 w-3" aria-hidden />
          )}
          Start Ollama
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 p-3 text-xs text-muted-foreground">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
      <p>
        <span className="font-medium text-foreground">Ollama draait</span> ·{' '}
        <span className="font-mono text-[11px]">{presence.cliPath ?? 'systeem-pad'}</span>
      </p>
    </div>
  );
}

function OllamaInstalledList({
  models,
  removingName,
  onRemove,
  activeModel,
  onActivate,
  pipelineBusy,
}: {
  models: Array<{ name: string; size: number }>;
  removingName: string | null;
  onRemove: (name: string) => void;
  activeModel: string | null;
  onActivate: (name: string) => void;
  pipelineBusy: string | null;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3">
      <p className="text-xs font-medium">
        Lokale Ollama-modellen ({models.length})
      </p>
      {models.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Nog geen modellen — gebruik hieronder de dropdown om er één te downloaden.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border/50">
          {models.map((m) => {
            const isRemoving = removingName === m.name;
            const isActive = activeModel === m.name;
            const activateKey = `ollama-activate:${m.name}`;
            const activating = pipelineBusy === activateKey;
            const isEmbedding = looksLikeEmbeddingModel(m.name);
            return (
              <li
                key={m.name}
                className={cn(
                  'flex items-center justify-between gap-2 py-1.5',
                  isActive && 'rounded-md px-2 ring-1 ring-primary/25 bg-primary/[0.03]'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-xs">
                    {m.name}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
                        <span className="h-1 w-1 rounded-full bg-primary" aria-hidden />
                        In gebruik
                      </span>
                    )}
                    {isEmbedding && (
                      <span
                        className="rounded-full border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                        title="Embedding-modellen kunnen geen tekst genereren en zijn niet bruikbaar voor LLM-rollen."
                      >
                        Embedding-only
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{mb(m.size)} MB op schijf</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onActivate(m.name)}
                    disabled={activating || isActive || isEmbedding || Boolean(pipelineBusy)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50',
                      isActive
                        ? 'border-border/70 bg-muted/50 text-muted-foreground'
                        : 'border-border/50 text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
                    )}
                    title={
                      isEmbedding
                        ? 'Embedding-model — kan geen tekst genereren, dus niet bruikbaar als LLM-rol.'
                        : isActive
                          ? 'Dit is het actieve model'
                          : `Kies ${m.name} als actief LLM-model`
                    }
                  >
                    {activating ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : isActive ? (
                      <CheckCircle2 className="h-3 w-3" aria-hidden />
                    ) : (
                      <Power className="h-3 w-3" aria-hidden />
                    )}
                    {isActive ? 'In gebruik' : isEmbedding ? 'Niet bruikbaar' : 'Activeer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(m.name)}
                    disabled={isRemoving}
                    className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    title={`Verwijder ${m.name}`}
                  >
                    {isRemoving ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3 w-3" aria-hidden />
                    )}
                    Verwijder
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OllamaRolesCard({
  state,
  onToggleRole,
  pipelineBusy,
}: {
  state: {
    model: string | null;
    daemonRunning: boolean;
    modelPresent: boolean;
    reviewEnabled: boolean;
    extraNerEnabled: boolean;
    borderlineEnabled: boolean;
  };
  onToggleRole: (
    role: 'review' | 'extra-ner' | 'borderline',
    enabled: boolean,
  ) => void;
  pipelineBusy: string | null;
}): JSX.Element {
  const roles: Array<{
    key: 'review' | 'extra-ner' | 'borderline';
    label: string;
    description: string;
    enabled: boolean;
    availableNow: boolean;
    disabledReason?: string;
  }> = [
    {
      key: 'review',
      label: 'Privacy-controle achteraf (aanbevolen)',
      description:
        'Na anonimisering controleert het LLM of er nog PII in de tekst staat. Extra vangnet — verandert de detectie zelf niet. Eerste keer kan het laden van het model 30–60 seconden duren.',
      enabled: state.reviewEnabled,
      availableNow: true,
    },
    {
      key: 'extra-ner',
      label: 'Extra NER-detector',
      description:
        'Het LLM scant mee in stap 3 en voegt hits toe. Kan vals-positieven introduceren.',
      enabled: state.extraNerEnabled,
      availableNow: false,
      disabledReason: 'Komt in de volgende release beschikbaar.',
    },
    {
      key: 'borderline',
      label: 'Borderline-rechter',
      description:
        'Alleen bij twijfelhits roept het LLM ja/nee om vals-positieven te verminderen.',
      enabled: state.borderlineEnabled,
      availableNow: false,
      disabledReason: 'Komt in de volgende release beschikbaar.',
    },
  ];

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <p className="text-xs font-medium">
        Rollen voor{' '}
        <span className="font-mono">{state.model ?? '—'}</span>
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Zet expliciet aan waarvoor je dit model wilt gebruiken. Standaard staat alles uit.
      </p>
      <ul className="mt-2 space-y-1.5">
        {roles.map((role) => {
          const busyKey = `ollama-role:${role.key}`;
          const busy = pipelineBusy === busyKey;
          const hardDisabled =
            !role.availableNow ||
            !state.daemonRunning ||
            !state.modelPresent ||
            busy ||
            Boolean(pipelineBusy && pipelineBusy !== busyKey);
          return (
            <li
              key={role.key}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/60 p-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">
                  {role.label}
                  {!role.availableNow && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (binnenkort)
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {role.description}
                </p>
                {role.disabledReason && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                    {role.disabledReason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    'w-6 text-right text-[11px] font-semibold',
                    role.enabled ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  {role.enabled ? 'Aan' : 'Uit'}
                </span>
                <ToggleSwitch
                  checked={role.enabled}
                  onChange={(next) => onToggleRole(role.key, next)}
                  busy={busy}
                  disabled={hardDisabled}
                  label={`${role.label} aan of uit`}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {!state.daemonRunning && (
        <p className="mt-2 text-[10px] text-warning-foreground dark:text-warning">
          <AlertTriangle className="inline h-3 w-3" aria-hidden /> De Ollama-daemon
          draait niet — de rollen blijven uit tot je hem start.
        </p>
      )}
    </div>
  );
}

function CatalogBar({
  meta,
  error,
  refreshing,
  onRefresh,
}: {
  meta: {
    version: string;
    source: 'cache' | 'bundled';
    updatedAt: number | null;
    remoteUrl: string | null;
  } | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}): JSX.Element {
  const sourceLabel = meta?.source === 'cache' ? 'recente download' : 'meegeleverd met de app';
  const updatedAtLabel =
    meta?.updatedAt != null
      ? new Date(meta.updatedAt).toLocaleString('nl-NL', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : null;
  const refreshDisabled = refreshing || !meta?.remoteUrl;

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Modellijst</p>
          <p className="text-muted-foreground">
            {meta ? (
              <>
                Versie <span className="font-mono">{meta.version}</span> · bron: {sourceLabel}
                {updatedAtLabel ? ` · vernieuwd ${updatedAtLabel}` : ''}
              </>
            ) : (
              'Modellijst laden…'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title={
            meta?.remoteUrl
              ? `Haalt de actuele lijst op van ${meta.remoteUrl}`
              : 'Geen remote-URL geconfigureerd — alleen meegeleverde lijst beschikbaar'
          }
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          Catalog vernieuwen
        </button>
      </div>
      {error && (
        <p className="mt-2 text-destructive">
          <XCircle className="inline h-3 w-3" aria-hidden /> {error}
        </p>
      )}
      {!meta?.remoteUrl && !error && (
        <p className="mt-1 text-muted-foreground/80">
          Geen remote-URL geconfigureerd. Stel <span className="font-mono">ANONIMISEER_OLLAMA_CATALOG_URL</span> in
          om automatische updates aan te zetten.
        </p>
      )}
    </div>
  );
}

function OllamaPullCard({
  ollama,
  system,
  pullBusy,
  pullMessage,
  selection,
  onSelectionChange,
  customName,
  onCustomChange,
  showCustom,
  onToggleCustom,
  selectedEntry,
  ollamaName,
  ollamaFit,
  catalogEntries,
  onPull,
}: {
  ollama: { models: Array<{ name: string; size: number }> };
  system: SystemInfo | null;
  pullBusy: boolean;
  pullMessage: string | null;
  selection: string;
  onSelectionChange: (name: string) => void;
  customName: string;
  onCustomChange: (name: string) => void;
  showCustom: boolean;
  onToggleCustom: () => void;
  selectedEntry: OllamaCatalogEntry | null;
  ollamaName: string;
  ollamaFit: FitVerdict | null;
  catalogEntries: OllamaCatalogEntry[];
  onPull: () => void;
}): JSX.Element {
  return (
    <div className="rounded-md border border-border/60 bg-card/30 p-3 space-y-3">
      <p className="text-xs font-medium">Nieuw model downloaden</p>

      {!showCustom && (
        <div className="space-y-2">
          <label className="block text-[11px] text-muted-foreground" htmlFor="ollama-select">
            Kies een aanbevolen model:
          </label>
          {(() => {
            const machineRec = pickRecommendedForMachine(catalogEntries, system);
            if (!machineRec) return null;
            return (
              <p className="text-[11px] text-success-foreground dark:text-success">
                <CheckCircle2 className="inline h-3 w-3" aria-hidden /> Voor jouw
                machine ({system ? `${gb(system.totalMemMb)} GB RAM` : '—'}) is{' '}
                <span className="font-medium">{machineRec.label}</span> een
                veilige start.
              </p>
            );
          })()}
          <div className="relative">
            <select
              id="ollama-select"
              value={selection}
              onChange={(e) => onSelectionChange(e.target.value)}
              disabled={pullBusy}
              className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
            >
              {(() => {
                const sorted = sortCatalogByFit(catalogEntries, system);
                const machineRec = pickRecommendedForMachine(catalogEntries, system);
                const groups: Array<{
                  level: FitLevel;
                  label: string;
                  items: OllamaCatalogEntry[];
                }> = [
                  { level: 'fits', label: 'Past op deze machine', items: [] },
                  { level: 'tight', label: 'Krap — sluit andere apps', items: [] },
                  { level: 'too-large', label: 'Te zwaar voor deze machine', items: [] },
                  { level: 'unknown', label: 'Onbekende fit', items: [] },
                ];
                for (const entry of sorted) {
                  const lvl = evaluateFit(entry.minRamMb, system).level;
                  const bucket = groups.find((g) => g.level === lvl);
                  bucket?.items.push(entry);
                }
                return groups
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <optgroup key={g.level} label={g.label}>
                      {g.items.map((entry) => {
                        const installed = ollamaInstalled(entry.name, ollama.models);
                        const isMachineRec = machineRec?.name === entry.name;
                        const prefix = isMachineRec
                          ? '★ Aanbevolen — '
                          : installed
                            ? '✓ '
                            : '';
                        return (
                          <option key={entry.name} value={entry.name}>
                            {prefix}
                            {entry.label} ({gb(entry.sizeMb)} GB)
                            {entry.recommended && !isMachineRec ? ' ★' : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  ));
              })()}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>

          {selectedEntry && (
            <div className="rounded-md border border-border/40 bg-muted/20 p-2 text-[11px] text-muted-foreground">
              <p>{selectedEntry.description}</p>
              <p className="mt-1">
                Download ~{gb(selectedEntry.sizeMb)} GB · advies-RAM: {gb(selectedEntry.minRamMb)} GB
              </p>
              {ollamaFit && <FitLine fit={ollamaFit} />}
              {ollamaInstalled(selectedEntry.name, ollama.models) && (
                <p className="mt-1 text-success-foreground dark:text-success">
                  <CheckCircle2 className="inline h-3 w-3" aria-hidden /> Al lokaal
                  aanwezig — opnieuw pullen werkt als update.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showCustom && (
        <div className="space-y-1">
          <label className="block text-[11px] text-muted-foreground" htmlFor="ollama-custom">
            Eigen modelnaam (zoals op{' '}
            <span className="font-mono">ollama.com/library</span>):
          </label>
          <input
            id="ollama-custom"
            type="text"
            value={customName}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="bv. mixtral:8x7b-instruct-q4_K_M"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={pullBusy}
          />
          <p className="text-[11px] text-muted-foreground">
            Let op: zonder fit-check. Controleer zelf of je machine genoeg RAM/VRAM heeft.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPull}
          disabled={pullBusy || !ollamaName}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pullBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          {pullBusy ? 'Bezig…' : `Pull ${ollamaName || ''}`.trim()}
        </button>
        <button
          type="button"
          onClick={onToggleCustom}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {showCustom ? '← Terug naar lijst' : 'Geavanceerd: eigen naam invoeren'}
        </button>
      </div>

      {pullMessage && <p className="text-[11px] text-muted-foreground">{pullMessage}</p>}
      <p className="text-[11px] text-muted-foreground">
        Ollama-pull blokkeert tot het model binnen is — dat kan minuten duren bij grote modellen.
      </p>
      <p className="text-[10px] text-muted-foreground/80">
        Tip: alleen lokaal draaibare modellen staan in deze lijst. Varianten met
        <span className="font-mono"> :cloud</span> draaien op de servers van Ollama en
        breken de privacybelofte van Anonimiseer.
      </p>
    </div>
  );
}

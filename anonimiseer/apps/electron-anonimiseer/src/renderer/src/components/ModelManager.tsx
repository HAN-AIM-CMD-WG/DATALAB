import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  Package,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
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
      <div className="my-auto w-full max-w-3xl rounded-2xl border border-border bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Modellen beheren</h2>
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

        <div className="space-y-6 px-6 py-5">
          <SystemPanel system={system} error={systemError} onReload={() => void reloadSystem()} />

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

          <section>
            <SectionHeader
              title="Engine-modellen (spaCy + HuggingFace)"
              onReload={() => {
                void reload();
                void reloadActive();
              }}
            />
            {error && (
              <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                Kon modellen niet ophalen: {error}
              </p>
            )}
            {models === null && !error && (
              <p className="mt-2 text-xs text-muted-foreground">Laden…</p>
            )}
            {models && models.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Geen modellen geconfigureerd.</p>
            )}
            <ul className="mt-3 space-y-2">
              {models?.map((m) => {
                const isSpacy = m.kind === 'spacy';
                const isSonar = m.kind === 'hf' && m.installTarget.includes('sonar');
                // BERTje en vrienden zijn base-modellen zonder NER-hoofd.
                // Ze kunnen niet zelfstandig entities vinden — ze vormen
                // het fundament waar SoNaR-BERT op fine-tuned is.
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
                    label: isActive ? 'Actief' : 'Gebruik',
                    icon: 'power',
                    busy: pipelineBusy === `activate:${m.id}`,
                    disabled: !m.installed || isActive || pipelineBusy !== null,
                    onClick: () => void activateSpacy(m),
                  };
                } else if (isSonar) {
                  activate = {
                    label: isActive ? 'Uitschakelen' : 'Inschakelen',
                    icon: isActive ? 'power-off' : 'power',
                    busy: pipelineBusy === `toggle:${m.id}`,
                    disabled: !m.installed || pipelineBusy !== null || sonarOnDifferentRepo,
                    onClick: () => void toggleSonar(m),
                  };
                } else if (isBaseModel) {
                  roleNote =
                    'Basis-model zonder NER-hoofd — niet zelfstandig bruikbaar. Fundament waar SoNaR-BERT hieronder op is fine-tuned.';
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
              })}
            </ul>
            <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">Er staat altijd één primaire pipeline aan</span>{' '}
                — dat is verplicht voor de detectie-motor. Klik{' '}
                <span className="font-medium">Gebruik</span> bij een ander spaCy-model om te wisselen;{' '}
                meerdere tegelijk zetten kan niet (zou dubbele hits geven).
              </p>
              <p>
                <span className="font-semibold text-foreground">SoNaR-BERT is een extra laag ernaast</span>{' '}
                die hits toevoegt die spaCy mist. Voor beste recall op Nederlandse teksten:{' '}
                large-spaCy + SoNaR-BERT = de sweet spot (wat je nu hebt). Eerste analyse na inschakelen
                duurt langer omdat het BERT-model in geheugen geladen wordt.
              </p>
              <p>
                Twijfel je over wat welk model doet? Open{' '}
                <span className="font-medium">Hulp &amp; uitleg</span> rechtsboven.
              </p>
            </div>
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
    <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">Wat gebruikt Anonimiseer nu?</h3>
            <p className="text-[11px] text-muted-foreground">
              Eén primaire spaCy-pipeline (altijd aan, je kiest welke) plus optioneel
              SoNaR-BERT ernaast voor extra recall. Keuzes worden meteen actief —
              geen herstart nodig.
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
          className={`mt-2 rounded-md px-2 py-1 text-[11px] ${
            message.kind === 'ok'
              ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="inline h-3 w-3" aria-hidden />
          ) : (
            <XCircle className="inline h-3 w-3" aria-hidden />
          )}{' '}
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
        <div className="mt-3 space-y-2 text-[11px]">
          <ul className="space-y-1.5">
            {info.activeModels.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-background/60 px-2 py-1.5"
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden />
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground">
                  · {m.kind === 'spacy' ? 'spaCy' : 'HuggingFace'} ·{' '}
                  {m.role === 'nlp'
                    ? 'tokenisatie + basis-NER'
                    : 'aanvullende NER'}
                </span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                  {m.id}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">Drempelwaarde:</span>{' '}
              {info.scoreThreshold.toFixed(2)}
            </span>
            <span>
              <span className="font-medium text-foreground">Recognizers:</span>{' '}
              {info.recognizers.length}
            </span>
            <span>
              <span className="font-medium text-foreground">SoNaR-BERT:</span>{' '}
              {info.sonarEnabled ? 'aan' : 'uit'}
              {info.sonarEnabled ? (
                <span className="ml-1 opacity-70">(extra Nederlandse NER)</span>
              ) : (
                <span className="ml-1 opacity-70">
                  (zet aan in Engine-modellen hieronder voor extra Nederlandse NER)
                </span>
              )}
            </span>
          </div>

          {info.recognizers.length > 0 && (
            <details className="text-muted-foreground">
              <summary className="cursor-pointer text-[11px]">
                Toon alle {info.recognizers.length} recognizers
              </summary>
              <p className="mt-1 break-words font-mono text-[10px] opacity-80">
                {info.recognizers.join(', ')}
              </p>
            </details>
          )}

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
    <div className="rounded-md border border-border/50 bg-background/60 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium">
            HAN-/onderwijsprofiel{' '}
            <span
              className={
                enabled
                  ? 'rounded-full border border-lime-500/40 bg-lime-500/10 px-1.5 py-0.5 text-[10px] text-lime-700 dark:text-lime-200'
                  : 'rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground'
              }
            >
              {enabled ? 'actief' : 'uit'}
            </span>
          </p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Extra herkenners voor studentnummers, personeelsnummers, klas- en
            groepscodes, cursus- en CROHO-codes en namen direct achter
            mentor-/docent-/SLB-/examinator-labels. Zet uit voor gebruik buiten
            het hoger onderwijs.
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => onToggle(!enabled)}
          disabled={busy}
        >
          {enabled ? 'Uitschakelen' : 'Inschakelen'}
        </button>
      </div>
    </div>
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
  return (
    <div className="rounded-md border border-border/50 bg-background/60 p-2">
      <p className="text-[11px] font-medium">
        Lokaal LLM (Ollama){' '}
        {state.model ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-200">
            {state.model}
          </span>
        ) : (
          <span className="text-muted-foreground font-normal">— geen model gekozen</span>
        )}
      </p>
      {state.model ? (
        <>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[11px]">
            <RoleBadge
              label="Privacy-controle"
              on={state.reviewEnabled}
              hint="LLM controleert na anonimisering of er nog PII achterblijft. Klik om aan/uit te zetten."
              onToggle={
                reviewClickable
                  ? () => onToggleReview(!state.reviewEnabled)
                  : undefined
              }
              busy={reviewBusy}
            />
            <RoleBadge
              label="Extra-NER"
              on={state.extraNerEnabled}
              hint="LLM scant mee in stap 3 voor extra hits (vervolgronde)."
            />
            <RoleBadge
              label="Borderline"
              on={state.borderlineEnabled}
              hint="LLM oordeelt alleen over twijfelgevallen (vervolgronde)."
            />
          </div>
          {state.reviewEnabled && reviewClickable && (
            <p className="mt-1.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="inline h-3 w-3" aria-hidden /> Bij stap 4
              vraagt {state.model} een second-opinion na anonimisatie.
            </p>
          )}
          {state.daemonRunning ? (
            state.modelPresent ? null : (
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                <AlertTriangle className="inline h-3 w-3" aria-hidden />{' '}
                Model staat niet (meer) in <span className="font-mono">ollama list</span>.
                Pull hem opnieuw of kies een ander.
              </p>
            )
          ) : (
            <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="inline h-3 w-3" aria-hidden />{' '}
              Ollama-daemon draait niet. Start hem via het paneel hieronder.
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground/80">
          Open het paneel <span className="font-medium">Geavanceerd: Ollama</span>{' '}
          hieronder, download een model en druk op <span className="font-medium">Activeer</span>.
        </p>
      )}
    </div>
  );
}

function RoleBadge({
  label,
  on,
  hint,
  onToggle,
  busy,
}: {
  label: string;
  on: boolean;
  hint: string;
  onToggle?: () => void;
  busy?: boolean;
}): JSX.Element {
  const baseClass = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors ${
    on
      ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
      : 'border border-border/50 bg-muted/40 text-muted-foreground'
  }`;
  const Icon = busy ? Loader2 : on ? Power : PowerOff;
  const iconClass = busy ? 'h-3 w-3 animate-spin' : 'h-3 w-3';
  if (onToggle) {
    return (
      <button
        type="button"
        title={hint}
        onClick={onToggle}
        disabled={busy}
        className={`${baseClass} cursor-pointer hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60`}
      >
        <Icon className={iconClass} aria-hidden />
        {label}: {on ? 'aan' : 'uit'}
        <span className="sr-only">— klik om {on ? 'uit' : 'aan'} te zetten</span>
      </button>
    );
  }
  return (
    <span title={hint} className={baseClass}>
      <Icon className={iconClass} aria-hidden />
      {label}
      <span className="sr-only">{on ? ' aan' : ' uit'}</span>
    </span>
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
    <section className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Cpu className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">Deze computer</h3>
            <p className="text-[11px] text-muted-foreground">
              Snelle hardware-check zodat we kunnen waarschuwen als een model te zwaar is.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReload}
          className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" aria-hidden /> Vernieuwen
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-destructive">Kon systeeminfo niet ophalen: {error}</p>
      )}
      {!system && !error && (
        <p className="mt-2 text-[11px] text-muted-foreground">Detecteren…</p>
      )}
      {system && (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <SystemStat
            icon={<Cpu className="h-3 w-3" aria-hidden />}
            label="CPU"
            value={`${system.cpuModel} (${system.cpuCores} cores)`}
          />
          <SystemStat
            icon={<HardDrive className="h-3 w-3" aria-hidden />}
            label="RAM"
            value={`${gb(system.totalMemMb)} GB totaal · ${gb(system.freeMemMb)} GB vrij`}
          />
          <SystemStat
            icon={<Zap className="h-3 w-3" aria-hidden />}
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
                : 'Geen aparte GPU gevonden — CPU wordt gebruikt.'
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
    <div className="rounded-md border border-border/40 bg-background/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="font-medium">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-foreground" title={value}>
        {value}
      </div>
    </div>
  );
}

function FitLine({ fit }: { fit: FitVerdict }): JSX.Element {
  const cls =
    fit.level === 'too-large'
      ? 'text-destructive'
      : fit.level === 'tight'
      ? 'text-amber-700 dark:text-amber-400'
      : fit.level === 'fits'
      ? 'text-emerald-700 dark:text-emerald-400'
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

function SectionHeader({
  title,
  onReload,
}: {
  title: string;
  onReload: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">{title}</h3>
      <button
        type="button"
        onClick={onReload}
        className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <RefreshCw className="h-3 w-3" aria-hidden /> Vernieuwen
      </button>
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

  return (
    <li
      className={`rounded-lg border p-3 ${
        isActive
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : 'border-border/60 bg-card/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge installed={model.installed} task={task} />
            <p className="truncate text-sm font-medium">{model.label}</p>
            <span className="text-[11px] text-muted-foreground">
              · {model.kind === 'spacy' ? 'spaCy' : 'HuggingFace'} · ~{model.sizeMb} MB
            </span>
            {isActive && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Actief
              </span>
            )}
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
        <div className="flex flex-col items-stretch gap-1.5">
          {activate && model.installed && (
            <button
              type="button"
              onClick={activate.onClick}
              disabled={activate.disabled}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                isActive
                  ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  : 'border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
              }`}
              title={
                isActive
                  ? 'Dit model wordt op dit moment gebruikt.'
                  : 'Wissel direct over naar dit model.'
              }
            >
              {activate.busy ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : activate.icon === 'power' ? (
                <Power className="h-3 w-3" aria-hidden />
              ) : (
                <PowerOff className="h-3 w-3" aria-hidden />
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
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />;
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
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-2">
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
            className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
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
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-2">
        <p className="font-medium">Ollama is geïnstalleerd, maar de service draait niet.</p>
        <p className="opacity-80">CLI-pad: <span className="font-mono">{presence.cliPath}</span></p>
        <button
          type="button"
          onClick={onStart}
          disabled={actionBusy === 'start'}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
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
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-100">
      <p className="font-medium">
        <CheckCircle2 className="inline h-3.5 w-3.5" aria-hidden /> Ollama draait
        ({presence.cliPath ?? 'systeem-pad'}).
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
                className={`flex items-center justify-between gap-2 py-1.5 ${
                  isActive ? 'rounded px-1 ring-1 ring-emerald-500/40' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-xs">
                    {m.name}
                    {isActive && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-200">
                        Actief
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
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-50 ${
                      isActive
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                        : 'border-border/50 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-700'
                    }`}
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
                    {isActive ? 'Actief' : isEmbedding ? 'Niet bruikbaar' : 'Activeer'}
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
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
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
              className="flex items-start gap-3 rounded border border-border/50 bg-background/60 p-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium">
                  {role.label}
                  {!role.availableNow && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      (binnenkort)
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {role.description}
                </p>
                {role.disabledReason && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                    {role.disabledReason}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onToggleRole(role.key, !role.enabled)}
                disabled={hardDisabled}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] disabled:opacity-40 ${
                  role.enabled
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                    : 'border-border/50 text-muted-foreground hover:bg-muted'
                }`}
                title={
                  role.availableNow
                    ? role.enabled
                      ? 'Uitschakelen'
                      : 'Inschakelen'
                    : role.disabledReason ?? 'Nog niet beschikbaar'
                }
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : role.enabled ? (
                  <Power className="h-3 w-3" aria-hidden />
                ) : (
                  <PowerOff className="h-3 w-3" aria-hidden />
                )}
                {role.enabled ? 'Aan' : 'Uit'}
              </button>
            </li>
          );
        })}
      </ul>
      {!state.daemonRunning && (
        <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
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
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
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
                <p className="mt-1 text-emerald-700 dark:text-emerald-400">
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

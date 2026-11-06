/**
 * Gedeeld type-contract tussen preload-bridge en renderer.
 *
 * Alles wat via ``window.anonimiseer`` in de UI beschikbaar is staat
 * hier gedefinieerd, zodat zowel het preload-script als de React-code
 * dezelfde TypeScript-typing gebruiken.
 */

export interface VersionInfo {
  app: string;
  /** Installed app (starts its own engine) rather than a development build. */
  packaged: boolean;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
}

/**
 * Antwoord van `GET /health` op de pii-engine, aangevuld met extra velden
 * die we in het main-proces toevoegen zodat de renderer niet zelf hoeft
 * te interpreteren hoe "healthy" eruit ziet.
 */
export interface EngineHealthOk {
  status: 'ok';
  version: string;
  recognizers: number;
  spacyModel: string;
  url: string;
  /**
   * Why detection is weaker than configured, in plain Dutch (a model that
   * could not be loaded). Non-empty means the app shows "Beperkt".
   */
  limitations: string[];
}

export interface EngineHealthDown {
  status: 'down';
  reason: string;
  url: string;
  /** The app is still starting the engine; not reachable is expected then. */
  starting?: boolean;
}

export type EngineHealth = EngineHealthOk | EngineHealthDown;

export interface AnalyzeHit {
  entity_type: string;
  start: number;
  end: number;
  score: number;
  original: string;
}

export interface AnalyzeRequest {
  text: string;
  language?: string;
  entities?: string[];
  threshold: number;
}

export type AnalyzeResponse =
  | { ok: true; items: AnalyzeHit[] }
  | { ok: false; error: string };

export interface ActiveEngineModel {
  /** Registry-id, bv. ``spacy:nl_core_news_lg``. */
  id: string;
  label: string;
  kind: 'spacy' | 'hf';
  /** ``nlp`` = primaire spaCy-pipeline, ``ner`` = aanvullend NER-model. */
  role: 'nlp' | 'ner';
}

export interface ActiveOllamaState {
  /** Runtime-gekozen Ollama-tag, of ``null`` als er geen gekozen is. */
  model: string | null;
  /** Antwoordt de lokale daemon? */
  daemonRunning: boolean;
  /** Staat het gekozen model ook daadwerkelijk in ``ollama list``? */
  modelPresent: boolean;
  /** LLM-review na anonimisatie aan? */
  reviewEnabled: boolean;
  /** LLM-extra-NER-recognizer aan? (vervolgronde) */
  extraNerEnabled: boolean;
  /** LLM-borderline-rechter aan? (vervolgronde) */
  borderlineEnabled: boolean;
}

export interface ActiveEngineInfo {
  /** Welke spaCy-pipeline (config-naam, kan afwijken van wat geïnstalleerd is). */
  spacyModel: string;
  /** Of SoNaR-BERT echt geladen is in de huidige analyzer. */
  sonarEnabled: boolean;
  sonarModel: string | null;
  /** ``loading`` right after start; ``failed`` comes with a limitation. */
  sonarState: 'off' | 'loading' | 'loaded' | 'failed';
  /** Same, for the extra PII model. */
  piiModelState: 'off' | 'loading' | 'loaded' | 'failed';
  /** Active organisation profile as the engine knows it; empty when none was chosen. */
  profileName: string;
  customTerms: Array<ProfileTerm & { entityType: string }>;
  customTermsState: 'off' | 'loading' | 'loaded' | 'failed';
  /** See ``EngineHealthOk.limitations``. */
  limitations: string[];
  /** PyMuPDF is installed, so PDFs can be opened. It is a separate download. */
  pdfSupport: boolean;
  /** HAN-/onderwijsprofiel actief? Zet klas-, cursus-, CROHO-, medewerker-
   *  en mentor-/docent-recognizers aan. */
  hanEduEnabled: boolean;
  scoreThreshold: number;
  /** Klassennamen van alle aktieve recognizers (bv. ``BsnRecognizer``). */
  recognizers: string[];
  /** Voor de UI: welke registry-modellen tonen we als 'Actief'? */
  activeModels: ActiveEngineModel[];
  /** Runtime Ollama-status (model + drie rol-toggles). */
  ollama: ActiveOllamaState;
}

export type ActiveEngineResponse =
  | { ok: true; info: ActiveEngineInfo }
  | { ok: false; error: string };

export interface EngineConfigPatch {
  /** Pip-naam zonder ``spacy:``-prefix, bv. ``nl_core_news_md``. */
  spacyModel?: string;
  /** Schakel SoNaR-BERT in of uit. */
  enableSonar?: boolean;
  /** HF-repo voor SoNaR. */
  sonarModel?: string;
  /** Schakel HAN-/onderwijsprofiel aan/uit (klas, cursus, CROHO, medewerker,
   *  mentor-/docent-label). */
  enableHanEdu?: boolean;
  /** Schakel het extra PII-model in of uit (moet gedownload zijn). */
  enablePiiModel?: boolean;
  /** Naam van het actieve organisatieprofiel. */
  profileName?: string;
  /** Eigen begrippen van dat profiel; een lege lijst zet ze uit. */
  customTerms?: ProfileTerm[];
  /** Ollama-tag (bv. ``qwen3.5:4b``) voor alle LLM-rollen. */
  ollamaModel?: string;
  /** Schakel de LLM-review-laag aan/uit. */
  ollamaReviewEnabled?: boolean;
  /** Schakel de LLM-extra-NER aan/uit (vervolgronde). */
  ollamaExtraNerEnabled?: boolean;
  /** Schakel de LLM-borderline-rechter aan/uit (vervolgronde). */
  ollamaBorderlineEnabled?: boolean;
}

export interface ReviewFinding {
  snippet: string;
  category: string;
  explanation: string;
}

export type ReviewResponse =
  | {
      ok: true;
      model: string;
      verdict: 'clean' | 'suspect' | 'unknown';
      summary: string;
      findings: ReviewFinding[];
      rawResponse: string;
      evalDurationMs: number | null;
    }
  | { ok: false; error: string };

export interface EngineApi {
  /** Pollt de engine en geeft het resultaat terug. Crasht nooit. */
  health(): Promise<EngineHealth>;
  /** Default URL waar we naar kijken (voor foutmeldingen/help). */
  url(): Promise<string>;
  /** Voert een analyse uit. Crasht nooit; foutstatus zit in het resultaat. */
  analyze(req: AnalyzeRequest): Promise<AnalyzeResponse>;
  /** Welke modellen zitten *nu* in de detectie-pipeline? */
  active(): Promise<ActiveEngineResponse>;
  /** Wissel runtime van actief spaCy-model en/of SoNaR aan/uit. */
  setConfig(patch: EngineConfigPatch): Promise<ActiveEngineResponse>;
  /** Verwijder runtime-overrides; val terug op env/defaults. */
  resetConfig(): Promise<ActiveEngineResponse>;
  /** Vraag een lokaal Ollama-model om het geanonimiseerde resultaat te controleren. */
  review(text: string, modelOverride?: string): Promise<ReviewResponse>;
}

export interface AppSettings {
  schemaVersion: 1;
  onboardingCompletedAt: string | null;
  acceptedResponsibility: boolean;
}

export interface SettingsApi {
  get(): Promise<AppSettings>;
  set(patch: Partial<AppSettings>): Promise<AppSettings>;
  reset(): Promise<AppSettings>;
}

export interface DialogFileInfo {
  path: string;
  name: string;
  /** Lowercase, inclusief de punt: ".md", ".pdf", … */
  extension: string;
  /** Grootte in bytes. */
  size: number;
}

export interface DialogApi {
  /** Opent het native open-file-dialog (multi-select). Leeg = geannuleerd. */
  openFiles(): Promise<DialogFileInfo[]>;
  /** Stat bestaande paden; onleesbare/niet-bestaande paden vallen eruit. */
  statFiles(paths: string[]): Promise<DialogFileInfo[]>;
  /** Pad van een via drag-drop meegegeven File (gebruikt Electron's webUtils). */
  getPathForFile(file: File): string;
}

export type ReadTextResponse =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface FileApi {
  /** Leest een .md/.txt bestand als UTF-8. Crasht nooit. */
  readText(path: string): Promise<ReadTextResponse>;
}

export interface DocumentBlock {
  id: string;
  kind: string;
  start: number;
  end: number;
}

export type DocumentExtractResponse =
  | { ok: true; flatText: string; blocks: DocumentBlock[] }
  | { ok: false; error: string };

export interface DocumentReplacement {
  start: number;
  end: number;
  replacement: string;
  /** Voor PDF verplicht; voor DOCX/XLSX optioneel. */
  original?: string;
}

export interface DocumentApplyRequest {
  sourcePath: string;
  blocks: DocumentBlock[];
  replacements: DocumentReplacement[];
  outputPath: string;
  /** Optionele watermerk-tekst die in het document terechtkomt. */
  footerNote?: string;
}

export type DocumentApplyResponse =
  | {
      ok: true;
      outputPath: string;
      bytesWritten: number;
      /**
       * Accepted replacements whose text is still in the output, as counted
       * by the engine. Above zero, the file still holds personal data.
       */
      unreplaced: number;
    }
  | { ok: false; error: string };

export interface ModelInfo {
  id: string;
  label: string;
  kind: 'spacy' | 'hf' | 'component';
  description: string;
  sizeMb: number;
  installTarget: string;
  installed: boolean;
  localPath: string | null;
  minRamMb: number;
  gpuRecommended: boolean;
  /** Licentie van de modelgewichten, kort en leesbaar. */
  license: string;
  /** Waar die licentie te vinden is; leeg als er geen bron bekend is. */
  licenseUrl: string;
  /**
   * What the model does: the spaCy pipeline (``nlp``), an extra NER layer
   * (``ner``, SoNaR), an extra PII model (``pii``), the organisation's own
   * terms (``custom-terms``), a foundation without NER head (``base``), or a
   * program part such as PDF support (``component``).
   */
  role: ModelRole;
  /** Shown before the download, which starts only once the user confirms it. */
  notice: string;
}

export type ModelRole = 'nlp' | 'ner' | 'pii' | 'custom-terms' | 'base' | 'component';

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemMb: number;
  freeMemMb: number;
  /**
   * Best-effort GPU-detectie. Op macOS via ``system_profiler``, op
   * Linux via ``nvidia-smi`` indien aanwezig, op Windows via WMI.
   * ``null`` als we geen discrete GPU konden vinden — dan wordt
   * standaard CPU/iGPU gebruikt.
   */
  gpu: {
    name: string;
    vramMb: number | null;
    /** ``apple-silicon`` deelt geheugen met de CPU (unified memory). */
    kind: 'discrete' | 'integrated' | 'apple-silicon' | 'unknown';
  } | null;
}

export type LicensesResponse = { ok: true; text: string } | { ok: false; error: string };

export interface SystemApi {
  info(): Promise<SystemInfo>;
  /** Third-party overview plus full licence texts, generated at build time. */
  licenses(): Promise<LicensesResponse>;
}

export type ModelListResponse =
  | { ok: true; models: ModelInfo[] }
  | { ok: false; error: string };

export type ModelTaskState = 'pending' | 'running' | 'done' | 'error';

export interface ModelTask {
  taskId: string;
  descriptorId: string;
  state: ModelTaskState;
  progress: number;
  message: string;
  startedAt: number;
  finishedAt: number | null;
}

export type ModelTaskResponse =
  | { ok: true; task: ModelTask }
  | { ok: false; error: string };

export interface OllamaCatalogEntry {
  /** ``ollama pull <name>`` doelnaam, bv. ``qwen3.5:4b``. */
  name: string;
  /** Mens-leesbare titel voor in de UI. */
  label: string;
  /** Korte uitleg in lekentaal — wordt onder de dropdown getoond. */
  description: string;
  /** Geschatte download- en schijfgrootte in MB. */
  sizeMb: number;
  /** Aanbevolen minimum-RAM in MB voor comfortabele inference. */
  minRamMb: number;
  /** ``true`` voor een sweet-spot model in zijn RAM-klasse. */
  recommended?: boolean;
}

export interface OllamaCatalog {
  schemaVersion: 1;
  /** Datum-string, bv. ``2026-04-17``. Wordt gebruikt om bundled vs cache te vergelijken. */
  version: string;
  /** Vrije toelichting (alleen voor mens, niet machine-leesbaar). */
  notes?: string;
  models: OllamaCatalogEntry[];
}

export type OllamaCatalogResponse =
  | {
      ok: true;
      catalog: OllamaCatalog;
      /** Welke laag de actuele catalog levert. */
      source: 'cache' | 'bundled';
      /** ``mtime`` van het cache-bestand wanneer ``source === 'cache'``; anders ``null``. */
      updatedAt: number | null;
      remoteUrl: string | null;
    }
  | {
      ok: false;
      error: string;
      remoteUrl: string | null;
    };

export interface CatalogApi {
  ollama: {
    get(): Promise<OllamaCatalogResponse>;
    refresh(): Promise<OllamaCatalogResponse>;
  };
}

export interface OllamaPresence {
  /** ``true`` als de ollama-CLI op deze computer staat. */
  installed: boolean;
  /** Pad naar de gevonden CLI; ``null`` als nergens gevonden. */
  cliPath: string | null;
  /** Antwoordt de daemon op localhost:11434? */
  daemonRunning: boolean;
  /** Officiële downloadpagina (geopend in standaardbrowser). */
  downloadUrl: string;
}

export interface OllamaApi {
  /** Pingt http://localhost:11434/api/tags. */
  status(): Promise<{ ok: true; models: Array<{ name: string; size: number }> } | { ok: false; error: string }>;
  /** Start een ollama pull <name>. Streamt ruwe statusregels niet, maar polled is genoeg. */
  pull(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Verwijder een lokaal Ollama-model via DELETE /api/delete. */
  remove(name: string): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Detecteert of de CLI ergens staat én of de daemon draait. */
  detect(): Promise<OllamaPresence>;
  /** Open de officiële downloadpagina in de standaard browser. */
  openInstaller(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Probeer de daemon te starten als de CLI aanwezig is. */
  start(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface ModelsApi {
  list(): Promise<ModelListResponse>;
  install(descriptorId: string): Promise<ModelTaskResponse>;
  task(taskId: string): Promise<ModelTaskResponse>;
  ollama: OllamaApi;
}

export interface DocumentApi {
  /** Extract flat-text + blocks via engine; leest het bronbestand zelf. */
  extract(path: string): Promise<DocumentExtractResponse>;
}

export interface RunMappingEntry {
  entity_type: string;
  original: string;
  pseudonym: string;
}

export interface RunFileStats {
  totalHits: number;
  accepted: number;
  skipped: number;
}

/**
 * Tekstbestand (.md/.txt) — de renderer heeft de volledige
 * geanonimiseerde tekst al client-side gebouwd en stuurt die op.
 */
export interface RunTextFileInput {
  kind: 'text';
  sourcePath: string;
  sourceName: string;
  stem: string;
  extension: string;
  anonymizedText: string;
  stats: RunFileStats;
}

/**
 * Document (.docx/.xlsx/.pdf) — het main-proces stuurt het originele
 * bestand + deze vervangingen naar ``/document/apply`` en schrijft de
 * response bytes weg. Dat houdt opmaak zoveel mogelijk intact.
 */
export interface RunDocumentFileInput {
  kind: 'document';
  sourcePath: string;
  sourceName: string;
  stem: string;
  extension: string;
  blocks: DocumentBlock[];
  replacements: DocumentReplacement[];
  stats: RunFileStats;
}

export type RunFileInput = RunTextFileInput | RunDocumentFileInput;

export interface RunSkippedFile {
  sourcePath: string;
  sourceName: string;
  extension: string;
  reason: string;
}

export interface RunAuditContext {
  mode: 'pseudonymize' | 'anonymize';
  sensitivity: string;
  entities: string[];
  threshold: number;
  whitelist: string[];
  /** Models the engine really had loaded when the run was saved. */
  models: string[];
  /** See ``EngineHealthOk.limitations``; recorded so the audit shows them. */
  limitations: string[];
  startedAt: string;
}

export interface RunPayload {
  outputParent: string;
  context: RunAuditContext;
  files: RunFileInput[];
  skipped: RunSkippedFile[];
  /** Alleen gevuld bij mode='pseudonymize'. */
  mapping: RunMappingEntry[];
}

export interface RunResultFile {
  sourceName: string;
  outputPath: string | null;
  status: 'written' | 'skipped' | 'error';
  error?: string;
  /** See ``DocumentApplyResponse.unreplaced``; absent for plain text. */
  unreplaced?: number;
}

export type MappingSaveStatus =
  | { status: 'saved'; path: string }
  | { status: 'skipped-no-encryption'; reason: string }
  | { status: 'not-applicable' }
  | { status: 'error'; error: string };

export type WriteRunResponse =
  | {
      ok: true;
      runDir: string;
      files: RunResultFile[];
      disclaimerPath: string;
      auditPath: string;
      mapping: MappingSaveStatus;
    }
  | { ok: false; error: string };

export interface OutputApi {
  /** Opent folder-dialog; null = geannuleerd. */
  pickFolder(): Promise<string | null>;
  /** Kijk of de OS-keychain beschikbaar is (voor mapping-versleuteling). */
  encryptionAvailable(): Promise<boolean>;
  /** Schrijf een volledige run weg. */
  writeRun(payload: RunPayload): Promise<WriteRunResponse>;
  /** Open een map in Finder/Explorer. */
  revealPath(path: string): Promise<void>;
}

/**
 * The mapping stays in the main process; the renderer only learns how many
 * entries it has. ``verified`` is false for files from Anonimiseer 0.1, which
 * cannot be checked for changes.
 */
export type RestoreMappingResponse =
  | { ok: true; entries: number; createdAt: string | null; verified: boolean }
  | { ok: false; error: string };

export interface RestoreSourceFile {
  path: string;
  name: string;
}

export interface RestoreResultFile {
  sourceName: string;
  outputPath: string | null;
  /** Pseudonyms put back. */
  restored: number;
  /** Pseudonyms not in this mapping, usually from another run. */
  unknown: number;
  error?: string;
}

export type RestoreRunResponse =
  | { ok: true; runDir: string; files: RestoreResultFile[] }
  | { ok: false; error: string };

export interface RestoreApi {
  /** Pick and open a mapping.bin; ``null`` when the dialog was cancelled. */
  openMapping(): Promise<RestoreMappingResponse | null>;
  /** Pick pseudonymised files (.md, .txt, .docx, .xlsx). */
  pickFiles(): Promise<RestoreSourceFile[]>;
  /** Restore with the open mapping into a new folder inside ``outputParent``. */
  run(req: { files: string[]; outputParent: string }): Promise<RestoreRunResponse>;
}

export interface ProfileTerm {
  label: string;
  description: string;
}

/**
 * An organisation profile: the HAN education recognizers on or off, and the
 * organisation's own terms. Two are built in; others are imported from a file
 * the organisation provides and kept in the app's folder.
 */
export interface OrgProfile {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  hanEdu: boolean;
  terms: ProfileTerm[];
}

export type ProfileImportResponse =
  | { ok: true; profile: OrgProfile }
  | { ok: false; error: string };

export interface ProfilesApi {
  list(): Promise<OrgProfile[]>;
  /** Pick a profile file; ``null`` when the dialog was cancelled. */
  import(): Promise<ProfileImportResponse | null>;
  /** Remove an imported profile; built-in ones stay. */
  remove(id: string): Promise<OrgProfile[]>;
}

export interface AnonimiseerApi {
  version: VersionInfo;
  engine: EngineApi;
  settings: SettingsApi;
  dialog: DialogApi;
  file: FileApi;
  output: OutputApi;
  document: DocumentApi;
  models: ModelsApi;
  system: SystemApi;
  catalog: CatalogApi;
  restore: RestoreApi;
  profiles: ProfilesApi;
}

declare global {
  interface Window {
    anonimiseer: AnonimiseerApi;
  }
}

export {};

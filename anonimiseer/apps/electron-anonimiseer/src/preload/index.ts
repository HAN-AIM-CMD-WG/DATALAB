/**
 * Preload-bridge.
 *
 * Dit is de enige plek waar main-proces capabilities naar de renderer
 * exposed worden. We volgen strikt het principe van "kleinst mogelijke
 * oppervlakte": alleen wat de UI nu écht nodig heeft.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  ActiveEngineResponse,
  AnalyzeRequest,
  AnalyzeResponse,
  AnonimiseerApi,
  AppSettings,
  DialogFileInfo,
  DocumentApplyRequest,
  DocumentApplyResponse,
  DocumentExtractResponse,
  EngineConfigPatch,
  EngineHealth,
  ModelListResponse,
  ModelTaskResponse,
  OllamaCatalogResponse,
  OllamaPresence,
  ReadTextResponse,
  ReviewResponse,
  RunPayload,
  SystemInfo,
  WriteRunResponse,
} from '@shared/api';

const api: AnonimiseerApi = {
  version: {
    app: process.env.npm_package_version ?? '0.1.0',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  },
  engine: {
    health: (): Promise<EngineHealth> =>
      ipcRenderer.invoke('engine:health') as Promise<EngineHealth>,
    url: (): Promise<string> =>
      ipcRenderer.invoke('engine:url') as Promise<string>,
    analyze: (req: AnalyzeRequest): Promise<AnalyzeResponse> =>
      ipcRenderer.invoke('engine:analyze', req) as Promise<AnalyzeResponse>,
    active: (): Promise<ActiveEngineResponse> =>
      ipcRenderer.invoke('engine:active') as Promise<ActiveEngineResponse>,
    setConfig: (patch: EngineConfigPatch): Promise<ActiveEngineResponse> =>
      ipcRenderer.invoke('engine:setConfig', patch) as Promise<ActiveEngineResponse>,
    resetConfig: (): Promise<ActiveEngineResponse> =>
      ipcRenderer.invoke('engine:resetConfig') as Promise<ActiveEngineResponse>,
    review: (text: string, modelOverride?: string): Promise<ReviewResponse> =>
      ipcRenderer.invoke('engine:review', text, modelOverride) as Promise<ReviewResponse>,
  },
  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:get') as Promise<AppSettings>,
    set: (patch): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:set', patch) as Promise<AppSettings>,
    reset: (): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:reset') as Promise<AppSettings>,
  },
  dialog: {
    openFiles: (): Promise<DialogFileInfo[]> =>
      ipcRenderer.invoke('dialog:openFiles') as Promise<DialogFileInfo[]>,
    statFiles: (paths): Promise<DialogFileInfo[]> =>
      ipcRenderer.invoke('dialog:statFiles', paths) as Promise<DialogFileInfo[]>,
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
  file: {
    readText: (path: string): Promise<ReadTextResponse> =>
      ipcRenderer.invoke('file:readText', path) as Promise<ReadTextResponse>,
  },
  output: {
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('output:pickFolder') as Promise<string | null>,
    encryptionAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke('output:encryptionAvailable') as Promise<boolean>,
    writeRun: (payload: RunPayload): Promise<WriteRunResponse> =>
      ipcRenderer.invoke('output:writeRun', payload) as Promise<WriteRunResponse>,
    revealPath: (path: string): Promise<void> =>
      ipcRenderer.invoke('output:revealPath', path) as Promise<void>,
  },
  document: {
    extract: (path: string): Promise<DocumentExtractResponse> =>
      ipcRenderer.invoke('document:extract', path) as Promise<DocumentExtractResponse>,
    apply: (req: DocumentApplyRequest): Promise<DocumentApplyResponse> =>
      ipcRenderer.invoke('document:apply', req) as Promise<DocumentApplyResponse>,
  },
  models: {
    list: (): Promise<ModelListResponse> =>
      ipcRenderer.invoke('models:list') as Promise<ModelListResponse>,
    install: (descriptorId: string): Promise<ModelTaskResponse> =>
      ipcRenderer.invoke('models:install', descriptorId) as Promise<ModelTaskResponse>,
    task: (taskId: string): Promise<ModelTaskResponse> =>
      ipcRenderer.invoke('models:task', taskId) as Promise<ModelTaskResponse>,
    ollama: {
      status: () =>
        ipcRenderer.invoke('ollama:status') as Promise<
          | { ok: true; models: Array<{ name: string; size: number }> }
          | { ok: false; error: string }
        >,
      pull: (name: string) =>
        ipcRenderer.invoke('ollama:pull', name) as Promise<
          { ok: true } | { ok: false; error: string }
        >,
      remove: (name: string) =>
        ipcRenderer.invoke('ollama:remove', name) as Promise<
          { ok: true } | { ok: false; error: string }
        >,
      detect: (): Promise<OllamaPresence> =>
        ipcRenderer.invoke('ollama:detect') as Promise<OllamaPresence>,
      openInstaller: () =>
        ipcRenderer.invoke('ollama:openInstaller') as Promise<
          { ok: true } | { ok: false; error: string }
        >,
      start: () =>
        ipcRenderer.invoke('ollama:start') as Promise<
          { ok: true } | { ok: false; error: string }
        >,
    },
  },
  system: {
    info: (): Promise<SystemInfo> =>
      ipcRenderer.invoke('system:info') as Promise<SystemInfo>,
  },
  catalog: {
    ollama: {
      get: (): Promise<OllamaCatalogResponse> =>
        ipcRenderer.invoke('catalog:ollama:get') as Promise<OllamaCatalogResponse>,
      refresh: (): Promise<OllamaCatalogResponse> =>
        ipcRenderer.invoke('catalog:ollama:refresh') as Promise<OllamaCatalogResponse>,
    },
  },
};

contextBridge.exposeInMainWorld('anonimiseer', api);

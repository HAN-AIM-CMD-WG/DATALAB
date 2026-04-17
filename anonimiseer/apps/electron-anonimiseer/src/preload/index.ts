/**
 * Preload-bridge.
 *
 * Dit is de enige plek waar main-proces capabilities naar de renderer
 * exposed worden. We volgen strikt het principe van "kleinst mogelijke
 * oppervlakte": alleen wat de UI nu écht nodig heeft.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AnonimiseerApi,
  AppSettings,
  DialogFileInfo,
  EngineHealth,
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
};

contextBridge.exposeInMainWorld('anonimiseer', api);

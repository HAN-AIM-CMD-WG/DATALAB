/**
 * Organisation profiles: whether the HAN education recognizers run, and which
 * own terms the engine looks for.
 *
 * Two profiles are built in. Others come from a JSON file the organisation
 * provides (see docs/profielen.md); an imported profile is kept in the app's
 * own folder, never in this repository. Activating one is a plain engine
 * config change, done from the Model Manager; the engine keeps the active
 * profile across restarts.
 */

import { BrowserWindow, app, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { OrgProfile, ProfileImportResponse } from '@shared/api';
import { BUILT_IN, ProfileError, parseProfile, toFile } from './profileFormat';
import { atomicWrite } from './safeWrite';

const MAX_FILE_BYTES = 100 * 1024;

function profilesDir(): string {
  return join(app.getPath('userData'), 'profiles');
}

async function listProfiles(): Promise<OrgProfile[]> {
  const imported: OrgProfile[] = [];
  let names: string[] = [];
  try {
    names = await fs.readdir(profilesDir());
  } catch {
    names = [];
  }
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      imported.push(parseProfile(JSON.parse(await fs.readFile(join(profilesDir(), name), 'utf8'))));
    } catch (error) {
      console.warn('[profiles] overgeslagen:', name, error);
    }
  }
  return [...BUILT_IN, ...imported];
}

async function importProfile(event: IpcMainInvokeEvent): Promise<ProfileImportResponse | null> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const opts: Electron.OpenDialogOptions = {
    title: 'Kies een profielbestand van je organisatie',
    properties: ['openFile'],
    filters: [{ name: 'Profiel (JSON)', extensions: ['json'] }],
  };
  const result = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts);
  const [path] = result.canceled ? [] : result.filePaths;
  if (!path) return null;
  try {
    const stat = await fs.stat(path);
    if (stat.size > MAX_FILE_BYTES) throw new ProfileError('Dit bestand is te groot voor een profiel.');
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(path, 'utf8'));
    } catch {
      throw new ProfileError('Dit bestand is geen geldige JSON.');
    }
    const profile = parseProfile(raw);
    await fs.mkdir(profilesDir(), { recursive: true, mode: 0o700 });
    await atomicWrite(join(profilesDir(), `${profile.id}.json`), toFile(profile));
    return { ok: true, profile };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ProfileError ? error.message : 'Het profiel kon niet worden geladen.',
    };
  }
}

async function removeProfile(id: unknown): Promise<OrgProfile[]> {
  const profiles = await listProfiles();
  const target = profiles.find((p) => p.id === id && !p.builtIn);
  if (target) await fs.unlink(join(profilesDir(), `${target.id}.json`)).catch(() => undefined);
  return listProfiles();
}

export function registerProfilesBridge(): void {
  ipcMain.handle('profiles:list', () => listProfiles());
  ipcMain.handle('profiles:import', (event) => importProfile(event));
  ipcMain.handle('profiles:remove', (_event, id: unknown) => removeProfile(id));
}

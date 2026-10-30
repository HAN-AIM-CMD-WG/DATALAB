/**
 * Putting pseudonyms back with the mapping of an earlier run.
 *
 * The decrypted mapping stays in this process; the renderer only learns how
 * many entries it has. The engine does the replacing, so text files and
 * documents follow the same rule. The result holds personal data again, so it
 * is written like any other output: into a new private folder inside a folder
 * the user picked, every file 0600. Only files the user picked in the dialog
 * are read.
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type {
  RestoreMappingResponse,
  RestoreResultFile,
  RestoreRunResponse,
  RestoreSourceFile,
  RunMappingEntry,
} from '@shared/api';
import { engineHeaders, engineUrl } from './engineEndpoint';
import { MappingError, openMapping } from './mappingStore';
import { createRunDir, isPickedFolder } from './outputBridge';
import { atomicWrite } from './safeWrite';

const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const TEXT_EXTENSIONS = new Set(['.md', '.txt']);
const DOCUMENT_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

let mapping: RunMappingEntry[] | null = null;
const pickedFiles = new Set<string>();

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

async function showOpen(
  event: IpcMainInvokeEvent,
  opts: Electron.OpenDialogOptions
): Promise<string[]> {
  const window = parentWindow(event);
  const result = window ? await dialog.showOpenDialog(window, opts) : await dialog.showOpenDialog(opts);
  return result.canceled ? [] : result.filePaths;
}

function parseEntries(raw: unknown): RunMappingEntry[] {
  if (!Array.isArray(raw)) throw new MappingError('Deze mapping bevat geen vervangingen.');
  return raw.filter(
    (e): e is RunMappingEntry =>
      Boolean(e) &&
      typeof e === 'object' &&
      typeof (e as RunMappingEntry).entity_type === 'string' &&
      typeof (e as RunMappingEntry).original === 'string' &&
      typeof (e as RunMappingEntry).pseudonym === 'string'
  );
}

async function openMappingFile(event: IpcMainInvokeEvent): Promise<RestoreMappingResponse | null> {
  const [path] = await showOpen(event, {
    title: 'Kies de mapping.bin van de run',
    properties: ['openFile'],
    filters: [{ name: 'Mapping van Anonimiseer', extensions: ['bin'] }],
  });
  if (!path) return null;
  mapping = null;
  try {
    const stat = await fs.stat(path);
    if (stat.size > MAX_BYTES) throw new MappingError('Dit bestand is te groot voor een mapping.');
    const { json, verified } = await openMapping(await fs.readFile(path));
    const parsed = JSON.parse(json) as { createdAt?: unknown; entries?: unknown };
    const entries = parseEntries(parsed.entries);
    mapping = entries;
    return {
      ok: true,
      entries: entries.length,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
      verified,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof MappingError
          ? error.message
          : 'Dit bestand is geen mapping van Anonimiseer.',
    };
  }
}

async function pickFiles(event: IpcMainInvokeEvent): Promise<RestoreSourceFile[]> {
  const paths = await showOpen(event, {
    title: 'Kies gepseudonimiseerde bestanden',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Tekst, Word en Excel', extensions: ['md', 'txt', 'docx', 'xlsx'] }],
  });
  for (const path of paths) pickedFiles.add(path);
  return paths.map((path) => ({ path, name: basename(path) }));
}

async function engineError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === 'string' ? body.detail : `engine HTTP ${response.status}`;
  return new Error(detail);
}

async function restoreText(
  text: string,
  entries: RunMappingEntry[]
): Promise<{ data: string; restored: number; unknown: number }> {
  const response = await fetch(`${engineUrl()}/restore/text`, {
    method: 'POST',
    headers: engineHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ text, mapping: entries }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw await engineError(response);
  const body = (await response.json()) as { text: string; restored: number; unknown: number };
  return { data: body.text, restored: body.restored, unknown: body.unknown };
}

async function restoreDocument(
  name: string,
  ext: string,
  data: Buffer,
  entries: RunMappingEntry[]
): Promise<{ data: Buffer; restored: number; unknown: number }> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(data)], { type: DOCUMENT_MIME[ext] ?? 'application/octet-stream' }),
    name
  );
  form.append('payload', JSON.stringify({ mapping: entries }));
  const response = await fetch(`${engineUrl()}/document/restore`, {
    method: 'POST',
    headers: engineHeaders(),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw await engineError(response);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    restored: Number.parseInt(response.headers.get('x-anonimiseer-restored') ?? '0', 10),
    unknown: Number.parseInt(response.headers.get('x-anonimiseer-unknown') ?? '0', 10),
  };
}

/** ``intake.anon.docx`` becomes ``intake.teruggezet.docx``. */
function outputName(name: string, ext: string): string {
  const stem = name.slice(0, name.length - ext.length).replace(/\.anon$/, '');
  return `${stem}.teruggezet${ext}`;
}

async function run(req: { files?: unknown; outputParent?: unknown }): Promise<RestoreRunResponse> {
  const entries = mapping;
  if (entries === null) return { ok: false, error: 'Kies eerst een mapping.' };
  const files = req?.files;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((f) => typeof f !== 'string' || !pickedFiles.has(f))
  ) {
    return { ok: false, error: 'Kies de bestanden opnieuw via "Kies bestanden".' };
  }
  if (typeof req.outputParent !== 'string' || !isPickedFolder(req.outputParent)) {
    return { ok: false, error: 'Kies de doelmap opnieuw via "Kies map".' };
  }

  let runDir: string;
  try {
    runDir = await createRunDir(req.outputParent, 'teruggezet-');
  } catch (error) {
    return {
      ok: false,
      error: `kan map niet aanmaken: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }

  const results: RestoreResultFile[] = [];
  for (const path of files as string[]) {
    const name = basename(path);
    const ext = extname(name).toLowerCase();
    try {
      const stat = await fs.stat(path);
      if (stat.size > MAX_BYTES) throw new Error(`bestand is te groot (${stat.size} bytes)`);
      const data = await fs.readFile(path);
      const restored = TEXT_EXTENSIONS.has(ext)
        ? await restoreText(data.toString('utf8'), entries)
        : await restoreDocument(name, ext, data, entries);
      const outputPath = join(runDir, outputName(name, ext));
      await atomicWrite(outputPath, restored.data);
      results.push({
        sourceName: name,
        outputPath,
        restored: restored.restored,
        unknown: restored.unknown,
      });
    } catch (error) {
      results.push({
        sourceName: name,
        outputPath: null,
        restored: 0,
        unknown: 0,
        error: error instanceof Error ? error.message : 'onbekende fout',
      });
    }
  }
  return { ok: true, runDir, files: results };
}

export function registerRestoreBridge(): void {
  ipcMain.handle('restore:openMapping', (event) => openMappingFile(event));
  ipcMain.handle('restore:pickFiles', (event) => pickFiles(event));
  ipcMain.handle('restore:run', (_event, req: { files?: unknown; outputParent?: unknown }) =>
    run(req)
  );
}

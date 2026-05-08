/**
 * IPC-bridge voor Model Manager.
 *
 * De engine doet de zware downloads (spaCy/HuggingFace) zodat de
 * Electron-app niet zelf een Python-omgeving hoeft te kennen. Voor
 * Ollama spreken we direct met de lokale daemon op poort 11434 — dat
 * is een ander proces en heeft niets met de pii-engine te maken.
 */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ipcMain, shell } from 'electron';
import type {
  ModelInfo,
  ModelListResponse,
  ModelTask,
  ModelTaskResponse,
  OllamaPresence,
} from '@shared/api';

const execAsync = promisify(exec);

/**
 * Bekende install-paden per platform — handig om de CLI te vinden
 * ook al staat ``ollama`` niet op ``$PATH`` van het Electron-proces
 * (dat gebeurt vaak op macOS bij apps die niet uit Terminal starten).
 */
const OLLAMA_KNOWN_PATHS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama'],
  linux: ['/usr/local/bin/ollama', '/usr/bin/ollama'],
  win32: [
    'C:\\Program Files\\Ollama\\ollama.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Programs\\Ollama\\ollama.exe`,
  ],
};

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

const ENGINE_URL =
  process.env.ANONIMISEER_ENGINE_URL ?? 'http://127.0.0.1:8765';
const OLLAMA_URL =
  process.env.ANONIMISEER_OLLAMA_URL ?? 'http://127.0.0.1:11434';

interface RawTask {
  task_id: string;
  descriptor_id: string;
  state: ModelTask['state'];
  progress: number;
  message: string;
  started_at: number;
  finished_at: number | null;
}

function mapTask(raw: RawTask): ModelTask {
  return {
    taskId: raw.task_id,
    descriptorId: raw.descriptor_id,
    state: raw.state,
    progress: raw.progress,
    message: raw.message,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
  };
}

async function listModels(): Promise<ModelListResponse> {
  try {
    const res = await fetch(`${ENGINE_URL}/models`);
    if (!res.ok) {
      return { ok: false, error: `engine ${res.status}` };
    }
    const json = (await res.json()) as {
      models: Array<{
        id: string;
        label: string;
        kind: 'spacy' | 'hf';
        description: string;
        size_mb: number;
        install_target: string;
        installed: boolean;
        local_path: string | null;
        min_ram_mb?: number;
        gpu_recommended?: boolean;
      }>;
    };
    const models: ModelInfo[] = json.models.map((m) => ({
      id: m.id,
      label: m.label,
      kind: m.kind,
      description: m.description,
      sizeMb: m.size_mb,
      installTarget: m.install_target,
      installed: m.installed,
      localPath: m.local_path,
      minRamMb: m.min_ram_mb ?? 0,
      gpuRecommended: m.gpu_recommended ?? false,
    }));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function installModel(descriptorId: unknown): Promise<ModelTaskResponse> {
  if (typeof descriptorId !== 'string' || !descriptorId) {
    return { ok: false, error: 'descriptorId verplicht' };
  }
  try {
    const res = await fetch(`${ENGINE_URL}/models/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ descriptor_id: descriptorId }),
    });
    if (!res.ok) {
      return { ok: false, error: `engine ${res.status}` };
    }
    const raw = (await res.json()) as RawTask;
    return { ok: true, task: mapTask(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchTask(taskId: unknown): Promise<ModelTaskResponse> {
  if (typeof taskId !== 'string' || !taskId) {
    return { ok: false, error: 'taskId verplicht' };
  }
  try {
    const res = await fetch(`${ENGINE_URL}/models/tasks/${encodeURIComponent(taskId)}`);
    if (!res.ok) {
      return { ok: false, error: `engine ${res.status}` };
    }
    const raw = (await res.json()) as RawTask;
    return { ok: true, task: mapTask(raw) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function ollamaStatus(): Promise<
  | { ok: true; models: Array<{ name: string; size: number }> }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) {
      return { ok: false, error: `ollama ${res.status}` };
    }
    const json = (await res.json()) as {
      models?: Array<{ name: string; size: number }>;
    };
    return { ok: true, models: json.models ?? [] };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Ollama is niet bereikbaar op localhost:11434',
    };
  }
}

async function ollamaDetect(): Promise<OllamaPresence> {
  const fs = await import('node:fs/promises');
  const candidates = OLLAMA_KNOWN_PATHS[process.platform] ?? [];
  let cliPath: string | null = null;

  // 1. Probeer ``which``/``where`` zodat we de live $PATH respecteren.
  try {
    const cmd = process.platform === 'win32' ? 'where ollama' : 'command -v ollama';
    const { stdout } = await execAsync(cmd, { timeout: 2000 });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) cliPath = first;
  } catch {
    /* niet op PATH; we kijken bij known paths */
  }

  // 2. Fallback: bekende install-paden controleren.
  if (!cliPath) {
    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        cliPath = candidate;
        break;
      } catch {
        /* bestaat niet */
      }
    }
  }

  // 3. Daemon-check: kunnen we praten met /api/tags?
  let daemonRunning = false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    daemonRunning = res.ok;
  } catch {
    daemonRunning = false;
  }

  return {
    installed: cliPath !== null,
    cliPath,
    daemonRunning,
    downloadUrl: OLLAMA_DOWNLOAD_URL,
  };
}

async function ollamaOpenInstaller(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await shell.openExternal(OLLAMA_DOWNLOAD_URL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function ollamaStart(): Promise<{ ok: true } | { ok: false; error: string }> {
  const presence = await ollamaDetect();
  if (presence.daemonRunning) return { ok: true };
  if (!presence.installed) {
    return { ok: false, error: 'Ollama is niet geïnstalleerd op deze computer.' };
  }

  try {
    if (process.platform === 'darwin') {
      // Voorkeur: open de .app — die zet zelf de daemon op en plaatst
      // het tray-icoon. Valt anders terug op direct ``ollama serve``.
      try {
        spawn('open', ['-a', 'Ollama'], { detached: true, stdio: 'ignore' }).unref();
      } catch {
        spawn(presence.cliPath!, ['serve'], { detached: true, stdio: 'ignore' }).unref();
      }
    } else if (process.platform === 'win32') {
      spawn(presence.cliPath!, ['serve'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // Linux: ``ollama serve`` als losse achtergrondproces.
      spawn(presence.cliPath!, ['serve'], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Geef de daemon ~5s om op te komen.
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(800) });
      if (res.ok) return { ok: true };
    } catch {
      /* nog niet klaar */
    }
  }
  return { ok: false, error: 'Ollama-daemon startte niet binnen 5 seconden.' };
}

async function ollamaRemove(name: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof name !== 'string' || !name.trim()) {
    return { ok: false, error: 'modelnaam verplicht' };
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `ollama ${res.status} ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function ollamaPull(name: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof name !== 'string' || !name) {
    return { ok: false, error: 'modelnaam verplicht' };
  }
  try {
    // Ollama streamt JSON-events. We willen alleen weten of het lukt;
    // we lezen tot stream eindigt en kijken naar de laatste status.
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: `ollama ${res.status} ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerModelsBridge(): void {
  ipcMain.handle('models:list', async () => listModels());
  ipcMain.handle('models:install', async (_event, descriptorId: unknown) =>
    installModel(descriptorId)
  );
  ipcMain.handle('models:task', async (_event, taskId: unknown) => fetchTask(taskId));
  ipcMain.handle('ollama:status', async () => ollamaStatus());
  ipcMain.handle('ollama:pull', async (_event, name: unknown) => ollamaPull(name));
  ipcMain.handle('ollama:detect', async () => ollamaDetect());
  ipcMain.handle('ollama:openInstaller', async () => ollamaOpenInstaller());
  ipcMain.handle('ollama:start', async () => ollamaStart());
  ipcMain.handle('ollama:remove', async (_event, name: unknown) => ollamaRemove(name));
}

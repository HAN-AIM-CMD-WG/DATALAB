/**
 * Engine-bridge: minimum variant (Fase 3.2).
 *
 * Registreert IPC-handlers waarmee de renderer via ``window.anonimiseer.engine``
 * met de lokale pii-engine kan praten. We doen dit expliciet vanuit het
 * main-proces zodat:
 *   - de renderer geen directe netwerkcalls hoeft te doen (CSP blijft strak),
 *   - er geen browser-CORS in de weg zit bij localhost-calls,
 *   - we in latere fases eenvoudig kunnen upgraden naar "spawn + manage
 *     de sidecar zelf" zonder het preload-contract te breken.
 */

import { ipcMain } from 'electron';
import type { EngineHealth } from '@shared/api';

const ENGINE_URL =
  process.env.ANONIMISEER_ENGINE_URL ?? 'http://127.0.0.1:8765';
const HEALTH_TIMEOUT_MS = 2500;

async function fetchHealth(): Promise<EngineHealth> {
  const url = `${ENGINE_URL}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return {
        status: 'down',
        reason: `HTTP ${response.status}`,
        url: ENGINE_URL,
      };
    }
    const data = (await response.json()) as {
      status?: string;
      version?: string;
      recognizers?: number;
      spacy_model?: string;
    };
    if (data.status !== 'ok') {
      return {
        status: 'down',
        reason: `engine status ${data.status ?? 'onbekend'}`,
        url: ENGINE_URL,
      };
    }
    return {
      status: 'ok',
      version: data.version ?? '0.0.0',
      recognizers: data.recognizers ?? 0,
      spacyModel: data.spacy_model ?? '—',
      url: ENGINE_URL,
    };
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'engine antwoordt niet binnen 2.5s'
          : error.message
        : 'onbekende fout';
    return { status: 'down', reason, url: ENGINE_URL };
  }
}

export function registerEngineBridge(): void {
  ipcMain.handle('engine:health', async () => fetchHealth());
  ipcMain.handle('engine:url', () => ENGINE_URL);
}

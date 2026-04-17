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
import type {
  ActiveEngineModel,
  ActiveEngineResponse,
  ActiveOllamaState,
  AnalyzeHit,
  AnalyzeRequest,
  AnalyzeResponse,
  EngineConfigPatch,
  EngineHealth,
  ReviewFinding,
  ReviewResponse,
} from '@shared/api';

const ENGINE_URL =
  process.env.ANONIMISEER_ENGINE_URL ?? 'http://127.0.0.1:8765';
const HEALTH_TIMEOUT_MS = 2500;
const ANALYZE_TIMEOUT_MS = 30_000;
// Wisselen van pipeline (vooral SoNaR-BERT inschakelen) kan tientallen
// seconden duren omdat de eerstvolgende analyzer-build het model laadt.
const CONFIG_TIMEOUT_MS = 120_000;
// LLM-review is per definitie langzamer: lokale inference + prompt.
const REVIEW_TIMEOUT_MS = 180_000;

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

async function postAnalyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
  try {
    const response = await fetch(`${ENGINE_URL}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        language: req.language ?? 'nl',
        entities: req.entities,
        score_threshold: req.threshold,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: `engine antwoordt HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      };
    }
    const data = (await response.json()) as { items?: unknown };
    if (!Array.isArray(data.items)) {
      return { ok: false, error: 'onverwacht antwoord (geen items-array)' };
    }
    return { ok: true, items: data.items as AnalyzeHit[] };
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `engine antwoordt niet binnen ${ANALYZE_TIMEOUT_MS / 1000}s`
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

async function fetchActive(): Promise<ActiveEngineResponse> {
  const url = `${ENGINE_URL}/engine/active`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false, error: `engine antwoordt HTTP ${response.status}` };
    }
    return parseActiveBody(await response.json());
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'engine antwoordt niet binnen 2.5s'
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

function parseActiveBody(data: unknown): ActiveEngineResponse {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'onverwacht antwoord (geen object)' };
  }
  const obj = data as Record<string, unknown>;
  const recognizers = Array.isArray(obj.recognizers)
    ? (obj.recognizers.filter((x) => typeof x === 'string') as string[])
    : [];
  const activeModels: ActiveEngineModel[] = Array.isArray(obj.active_models)
    ? (obj.active_models
        .map((raw) => {
          if (!raw || typeof raw !== 'object') return null;
          const m = raw as Record<string, unknown>;
          const id = typeof m.id === 'string' ? m.id : null;
          const label = typeof m.label === 'string' ? m.label : null;
          const kind = m.kind === 'spacy' || m.kind === 'hf' ? m.kind : null;
          const role = m.role === 'nlp' || m.role === 'ner' ? m.role : null;
          if (!id || !label || !kind || !role) return null;
          return { id, label, kind, role } satisfies ActiveEngineModel;
        })
        .filter((x): x is ActiveEngineModel => x !== null))
    : [];
  const ollamaRaw = (obj.ollama ?? {}) as Record<string, unknown>;
  const ollama: ActiveOllamaState = {
    model: typeof ollamaRaw.model === 'string' ? ollamaRaw.model : null,
    daemonRunning: Boolean(ollamaRaw.daemon_running),
    modelPresent: Boolean(ollamaRaw.model_present),
    reviewEnabled: Boolean(ollamaRaw.review_enabled),
    extraNerEnabled: Boolean(ollamaRaw.extra_ner_enabled),
    borderlineEnabled: Boolean(ollamaRaw.borderline_enabled),
  };
  return {
    ok: true,
    info: {
      spacyModel: typeof obj.spacy_model === 'string' ? obj.spacy_model : '—',
      sonarEnabled: Boolean(obj.sonar_enabled),
      sonarModel: typeof obj.sonar_model === 'string' ? obj.sonar_model : null,
      scoreThreshold:
        typeof obj.score_threshold === 'number' ? obj.score_threshold : 0.35,
      recognizers,
      activeModels,
      ollama,
    },
  };
}

async function postReview(
  text: string,
  model?: string,
): Promise<ReviewResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = { text };
    if (model) body.model = model;
    const response = await fetch(`${ENGINE_URL}/engine/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { detail?: unknown };
        if (typeof parsed?.detail === 'string') detail = parsed.detail;
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        error:
          detail ||
          `engine antwoordt HTTP ${response.status} zonder details`,
      };
    }
    const data = (await response.json()) as Record<string, unknown>;
    const verdict =
      data.verdict === 'clean' || data.verdict === 'suspect'
        ? data.verdict
        : 'unknown';
    const findings: ReviewFinding[] = Array.isArray(data.findings)
      ? (data.findings as unknown[])
          .map((raw) => {
            if (!raw || typeof raw !== 'object') return null;
            const f = raw as Record<string, unknown>;
            const snippet = typeof f.snippet === 'string' ? f.snippet : null;
            if (!snippet) return null;
            return {
              snippet,
              category: typeof f.category === 'string' ? f.category : 'OTHER',
              explanation:
                typeof f.explanation === 'string' ? f.explanation : '',
            } satisfies ReviewFinding;
          })
          .filter((x): x is ReviewFinding => x !== null)
      : [];
    return {
      ok: true,
      model: typeof data.model === 'string' ? data.model : '—',
      verdict,
      summary:
        typeof data.summary === 'string'
          ? data.summary
          : 'Geen samenvatting ontvangen.',
      findings,
      rawResponse: typeof data.raw_response === 'string' ? data.raw_response : '',
      evalDurationMs:
        typeof data.eval_duration_ms === 'number' ? data.eval_duration_ms : null,
    };
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `engine antwoordt niet binnen ${REVIEW_TIMEOUT_MS / 1000}s`
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

async function postEngineConfig(
  pathname: '/engine/config' | '/engine/config/reset',
  body: Record<string, unknown> | null,
): Promise<ActiveEngineResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(`${ENGINE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed?.detail === 'string') detail = parsed.detail;
      } catch {
        // body was geen JSON, gewoon de tekst gebruiken
      }
      return {
        ok: false,
        error:
          response.status === 400
            ? detail || 'wijziging geweigerd'
            : `engine antwoordt HTTP ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ''}`,
      };
    }
    const data = (await response.json()) as unknown;
    return parseActiveBody(data);
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `engine antwoordt niet binnen ${CONFIG_TIMEOUT_MS / 1000}s (zwaar model laadt?)`
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

export function registerEngineBridge(): void {
  ipcMain.handle('engine:health', async () => fetchHealth());
  ipcMain.handle('engine:url', () => ENGINE_URL);
  ipcMain.handle('engine:analyze', async (_event, req: AnalyzeRequest) =>
    postAnalyze(req)
  );
  ipcMain.handle('engine:active', async () => fetchActive());
  ipcMain.handle('engine:setConfig', async (_event, patch: EngineConfigPatch) => {
    const body: Record<string, unknown> = {};
    if (typeof patch?.spacyModel === 'string') body.spacy_model = patch.spacyModel;
    if (typeof patch?.enableSonar === 'boolean') body.enable_sonar = patch.enableSonar;
    if (typeof patch?.sonarModel === 'string') body.sonar_model = patch.sonarModel;
    if (typeof patch?.ollamaModel === 'string') body.ollama_model = patch.ollamaModel;
    if (typeof patch?.ollamaReviewEnabled === 'boolean')
      body.ollama_review_enabled = patch.ollamaReviewEnabled;
    if (typeof patch?.ollamaExtraNerEnabled === 'boolean')
      body.ollama_extra_ner_enabled = patch.ollamaExtraNerEnabled;
    if (typeof patch?.ollamaBorderlineEnabled === 'boolean')
      body.ollama_borderline_enabled = patch.ollamaBorderlineEnabled;
    return postEngineConfig('/engine/config', body);
  });
  ipcMain.handle('engine:resetConfig', async () =>
    postEngineConfig('/engine/config/reset', null)
  );
  ipcMain.handle(
    'engine:review',
    async (_event, text: string, modelOverride?: string) =>
      postReview(text, modelOverride),
  );
}

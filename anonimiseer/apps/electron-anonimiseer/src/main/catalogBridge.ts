/**
 * Catalog-bridge.
 *
 * Strategie in drie lagen:
 *  1. **Bundled fallback**: ``resources/ollama-catalog.json`` reist met
 *     de app mee zodat we offline ook iets kunnen tonen.
 *  2. **Cached refresh**: bij druk op "Vernieuwen" trekt de app een
 *     verse JSON van een door ons gehoste URL en bewaart die in
 *     ``userData/catalog/ollama-catalog.json``. Volgende app-start
 *     wordt eerst de cache gelezen.
 *  3. **Eigen naam**: blijft beschikbaar in de UI als ontsnappingsluik.
 *
 * Defense in depth: we filteren ``:cloud``-varianten *na* het ophalen
 * actief weg. Onze privacybelofte (alles lokaal) mag nooit door een
 * verkeerd geconfigureerd catalog-bestand sneuvelen.
 */

import { app, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { OllamaCatalog, OllamaCatalogEntry, OllamaCatalogResponse } from '@shared/api';

const CATALOG_FILE = 'ollama-catalog.json';
const CACHE_DIR_NAME = 'catalog';
const CURRENT_SCHEMA_VERSION = 1;

const DEFAULT_REMOTE_URL =
  process.env.ANONIMISEER_OLLAMA_CATALOG_URL ??
  // Plaatsvervanger: hier komt straks de canonical raw-URL te staan
  // wanneer de monorepo publiek is. ``null`` betekent: alleen bundled
  // + cache, geen remote refresh tot er een URL is.
  '';

async function bundledCatalogPath(): Promise<string> {
  // De bundle leeft op verschillende plekken in dev (electron-vite serveert
  // ``out/main/index.js`` vanuit projectroot) en in prod (asar in
  // ``process.resourcesPath``). We proberen alle bekende locaties en
  // kiezen het eerste pad dat écht op schijf staat. Als geen enkel pad
  // bestaat, retourneren we het eerste zodat de fout-melding zinvol is.
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'resources', CATALOG_FILE),
    path.join(appPath, '..', 'resources', CATALOG_FILE),
    path.resolve(__dirname, '..', '..', 'resources', CATALOG_FILE),
    path.join(process.resourcesPath ?? '', CATALOG_FILE),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await fs.access(candidate);
      console.log('[catalog] bundled gevonden op', candidate);
      return candidate;
    } catch {
      // Probeer volgende kandidaat.
    }
  }
  console.warn(
    '[catalog] bundled catalog niet gevonden, geprobeerd:',
    Array.from(seen)
  );
  return candidates[0];
}

function cacheDir(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

function cachePath(): string {
  return path.join(cacheDir(), CATALOG_FILE);
}

interface RawCatalog {
  schemaVersion?: unknown;
  version?: unknown;
  notes?: unknown;
  models?: unknown;
}

interface RawEntry {
  name?: unknown;
  label?: unknown;
  description?: unknown;
  sizeMb?: unknown;
  minRamMb?: unknown;
  recommended?: unknown;
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Strikte validator. Gooit een fout met duidelijke reden zodat we in
 * de UI kunnen tonen waarom een refresh werd geweigerd.
 */
function parseCatalog(raw: unknown, sourceLabel: string): OllamaCatalog {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${sourceLabel}: catalog is geen JSON-object`);
  }
  const obj = raw as RawCatalog;
  const schemaVersion = obj.schemaVersion;
  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `${sourceLabel}: onbekende schemaVersion ${String(schemaVersion)} (verwacht ${CURRENT_SCHEMA_VERSION})`
    );
  }
  if (!isString(obj.version)) {
    throw new Error(`${sourceLabel}: 'version' ontbreekt of is leeg`);
  }
  if (!Array.isArray(obj.models)) {
    throw new Error(`${sourceLabel}: 'models' moet een array zijn`);
  }

  const seen = new Set<string>();
  const models: OllamaCatalogEntry[] = [];

  for (const item of obj.models as RawEntry[]) {
    if (!item || typeof item !== 'object') continue;
    if (!isString(item.name)) continue;
    if (item.name.endsWith(':cloud') || item.name.includes(':cloud-')) {
      // Stille weigering: cloud-varianten staan haaks op de privacybelofte.
      continue;
    }
    if (!isString(item.label) || !isString(item.description)) continue;
    if (!isFiniteNumber(item.sizeMb) || !isFiniteNumber(item.minRamMb)) continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    models.push({
      name: item.name,
      label: item.label,
      description: item.description,
      sizeMb: item.sizeMb,
      minRamMb: item.minRamMb,
      recommended: item.recommended === true ? true : undefined,
    });
  }

  if (models.length === 0) {
    throw new Error(`${sourceLabel}: geen geldige models na validatie`);
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    version: obj.version,
    notes: isString(obj.notes) ? obj.notes : undefined,
    models,
  };
}

async function readJson(filePath: string): Promise<unknown> {
  const buf = await fs.readFile(filePath, 'utf8');
  return JSON.parse(buf);
}

async function loadBundled(): Promise<OllamaCatalog> {
  const raw = await readJson(await bundledCatalogPath());
  return parseCatalog(raw, 'gebundelde catalog');
}

async function loadCached(): Promise<{ catalog: OllamaCatalog; mtimeMs: number } | null> {
  try {
    const stat = await fs.stat(cachePath());
    const raw = await readJson(cachePath());
    const catalog = parseCatalog(raw, 'cache');
    return { catalog, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

async function writeCache(catalog: OllamaCatalog): Promise<number> {
  await fs.mkdir(cacheDir(), { recursive: true });
  const tmp = `${cachePath()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(catalog, null, 2), 'utf8');
  await fs.rename(tmp, cachePath());
  const stat = await fs.stat(cachePath());
  return stat.mtimeMs;
}

async function getEffectiveCatalog(): Promise<OllamaCatalogResponse> {
  // Bundled altijd lezen, zelfs als cache slaagt — dan kunnen we de
  // versies vergelijken en in de UI zeggen "cache is ouder dan
  // gebundeld".
  let bundled: OllamaCatalog | null = null;
  try {
    bundled = await loadBundled();
  } catch (err) {
    bundled = null;
    // Geen fatale fout — we proberen toch de cache.
    console.error('[catalog] bundled load mislukte:', err);
  }

  const cached = await loadCached();
  let active: OllamaCatalog | null = null;
  let source: 'cache' | 'bundled' | 'none' = 'none';
  let updatedAt: number | null = null;

  if (cached && bundled && cached.catalog.version >= bundled.version) {
    active = cached.catalog;
    source = 'cache';
    updatedAt = cached.mtimeMs;
  } else if (cached && !bundled) {
    active = cached.catalog;
    source = 'cache';
    updatedAt = cached.mtimeMs;
  } else if (bundled) {
    active = bundled;
    source = 'bundled';
  }

  if (!active) {
    return {
      ok: false,
      error: 'Geen geldige catalog gevonden (zowel bundled als cache mislukt).',
      remoteUrl: DEFAULT_REMOTE_URL || null,
    };
  }

  return {
    ok: true,
    catalog: active,
    source,
    updatedAt,
    remoteUrl: DEFAULT_REMOTE_URL || null,
  };
}

async function refreshFromRemote(): Promise<OllamaCatalogResponse> {
  if (!DEFAULT_REMOTE_URL) {
    return {
      ok: false,
      error:
        'Geen remote-URL geconfigureerd (zet ANONIMISEER_OLLAMA_CATALOG_URL of bewerk catalogBridge.ts).',
      remoteUrl: null,
    };
  }
  let raw: unknown;
  try {
    const res = await fetch(DEFAULT_REMOTE_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} bij ophalen ${DEFAULT_REMOTE_URL}`,
        remoteUrl: DEFAULT_REMOTE_URL,
      };
    }
    raw = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      remoteUrl: DEFAULT_REMOTE_URL,
    };
  }

  let catalog: OllamaCatalog;
  try {
    catalog = parseCatalog(raw, 'remote');
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      remoteUrl: DEFAULT_REMOTE_URL,
    };
  }

  const updatedAt = await writeCache(catalog);
  return {
    ok: true,
    catalog,
    source: 'cache',
    updatedAt,
    remoteUrl: DEFAULT_REMOTE_URL,
  };
}

export function registerCatalogBridge(): void {
  ipcMain.handle('catalog:ollama:get', async (): Promise<OllamaCatalogResponse> =>
    getEffectiveCatalog()
  );
  ipcMain.handle('catalog:ollama:refresh', async (): Promise<OllamaCatalogResponse> =>
    refreshFromRemote()
  );
}

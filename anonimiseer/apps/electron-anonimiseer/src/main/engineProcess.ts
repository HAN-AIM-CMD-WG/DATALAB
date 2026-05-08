/**
 * Engine-process manager.
 *
 * In **productie** spawnt Electron de meegebundelde pii-engine binary (via
 * PyInstaller in `extraResources/pii-engine/`). In **dev** nemen we aan dat de
 * ontwikkelaar `uvicorn pii_engine.api:app --port 8765` zelf start — dat geeft
 * snellere hot-reloads. Dit wordt gedetecteerd via `app.isPackaged`.
 *
 * Verantwoordelijkheden:
 *   - binary-pad kiezen per platform (mac: `pii-engine`, win: `pii-engine.exe`)
 *   - child process starten, stdout/stderr forwarden naar Electron's log
 *   - wachten tot `/health` 200 teruggeeft (max ~30 s)
 *   - clean kill bij `app.quit()`, ook als de engine nog aan het laden is
 *
 * Waarom geen node_modules-library (bv. `execa`)? Bewust minimaal houden:
 * Electron's `child_process` is voldoende en wordt sowieso gebundeld.
 */

import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HEALTH_POLL_INTERVAL_MS = 500;
// Torch/transformers + spaCy-lg hebben op eerste koude start ~30-40 s nodig
// voor model-decompressie en Presidio-registratie. We geven ruim tot 90 s.
const HEALTH_POLL_TIMEOUT_MS = 90_000;
const HEALTH_PORT = Number.parseInt(
  process.env.ANONIMISEER_ENGINE_PORT ?? '8765',
  10,
);
const HEALTH_HOST = process.env.ANONIMISEER_ENGINE_HOST ?? '127.0.0.1';

let engineChild: ChildProcess | null = null;

/**
 * Seed de HuggingFace-modelcache van de gebruiker vanuit de meegebundelde
 * seed-folder, zodat SoNaR-BERT out-of-the-box werkt zonder internet.
 *
 * Strategie:
 *   - Bron: `<resources>/hf-seed/hub/models--<repo>/` (meegebundeld, read-only).
 *   - Doel: `~/.anonimiseer/huggingface/hub/models--<repo>/` (schrijfbaar).
 *   - Alleen kopiëren als de doel-map nog niet bestaat, anders laten we de
 *     bestaande cache met rust (gebruiker kan er zelf modellen aan hebben
 *     toegevoegd via de Model Manager).
 *   - Symlinks behouden we zoals ze in de HF-cache horen te staan
 *     (snapshots/... → ../../blobs/<hash>). Node's `cpSync` kopieert met
 *     `verbatimSymlinks: true` zonder te dereferencen.
 */
function seedHuggingFaceCache(): void {
  const seedRoot = join(process.resourcesPath, 'hf-seed', 'hub');
  if (!existsSync(seedRoot)) {
    console.log('[engineProcess] geen hf-seed in resources, skip seeding');
    return;
  }
  const userHubCache = join(homedir(), '.anonimiseer', 'huggingface', 'hub');
  mkdirSync(userHubCache, { recursive: true });

  let seededCount = 0;
  for (const repoFolder of readdirSync(seedRoot)) {
    const srcRepo = join(seedRoot, repoFolder);
    const dstRepo = join(userHubCache, repoFolder);
    if (existsSync(dstRepo)) {
      continue;
    }
    try {
      copyHfRepo(srcRepo, dstRepo);
      seededCount += 1;
      console.log('[engineProcess] geseed:', repoFolder);
    } catch (err) {
      console.warn('[engineProcess] kon', repoFolder, 'niet seeden:', err);
    }
  }
  if (seededCount > 0) {
    console.log(
      `[engineProcess] ${seededCount} HF-repo(s) geseed naar ${userHubCache}`,
    );
  }
}

/**
 * Recursieve kopie van een HF-cache-map met behoud van symlinks. We gebruiken
 * niet `fs.cpSync` met `verbatimSymlinks: true` omdat dat in oudere Electron-
 * builds inconsistent is; handmatig is robuuster.
 */
function copyHfRepo(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(srcPath);
      try {
        symlinkSync(target, dstPath);
      } catch (err) {
        // Op Windows mag je zonder admin-rechten geen symlinks maken; val
        // dan terug op een kopie van het doel-bestand.
        try {
          const resolved = statSync(srcPath);
          if (resolved.isFile()) {
            cpSync(srcPath, dstPath);
          }
        } catch {
          throw err;
        }
      }
    } else if (entry.isDirectory()) {
      copyHfRepo(srcPath, dstPath);
    } else if (entry.isFile()) {
      cpSync(srcPath, dstPath);
    }
  }
}

function resolveEngineBinary(): string | null {
  // In productie ligt de PyInstaller-bundle onder `process.resourcesPath`:
  //   Mac: <App>.app/Contents/Resources/pii-engine/pii-engine
  //   Win: resources\pii-engine\pii-engine.exe
  //   Lin: resources/pii-engine/pii-engine
  const binName = process.platform === 'win32' ? 'pii-engine.exe' : 'pii-engine';
  const candidate = join(process.resourcesPath, 'pii-engine', binName);
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

async function waitForHealth(): Promise<void> {
  const url = `http://${HEALTH_HOST}:${HEALTH_PORT}/health`;
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        return;
      }
    } catch {
      // ignore, engine is nog aan het opstarten
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(
    `pii-engine reageerde niet op ${url} binnen ${HEALTH_POLL_TIMEOUT_MS / 1000} s`,
  );
}

/**
 * Start de engine in productie. In dev doet deze functie niets.
 * Gooi een error als starten mislukt zodat de UI een heldere boodschap kan
 * tonen.
 */
export async function startEngine(): Promise<{ started: boolean; reason?: string }> {
  if (!app.isPackaged) {
    return { started: false, reason: 'dev-mode: verwacht uvicorn al te draaien' };
  }
  const binary = resolveEngineBinary();
  if (binary === null) {
    return {
      started: false,
      reason:
        'pii-engine binary niet gevonden in resources/pii-engine/. Herinstalleer de app.',
    };
  }

  // Seed eerst de HF-cache zodat SoNaR-BERT direct beschikbaar is.
  seedHuggingFaceCache();

  console.log('[engineProcess] start engine:', binary);
  engineChild = spawn(binary, [], {
    env: {
      ...process.env,
      PII_ENGINE_HOST: HEALTH_HOST,
      PII_ENGINE_PORT: String(HEALTH_PORT),
      // In de bundle zit nl_core_news_lg als default voor de beste Nederlandse
      // namen-recall. Blijft overschrijfbaar via env voor development.
      PII_ENGINE_SPACY_MODEL:
        process.env.PII_ENGINE_SPACY_MODEL ?? 'nl_core_news_lg',
      // SoNaR-BERT standaard aan: het model zit in de bundle via hf-seed en
      // torch is beschikbaar. Gebruikt ~600 MB extra RAM maar levert meetbaar
      // betere recall op lange/ongebruikelijke namen.
      PII_ENGINE_ENABLE_SONAR:
        process.env.PII_ENGINE_ENABLE_SONAR ?? 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  engineChild.stdout?.on('data', (chunk: Buffer) => {
    console.log('[pii-engine]', chunk.toString().trimEnd());
  });
  engineChild.stderr?.on('data', (chunk: Buffer) => {
    console.error('[pii-engine]', chunk.toString().trimEnd());
  });
  engineChild.on('exit', (code, signal) => {
    console.warn(
      `[engineProcess] engine afgesloten (code=${code}, signal=${signal})`,
    );
    engineChild = null;
  });

  try {
    await waitForHealth();
    console.log('[engineProcess] engine is gezond');
    return { started: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    stopEngine();
    return { started: false, reason };
  }
}

export function stopEngine(): void {
  if (engineChild === null) {
    return;
  }
  console.log('[engineProcess] stop engine (pid=%s)', engineChild.pid);
  // SIGTERM geeft uvicorn de kans om fatsoenlijk af te sluiten; na 3s forceren.
  const child = engineChild;
  engineChild = null;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  const killTimer = setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 3000);
  child.once('exit', () => clearTimeout(killTimer));
}

export function isEngineRunning(): boolean {
  return engineChild !== null;
}

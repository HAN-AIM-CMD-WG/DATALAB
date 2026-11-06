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
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { clearEngineEndpoint, setEngineEndpoint } from './engineEndpoint';

const HEALTH_POLL_INTERVAL_MS = 500;
// Torch/transformers + spaCy-lg hebben op eerste koude start ~30-40 s nodig
// voor model-decompressie en Presidio-registratie. We geven ruim tot 90 s.
const HEALTH_POLL_TIMEOUT_MS = 90_000;
const HEALTH_PORT = Number.parseInt(
  process.env.ANONIMISEER_ENGINE_PORT ?? '8765',
  10,
);
// Always loopback: an environment variable must not be able to expose the
// engine, and with it every document, to the network.
const HEALTH_HOST = '127.0.0.1';

let engineChild: ChildProcess | null = null;
/** Laatste stukje stderr van de engine, om een vroege exit te kunnen uitleggen. */
let engineStderrTail = '';

/**
 * Vertaal een engine die direct na het starten stopt naar iets waar een
 * gebruiker mee verder kan. Deze tekst belandt in de foutdialoog.
 */
function explainEarlyExit(stderr: string): string {
  if (/address already in use/i.test(stderr)) {
    return (
      `Poort ${HEALTH_PORT} is al in gebruik door een ander programma, vaak een ` +
      'engine die is blijven hangen na een eerdere crash. Stop het proces ' +
      '"pii-engine" via Activiteitenweergave (Mac) of Taakbeheer (Windows), of ' +
      'herstart je computer, en open Anonimiseer daarna opnieuw.'
    );
  }
  return (
    'De verwerkings-engine stopte direct na het starten. Installeer de app ' +
    'opnieuw; helpt dat niet, neem dan contact op met support.'
  );
}

/**
 * Copy the models the installer ships (`<resources>/hf-seed/hub/models--<repo>/`)
 * into the user's cache (`~/.anonimiseer/huggingface/hub/`), where the engine
 * loads them from without internet. A model already in the cache is left
 * alone. Asynchronous, so the window stays responsive while ~1 GB is copied,
 * and via a temporary folder: an interrupted first start leaves no half model
 * that the engine would take for a complete one.
 */
async function seedHuggingFaceCache(): Promise<void> {
  const seedRoot = join(process.resourcesPath, 'hf-seed', 'hub');
  if (!existsSync(seedRoot)) {
    console.log('[engineProcess] geen hf-seed in resources, skip seeding');
    return;
  }
  const userHubCache = join(homedir(), '.anonimiseer', 'huggingface', 'hub');
  await mkdir(userHubCache, { recursive: true });
  for (const repoFolder of await readdir(seedRoot)) {
    const dstRepo = join(userHubCache, repoFolder);
    if (!repoFolder.startsWith('models--') || existsSync(dstRepo)) continue;
    const partial = `${dstRepo}.partial`;
    try {
      await rm(partial, { recursive: true, force: true });
      await cp(join(seedRoot, repoFolder), partial, { recursive: true });
      await rename(partial, dstRepo);
      console.log('[engineProcess] geseed:', repoFolder);
    } catch (err) {
      console.warn('[engineProcess] kon', repoFolder, 'niet seeden:', err);
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

/**
 * Wacht tot *onze eigen* engine antwoordt.
 *
 * Een 200 op ``/health`` is niet genoeg: elk lokaal proces kan poort 8765
 * bezetten en `{"status":"ok"}` teruggeven. Daarom sturen we een nonce mee en
 * eist de app een bewijs terug — een HMAC over die nonce met het token dat we
 * bij het starten aan het kindproces hebben meegegeven. Een imitator kent dat
 * token niet en kan het bewijs dus niet produceren.
 *
 * We sturen het token hierbij bewust *niet* mee: dan zou de imitator het
 * cadeau krijgen. Pas als het bewijs klopt gebruiken we het token voor de
 * echte aanroepen.
 */
async function waitForHealth(token: string): Promise<void> {
  const base = `http://${HEALTH_HOST}:${HEALTH_PORT}`;
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;
  let lastProblem = 'engine reageerde niet';

  while (Date.now() < deadline) {
    // Is het kindproces al gestorven, dan heeft doorpollen geen zin — sterker
    // nog, dan pollen we mogelijk tegen iets anders dan onze engine.
    if (engineChild === null) {
      throw new Error(explainEarlyExit(engineStderrTail));
    }
    const nonce = randomBytes(16).toString('hex');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${base}/health?nonce=${nonce}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const body = (await res.json()) as { proof?: unknown };
        if (proofMatches(token, nonce, body.proof)) {
          return;
        }
        lastProblem =
          `er luistert wél iets op ${base}, maar het is niet de engine van deze app ` +
          '(geen geldig bewijs). Sluit andere programma\u2019s die deze poort gebruiken af.';
      }
    } catch {
      // engine is nog aan het opstarten
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  throw new Error(
    `${lastProblem} (${HEALTH_POLL_TIMEOUT_MS / 1000} s gewacht op ${base}).`,
  );
}

function proofMatches(token: string, nonce: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || proof.length === 0) return false;
  const expected = createHmac('sha256', token).update(nonce).digest();
  let received: Buffer;
  try {
    received = Buffer.from(proof, 'hex');
  } catch {
    return false;
  }
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

let starting = false;

/** True while the app is still starting its engine, so "not reachable" is expected. */
export function isEngineStarting(): boolean {
  return starting;
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
  starting = true;
  try {
    return await launchEngine();
  } finally {
    starting = false;
  }
}

async function launchEngine(): Promise<{ started: boolean; reason?: string }> {
  const binary = resolveEngineBinary();
  if (binary === null) {
    return {
      started: false,
      reason:
        'pii-engine binary niet gevonden in resources/pii-engine/. Herinstalleer de app.',
    };
  }

  // Seed eerst de HF-cache zodat het PII-model direct beschikbaar is.
  await seedHuggingFaceCache();

  // Geheim dat alleen deze app en het kindproces kennen. Zie waitForHealth.
  const token = randomBytes(32).toString('hex');

  console.log('[engineProcess] start engine:', binary);
  engineChild = spawn(binary, [], {
    // A fixed directory of our own, not whatever the app was started from.
    cwd: app.getPath('userData'),
    env: {
      ...process.env,
      PII_ENGINE_HOST: HEALTH_HOST,
      PII_ENGINE_PORT: String(HEALTH_PORT),
      PII_ENGINE_AUTH_TOKEN: token,
      // De playground-UI van de engine heeft in de desktop-app geen functie en
      // vergroot alleen het aanvalsoppervlak.
      PII_ENGINE_ENABLE_PLAYGROUND: 'false',
      // Zie de stdin-pipe hieronder.
      PII_ENGINE_EXIT_WITH_PARENT: 'true',
      // In de bundle zit nl_core_news_lg als default voor de beste Nederlandse
      // namen-recall. Blijft overschrijfbaar via env voor development.
      PII_ENGINE_SPACY_MODEL:
        process.env.PII_ENGINE_SPACY_MODEL ?? 'nl_core_news_lg',
      // The PII model ships via hf-seed and is the default extra layer.
      // SoNaR-BERT has no licence, so it is an optional download, off until
      // the user switches it on.
      PII_ENGINE_ENABLE_PII_MODEL:
        process.env.PII_ENGINE_ENABLE_PII_MODEL ?? 'true',
      PII_ENGINE_ENABLE_SONAR:
        process.env.PII_ENGINE_ENABLE_SONAR ?? 'false',
    },
    // stdin is een pipe die we nooit beschrijven: het is een levenslijn. Bij
    // een crash of geforceerde stop van de app worden `before-quit` en
    // `stopEngine` niet meer uitgevoerd, maar sluit het OS deze pipe wel. De
    // engine leest dan EOF en stopt zichzelf, in plaats van als wees de poort
    // vast te houden zodat de app niet meer kan starten.
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  engineStderrTail = '';

  engineChild.stdout?.on('data', (chunk: Buffer) => {
    console.log('[pii-engine]', chunk.toString().trimEnd());
  });
  engineChild.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    engineStderrTail = (engineStderrTail + text).slice(-4000);
    console.error('[pii-engine]', text.trimEnd());
  });
  engineChild.on('exit', (code, signal) => {
    console.warn(
      `[engineProcess] engine afgesloten (code=${code}, signal=${signal})`,
    );
    engineChild = null;
  });

  try {
    await waitForHealth(token);
    setEngineEndpoint(`http://${HEALTH_HOST}:${HEALTH_PORT}`, token);
    console.log('[engineProcess] engine is gezond');
    return { started: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    stopEngine();
    return { started: false, reason };
  }
}

export function stopEngine(): void {
  clearEngineEndpoint();
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

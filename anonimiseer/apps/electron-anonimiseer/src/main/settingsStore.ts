/**
 * Settings-store voor de Electron-app.
 *
 * Persisteert gebruikersvoorkeuren als JSON in ``userData/settings.json``.
 * Bewust een *piepklein* eigen implementatie in plaats van
 * ``electron-store`` o.i.d., zodat we:
 *
 *   - geen externe dep voor een file+schema hebben;
 *   - precies kunnen bepalen wat we opslaan (GDPR: minimal data);
 *   - atomisch kunnen schrijven (tmp + rename) zodat een crash nooit
 *     een half bestand achterlaat.
 *
 * De store is géén veilige opslag voor secrets — dat is hij ook niet
 * bedoeld. Voor pseudonym-mappings komt in Fase 3.4d een aparte
 * versleutelde store.
 */

import { app, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export type ModelProfile = 'basis' | 'plus' | 'max';

export interface AppSettings {
  /** Schema-versie, zodat we later kunnen migreren. */
  schemaVersion: 1;
  /** ISO-timestamp wanneer de gebruiker de onboarding afrondde, of null. */
  onboardingCompletedAt: string | null;
  /** Heeft de gebruiker expliciet "ik blijf verantwoordelijk" geaccepteerd. */
  acceptedResponsibility: boolean;
  /** Gekozen modelprofiel (wordt in Fase 3.8 gebruikt om engine te spawnen). */
  modelProfile: ModelProfile;
}

const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  onboardingCompletedAt: null,
  acceptedResponsibility: false,
  modelProfile: 'plus',
};

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json');
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, schemaVersion: 1 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_SETTINGS };
    }
    // Corrupt bestand: val terug op defaults i.p.v. crashen. We laten het
    // bestand staan zodat een gevorderde gebruiker het zelf kan inspecteren.
    console.warn('[settingsStore] Kon settings niet lezen, gebruik defaults:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(next: AppSettings): Promise<void> {
  const p = settingsPath();
  await fs.mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

/**
 * Valideer en normaliseer een patch uit de renderer. Onbekende velden
 * worden genegeerd; dit is een vertrouwensgrens.
 */
function sanitizePatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object') return {};
  const input = patch as Record<string, unknown>;
  const out: Partial<AppSettings> = {};
  if (typeof input.onboardingCompletedAt === 'string' || input.onboardingCompletedAt === null) {
    out.onboardingCompletedAt = input.onboardingCompletedAt as string | null;
  }
  if (typeof input.acceptedResponsibility === 'boolean') {
    out.acceptedResponsibility = input.acceptedResponsibility;
  }
  if (
    input.modelProfile === 'basis' ||
    input.modelProfile === 'plus' ||
    input.modelProfile === 'max'
  ) {
    out.modelProfile = input.modelProfile;
  }
  return out;
}

export function registerSettingsBridge(): void {
  ipcMain.handle('settings:get', async (): Promise<AppSettings> => readSettings());

  ipcMain.handle(
    'settings:set',
    async (_event, patch: unknown): Promise<AppSettings> => {
      const current = await readSettings();
      const next: AppSettings = {
        ...current,
        ...sanitizePatch(patch),
        schemaVersion: 1,
      };
      await writeSettings(next);
      return next;
    }
  );

  ipcMain.handle('settings:reset', async (): Promise<AppSettings> => {
    const fresh = { ...DEFAULT_SETTINGS };
    await writeSettings(fresh);
    return fresh;
  });
}

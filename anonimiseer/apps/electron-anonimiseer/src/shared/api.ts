/**
 * Gedeeld type-contract tussen preload-bridge en renderer.
 *
 * Alles wat via ``window.anonimiseer`` in de UI beschikbaar is staat
 * hier gedefinieerd, zodat zowel het preload-script als de React-code
 * dezelfde TypeScript-typing gebruiken.
 */

export interface VersionInfo {
  app: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform;
}

/**
 * Antwoord van `GET /health` op de pii-engine, aangevuld met extra velden
 * die we in het main-proces toevoegen zodat de renderer niet zelf hoeft
 * te interpreteren hoe "healthy" eruit ziet.
 */
export interface EngineHealthOk {
  status: 'ok';
  version: string;
  recognizers: number;
  spacyModel: string;
  url: string;
}

export interface EngineHealthDown {
  status: 'down';
  reason: string;
  url: string;
}

export type EngineHealth = EngineHealthOk | EngineHealthDown;

export interface EngineApi {
  /** Pollt de engine en geeft het resultaat terug. Crasht nooit. */
  health(): Promise<EngineHealth>;
  /** Default URL waar we naar kijken (voor foutmeldingen/help). */
  url(): Promise<string>;
}

export type ModelProfile = 'basis' | 'plus' | 'max';

export interface AppSettings {
  schemaVersion: 1;
  onboardingCompletedAt: string | null;
  acceptedResponsibility: boolean;
  modelProfile: ModelProfile;
}

export interface SettingsApi {
  get(): Promise<AppSettings>;
  set(patch: Partial<AppSettings>): Promise<AppSettings>;
  reset(): Promise<AppSettings>;
}

export interface AnonimiseerApi {
  version: VersionInfo;
  engine: EngineApi;
  settings: SettingsApi;
}

declare global {
  interface Window {
    anonimiseer: AnonimiseerApi;
  }
}

export {};

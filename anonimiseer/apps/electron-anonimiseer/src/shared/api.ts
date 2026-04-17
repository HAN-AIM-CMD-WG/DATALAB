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

export interface AnonimiseerApi {
  version: VersionInfo;
}

declare global {
  interface Window {
    anonimiseer: AnonimiseerApi;
  }
}

export {};

import type { DialogFileInfo } from '@shared/api';
import {
  MAX_FILE_BYTES,
  SUPPORTED_EXTENSIONS,
  type SupportedExtension,
  type WizardFileEntry,
} from './wizardTypes';

/**
 * Valideer één bestand en geef een ``WizardFileEntry`` terug.
 *
 * We geven altijd een entry terug — ook als het bestand ongeldig is —
 * zodat de UI kan tonen *waarom* het niet bruikbaar is. De gebruiker
 * ziet dan direct welk bestand 'm blokkeert en kan 't verwijderen.
 */
export function validateFile(
  info: DialogFileInfo,
  existing: WizardFileEntry[]
): WizardFileEntry {
  const entry: WizardFileEntry = { id: makeId(info), info };

  if (existing.some((e) => e.info.path === info.path)) {
    entry.error = 'Dit bestand staat al in de lijst.';
    return entry;
  }

  if (!SUPPORTED_EXTENSIONS.includes(info.extension as SupportedExtension)) {
    entry.error = `Bestandstype ${info.extension || '(onbekend)'} wordt nog niet ondersteund.`;
    return entry;
  }

  if (info.size === 0) {
    entry.error = 'Leeg bestand — niets te anonimiseren.';
    return entry;
  }

  if (info.size > MAX_FILE_BYTES) {
    entry.error = `Te groot: ${formatBytes(info.size)} (max ${formatBytes(MAX_FILE_BYTES)}).`;
    return entry;
  }

  return entry;
}

/** Stabiele id — pad is uniek genoeg en leesbaar tijdens debugging. */
function makeId(info: DialogFileInfo): string {
  return info.path;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

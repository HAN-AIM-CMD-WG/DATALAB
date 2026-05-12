import type { DialogFileInfo } from '@shared/api';

export type WizardStepId = 'files' | 'settings' | 'review' | 'save';

export const WIZARD_STEPS: { id: WizardStepId; label: string }[] = [
  { id: 'files', label: 'Bestand kiezen' },
  { id: 'settings', label: 'Instellingen' },
  { id: 'review', label: 'Controleren' },
  { id: 'save', label: 'Opslaan' },
];

export type SupportedExtension = '.md' | '.txt' | '.docx' | '.pdf' | '.xlsx';

export const SUPPORTED_EXTENSIONS: SupportedExtension[] = [
  '.md',
  '.txt',
  '.docx',
  '.pdf',
  '.xlsx',
];

/** Maximum grootte per bestand in bytes (25 MiB). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Een bestand in de wizard. Voor "direct-tekst" bestanden (md/txt) hebben
 * we voldoende aan ``info`` en kunnen we later de bytes op de engine
 * plakken. Voor office/pdf-bestanden geldt hetzelfde, maar dan via de
 * parser in Fase 3.5.
 */
export interface WizardFileEntry {
  /** Stabiele id voor React-keys. */
  id: string;
  info: DialogFileInfo;
  /** Menselijke foutmelding als het bestand niet door de validatie kwam. */
  error?: string;
}

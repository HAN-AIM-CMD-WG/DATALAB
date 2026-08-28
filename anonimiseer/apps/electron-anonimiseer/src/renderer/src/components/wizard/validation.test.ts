import { describe, expect, it } from 'vitest';
import type { DialogFileInfo } from '@shared/api';
import { formatBytes, validateFile } from './validation';
import { MAX_FILE_BYTES, type WizardFileEntry } from './wizardTypes';

function info(overrides: Partial<DialogFileInfo> = {}): DialogFileInfo {
  return {
    path: '/tmp/notitie.md',
    name: 'notitie.md',
    extension: '.md',
    size: 1024,
    ...overrides,
  };
}

describe('validateFile', () => {
  it('accepteert een ondersteund bestand zonder fout', () => {
    expect(validateFile(info(), [])).toEqual({ id: '/tmp/notitie.md', info: info() });
  });

  it('herkent een dubbel toegevoegd bestand aan het pad', () => {
    const existing: WizardFileEntry[] = [{ id: '/tmp/notitie.md', info: info() }];
    const entry = validateFile(info({ name: 'anders-genoemd.md' }), existing);

    expect(entry.error).toBe('Dit bestand staat al in de lijst.');
  });

  it('weigert een niet-ondersteunde extensie en noemt welke', () => {
    const entry = validateFile(info({ name: 'foto.png', extension: '.png' }), []);

    expect(entry.error).toContain('.png');
  });

  it('noemt een lege extensie "(onbekend)" in plaats van niets', () => {
    const entry = validateFile(info({ name: 'LICENSE', extension: '' }), []);

    expect(entry.error).toContain('(onbekend)');
  });

  it('weigert een leeg bestand', () => {
    expect(validateFile(info({ size: 0 }), []).error).toBe('Leeg bestand — niets te anonimiseren.');
  });

  it('weigert een bestand boven de limiet, maar laat de limiet zelf toe', () => {
    expect(validateFile(info({ size: MAX_FILE_BYTES + 1 }), []).error).toContain('Te groot');
    expect(validateFile(info({ size: MAX_FILE_BYTES }), []).error).toBeUndefined();
  });

  it('checkt duplicaten vóór het bestandstype, zodat de melding klopt', () => {
    const existing: WizardFileEntry[] = [
      { id: '/tmp/foto.png', info: info({ path: '/tmp/foto.png', extension: '.png' }) },
    ];
    const entry = validateFile(info({ path: '/tmp/foto.png', extension: '.png' }), existing);

    expect(entry.error).toBe('Dit bestand staat al in de lijst.');
  });
});

describe('formatBytes', () => {
  it('schaalt mee met de grootte', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

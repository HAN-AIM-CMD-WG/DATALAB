import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProfile, toFile } from './profileFormat';

// Verzonnen voorbeeldprofiel; echte profielen van partners horen hier niet.
const example = {
  anonimiseerProfiel: 1,
  naam: 'Voorbeeldorganisatie',
  omschrijving: 'Profiel voor de test.',
  onderwijsherkenners: false,
  begrippen: [
    { label: 'dossiernummer', omschrijving: 'Nummer van een dossier, bijvoorbeeld D-2024-0012' },
    { label: 'projectcode', omschrijving: 'Code van een project' },
  ],
};

describe('parseProfile', () => {
  it('leest een geldig profiel', () => {
    expect(parseProfile(example)).toEqual({
      id: 'voorbeeldorganisatie',
      name: 'Voorbeeldorganisatie',
      description: 'Profiel voor de test.',
      builtIn: false,
      hanEdu: false,
      terms: [
        { label: 'dossiernummer', description: 'Nummer van een dossier, bijvoorbeeld D-2024-0012' },
        { label: 'projectcode', description: 'Code van een project' },
      ],
    });
  });

  it('overleeft een rondje bestand schrijven en lezen', () => {
    const profile = parseProfile(example);
    expect(parseProfile(JSON.parse(toFile(profile)))).toEqual(profile);
  });

  it('accepteert het voorbeeld uit docs/profielen.md', () => {
    const path = resolve(__dirname, '../../../../docs/examples/profiel-voorbeeld.json');
    expect(parseProfile(JSON.parse(readFileSync(path, 'utf8'))).terms).toHaveLength(2);
  });

  it('botst niet met een ingebouwd profiel', () => {
    expect(parseProfile({ ...example, naam: 'Algemeen' }).id).toBe('org-algemeen');
  });

  it.each([
    ['geen profielbestand', { ...example, anonimiseerProfiel: undefined }, 'anonimiseerProfiel'],
    ['naam ontbreekt', { ...example, naam: '' }, '"naam"'],
    [
      'te veel begrippen',
      { ...example, begrippen: Array.from({ length: 26 }, (_, i) => ({ label: `begrip${i}` })) },
      'hoogstens 25',
    ],
    [
      'dubbel begrip',
      { ...example, begrippen: [{ label: 'dossiernummer' }, { label: 'Dossiernummer' }] },
      'dubbel',
    ],
    ['ongeldig label', { ...example, begrippen: [{ label: '<script>' }] }, 'alleen letters'],
    [
      'omschrijving te lang',
      { ...example, begrippen: [{ label: 'dossiernummer', omschrijving: 'x'.repeat(301) }] },
      'hoogstens 300',
    ],
    ['onderwijsherkenners geen boolean', { ...example, onderwijsherkenners: 'ja' }, 'true of false'],
  ])('weigert een profiel: %s', (_label, raw, message) => {
    expect(() => parseProfile(raw)).toThrow(message);
  });
});

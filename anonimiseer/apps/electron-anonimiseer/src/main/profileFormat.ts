/**
 * The profile file an organisation provides, and the two built-in profiles.
 *
 * Kept free of Electron so the checks can be tested on their own. The file
 * format is described in docs/profielen.md; messages are meant for the person
 * who wrote the file.
 */

import type { OrgProfile, ProfileTerm } from '@shared/api';

const MAX_TERMS = 25;
const TERM_LABEL = /^[\p{L}\p{N}][\p{L}\p{N} \-/]{0,39}$/u;

export const BUILT_IN: OrgProfile[] = [
  {
    id: 'algemeen',
    name: 'Algemeen',
    description: 'Alleen de standaardherkenning, zonder onderwijscodes of eigen begrippen.',
    builtIn: true,
    hanEdu: false,
    terms: [],
  },
  {
    id: 'han-onderwijs',
    name: 'HAN-onderwijs',
    description: 'Standaardherkenning plus klas-, cursus-, CROHO- en personeelsnummers.',
    builtIn: true,
    hanEdu: true,
    terms: [],
  },
];

export class ProfileError extends Error {}

function slug(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = base || 'profiel';
  return BUILT_IN.some((p) => p.id === id) ? `org-${id}` : id;
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) {
    throw new ProfileError(
      `Veld "${field}" ontbreekt of is te lang (hoogstens ${max} tekens).`
    );
  }
  return value.trim();
}

/** Check a profile file. */
export function parseProfile(raw: unknown): OrgProfile {
  if (!raw || typeof raw !== 'object') throw new ProfileError('Dit is geen profielbestand.');
  const obj = raw as Record<string, unknown>;
  if (obj.anonimiseerProfiel !== 1) {
    throw new ProfileError('Dit is geen profielbestand voor Anonimiseer (anonimiseerProfiel: 1 ontbreekt).');
  }
  const name = text(obj.naam, 'naam', 60, true);
  const description = text(obj.omschrijving, 'omschrijving', 300, false);
  if (obj.onderwijsherkenners !== undefined && typeof obj.onderwijsherkenners !== 'boolean') {
    throw new ProfileError('Veld "onderwijsherkenners" moet true of false zijn.');
  }
  const rawTerms = obj.begrippen ?? [];
  if (!Array.isArray(rawTerms) || rawTerms.length > MAX_TERMS) {
    throw new ProfileError(`Veld "begrippen" moet een lijst zijn van hoogstens ${MAX_TERMS} begrippen.`);
  }
  const seen = new Set<string>();
  const terms: ProfileTerm[] = rawTerms.map((item, i) => {
    const t = (item ?? {}) as Record<string, unknown>;
    const label = text(t.label, `begrippen[${i + 1}].label`, 40, true);
    if (!TERM_LABEL.test(label)) {
      throw new ProfileError(
        `Begrip "${label}" mag alleen letters, cijfers, spaties, - en / bevatten.`
      );
    }
    if (seen.has(label.toLowerCase())) throw new ProfileError(`Begrip "${label}" staat er dubbel in.`);
    seen.add(label.toLowerCase());
    return { label, description: text(t.omschrijving, `begrippen[${i + 1}].omschrijving`, 300, false) };
  });
  return {
    id: slug(name),
    name,
    description,
    builtIn: false,
    hanEdu: obj.onderwijsherkenners === true,
    terms,
  };
}

export function toFile(profile: OrgProfile): string {
  return JSON.stringify(
    {
      anonimiseerProfiel: 1,
      naam: profile.name,
      omschrijving: profile.description,
      onderwijsherkenners: profile.hanEdu,
      begrippen: profile.terms.map((t) => ({ label: t.label, omschrijving: t.description })),
    },
    null,
    2
  );
}

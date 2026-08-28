import { describe, expect, it } from 'vitest';
import type { AnalyzeHit, DialogFileInfo, RunTextFileInput } from '@shared/api';
import { buildRun } from './anonymizeLocal';
import { hitId, type FileReview, type ReviewState } from './reviewTypes';
import type { WizardFileEntry } from './wizardTypes';

function entry(path: string, name: string, extension = '.md'): WizardFileEntry {
  const info: DialogFileInfo = { path, name, extension, size: 128 };
  return { id: path, info };
}

function hit(original: string, start: number, entity_type = 'PERSON'): AnalyzeHit {
  return { entity_type, start, end: start + original.length, score: 0.9, original };
}

function review(overrides: Partial<FileReview> & Pick<FileReview, 'path'>): FileReview {
  return {
    name: 'a.md',
    extension: '.md',
    kind: 'text',
    status: 'done',
    decisions: {},
    ...overrides,
  } as FileReview;
}

function state(files: FileReview[], whitelist: string[] = []): ReviewState {
  return {
    files: Object.fromEntries(files.map((f) => [f.path, f])),
    activePath: files[0]?.path ?? null,
    whitelist,
  };
}

function textFiles(result: ReturnType<typeof buildRun>): RunTextFileInput[] {
  return result.files.filter((f): f is RunTextFileInput => f.kind === 'text');
}

describe('buildRun — tekstbestanden', () => {
  it('vervangt hits door genummerde pseudoniemen per entiteitstype', () => {
    const text = 'Anne mailt Bram over Delft.';
    const hits = [hit('Anne', 0), hit('Bram', 11), hit('Delft', 21, 'LOCATION')];
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([review({ path: '/tmp/a.md', text, hits: hits.map((h) => ({ ...h, id: hitId(h) })) })]),
      'pseudonymize'
    );

    expect(textFiles(result)[0].anonymizedText).toBe(
      'PERSON_1 mailt PERSON_2 over LOCATION_1.'
    );
  });

  it('geeft hetzelfde origineel in twee bestanden hetzelfde pseudoniem', () => {
    const a = review({
      path: '/tmp/a.md',
      text: 'Anne is hier.',
      hits: [{ ...hit('Anne', 0), id: hitId(hit('Anne', 0)) }],
    });
    const b = review({
      path: '/tmp/b.md',
      name: 'b.md',
      text: 'Ook Anne staat hier.',
      hits: [{ ...hit('Anne', 4), id: hitId(hit('Anne', 4)) }],
    });

    const result = buildRun(
      [entry('/tmp/a.md', 'a.md'), entry('/tmp/b.md', 'b.md')],
      state([a, b]),
      'pseudonymize'
    );

    expect(textFiles(result).map((f) => f.anonymizedText)).toEqual([
      'PERSON_1 is hier.',
      'Ook PERSON_1 staat hier.',
    ]);
    expect(result.mapping).toEqual([
      { entity_type: 'PERSON', original: 'Anne', pseudonym: 'PERSON_1' },
    ]);
  });

  it('gebruikt labels zonder mapping in anonymize-modus', () => {
    const h = hit('Anne', 0);
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([review({ path: '/tmp/a.md', text: 'Anne is hier.', hits: [{ ...h, id: hitId(h) }] })]),
      'anonymize'
    );

    expect(textFiles(result)[0].anonymizedText).toBe('[PERSON] is hier.');
    expect(result.mapping).toEqual([]);
  });

  it('laat overgeslagen en gewhiteliste hits ongemoeid en telt ze apart', () => {
    const anne = hit('Anne', 0);
    const bram = hit('Bram', 11);
    const delft = hit('Delft', 21, 'LOCATION');
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state(
        [
          review({
            path: '/tmp/a.md',
            text: 'Anne mailt Bram over Delft.',
            hits: [anne, bram, delft].map((h) => ({ ...h, id: hitId(h) })),
            decisions: { [hitId(bram)]: 'skip' },
          }),
        ],
        ['delft']
      ),
      'pseudonymize'
    );

    const file = textFiles(result)[0];
    expect(file.anonymizedText).toBe('PERSON_1 mailt Bram over Delft.');
    expect(file.stats).toEqual({ totalHits: 3, accepted: 1, skipped: 2 });
  });

  it('past overlappende hits niet twee keer toe', () => {
    const volledig = hit('Anne de Vries', 0);
    const deel = hit('Anne', 0);
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([
        review({
          path: '/tmp/a.md',
          text: 'Anne de Vries belt.',
          hits: [volledig, deel].map((h) => ({ ...h, id: hitId(h) })),
        }),
      ]),
      'pseudonymize'
    );

    expect(textFiles(result)[0].anonymizedText).toBe('PERSON_1 belt.');
    expect(result.mapping).toHaveLength(1);
  });

  it('nummert pseudoniemen in leesvolgorde, ook als de hits door elkaar staan', () => {
    const anne = hit('Anne', 0);
    const bram = hit('Bram', 11);
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([
        review({
          path: '/tmp/a.md',
          text: 'Anne mailt Bram.',
          hits: [bram, anne].map((h) => ({ ...h, id: hitId(h) })),
        }),
      ]),
      'pseudonymize'
    );

    expect(textFiles(result)[0].anonymizedText).toBe('PERSON_1 mailt PERSON_2.');
  });
});

describe('buildRun — overslaan met uitleg', () => {
  it('slaat bestanden over die nog niet klaar zijn met analyseren', () => {
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([review({ path: '/tmp/a.md', status: 'analyzing' })]),
      'pseudonymize'
    );

    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toContain('stap 3');
  });

  it('neemt de foutmelding van een mislukte analyse over', () => {
    const result = buildRun(
      [entry('/tmp/a.md', 'a.md')],
      state([review({ path: '/tmp/a.md', status: 'error', error: 'engine offline' })]),
      'pseudonymize'
    );

    expect(result.skipped[0].reason).toContain('engine offline');
  });

  it('negeert bestanden die de validatie al had afgekeurd', () => {
    const bad: WizardFileEntry = { ...entry('/tmp/foto.png', 'foto.png', '.png'), error: 'nope' };
    const result = buildRun([bad], state([]), 'pseudonymize');

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('buildRun — documenten', () => {
  it('stuurt vervangingen plus blocks mee in plaats van kant-en-klare tekst', () => {
    const h = hit('Anne', 6);
    const result = buildRun(
      [entry('/tmp/brief.docx', 'brief.docx', '.docx')],
      state([
        review({
          path: '/tmp/brief.docx',
          name: 'brief.docx',
          extension: '.docx',
          kind: 'document',
          text: 'Beste Anne,',
          hits: [{ ...h, id: hitId(h) }],
          blocks: [{ id: 'p1', kind: 'paragraph', start: 0, end: 11 }],
        }),
      ]),
      'pseudonymize'
    );

    const file = result.files[0];
    expect(file.kind).toBe('document');
    expect(file.kind === 'document' && file.replacements).toEqual([
      { start: 6, end: 10, replacement: 'PERSON_1', original: 'Anne' },
    ]);
  });

  it('stuurt geen overlappende vervangingen naar de engine', () => {
    const volledig = hit('Anne de Vries', 6);
    const deel = hit('Anne', 6);
    const result = buildRun(
      [entry('/tmp/brief.docx', 'brief.docx', '.docx')],
      state([
        review({
          path: '/tmp/brief.docx',
          name: 'brief.docx',
          extension: '.docx',
          kind: 'document',
          text: 'Beste Anne de Vries,',
          hits: [volledig, deel].map((h) => ({ ...h, id: hitId(h) })),
          blocks: [{ id: 'p1', kind: 'paragraph', start: 0, end: 20 }],
        }),
      ]),
      'pseudonymize'
    );

    const file = result.files[0];
    expect(file.kind === 'document' && file.replacements).toEqual([
      { start: 6, end: 19, replacement: 'PERSON_1', original: 'Anne de Vries' },
    ]);
  });

  it('slaat een document zonder block-structuur over in plaats van het te verminken', () => {
    const result = buildRun(
      [entry('/tmp/brief.docx', 'brief.docx', '.docx')],
      state([
        review({
          path: '/tmp/brief.docx',
          name: 'brief.docx',
          extension: '.docx',
          kind: 'document',
          text: 'Beste Anne,',
        }),
      ]),
      'pseudonymize'
    );

    expect(result.files).toEqual([]);
    expect(result.skipped[0].reason).toContain('Document-structuur ontbreekt');
  });
});

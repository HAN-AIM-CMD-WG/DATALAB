import { describe, expect, it } from 'vitest';
import type { AnalyzeHit } from '@shared/api';
import {
  effectiveDecision,
  hitId,
  isManualHitId,
  manualHitId,
  type FileReview,
} from './reviewTypes';

function hit(overrides: Partial<AnalyzeHit> = {}): AnalyzeHit {
  return { entity_type: 'PERSON', start: 0, end: 4, score: 0.9, original: 'Anne', ...overrides };
}

function file(decisions: FileReview['decisions'] = {}): FileReview {
  return {
    path: '/tmp/a.md',
    name: 'a.md',
    extension: '.md',
    kind: 'text',
    status: 'done',
    decisions,
  };
}

describe('effectiveDecision', () => {
  it('vervangt standaard — wie niets aanklikt krijgt de veilige keuze', () => {
    expect(effectiveDecision(hit(), file(), [])).toBe('accept');
  });

  it('respecteert een expliciet besluit van de gebruiker', () => {
    expect(effectiveDecision(hit(), file({ [hitId(hit())]: 'skip' }), [])).toBe('skip');
  });

  it('laat de whitelist winnen van een expliciet accept', () => {
    expect(effectiveDecision(hit(), file({ [hitId(hit())]: 'accept' }), ['anne'])).toBe('skip');
  });

  it('matcht de whitelist hoofdletterongevoelig', () => {
    expect(effectiveDecision(hit({ original: 'ANNE' }), file(), ['anne'])).toBe('skip');
  });

  it('raakt andere hits van hetzelfde type niet', () => {
    const other = hit({ start: 20, end: 24, original: 'Bram' });
    expect(effectiveDecision(other, file({ [hitId(hit())]: 'skip' }), ['anne'])).toBe('accept');
  });
});

describe('hit-ids', () => {
  it('onderscheidt hits op type en positie', () => {
    expect(hitId(hit())).not.toBe(hitId(hit({ start: 5, end: 9 })));
    expect(hitId(hit())).not.toBe(hitId(hit({ entity_type: 'LOCATION' })));
  });

  it('markeert handmatig toegevoegde hits herkenbaar', () => {
    expect(isManualHitId(manualHitId(hit()))).toBe(true);
    expect(isManualHitId(hitId(hit()))).toBe(false);
  });
});

import type { AnalyzeHit, DocumentBlock } from '@shared/api';

export interface ReviewHit extends AnalyzeHit {
  /** Stabiele id voor React-keys en decisions-map. */
  id: string;
}

export type HitDecision = 'accept' | 'skip';

/**
 * Welke strategie we gebruiken om dit bestand anoniem te maken:
 *
 *   - ``text`` — .md/.txt bestanden worden als UTF-8 gelezen, hits
 *     worden client-side toegepast en naar een nieuw .txt-bestand
 *     geschreven.
 *   - ``document`` — .docx/.xlsx/.pdf gaan via de engine die zowel
 *     extractie als toepassing in het oorspronkelijke formaat doet.
 */
export type FileReviewKind = 'text' | 'document';

export interface FileReview {
  path: string;
  name: string;
  extension: string;
  /** Soort pipeline voor dit bestand. */
  kind: FileReviewKind;
  status: 'pending' | 'loading' | 'analyzing' | 'done' | 'error' | 'unsupported';
  text?: string;
  hits?: ReviewHit[];
  /**
   * Alleen gezet voor ``kind === 'document'``: nodig om het bestand
   * later via ``/document/apply`` te her-bouwen.
   */
  blocks?: DocumentBlock[];
  error?: string;
  /** Per-hit besluit. Hits die er niet in staan = 'accept' (default). */
  decisions: Record<string, HitDecision>;
  /** Hash van settings (entities+threshold) waarmee er laatst geanalyseerd is. */
  analyzedWith?: string;
}

export interface ReviewState {
  files: Record<string, FileReview>;
  activePath: string | null;
  /** Lowercased originals die altijd overgeslagen worden. */
  whitelist: string[];
}

export function hitId(hit: AnalyzeHit): string {
  return `${hit.entity_type}:${hit.start}:${hit.end}`;
}

/** Prefix waarmee we id's van handmatig toegevoegde hits markeren, zodat
 *  we ze in de UI anders kunnen tonen (badge, verwijder-knop) en bij een
 *  her-analyse niet wegspoelen. */
export const MANUAL_HIT_PREFIX = 'manual:';

export function manualHitId(hit: Pick<AnalyzeHit, 'entity_type' | 'start' | 'end'>): string {
  return `${MANUAL_HIT_PREFIX}${hit.entity_type}:${hit.start}:${hit.end}`;
}

export function isManualHitId(id: string): boolean {
  return id.startsWith(MANUAL_HIT_PREFIX);
}

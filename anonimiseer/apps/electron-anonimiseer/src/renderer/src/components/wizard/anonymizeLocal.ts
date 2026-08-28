/**
 * Bouwt de opdracht voor de save-stap op vanuit de review-state.
 *
 * Twee soorten bestanden worden verschillend behandeld:
 *
 *   - ``.md``/``.txt`` — we maken hier client-side de geanonimiseerde
 *     tekst direct aan. Dat geeft deterministisch gedrag: wat de
 *     gebruiker in stap 3 zag is letterlijk wat er op disk komt.
 *   - ``.docx``/``.xlsx``/``.pdf`` — we produceren alleen een lijst
 *     vervangingen (in flat-tekst-coördinaten) samen met de block_map.
 *     Het main-proces stuurt dat naar ``/document/apply`` zodat de
 *     engine de originele opmaak zoveel mogelijk kan bewaren.
 *
 * In beide gevallen wordt dezelfde pseudoniem-mapping gebruikt zodat
 * hetzelfde origineel in alle bestanden hetzelfde pseudoniem krijgt.
 */

import type {
  AnalyzeHit,
  DocumentReplacement,
  RunDocumentFileInput,
  RunFileInput,
  RunMappingEntry,
  RunTextFileInput,
} from '@shared/api';
import { effectiveDecision, type FileReview, type ReviewState } from './reviewTypes';
import type { AnonymizeMode } from './settingsTypes';
import type { WizardFileEntry } from './wizardTypes';

export interface BuildRunResult {
  files: RunFileInput[];
  mapping: RunMappingEntry[];
  skipped: Array<{
    sourcePath: string;
    sourceName: string;
    extension: string;
    reason: string;
  }>;
}

function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

function acceptedHits(file: FileReview, whitelist: string[]): AnalyzeHit[] {
  return (file.hits ?? []).filter(
    (h) => effectiveDecision(h, file, whitelist) === 'accept'
  );
}

/**
 * Filter overlappende hits weg en geef de rest in leesvolgorde terug.
 *
 * Overlap ontstaat vooral door handmatig markeren: de gebruiker sleept
 * over "Anne de Vries" terwijl de detector "Anne" al had gevonden. Zou je
 * beide vervangen, dan knip je in een stuk tekst dat er niet meer staat.
 * De hit die het verst naar rechts begint wint.
 */
function selectNonOverlapping(hits: AnalyzeHit[]): AnalyzeHit[] {
  const rightToLeft = hits.slice().sort((a, b) => b.start - a.start);
  const kept: AnalyzeHit[] = [];
  let lastStart = Infinity;
  for (const hit of rightToLeft) {
    if (hit.end > lastStart) continue;
    kept.push(hit);
    lastStart = hit.start;
  }
  return kept.reverse();
}

/**
 * Vervangingen toepassen van achter naar voren, zodat de offsets van de
 * nog niet verwerkte hits geldig blijven.
 *
 * De vervangingen zélf worden in leesvolgorde opgevraagd: anders krijgt
 * de laatste naam in het document ``PERSON_1`` en telt de mapping voor
 * een lezer averechts.
 */
function applyReplacementsToText(
  text: string,
  hits: AnalyzeHit[],
  replacementFor: (hit: AnalyzeHit) => string
): string {
  const applicable = selectNonOverlapping(hits);
  const replacements = applicable.map(replacementFor);

  let out = text;
  for (let i = applicable.length - 1; i >= 0; i--) {
    const hit = applicable[i];
    out = out.slice(0, hit.start) + replacements[i] + out.slice(hit.end);
  }
  return out;
}

export function buildRun(
  files: WizardFileEntry[],
  review: ReviewState,
  mode: AnonymizeMode
): BuildRunResult {
  const mapping: RunMappingEntry[] = [];
  const mappingIndex = new Map<string, string>();
  const counters = new Map<string, number>();
  const resultFiles: RunFileInput[] = [];
  const skipped: BuildRunResult['skipped'] = [];

  const pseudonymFor = (hit: AnalyzeHit): string => {
    const key = `${hit.entity_type}::${hit.original}`;
    const cached = mappingIndex.get(key);
    if (cached) return cached;
    const n = (counters.get(hit.entity_type) ?? 0) + 1;
    counters.set(hit.entity_type, n);
    const pseudo = `${hit.entity_type}_${n}`;
    mappingIndex.set(key, pseudo);
    mapping.push({
      entity_type: hit.entity_type,
      original: hit.original,
      pseudonym: pseudo,
    });
    return pseudo;
  };

  const replacementFor = (hit: AnalyzeHit): string => {
    if (mode === 'anonymize') return `[${hit.entity_type}]`;
    return pseudonymFor(hit);
  };

  for (const entry of files) {
    if (entry.error) continue;
    const info = entry.info;
    const review_ = review.files[info.path];
    const { stem, ext } = splitExt(info.name);

    if (!review_ || review_.status === 'unsupported') {
      skipped.push({
        sourcePath: info.path,
        sourceName: info.name,
        extension: info.extension,
        reason: 'Dit bestandstype wordt nog niet ondersteund.',
      });
      continue;
    }
    if (review_.status !== 'done' || review_.text === undefined) {
      skipped.push({
        sourcePath: info.path,
        sourceName: info.name,
        extension: info.extension,
        reason:
          review_.status === 'error'
            ? `Analyse was mislukt: ${review_.error ?? 'onbekend'}`
            : 'Analyse was nog niet klaar — ga terug naar stap 3 en wacht tot alle bestanden groen zijn.',
      });
      continue;
    }

    const allHits = review_.hits ?? [];
    const accepted = acceptedHits(review_, review.whitelist);
    const stats = {
      totalHits: allHits.length,
      accepted: accepted.length,
      skipped: allHits.length - accepted.length,
    };

    if (review_.kind === 'text') {
      const anonymizedText = applyReplacementsToText(
        review_.text,
        accepted,
        replacementFor
      );
      const file: RunTextFileInput = {
        kind: 'text',
        sourcePath: info.path,
        sourceName: info.name,
        stem,
        extension: ext || info.extension,
        anonymizedText,
        stats,
      };
      resultFiles.push(file);
      continue;
    }

    // kind === 'document'
    if (!review_.blocks) {
      skipped.push({
        sourcePath: info.path,
        sourceName: info.name,
        extension: info.extension,
        reason:
          'Document-structuur ontbreekt — ga terug naar stap 3 en analyseer opnieuw.',
      });
      continue;
    }
    const replacements: DocumentReplacement[] = selectNonOverlapping(accepted).map((hit) => ({
      start: hit.start,
      end: hit.end,
      replacement: replacementFor(hit),
      original: hit.original,
    }));
    const file: RunDocumentFileInput = {
      kind: 'document',
      sourcePath: info.path,
      sourceName: info.name,
      stem,
      extension: ext || info.extension,
      blocks: review_.blocks,
      replacements,
      stats,
    };
    resultFiles.push(file);
  }

  return { files: resultFiles, mapping, skipped };
}

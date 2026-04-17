/**
 * Renderer-side helpers rond de Ollama-catalog.
 *
 * De *content* van de catalog komt uit het main-proces (gebundelde
 * fallback + optioneel verse remote-cache). Hier alleen een helper om
 * te bepalen of een catalog-naam al lokaal aanwezig is.
 */

import type { OllamaCatalogEntry } from '@shared/api';

export type { OllamaCatalogEntry };

export function ollamaInstalled(
  catalogName: string,
  installed: Array<{ name: string }>
): boolean {
  return installed.some((m) => m.name === catalogName);
}

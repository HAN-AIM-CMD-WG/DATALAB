/**
 * Kleurmapping voor gedetecteerde PII, gebaseerd op de
 * *gebruikers-categorie* (niet de ruwe Presidio-term). Zo blijft
 * bijv. NL_POSTCODE en LOCATION dezelfde kleur houden.
 */

import { ENTITY_CATEGORIES, type EntityCategory } from './settingsTypes';

export interface EntityStyle {
  categoryId: string;
  label: string;
  /** Voor highlights in de tekst. */
  highlight: string;
  /** Voor pill-elementen in de lijst. */
  pill: string;
  /** Voor de "accepted"-kleur van de highlight. */
  strong: string;
}

const PALETTE: Record<string, Omit<EntityStyle, 'categoryId' | 'label'>> = {
  personen: {
    highlight: 'bg-violet-500/15 text-violet-900 dark:text-violet-200',
    pill: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
    strong: 'bg-violet-500/30',
  },
  email: {
    highlight: 'bg-sky-500/15 text-sky-900 dark:text-sky-200',
    pill: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
    strong: 'bg-sky-500/30',
  },
  telefoon: {
    highlight: 'bg-emerald-500/15 text-emerald-900 dark:text-emerald-200',
    pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    strong: 'bg-emerald-500/30',
  },
  bsn: {
    highlight: 'bg-rose-500/15 text-rose-900 dark:text-rose-200',
    pill: 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30',
    strong: 'bg-rose-500/30',
  },
  adres: {
    highlight: 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
    strong: 'bg-amber-500/30',
  },
  ids: {
    highlight: 'bg-fuchsia-500/15 text-fuchsia-900 dark:text-fuchsia-200',
    pill: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
    strong: 'bg-fuchsia-500/30',
  },
  financieel: {
    highlight: 'bg-red-500/15 text-red-900 dark:text-red-200',
    pill: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
    strong: 'bg-red-500/30',
  },
  organisaties: {
    highlight: 'bg-teal-500/15 text-teal-900 dark:text-teal-200',
    pill: 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/30',
    strong: 'bg-teal-500/30',
  },
  url: {
    highlight: 'bg-slate-500/15 text-slate-900 dark:text-slate-200',
    pill: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
    strong: 'bg-slate-500/30',
  },
  datum: {
    highlight: 'bg-orange-500/15 text-orange-900 dark:text-orange-200',
    pill: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
    strong: 'bg-orange-500/30',
  },
};

const FALLBACK: Omit<EntityStyle, 'categoryId' | 'label'> = {
  highlight: 'bg-zinc-500/15 text-zinc-900 dark:text-zinc-200',
  pill: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',
  strong: 'bg-zinc-500/30',
};

/**
 * Pre-berekende lookup van Presidio-entity-type → gebruikerscategorie.
 * Eerste hit wint: zo mapt ORGANIZATION naar 'organisaties' en niet
 * naar een generieke fallback.
 */
const ENTITY_TO_CATEGORY: Map<string, EntityCategory> = (() => {
  const m = new Map<string, EntityCategory>();
  for (const cat of ENTITY_CATEGORIES) {
    for (const ent of cat.entityTypes) {
      if (!m.has(ent)) m.set(ent, cat);
    }
  }
  return m;
})();

export function styleForEntity(entityType: string): EntityStyle {
  const cat = ENTITY_TO_CATEGORY.get(entityType);
  if (!cat) {
    return {
      categoryId: 'onbekend',
      label: entityType,
      ...FALLBACK,
    };
  }
  return {
    categoryId: cat.id,
    label: cat.label,
    ...(PALETTE[cat.id] ?? FALLBACK),
  };
}

import { AlertTriangle } from 'lucide-react';

/**
 * Waarschuwingsbanner. Verdwijnt pas als de gebruiker door de definitieve
 * first-run-flow is gegaan (komt in Fase 3.6). Voor nu tonen we 'm altijd
 * zodat de boodschap "jij blijft verantwoordelijk" van begin af aan helder
 * is, ook in de preview-fase.
 */
export function DisclaimerBanner(): JSX.Element {
  return (
    <div className="border-b border-amber-200/80 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="mx-auto flex max-w-5xl items-start gap-3 px-6 py-2.5 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
        <p className="leading-snug">
          <strong className="font-semibold">Preview — werk in uitvoering.</strong>{' '}
          Gebruik voorlopig geen echte persoonsgegevens buiten een
          goedgekeurde pilotcontext. Anonimiseer is een hulpmiddel; de
          eindcontrole op volledigheid blijft bij jou.
        </p>
      </div>
    </div>
  );
}

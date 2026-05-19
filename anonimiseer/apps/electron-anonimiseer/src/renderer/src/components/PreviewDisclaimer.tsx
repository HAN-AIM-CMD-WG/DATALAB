import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * Subtiele "Preview"-pill met info-tooltip. Vervangt de oude prominente
 * DisclaimerBanner: dezelfde boodschap, maar uit het zicht totdat de
 * gebruiker hem nodig heeft.
 *
 * ``placement`` bepaalt aan welke kant de popover opent. Default
 * ``below`` werkt voor gebruik in de header; ``above`` is bruikbaar
 * onderaan een venster (bv. een sticky balk).
 */
export function PreviewDisclaimer({
  placement = 'below',
}: {
  placement?: 'above' | 'below';
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toon disclaimer"
        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <Info className="h-3 w-3" aria-hidden />
        Preview
      </button>
      {open && (
        <div
          role="tooltip"
          className={
            placement === 'above'
              ? 'absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg'
              : 'absolute left-0 top-full z-50 mt-2 w-72 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg'
          }
        >
          <p className="font-medium text-foreground">Preview — werk in uitvoering</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            Gebruik voorlopig geen echte persoonsgegevens buiten een goedgekeurde
            pilotcontext. Anonimiseer is een hulpmiddel; de eindcontrole op
            volledigheid blijft bij jou.
          </p>
        </div>
      )}
    </div>
  );
}

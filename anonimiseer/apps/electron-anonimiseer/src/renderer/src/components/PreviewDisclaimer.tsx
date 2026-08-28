import { HoverPanel } from './HoverPanel';
import { cn } from '../lib/utils';

/**
 * Discrete preview-markering naast de titel. Neutraal qua kleur (past bij
 * HAN-grijswaarden); volledige disclaimer in hover-popover.
 */
export function PreviewDisclaimer({
  placement = 'below',
}: {
  placement?: 'above' | 'below';
}): JSX.Element {
  return (
    <HoverPanel
      label="Preview-disclaimer"
      placement={placement}
      align="start"
      trigger={
        <span
          className={cn(
            'inline-flex items-center rounded border border-border/80 bg-muted/25 px-1.5 py-px',
            'text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/55',
            'transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground/75'
          )}
        >
          Preview
        </span>
      }
    >
      <p className="font-medium text-foreground">Preview — werk in uitvoering</p>
      <p className="mt-1.5 leading-relaxed text-muted-foreground">
        Gebruik voorlopig geen echte persoonsgegevens buiten een goedgekeurde
        pilotcontext. Anonimiseer is een hulpmiddel; de eindcontrole op
        volledigheid blijft bij jou.
      </p>
    </HoverPanel>
  );
}

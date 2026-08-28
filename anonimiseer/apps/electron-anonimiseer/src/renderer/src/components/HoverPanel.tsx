import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Lichte hover/focus-popover voor compacte header-chips.
 * Geen externe tooltip-lib nodig; werkt met toetsenbord (Escape sluit).
 */
export function HoverPanel({
  trigger,
  children,
  placement = 'below',
  align = 'start',
  panelClassName,
  label,
  onActivate,
}: {
  trigger: ReactNode;
  children: ReactNode;
  placement?: 'above' | 'below';
  align?: 'start' | 'end' | 'center';
  panelClassName?: string;
  /** Toegankelijke naam voor de trigger (bv. "Engine-status"). */
  label: string;
  /**
   * Als gezet: een klik voert deze actie uit (bv. paneel openen) in plaats
   * van de tooltip te togglen. De tooltip blijft beschikbaar via hover/focus.
   */
  onActivate?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

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

  const alignClass =
    align === 'end'
      ? 'right-0'
      : align === 'center'
        ? 'left-1/2 -translate-x-1/2'
        : 'left-0';

  const placementClass =
    placement === 'above'
      ? cn('bottom-full mb-2', alignClass)
      : cn('top-full mt-2', alignClass);

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => {
          if (onActivate) onActivate();
          else setOpen((v) => !v);
        }}
        className="inline-flex rounded-md border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role="tooltip"
          className={cn(
            'absolute z-50 w-64 rounded-lg border border-border/80 bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md',
            placementClass,
            panelClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

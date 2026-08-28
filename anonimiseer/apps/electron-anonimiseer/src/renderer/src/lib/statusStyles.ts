import { cn } from './utils';

/** HAN-semantische statuskleuren (success / warning / info / destructive). */
export type StatusTone = 'success' | 'warning' | 'info' | 'destructive';

const tonePanel: Record<StatusTone, string> = {
  success: 'border-success/30 bg-success/5 text-success-foreground dark:text-success',
  warning: 'border-warning/30 bg-warning/5 text-warning-foreground dark:text-warning',
  info: 'border-info/30 bg-info/5 text-info-foreground dark:text-info',
  destructive:
    'border-destructive/30 bg-destructive/5 text-foreground dark:text-destructive-foreground',
};

const toneBadge: Record<StatusTone, string> = {
  success:
    'border-success/30 bg-success/10 text-success-foreground dark:text-success',
  warning:
    'border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning',
  info: 'border-info/30 bg-info/10 text-info-foreground dark:text-info',
  destructive:
    'border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive',
};

const toneIcon: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
};

const toneIconBg: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/10 text-info',
  destructive: 'bg-destructive/15 text-destructive',
};

export function statusPanel(tone: StatusTone, className?: string): string {
  return cn('rounded-xl border', tonePanel[tone], className);
}

export function statusBadge(tone: StatusTone, className?: string): string {
  return cn(toneBadge[tone], className);
}

export function statusIcon(tone: StatusTone, className?: string): string {
  return cn(toneIcon[tone], className);
}

export function statusIconBg(tone: StatusTone, className?: string): string {
  return cn(toneIconBg[tone], className);
}

export function statusNotice(tone: StatusTone, className?: string): string {
  return cn(
    'flex items-start gap-3 rounded-xl border p-3 text-sm',
    tonePanel[tone],
    className
  );
}

/** Subtiele header-chip — neutrale capsule, status via gekleurde dot. */
export function statusChip(className?: string): string {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors',
    'hover:border-border hover:bg-muted/30 hover:text-foreground/80',
    className
  );
}

export function statusDot(tone: StatusTone | 'neutral', className?: string): string {
  const color =
    tone === 'neutral'
      ? 'bg-muted-foreground/50 shadow-[0_0_0_2px_hsl(var(--muted-foreground)/0.12)]'
      : tone === 'success'
        ? 'bg-success shadow-[0_0_0_2px_hsl(var(--success)/0.22)]'
        : tone === 'warning'
          ? 'bg-warning shadow-[0_0_0_2px_hsl(var(--warning)/0.22)]'
          : tone === 'info'
            ? 'bg-info shadow-[0_0_0_2px_hsl(var(--info)/0.22)]'
            : 'bg-destructive shadow-[0_0_0_2px_hsl(var(--destructive)/0.22)]';
  return cn('h-1.5 w-1.5 shrink-0 rounded-full', color, className);
}

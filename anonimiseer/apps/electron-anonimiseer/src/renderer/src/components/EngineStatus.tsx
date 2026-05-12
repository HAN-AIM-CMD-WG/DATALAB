import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { EngineHealth } from '@shared/api';
import { cn } from '../lib/utils';

/**
 * Live-indicator van de pii-engine sidecar.
 *
 * Delegeert naar het main-proces (zie ``src/main/engineBridge.ts``) zodat
 * er vanuit de renderer geen directe netwerkcalls plaatsvinden en de CSP
 * strak dicht kan blijven.
 */
export function EngineStatus({
  state,
}: {
  state: EngineHealth | { status: 'checking' };
}): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
        state.status === 'ok' &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        state.status === 'down' &&
          'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
        state.status === 'checking' &&
          'border-border/60 bg-muted/60 text-muted-foreground'
      )}
      aria-live="polite"
    >
      {state.status === 'checking' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span>Engine controleren…</span>
        </>
      )}
      {state.status === 'ok' && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          <span>
            Engine online · {state.recognizers} recognizers · {state.spacyModel}
          </span>
        </>
      )}
      {state.status === 'down' && (
        <>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          <span>Engine niet bereikbaar</span>
          <span className="sr-only">{state.reason}</span>
        </>
      )}
    </div>
  );
}

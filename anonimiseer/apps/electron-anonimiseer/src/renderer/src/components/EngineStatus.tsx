import { useEffect, useState } from 'react';
import { CircleDot, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Live-indicator van de pii-engine sidecar.
 *
 * In deze scaffold-fase verbindt de renderer zelf direct met
 * ``http://127.0.0.1:8765/health`` (CSP staat dat toe, zie index.html).
 * In Fase 3.2 verplaatsen we deze check naar de main-process waar hij
 * onderdeel wordt van een proper sidecar-lifecycle (spawn, graceful
 * shutdown, restart-knop).
 */

type HealthState =
  | { status: 'checking' }
  | { status: 'ok'; recognizers: number; model: string; version: string }
  | { status: 'down'; reason: string };

const ENGINE_URL = 'http://127.0.0.1:8765/health';
const POLL_INTERVAL_MS = 5000;

export function EngineStatus(): JSX.Element {
  const [state, setState] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const response = await fetch(ENGINE_URL, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) {
          if (active) {
            setState({ status: 'down', reason: `HTTP ${response.status}` });
          }
          return;
        }
        const data = (await response.json()) as {
          status: string;
          version: string;
          recognizers: number;
          spacy_model: string;
        };
        if (active) {
          setState({
            status: 'ok',
            recognizers: data.recognizers,
            model: data.spacy_model,
            version: data.version,
          });
        }
      } catch (error) {
        if (active) {
          const reason = error instanceof Error ? error.message : 'onbekend';
          setState({ status: 'down', reason });
        }
      }
    };
    void check();
    const interval = setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
            Engine online · {state.recognizers} recognizers · {state.model}
          </span>
        </>
      )}
      {state.status === 'down' && (
        <>
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          <span>Engine niet bereikbaar — start de pii-engine op poort 8765</span>
          <CircleDot className="ml-1 h-3 w-3 opacity-40" aria-hidden />
          <span className="sr-only">{state.reason}</span>
        </>
      )}
    </div>
  );
}

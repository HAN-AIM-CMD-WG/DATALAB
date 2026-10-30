import { useState } from 'react';
import { AlertCircle, ClipboardCopy, ClipboardCheck, RefreshCw } from 'lucide-react';
import type { EngineHealth } from '@shared/api';
import { cn } from '../lib/utils';
import { statusBadge, statusIconBg, statusPanel } from '../lib/statusStyles';

/**
 * Expliciete fallback wanneer de pii-engine niet bereikbaar is.
 *
 * De geïnstalleerde app start de engine zelf; lukt dat niet, dan krijgt de
 * gebruiker stappen die zonder terminal werken. Alleen in een ontwikkelbuild,
 * waar je de engine zelf start, tonen we het commando.
 */

const START_COMMAND = `cd anonimiseer/packages/pii-engine
source .venv/bin/activate
PII_ENGINE_ENABLE_BSN=true PII_ENGINE_ENABLE_SONAR=true pii-engine`;

export function EngineOfflinePanel({
  health,
  onRetry,
}: {
  health: EngineHealth & { status: 'down' };
  onRetry?: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const packaged = window.anonimiseer.version.packaged;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(START_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className={cn(statusPanel('destructive', 'rounded-2xl p-6 shadow-sm'))}>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 flex-none items-center justify-center rounded-lg',
            statusIconBg('destructive')
          )}
        >
          <AlertCircle className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              De anonimiseringsengine draait niet
            </h3>
            <p className="mt-1 text-sm text-foreground/80">
              {packaged
                ? 'Zonder engine kan Anonimiseer geen persoonsgegevens vinden. Anonimiseer start de engine zelf bij het openen, maar dat is nu niet gelukt.'
                : 'Zonder engine kan Anonimiseer geen persoonsgegevens vinden. In een ontwikkelbuild start je de engine zelf; de geïnstalleerde app doet dat automatisch.'}
            </p>
          </div>

          <details className="rounded-lg border border-destructive/20 bg-background/60 p-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
              Technische details
            </summary>
            <dl className="mt-2 space-y-1 text-xs text-foreground/80">
              <div className="flex gap-2">
                <dt className="font-medium">URL:</dt>
                <dd>
                  <code>{health.url}</code>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Reden:</dt>
                <dd>{health.reason}</dd>
              </div>
            </dl>
          </details>

          {packaged ? (
            <div>
              <p className="text-sm font-medium text-foreground">Wat kun je doen?</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground/90">
                <li>Sluit Anonimiseer helemaal af en open de app opnieuw.</li>
                <li>Gebeurt het weer, herstart dan je computer en probeer het nog eens.</li>
                <li>
                  Lukt het dan nog niet, geef de reden onder <em>Technische details</em> door
                  aan wie Anonimiseer bij jou beheert.
                </li>
              </ol>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Opnieuw controleren
              </button>
            </div>
          ) : (
          <div>
            <p className="text-sm font-medium text-foreground">
              Hoe start ik de engine?
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-foreground/90">
              <li>Open een terminal.</li>
              <li>Plak en voer onderstaand commando uit.</li>
              <li>
                Wacht op <code>Application startup complete</code> en klik
                hieronder op <em>Opnieuw controleren</em>.
              </li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-md border border-destructive/20 bg-background/80 p-3 text-[12px] leading-relaxed text-foreground">
{START_COMMAND}
            </pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                  copied
                    ? statusBadge('success')
                    : 'border-destructive/30 bg-background/80 text-foreground hover:bg-background'
                )}
              >
                {copied ? (
                  <>
                    <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
                    Gekopieerd
                  </>
                ) : (
                  <>
                    <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                    Kopieer commando
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background/80 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-background"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Opnieuw controleren
              </button>
            </div>
          </div>
          )}
        </div>
      </div>
    </section>
  );
}

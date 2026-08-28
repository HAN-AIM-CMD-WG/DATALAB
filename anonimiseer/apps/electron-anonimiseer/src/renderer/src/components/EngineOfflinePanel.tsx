import { useState } from 'react';
import { AlertCircle, ClipboardCopy, ClipboardCheck, RefreshCw } from 'lucide-react';
import type { EngineHealth } from '@shared/api';
import { cn } from '../lib/utils';
import { statusBadge, statusIconBg, statusPanel } from '../lib/statusStyles';

/**
 * Expliciete fallback wanneer de pii-engine niet bereikbaar is.
 *
 * De minimum-variant van Fase 3.2: we spawnen (nog) niet zelf, dus
 * we leggen *zo concreet mogelijk* uit wat de gebruiker moet doen om
 * de engine online te krijgen. In Fase 3.8 (PyInstaller) wordt dit
 * automatisch en verdwijnt dit paneel.
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
              De anonimiseringsengine draait nog niet
            </h3>
            <p className="mt-1 text-sm text-foreground/80">
              Zonder engine kan Anonimiseer geen PII detecteren. Start de
              engine handmatig — in een toekomstige versie doen we dat
              automatisch bij het openen van de app.
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
        </div>
      </div>
    </section>
  );
}

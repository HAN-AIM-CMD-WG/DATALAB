import { Loader2, SlidersHorizontal } from 'lucide-react';
import type { EngineHealth } from '@shared/api';
import { cn } from '../lib/utils';
import { statusChip, statusDot } from '../lib/statusStyles';
import { HoverPanel } from './HoverPanel';

/**
 * Live-indicator van de pii-engine sidecar.
 *
 * Compacte chip in de header; technische details in een tooltip.
 */
export function EngineStatus({
  state,
  onOpenModels,
}: {
  state: EngineHealth | { status: 'checking' };
  onOpenModels?: () => void;
}): JSX.Element {
  const tone =
    state.status === 'ok'
      ? 'success'
      : state.status === 'down'
        ? 'destructive'
        : 'neutral';

  const label =
    state.status === 'ok'
      ? 'Online'
      : state.status === 'down'
        ? 'Offline'
        : 'Controleren';

  return (
    <HoverPanel
      label="Engine-status — klik om modellen te beheren"
      placement="below"
      align="end"
      onActivate={onOpenModels}
      trigger={
        <span
          className={cn(statusChip(), onOpenModels ? 'cursor-pointer' : 'cursor-default')}
          aria-live="polite"
        >
          {state.status === 'checking' ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <span className={statusDot(tone)} aria-hidden />
          )}
          <span>Engine · {label}</span>
        </span>
      }
    >
      {state.status === 'ok' && <EngineTooltipOk health={state} />}
      {state.status === 'down' && <EngineTooltipDown health={state} />}
      {state.status === 'checking' && (
        <p className="text-muted-foreground">
          Verbinding met de lokale PII-engine controleren…
        </p>
      )}
      {onOpenModels && state.status !== 'down' && (
        <p className="mt-2 flex items-center gap-1 border-t border-border/60 pt-2 text-[11px] font-medium text-foreground/70">
          <SlidersHorizontal className="h-3 w-3" aria-hidden />
          Klik om modellen te beheren
        </p>
      )}
    </HoverPanel>
  );
}

function EngineTooltipOk({
  health,
}: {
  health: Extract<EngineHealth, { status: 'ok' }>;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">PII-engine actief</p>
      <dl className="space-y-1 text-[11px] text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>Recognizers</dt>
          <dd className="font-medium text-foreground">{health.recognizers}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>spaCy-model</dt>
          <dd className="font-mono text-foreground">{health.spacyModel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Endpoint</dt>
          <dd className="font-mono text-foreground">{health.url}</dd>
        </div>
      </dl>
      <p className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        Detectie en anonimisering verlopen volledig lokaal op deze machine.
      </p>
    </div>
  );
}

function EngineTooltipDown({
  health,
}: {
  health: Extract<EngineHealth, { status: 'down' }>;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <p className="font-medium text-foreground">Engine niet bereikbaar</p>
      <p className="text-[11px] text-muted-foreground">{health.reason}</p>
      <p className="font-mono text-[11px] text-foreground/80">{health.url}</p>
      <p className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
        Start de engine handmatig of klik op <em>Opnieuw controleren</em> in het
        paneel hieronder.
      </p>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineHealth } from '@shared/api';

const POLL_INTERVAL_MS = 5000;

/**
 * Gedeelde hook die de engine-status pollt via de preload-bridge. Zowel
 * de ``EngineStatus``-pill in de header als de offline-helper in de
 * hoofdinhoud gebruiken dezelfde state, zodat er maar één poll-timer
 * actief is en de UI consistent blijft. ``recheck`` controleert direct,
 * zonder op de volgende poll te wachten.
 */
export function useEngineHealth(): {
  health: EngineHealth | { status: 'checking' };
  recheck: () => void;
} {
  const [health, setHealth] = useState<EngineHealth | { status: 'checking' }>({
    status: 'checking',
  });
  const active = useRef(true);

  const recheck = useCallback(() => {
    void window.anonimiseer.engine.health().then((result) => {
      if (active.current) setHealth(result);
    });
  }, []);

  useEffect(() => {
    active.current = true;
    recheck();
    const interval = setInterval(recheck, POLL_INTERVAL_MS);
    return () => {
      active.current = false;
      clearInterval(interval);
    };
  }, [recheck]);

  return { health, recheck };
}

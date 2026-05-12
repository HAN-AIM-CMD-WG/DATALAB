import { useEffect, useState } from 'react';
import type { EngineHealth } from '@shared/api';

const POLL_INTERVAL_MS = 5000;

/**
 * Gedeelde hook die de engine-status pollt via de preload-bridge. Zowel
 * de ``EngineStatus``-pill in de header als de offline-helper in de
 * hoofdinhoud gebruiken dezelfde state, zodat er maar één poll-timer
 * actief is en de UI consistent blijft.
 */
export function useEngineHealth(): EngineHealth | { status: 'checking' } {
  const [state, setState] = useState<EngineHealth | { status: 'checking' }>({
    status: 'checking',
  });

  useEffect(() => {
    let active = true;
    const check = async (): Promise<void> => {
      const result = await window.anonimiseer.engine.health();
      if (active) {
        setState(result);
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

  return state;
}

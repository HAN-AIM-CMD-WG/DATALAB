import { useCallback, useEffect, useState } from 'react';
import type { AppSettings } from '@shared/api';

/**
 * Leest de appsettings uit het main-proces en biedt een ``update`` helper
 * die atomair schrijft en de lokale state meteen bijwerkt.
 *
 * Tijdens het allereerste renderpad is ``settings`` ``null``; componenten
 * die er direct op leunen moeten dat respecteren (of wachten op een
 * truthy waarde).
 */
export function useSettings(): {
  settings: AppSettings | null;
  update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  reload: () => Promise<void>;
} {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const next = await window.anonimiseer.settings.get();
    setSettings(next);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      const next = await window.anonimiseer.settings.set(patch);
      setSettings(next);
      return next;
    },
    []
  );

  return { settings, update, reload };
}

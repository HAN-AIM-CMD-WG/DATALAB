import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Building2, Trash2, Upload } from 'lucide-react';
import type { ActiveEngineInfo, EngineConfigPatch, ModelInfo, OrgProfile } from '@shared/api';
import { cn } from '../lib/utils';
import { statusIcon, statusPanel } from '../lib/statusStyles';

/**
 * Het profiel van de organisatie: onderwijsherkenners aan of uit, en de eigen
 * begrippen die de engine zoekt.
 *
 * De engine onthoudt het actieve profiel; dit paneel leest het daar terug.
 * Wie niets heeft gekozen, draait op de standaard van de engine (de
 * onderwijsherkenners aan), en dat tonen we als "HAN-onderwijs".
 */
export function ProfilePanel({
  info,
  customTermsModel,
  busy,
  onApply,
}: {
  info: ActiveEngineInfo | null;
  /** The GLiNER2 model; own terms need it downloaded. */
  customTermsModel: ModelInfo | undefined;
  busy: string | null;
  onApply: (patch: EngineConfigPatch, busyKey: string, successMsg: string) => Promise<void>;
}): JSX.Element {
  const [profiles, setProfiles] = useState<OrgProfile[]>([]);
  const [importMessage, setImportMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    setProfiles(await window.anonimiseer.profiles.list());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active =
    info === null
      ? undefined
      : info.profileName
        ? profiles.find((p) => p.name === info.profileName)
        : profiles.find((p) => p.id === (info.hanEduEnabled ? 'han-onderwijs' : 'algemeen'));
  const termsNeedModel = (active?.terms.length ?? 0) > 0 && !customTermsModel?.installed;

  const activate = (profile: OrgProfile): Promise<void> =>
    onApply(
      { profileName: profile.name, enableHanEdu: profile.hanEdu, customTerms: profile.terms },
      `profile:${profile.id}`,
      profile.terms.length > 0
        ? `Profiel "${profile.name}" is actief; het model voor de eigen begrippen wordt geladen.`
        : `Profiel "${profile.name}" is actief.`
    );

  const importProfile = async (): Promise<void> => {
    const res = await window.anonimiseer.profiles.import();
    if (res === null) return;
    setImportMessage(
      res.ok
        ? { ok: true, text: `Profiel "${res.profile.name}" toegevoegd. Kies het hierboven om het te gebruiken.` }
        : { ok: false, text: res.error }
    );
    await reload();
  };

  const remove = async (profile: OrgProfile): Promise<void> => {
    setProfiles(await window.anonimiseer.profiles.remove(profile.id));
    setImportMessage(null);
  };

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-card p-4 text-xs">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="h-4 w-4" aria-hidden />
        </div>
        <div className="flex-1">
          <h3 className="font-heading text-sm font-semibold tracking-tight">
            Profiel van je organisatie
          </h3>
          <p className="text-muted-foreground">
            Bepaalt of de onderwijscodes meedoen en welke eigen begrippen worden gezocht, zoals
            een dossiernummer. Profielen van je organisatie krijg je als bestand van je
            beheerder.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="org-profile">
          Actief profiel
        </label>
        <select
          id="org-profile"
          value={active?.id ?? ''}
          disabled={busy !== null || info === null}
          onChange={(e) => {
            const next = profiles.find((p) => p.id === e.target.value);
            if (next) void activate(next);
          }}
          className="h-8 min-w-[14rem] rounded-md border border-border/60 bg-background px-2 text-xs"
        >
          {!active && (
            <option value="" disabled>
              {info?.profileName ? `${info.profileName} (niet meer op deze computer)` : 'Kies een profiel'}
            </option>
          )}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtIn ? '' : ' (eigen profiel)'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void importProfile()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 hover:bg-muted"
        >
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Profiel importeren…
        </button>
      </div>

      {active && (
        <div className="space-y-2">
          <p className="text-muted-foreground">{active.description || 'Geen omschrijving.'}</p>
          {active.terms.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Eigen begrippen (worden altijd gezocht)</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {active.terms.map((t) => (
                  <li
                    key={t.label}
                    title={t.description}
                    className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-700 dark:text-cyan-300"
                  >
                    {t.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {termsNeedModel && (
            <p className={cn('flex items-start gap-1.5', statusIcon('warning'))}>
              <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden />
              Download eerst {customTermsModel?.label ?? 'het model voor eigen begrippen'} hieronder;
              tot die tijd worden deze begrippen niet gezocht.
            </p>
          )}
        </div>
      )}

      {profiles.some((p) => !p.builtIn) && (
        <ul className="space-y-1 border-t border-border/60 pt-2">
          {profiles
            .filter((p) => !p.builtIn)
            .map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="flex-1 truncate">
                  {p.name} · {p.terms.length} eigen begrip{p.terms.length === 1 ? '' : 'pen'}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(p)}
                  disabled={p.id === active?.id}
                  title={p.id === active?.id ? 'Kies eerst een ander profiel' : 'Profiel verwijderen'}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Verwijderen
                </button>
              </li>
            ))}
        </ul>
      )}

      {importMessage && (
        <p
          className={cn(
            importMessage.ok ? statusPanel('success', 'p-2') : statusPanel('destructive', 'p-2')
          )}
        >
          {importMessage.text}
        </p>
      )}
    </section>
  );
}

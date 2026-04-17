import { useState } from 'react';
import {
  Settings2,
  KeyRound,
  EyeOff,
  Check,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ChevronDown,
  RotateCcw,
  Info,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ENTITY_CATEGORIES,
  SENSITIVITY_THRESHOLDS,
  defaultWizardSettings,
  resolveEntities,
  resolveThreshold,
  type AnonymizeMode,
  type Sensitivity,
  type WizardSettings,
} from './settingsTypes';

/**
 * Wizard-stap 2: Instellingen.
 *
 * Ontworpen voor een niet-technische gebruiker:
 *   - twee kaarten i.p.v. een abstracte radiogroep voor mode;
 *   - drie zichtbare gevoeligheidsniveaus i.p.v. een 0-1 slider
 *     (die zit onder "Geavanceerd" voor wie 'm wil);
 *   - categorieën in mensentaal met voorbeelden — Presidio-namen
 *     zijn verstopt in de vertaallaag in settingsTypes.ts;
 *   - alles heeft een zichtbaar, veilig default.
 */
export function Step2Settings({
  settings,
  onChange,
}: {
  settings: WizardSettings;
  onChange: (next: WizardSettings) => void;
}): JSX.Element {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const update = <K extends keyof WizardSettings>(key: K, value: WizardSettings[K]): void => {
    onChange({ ...settings, [key]: value });
  };

  const toggleCategory = (id: string, checked: boolean): void => {
    onChange({
      ...settings,
      enabledCategories: { ...settings.enabledCategories, [id]: checked },
    });
  };

  const setAllCategories = (value: boolean): void => {
    const next: Record<string, boolean> = {};
    for (const cat of ENTITY_CATEGORIES) next[cat.id] = value;
    onChange({ ...settings, enabledCategories: next });
  };

  const resetToDefaults = (): void => onChange(defaultWizardSettings());

  const enabledCount = Object.values(settings.enabledCategories).filter(Boolean).length;
  const canContinue = enabledCount > 0;

  return (
    <div className="space-y-8">
      <Header onReset={resetToDefaults} />

      <section className="space-y-3">
        <SectionTitle
          step="1"
          title="Hoe wil je PII vervangen?"
          hint="Kies wat er moet gebeuren met gevonden gegevens."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <ModeCard
            id="pseudonymize"
            icon={<KeyRound className="h-4 w-4" aria-hidden />}
            label="Pseudonimiseren"
            badge="Aanbevolen"
            description="Vervang door codes zoals PERSON_1. Omkeerbaar als je de sleutel later bewaart."
            example={{ before: 'Jan Jansen belde', after: 'PERSON_1 belde' }}
            selected={settings.mode === 'pseudonymize'}
            onSelect={(v) => update('mode', v)}
          />
          <ModeCard
            id="anonymize"
            icon={<EyeOff className="h-4 w-4" aria-hidden />}
            label="Anonimiseren"
            description="Vervang door [VERBORGEN]. Niet meer terug te herleiden — veilig om extern te delen."
            example={{ before: 'Jan Jansen belde', after: '[VERBORGEN] belde' }}
            selected={settings.mode === 'anonymize'}
            onSelect={(v) => update('mode', v)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          step="2"
          title="Hoe streng moet Anonimiseer zijn?"
          hint="Strenger = minder fout-positieven, maar grotere kans dat echte PII gemist wordt."
        />
        <div className="grid gap-2 md:grid-cols-3">
          <SensitivityCard
            id="voorzichtig"
            icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
            label="Voorzichtig"
            description="Liever te veel markeren dan iets missen. Jij filtert zelf in de volgende stap."
            selected={settings.sensitivity === 'voorzichtig'}
            onSelect={(v) => update('sensitivity', v)}
          />
          <SensitivityCard
            id="standaard"
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
            label="Standaard"
            description="Evenwichtige balans tussen recall en precisie. Past bij de meeste documenten."
            selected={settings.sensitivity === 'standaard'}
            onSelect={(v) => update('sensitivity', v)}
          />
          <SensitivityCard
            id="streng"
            icon={<ShieldQuestion className="h-4 w-4" aria-hidden />}
            label="Streng"
            description="Alleen zekere treffers. Sneller klaar, maar twijfelgevallen kunnen doorglippen."
            selected={settings.sensitivity === 'streng'}
            onSelect={(v) => update('sensitivity', v)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          step="3"
          title="Wat mag Anonimiseer opsporen?"
          hint="Alles wat aanstaat wordt in stap 3 aan je voorgelegd voordat het vervangen wordt."
          action={
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAllCategories(true)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Alles aan
              </button>
              <span className="text-border">·</span>
              <button
                type="button"
                onClick={() => setAllCategories(false)}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Alles uit
              </button>
            </div>
          }
        />
        <ul className="grid gap-2 md:grid-cols-2">
          {ENTITY_CATEGORIES.map((cat) => {
            const checked = !!settings.enabledCategories[cat.id];
            return (
              <li key={cat.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    checked
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/70 hover:bg-muted/40'
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 flex-none accent-primary"
                    checked={checked}
                    onChange={(e) => toggleCategory(cat.id, e.target.checked)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{cat.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {cat.description}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      <span className="font-medium">Voorbeeld:</span>{' '}
                      <code className="rounded bg-background px-1 py-0.5">{cat.example}</code>
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        {!canContinue && (
          <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <Info className="h-3.5 w-3.5" aria-hidden />
            Kies minstens één categorie — anders heeft Anonimiseer niets om naar te zoeken.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border/60 bg-muted/30">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
          aria-expanded={advancedOpen}
        >
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Geavanceerd
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              advancedOpen && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
        {advancedOpen && (
          <div className="space-y-4 border-t border-border/60 px-4 py-4">
            <ThresholdSlider
              sensitivity={settings.sensitivity}
              override={settings.thresholdOverride}
              onChange={(v) => update('thresholdOverride', v)}
            />
            <EntitiesPreview settings={settings} />
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ onReset }: { onReset: () => void }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings2 className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Instellingen</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bepaal hoe streng Anonimiseer zoekt en wat er met gevonden
            gegevens gebeurt. Je bekijkt alles nog voordat er iets verandert.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        title="Zet alles terug naar de veilige standaard"
        className="flex h-7 items-center gap-1 rounded-md border border-border/50 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Standaard
      </button>
    </div>
  );
}

function SectionTitle({
  step,
  title,
  hint,
  action,
}: {
  step: string;
  title: string;
  hint: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            {step}
          </span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <p className="mt-0.5 pl-7 text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function ModeCard({
  id,
  icon,
  label,
  badge,
  description,
  example,
  selected,
  onSelect,
}: {
  id: AnonymizeMode;
  icon: JSX.Element;
  label: string;
  badge?: string;
  description: string;
  example: { before: string; after: string };
  selected: boolean;
  onSelect: (v: AnonymizeMode) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/70 hover:border-border hover:bg-muted/40'
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            {badge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                {badge}
              </span>
            )}
          </div>
        </div>
        <span
          className={cn(
            'flex h-5 w-5 flex-none items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
          aria-hidden
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="rounded-md bg-background/70 p-2 text-[11px] leading-relaxed">
        <div className="text-muted-foreground">
          <span className="font-medium">Voor:</span>{' '}
          <code>{example.before}</code>
        </div>
        <div className="mt-1 text-foreground">
          <span className="font-medium">Na:</span>{' '}
          <code className="rounded bg-primary/10 px-1 py-0.5 text-primary">
            {example.after}
          </code>
        </div>
      </div>
    </button>
  );
}

function SensitivityCard({
  id,
  icon,
  label,
  description,
  selected,
  onSelect,
}: {
  id: Sensitivity;
  icon: JSX.Element;
  label: string;
  description: string;
  selected: boolean;
  onSelect: (v: Sensitivity) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/70 hover:border-border hover:bg-muted/40'
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
          )}
          aria-hidden
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

function ThresholdSlider({
  sensitivity,
  override,
  onChange,
}: {
  sensitivity: Sensitivity;
  override: number | null;
  onChange: (value: number | null) => void;
}): JSX.Element {
  const effective = override ?? SENSITIVITY_THRESHOLDS[sensitivity];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <label htmlFor="threshold" className="font-medium text-foreground">
          Technische drempelwaarde
        </label>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{effective.toFixed(2)}</span>
          {override !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted"
            >
              Reset naar {sensitivity}
            </button>
          )}
        </div>
      </div>
      <input
        id="threshold"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={effective}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
      <p className="text-[11px] text-muted-foreground">
        0.00 = alles laten zien · 1.00 = alleen 100% zekere hits. Wijzig
        dit alleen als je weet waar je mee bezig bent.
      </p>
    </div>
  );
}

function EntitiesPreview({ settings }: { settings: WizardSettings }): JSX.Element {
  const entities = resolveEntities(settings);
  const threshold = resolveThreshold(settings);
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <p className="font-medium text-foreground/80">
        Wat gaat er precies naar de engine?
      </p>
      <p>
        <span className="font-medium">Threshold:</span> {threshold.toFixed(2)} ·{' '}
        <span className="font-medium">Mode:</span>{' '}
        <code className="rounded bg-background px-1 py-0.5">{settings.mode}</code>
      </p>
      <p>
        <span className="font-medium">Entiteiten ({entities.length}):</span>{' '}
        {entities.length === 0 ? (
          <span className="text-amber-700 dark:text-amber-300">(geen — kies eerst een categorie)</span>
        ) : (
          entities.map((e) => (
            <code key={e} className="mx-0.5 rounded bg-background px-1 py-0.5">
              {e}
            </code>
          ))
        )}
      </p>
    </div>
  );
}

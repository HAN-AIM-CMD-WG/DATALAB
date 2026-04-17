import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Construction } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Step1FilePicker } from './Step1FilePicker';
import { Step2Settings } from './Step2Settings';
import {
  WIZARD_STEPS,
  type WizardFileEntry,
  type WizardStepId,
} from './wizardTypes';
import { defaultWizardSettings, type WizardSettings } from './settingsTypes';

/**
 * Wizard-container: stepper + inhoud + navigatieknoppen.
 *
 * De staat leeft hier (single source of truth). Stap-componenten krijgen
 * alleen de relevante slice + een setter. Later kunnen we dit naar een
 * context/reducer promoten; voor nu is het klein genoeg.
 */
export function Wizard(): JSX.Element {
  const [step, setStep] = useState<WizardStepId>('files');
  const [files, setFiles] = useState<WizardFileEntry[]>([]);
  const [settings, setSettings] = useState<WizardSettings>(defaultWizardSettings());

  const validFileCount = useMemo(
    () => files.filter((f) => !f.error).length,
    [files]
  );
  const enabledCategoryCount = useMemo(
    () => Object.values(settings.enabledCategories).filter(Boolean).length,
    [settings.enabledCategories]
  );

  const canAdvanceFromFiles = validFileCount > 0;
  const canAdvanceFromSettings = enabledCategoryCount > 0;

  const furthestReached: WizardStepId | null = canAdvanceFromFiles
    ? canAdvanceFromSettings
      ? 'settings'
      : 'files'
    : null;

  const canAdvance = (from: WizardStepId): boolean => {
    if (from === 'files') return canAdvanceFromFiles;
    if (from === 'settings') return canAdvanceFromSettings;
    return true;
  };

  const goTo = (target: WizardStepId): void => {
    const currentIdx = WIZARD_STEPS.findIndex((s) => s.id === step);
    const targetIdx = WIZARD_STEPS.findIndex((s) => s.id === target);
    if (targetIdx <= currentIdx) {
      setStep(target);
      return;
    }
    // Vooruit alleen als alle tussenstappen klaar zijn.
    for (let i = currentIdx; i < targetIdx; i += 1) {
      if (!canAdvance(WIZARD_STEPS[i].id)) return;
    }
    setStep(target);
  };

  const nextStep = (): void => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    const next = WIZARD_STEPS[idx + 1];
    if (next) goTo(next.id);
  };

  const prevStep = (): void => {
    const idx = WIZARD_STEPS.findIndex((s) => s.id === step);
    const prev = WIZARD_STEPS[idx - 1];
    if (prev) setStep(prev.id);
  };

  return (
    <section className="space-y-6">
      <Stepper current={step} furthestReached={furthestReached} onSelect={goTo} />

      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-sm">
        {step === 'files' && <Step1FilePicker files={files} onChange={setFiles} />}
        {step === 'settings' && (
          <Step2Settings settings={settings} onChange={setSettings} />
        )}
        {step === 'review' && <ComingSoon step="Controleren" />}
        {step === 'save' && <ComingSoon step="Opslaan" />}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevStep}
          disabled={WIZARD_STEPS[0].id === step}
          className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Terug
        </button>
        <div className="text-xs text-muted-foreground">
          {step === 'files' && validFileCount > 0 && (
            <>
              {validFileCount} bestand{validFileCount === 1 ? '' : 'en'} klaar
            </>
          )}
          {step === 'settings' && (
            <>
              {enabledCategoryCount} categorie
              {enabledCategoryCount === 1 ? '' : 'ën'} aan
            </>
          )}
        </div>
        <button
          type="button"
          onClick={nextStep}
          disabled={step === 'save' || !canAdvance(step)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors',
            'hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40'
          )}
        >
          Volgende
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

function Stepper({
  current,
  furthestReached,
  onSelect,
}: {
  current: WizardStepId;
  furthestReached: WizardStepId | null;
  onSelect: (id: WizardStepId) => void;
}): JSX.Element {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const reachedIdx = furthestReached
    ? WIZARD_STEPS.findIndex((s) => s.id === furthestReached)
    : -1;

  return (
    <ol className="flex items-center gap-3 text-xs text-muted-foreground">
      {WIZARD_STEPS.map((step, idx) => {
        const state: 'done' | 'active' | 'todo' =
          idx === currentIdx ? 'active' : idx <= reachedIdx ? 'done' : 'todo';
        const clickable = idx <= currentIdx || idx <= reachedIdx + 1;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(step.id)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-medium transition-colors',
                state === 'active' &&
                  'border-primary bg-primary text-primary-foreground',
                state === 'done' && 'border-primary/30 bg-primary/10 text-primary',
                state === 'todo' && 'border-border/60 bg-background text-muted-foreground',
                clickable && 'cursor-pointer hover:border-primary/60'
              )}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              {state === 'done' ? <Check className="h-3 w-3" aria-hidden /> : idx + 1}
            </button>
            <span
              className={cn(
                state === 'active' && 'text-foreground',
                state === 'done' && 'text-foreground/80'
              )}
            >
              {step.label}
            </span>
            {idx < WIZARD_STEPS.length - 1 && (
              <span className="mx-1 h-px w-8 bg-border/60" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ComingSoon({ step }: { step: string }): JSX.Element {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Construction className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="text-base font-semibold">Stap "{step}" komt eraan</h3>
      <p className="text-sm text-muted-foreground">
        Deze stap bouwen we in de volgende iteratie. Ga terug naar de vorige
        stap om de bestandenlijst aan te passen.
      </p>
    </div>
  );
}

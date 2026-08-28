import { useCallback, useRef, useState } from 'react';
import {
  UploadCloud,
  FolderOpen,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import type { DialogFileInfo } from '@shared/api';
import { cn } from '../../lib/utils';
import { FileIcon } from './FileIcon';
import { formatBytes, validateFile } from './validation';
import { SUPPORTED_EXTENSIONS, type WizardFileEntry } from './wizardTypes';

/**
 * Wizard-stap 1: bestanden selecteren.
 *
 * - drag-drop op het hele canvas (native OS file-drop);
 * - fallback-knop die het native open-dialog van Electron opent;
 * - per bestand: validatie (extensie, grootte, duplicaat), inline
 *   foutmelding als iets niet past;
 * - lijst met alle toegevoegde bestanden, ongeldige bovenaan.
 */

export function Step1FilePicker({
  files,
  onChange,
}: {
  files: WizardFileEntry[];
  onChange: (files: WizardFileEntry[]) => void;
}): JSX.Element {
  const [isDragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const addInfos = useCallback(
    (infos: DialogFileInfo[]): void => {
      if (infos.length === 0) return;
      const next = [...files];
      for (const info of infos) {
        next.push(validateFile(info, next));
      }
      onChange(next);
    },
    [files, onChange]
  );

  const pickViaDialog = useCallback(async (): Promise<void> => {
    const picked = await window.anonimiseer.dialog.openFiles();
    addInfos(picked);
  }, [addInfos]);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault();
      event.stopPropagation();
      setDragging(false);
      dragCounter.current = 0;
      const dropped = Array.from(event.dataTransfer.files);
      if (dropped.length === 0) return;

      // Haal de absolute paden op via Electron's webUtils (via preload).
      const paths = dropped
        .map((f) => {
          try {
            return window.anonimiseer.dialog.getPathForFile(f);
          } catch {
            return '';
          }
        })
        .filter((p): p is string => p.length > 0);

      if (paths.length === 0) {
        // Voorzorg: als we om wat voor reden géén pad krijgen, laten
        // we 't niet crashen — in dev browser modes kan dit gebeuren.
        return;
      }
      const infos = await window.anonimiseer.dialog.statFiles(paths);
      addInfos(infos);
    },
    [addInfos]
  );

  const onDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    if (event.dataTransfer.types.includes('Files')) setDragging(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };

  const removeAt = (id: string): void => {
    onChange(files.filter((f) => f.id !== id));
  };
  const clearAll = (): void => onChange([]);

  const validFiles = files.filter((f) => !f.error);
  const invalidFiles = files.filter((f) => f.error);

  return (
    <div
      onDrop={(e) => void handleDrop(e)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      className="space-y-5"
    >
      <Header />

      <div
        className={cn(
          'relative rounded-2xl border-2 border-dashed p-8 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/5'
            : 'border-border/70 hover:border-border'
        )}
      >
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full transition-colors',
              isDragging ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            <UploadCloud className="h-6 w-6" aria-hidden />
          </div>
          <p className="text-sm font-medium text-foreground">
            {isDragging
              ? 'Laat los om bestanden toe te voegen'
              : 'Sleep bestanden hierheen of kies ze handmatig'}
          </p>
          <p className="text-xs text-muted-foreground">
            Ondersteund:{' '}
            {SUPPORTED_EXTENSIONS.map((e) => (
              <code
                key={e}
                className="mx-0.5 rounded bg-background px-1 py-0.5 text-[11px]"
              >
                {e}
              </code>
            ))}{' '}
            · max 25 MB per bestand
          </p>
          <button
            type="button"
            onClick={() => void pickViaDialog()}
            className="mt-2 inline-flex items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <FolderOpen className="h-4 w-4" aria-hidden />
            Kies bestanden…
          </button>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {validFiles.length} bruikbaar · {invalidFiles.length} met fout ·{' '}
              {formatBytes(
                validFiles.reduce((sum, f) => sum + f.info.size, 0)
              )}{' '}
              totaal
            </div>
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Lijst leegmaken
            </button>
          </div>

          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
            {invalidFiles.map((f) => (
              <FileRow key={f.id} entry={f} onRemove={removeAt} />
            ))}
            {validFiles.map((f) => (
              <FileRow key={f.id} entry={f} onRemove={removeAt} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Header(): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
        <UploadCloud className="h-5 w-5" aria-hidden />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Kies bestanden</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sleep bestanden hierin of open het bestandsdialoog. De inhoud
          blijft lokaal — er wordt nu nog niets verstuurd.
        </p>
      </div>
    </div>
  );
}

function FileRow({
  entry,
  onRemove,
}: {
  entry: WizardFileEntry;
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-center gap-3 px-3 py-2.5',
        entry.error ? 'bg-destructive/5' : 'bg-background'
      )}
    >
      <FileIcon extension={entry.info.extension} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium text-foreground" title={entry.info.path}>
            {entry.info.name}
          </span>
          <span className="flex-none text-xs text-muted-foreground">
            {formatBytes(entry.info.size)}
          </span>
        </div>
        {entry.error ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            {entry.error}
          </p>
        ) : (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-success-foreground dark:text-success">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Klaar om te anonimiseren
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Verwijder ${entry.info.name}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}

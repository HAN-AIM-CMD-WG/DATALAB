/**
 * Schrijft een volledige Anonimiseer-run weg naar een door de
 * gebruiker gekozen map. Eén run = één submap met tijdstempel,
 * zodat meerdere runs elkaar niet overschrijven.
 *
 * Inhoud van een run-map:
 *   - ``{stem}.anon.{ext}``    voor elk verwerkt bestand
 *   - ``DISCLAIMER.txt``        uitleg + disclaimer voor de gebruiker
 *   - ``audit.jsonl``           één JSON-regel per bestand (en metadata)
 *   - ``mapping.bin``           AES-versleutelde JSON-mapping (alleen bij
 *                               pseudoniseren). Sleutel leeft in de
 *                               OS-keychain via Electron safeStorage.
 *
 * We schrijven *atomisch* per bestand (tmp + rename). Bij een crash
 * halverwege heb je óf een volledig bestand óf niks — nooit een halve.
 */

import { BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  MappingSaveStatus,
  RunPayload,
  RunResultFile,
  WriteRunResponse,
} from '@shared/api';
import { documentApply } from './documentBridge';

const RUN_PREFIX = 'anonimiseer-';

function timestampSlug(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

/**
 * Korte zichtbare watermerk-tekst die in DOCX/PDF/XLSX terecht komt zodat
 * een ontvanger meteen ziet dat dit document automatisch is bewerkt en
 * dat de eindcontrole bij de uploader ligt.
 */
function buildFooterNote(payload: RunPayload): string {
  const mode =
    payload.context.mode === 'pseudonymize'
      ? 'pseudonimisering (omkeerbaar via mapping)'
      : 'anonimisering (onomkeerbaar)';
  const stamp = payload.context.startedAt;
  return (
    `Anonimiseer — automatisch verwerkt op ${stamp} via ${mode}. ` +
    `Automatische detectie kan onvolledig zijn; controleer het document ` +
    `voordat je het deelt of archiveert.`
  );
}

function buildDisclaimer(payload: RunPayload, mapping: MappingSaveStatus): string {
  const { context } = payload;
  const lines: string[] = [];
  lines.push('DISCLAIMER — ANONIMISEER');
  lines.push('');
  lines.push(
    `Gegenereerd op: ${context.startedAt}`.trim()
  );
  lines.push(`Modus: ${context.mode === 'pseudonymize' ? 'Pseudonimiseren' : 'Anonimiseren'}`);
  lines.push(`Gevoeligheid: ${context.sensitivity}`);
  lines.push(`Modelprofiel: ${context.modelProfile}`);
  lines.push(`Drempel: ${context.threshold.toFixed(2)}`);
  lines.push(`Actieve categorieën: ${context.entities.join(', ') || '(geen)'}`);
  if (context.whitelist.length > 0) {
    lines.push(`Whitelist-termen: ${context.whitelist.join(', ')}`);
  }
  lines.push('');
  lines.push('--- BELANGRIJK ---');
  lines.push('');
  lines.push(
    'Anonimiseer is een hulpmiddel, geen garantie. Automatische detectie kan'
  );
  lines.push(
    'fouten maken: het kan persoonsgegevens missen (false negatives) of juist'
  );
  lines.push('onschuldige tekst markeren (false positives). Jij blijft als gebruiker');
  lines.push('verantwoordelijk voor het resultaat. Lees het geanonimiseerde bestand');
  lines.push('volledig door vóór je het deelt, publiceert of naar een externe dienst');
  lines.push('(bijv. een LLM-API) stuurt.');
  lines.push('');
  if (context.mode === 'pseudonymize') {
    lines.push('--- MAPPING ---');
    lines.push('');
    if (mapping.status === 'saved') {
      lines.push('De mapping tussen originele waarden en hun pseudoniemen staat in');
      lines.push('mapping.bin en is versleuteld met de OS-keychain (Electron');
      lines.push('safeStorage). Alleen dezelfde gebruiker op deze machine kan de');
      lines.push('mapping weer openen via Anonimiseer. Wil je de mapping meenemen naar');
      lines.push('een andere machine, exporteer hem dan via Anonimiseer — een kopie van');
      lines.push('mapping.bin alleen werkt daar niet.');
    } else if (mapping.status === 'skipped-no-encryption') {
      lines.push('LET OP: er kon geen mapping bewaard worden omdat de OS-keychain');
      lines.push('niet beschikbaar is. De pseudoniemen zijn daardoor niet omkeerbaar.');
      lines.push(`Reden: ${mapping.reason}`);
    } else if (mapping.status === 'error') {
      lines.push(`LET OP: het opslaan van de mapping is mislukt: ${mapping.error}`);
    }
    lines.push('');
  }
  lines.push(
    '--- GEBRUIK VAN DE AUDIT-LOG ---'
  );
  lines.push('');
  lines.push(
    'In audit.jsonl staat per verwerkt bestand welke categorieën zijn gevonden,'
  );
  lines.push('hoeveel hits je hebt geaccepteerd/overgeslagen en welke instellingen');
  lines.push('actief waren. Bewaar dit bestand zodat je achteraf kunt aantonen hoe');
  lines.push('het resultaat tot stand kwam.');
  lines.push('');
  return lines.join('\n');
}

function auditLines(payload: RunPayload, results: RunResultFile[]): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: 'run',
      startedAt: payload.context.startedAt,
      mode: payload.context.mode,
      sensitivity: payload.context.sensitivity,
      threshold: payload.context.threshold,
      entities: payload.context.entities,
      whitelist: payload.context.whitelist,
      modelProfile: payload.context.modelProfile,
      filesProcessed: results.filter((r) => r.status === 'written').length,
      filesSkipped: payload.skipped.length + results.filter((r) => r.status !== 'written').length,
    })
  );
  for (const f of payload.files) {
    const res = results.find((r) => r.sourceName === f.sourceName);
    lines.push(
      JSON.stringify({
        type: 'file',
        sourceName: f.sourceName,
        sourcePath: f.sourcePath,
        outputPath: res?.outputPath ?? null,
        status: res?.status ?? 'error',
        error: res?.error,
        stats: f.stats,
      })
    );
  }
  for (const s of payload.skipped) {
    lines.push(
      JSON.stringify({
        type: 'file',
        sourceName: s.sourceName,
        sourcePath: s.sourcePath,
        outputPath: null,
        status: 'skipped',
        reason: s.reason,
      })
    );
  }
  return lines.join('\n') + '\n';
}

async function saveMapping(
  runDir: string,
  payload: RunPayload
): Promise<MappingSaveStatus> {
  if (payload.context.mode !== 'pseudonymize') return { status: 'not-applicable' };
  if (payload.mapping.length === 0) return { status: 'not-applicable' };
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      status: 'skipped-no-encryption',
      reason:
        'OS-keychain (safeStorage) is niet beschikbaar op dit systeem. De mapping zou plaintext op schijf komen en dat weigeren we.',
    };
  }
  try {
    const payloadJson = JSON.stringify(
      {
        version: 1,
        createdAt: payload.context.startedAt,
        mode: payload.context.mode,
        entries: payload.mapping,
      },
      null,
      2
    );
    const encrypted = safeStorage.encryptString(payloadJson);
    const path = join(runDir, 'mapping.bin');
    await atomicWrite(path, encrypted);
    return { status: 'saved', path };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'onbekende fout',
    };
  }
}

async function writeRun(payload: RunPayload): Promise<WriteRunResponse> {
  // Basisvalidatie — het main-proces vertrouwt de renderer niet blind.
  if (typeof payload?.outputParent !== 'string' || !payload.outputParent) {
    return { ok: false, error: 'geen doelmap opgegeven' };
  }
  if (!Array.isArray(payload.files) || !Array.isArray(payload.skipped)) {
    return { ok: false, error: 'ongeldige payload-structuur' };
  }

  const runDir = join(
    payload.outputParent,
    `${RUN_PREFIX}${timestampSlug(new Date())}`
  );
  try {
    await fs.mkdir(runDir, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: `kan run-map niet aanmaken: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }

  const results: RunResultFile[] = [];
  for (const file of payload.files) {
    const outputName = `${file.stem}.anon${file.extension}`;
    const outputPath = join(runDir, outputName);
    try {
      if (dirname(outputPath) !== runDir) {
        throw new Error('ongeldige bestandsnaam');
      }
      if (file.kind === 'text') {
        await atomicWrite(outputPath, file.anonymizedText);
        results.push({ sourceName: file.sourceName, outputPath, status: 'written' });
      } else {
        // Document: laat de engine het opnieuw bouwen met originele opmaak.
        const applyResult = await documentApply({
          sourcePath: file.sourcePath,
          blocks: file.blocks,
          replacements: file.replacements,
          outputPath,
          footerNote: buildFooterNote(payload),
        });
        if (!applyResult.ok) {
          results.push({
            sourceName: file.sourceName,
            outputPath: null,
            status: 'error',
            error: applyResult.error,
          });
        } else {
          results.push({
            sourceName: file.sourceName,
            outputPath: applyResult.outputPath,
            status: 'written',
          });
        }
      }
    } catch (error) {
      results.push({
        sourceName: file.sourceName,
        outputPath: null,
        status: 'error',
        error: error instanceof Error ? error.message : 'onbekende fout',
      });
    }
  }

  const mapping = await saveMapping(runDir, payload);
  const disclaimer = buildDisclaimer(payload, mapping);
  const disclaimerPath = join(runDir, 'DISCLAIMER.txt');
  const auditPath = join(runDir, 'audit.jsonl');

  try {
    await atomicWrite(disclaimerPath, disclaimer);
  } catch (error) {
    return {
      ok: false,
      error: `disclaimer niet kunnen wegschrijven: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }
  try {
    await atomicWrite(auditPath, auditLines(payload, results));
  } catch (error) {
    return {
      ok: false,
      error: `audit-log niet kunnen wegschrijven: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }

  return {
    ok: true,
    runDir,
    files: results,
    disclaimerPath,
    auditPath,
    mapping,
  };
}

export function registerOutputBridge(): void {
  ipcMain.handle('output:pickFolder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      title: 'Kies map voor geanonimiseerde bestanden',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Kies map',
    };
    const result = window
      ? await dialog.showOpenDialog(window, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('output:encryptionAvailable', () =>
    safeStorage.isEncryptionAvailable()
  );

  ipcMain.handle('output:writeRun', async (_event, payload: RunPayload) =>
    writeRun(payload)
  );

  ipcMain.handle('output:revealPath', async (_event, path: unknown) => {
    if (typeof path !== 'string' || !path) return;
    await shell.openPath(path);
  });
}

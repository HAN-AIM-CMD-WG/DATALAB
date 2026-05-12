/**
 * Lees de tekstinhoud van een bestand. Alleen voor platte-tekst-
 * formaten waar geen parser nodig is: ``.md`` en ``.txt``.
 *
 * Andere formaten zullen in Fase 3.5 via de engine gaan (docling),
 * vandaar dat we hier bewust niet alvast `.docx`/`.pdf`/`.xlsx`
 * aanraken — dan hebben we geen parallelle codepaden die moeten
 * divergeren.
 */

import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { extname } from 'node:path';
import type { ReadTextResponse } from '@shared/api';

const MAX_BYTES = 25 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(['.md', '.txt']);

export function registerFileBridge(): void {
  ipcMain.handle(
    'file:readText',
    async (_event, path: unknown): Promise<ReadTextResponse> => {
      if (typeof path !== 'string') {
        return { ok: false, error: 'geen pad meegegeven' };
      }
      const ext = extname(path).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) {
        return {
          ok: false,
          error: `bestandstype ${ext} kan nog niet direct worden ingelezen (volgt in Fase 3.5)`,
        };
      }
      try {
        const stat = await fs.stat(path);
        if (stat.size > MAX_BYTES) {
          return { ok: false, error: `bestand is te groot (${stat.size} bytes)` };
        }
        const buffer = await fs.readFile(path);
        // UTF-8 is de norm; bij ongeldige byte-sequenties vervangt Node de
        // karakters met U+FFFD in plaats van te crashen.
        const text = buffer.toString('utf-8');
        return { ok: true, text };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'onbekende fout';
        return { ok: false, error: reason };
      }
    }
  );
}

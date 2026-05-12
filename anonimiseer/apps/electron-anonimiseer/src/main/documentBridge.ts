/**
 * IPC-bridge voor document-operaties (DOCX/PDF/XLSX). We lezen het
 * bronbestand in het main proces, sturen het naar de PII-engine via
 * multipart en schrijven de response atomisch weg. De renderer ziet
 * nooit zelf bytes of filesystem-paden buiten wat via deze handlers
 * gaat — dat houdt de sandbox en de CSP strak.
 */

import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, dirname } from 'node:path';
import type {
  DocumentApplyRequest,
  DocumentApplyResponse,
  DocumentExtractResponse,
} from '@shared/api';

const ENGINE_URL =
  process.env.ANONIMISEER_ENGINE_URL ?? 'http://127.0.0.1:8765';
const EXTRACT_TIMEOUT_MS = 60_000;
const APPLY_TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

async function readFileGuarded(path: string): Promise<Buffer> {
  const stat = await fs.stat(path);
  if (stat.size > MAX_BYTES) {
    throw new Error(`bestand is te groot (${stat.size} bytes)`);
  }
  return fs.readFile(path);
}

async function atomicWrite(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, path);
}

async function documentExtract(path: unknown): Promise<DocumentExtractResponse> {
  if (typeof path !== 'string' || !path) {
    return { ok: false, error: 'geen pad opgegeven' };
  }
  const filename = basename(path);
  const ext = extOf(filename);
  if (!(ext in MIME_BY_EXT)) {
    return { ok: false, error: `bestandstype ${ext} wordt niet ondersteund` };
  }

  let buffer: Buffer;
  try {
    buffer = await readFileGuarded(path);
  } catch (error) {
    return {
      ok: false,
      error: `kan bestand niet lezen: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: MIME_BY_EXT[ext] }),
      filename
    );
    const response = await fetch(`${ENGINE_URL}/document/extract`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: `engine HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      };
    }
    const data = (await response.json()) as {
      flat_text?: unknown;
      blocks?: unknown;
    };
    if (typeof data.flat_text !== 'string' || !Array.isArray(data.blocks)) {
      return { ok: false, error: 'onverwacht antwoord van engine' };
    }
    return {
      ok: true,
      flatText: data.flat_text,
      blocks: data.blocks as DocumentExtractResponse extends { ok: true; blocks: infer T }
        ? T
        : never,
    };
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `engine antwoordt niet binnen ${EXTRACT_TIMEOUT_MS / 1000}s`
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

export async function documentApply(
  req: DocumentApplyRequest
): Promise<DocumentApplyResponse> {
  if (!req?.sourcePath || !req?.outputPath) {
    return { ok: false, error: 'pad-velden ontbreken' };
  }
  const filename = basename(req.sourcePath);
  const ext = extOf(filename);
  if (!(ext in MIME_BY_EXT)) {
    return { ok: false, error: `bestandstype ${ext} wordt niet ondersteund` };
  }

  // Bescherm tegen per ongeluk door elkaar halen van folders.
  if (!dirname(req.outputPath)) {
    return { ok: false, error: 'ongeldig outputpad' };
  }

  let buffer: Buffer;
  try {
    buffer = await readFileGuarded(req.sourcePath);
  } catch (error) {
    return {
      ok: false,
      error: `kan bronbestand niet lezen: ${error instanceof Error ? error.message : 'onbekende fout'}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APPLY_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: MIME_BY_EXT[ext] }),
      filename
    );
    form.append(
      'payload',
      JSON.stringify({
        replacements: req.replacements,
        blocks: req.blocks,
        footer_note: req.footerNote ?? null,
      })
    );
    const response = await fetch(`${ENGINE_URL}/document/apply`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        error: `engine HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      };
    }
    const arrayBuffer = await response.arrayBuffer();
    const outBuffer = Buffer.from(arrayBuffer);
    await atomicWrite(req.outputPath, outBuffer);
    return { ok: true, outputPath: req.outputPath, bytesWritten: outBuffer.length };
  } catch (error) {
    clearTimeout(timer);
    const reason =
      error instanceof Error
        ? error.name === 'AbortError'
          ? `engine antwoordt niet binnen ${APPLY_TIMEOUT_MS / 1000}s`
          : error.message
        : 'onbekende fout';
    return { ok: false, error: reason };
  }
}

export function registerDocumentBridge(): void {
  ipcMain.handle('document:extract', async (_event, path: unknown) =>
    documentExtract(path)
  );
  ipcMain.handle('document:apply', async (_event, req: DocumentApplyRequest) =>
    documentApply(req)
  );
}

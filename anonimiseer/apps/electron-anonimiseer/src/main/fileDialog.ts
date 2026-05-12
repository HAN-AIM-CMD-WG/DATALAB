/**
 * Native file-dialog + stat-helpers.
 *
 * We exposen alleen de *metadata* naar de renderer (naam, pad, grootte),
 * niet de bytes. Het daadwerkelijk inlezen van een bestand gebeurt pas
 * als de gebruiker op "Volgende" klikt in stap 2 (en dan bij voorkeur
 * naar de engine, niet door de renderer heen).
 *
 * Waarom géén pad blootleggen? We doen dat wél — de renderer heeft het
 * nodig om na de wizard een audit-log te tonen ("ik heb X bestanden
 * verwerkt"). Dit is geen security-leak omdat de gebruiker zelf de
 * bestanden selecteert.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';

export interface DialogFileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
}

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.docx', '.pdf', '.xlsx'] as const;

async function statFile(path: string): Promise<DialogFileInfo | null> {
  try {
    const stat = await fs.stat(path);
    if (!stat.isFile()) return null;
    return {
      path,
      name: basename(path),
      extension: extname(path).toLowerCase(),
      size: stat.size,
    };
  } catch {
    return null;
  }
}

export function registerFileDialogBridge(): void {
  ipcMain.handle('dialog:openFiles', async (event): Promise<DialogFileInfo[]> => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(window!, {
      title: 'Kies bestanden om te anonimiseren',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Ondersteunde bestanden',
          extensions: ALLOWED_EXTENSIONS.map((e) => e.replace('.', '')),
        },
        { name: 'Alle bestanden', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    const infos = await Promise.all(result.filePaths.map(statFile));
    return infos.filter((info): info is DialogFileInfo => info !== null);
  });

  // Hergebruik: als de gebruiker pad(en) via drag-drop geeft en we het
  // path via `webUtils.getPathForFile` binnenhalen, hebben we dezelfde
  // stat-info nodig.
  ipcMain.handle('dialog:statFiles', async (_event, paths: unknown): Promise<DialogFileInfo[]> => {
    if (!Array.isArray(paths)) return [];
    const infos = await Promise.all(
      paths.filter((p): p is string => typeof p === 'string').map(statFile)
    );
    return infos.filter((info): info is DialogFileInfo => info !== null);
  });
}

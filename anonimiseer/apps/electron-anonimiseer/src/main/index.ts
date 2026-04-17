/**
 * Main-proces entrypoint.
 *
 * Ontwerpkeuzes:
 *   - `contextIsolation: true` + `nodeIntegration: false` zijn non-negotiable
 *     voor een tool die potentiëel gevoelige documenten verwerkt. Alle
 *     interactie met Node/Electron-APIs loopt via de `preload`-bridge
 *     (zie ``src/preload/index.ts``).
 *   - `sandbox: true` zet Chromium's sandbox aan voor de renderer. In
 *     combinatie met context isolation is dit de aanbeveling van het
 *     Electron-team zelf (zie https://www.electronjs.org/docs/latest/tutorial/security).
 *   - We laden nooit remote URLs in het hoofdvenster; alleen het lokale
 *     bundel uit ``out/renderer``. Externe navigatie wordt hard geblokkeerd.
 *
 * De sidecar-start (``pii-engine``) zit bewust NIET in deze file. Die logica
 * komt in ``src/main/engineBridge.ts`` zodra we Fase 3.2 bouwen.
 */

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'Anonimiseer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Blokkeer navigatie naar externe URLs — openen we in de standaardbrowser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('http://localhost:') ||
      url.startsWith('file://') ||
      url.startsWith('devtools://');
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  // macOS: houd het icoon in het Dock actief, maar niet in de taskbar op
  // Windows tenzij er een venster is.
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Extra veiligheidsnet: weiger requests die via WebContents proberen een nieuw
// venster te openen met een verdachte preload-config.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});

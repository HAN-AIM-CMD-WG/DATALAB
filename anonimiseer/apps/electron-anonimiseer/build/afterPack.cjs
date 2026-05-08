/**
 * electron-builder afterPack hook.
 *
 * Werk per platform:
 *   - mac/linux: zet execute-bit op de meegebundelde pii-engine binary.
 *     electron-builder kan die flag verliezen afhankelijk van hoe de folder
 *     origineel verpakt is; expliciet zetten is veilig.
 *   - windows: niks; .exe-extensie is genoeg.
 *
 * We tellen ook hoe groot de bundled engine is, puur informatief voor de
 * build-log.
 */

const fs = require('node:fs');
const path = require('node:path');

function walkAndChmod(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndChmod(full);
    } else if (entry.isFile()) {
      // Enkel de engine-binary en ingesloten shared libraries krijgen +x.
      const name = entry.name;
      const needsExec =
        name === 'pii-engine' ||
        name.endsWith('.so') ||
        name.endsWith('.dylib');
      if (needsExec) {
        try {
          fs.chmodSync(full, 0o755);
        } catch (err) {
          console.warn('[afterPack] kon chmod niet zetten op', full, err);
        }
      }
    }
  }
}

function folderSize(dir) {
  let total = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += folderSize(full);
    } else if (entry.isFile()) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const resourcesDir =
    platform === 'darwin'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
  const engineDir = path.join(resourcesDir, 'pii-engine');

  if (!fs.existsSync(engineDir)) {
    console.warn(
      '[afterPack] pii-engine-map niet gevonden op',
      engineDir,
      '— overslaan. Is de PyInstaller-bundle wel gebouwd?',
    );
    return;
  }

  if (platform !== 'win32') {
    walkAndChmod(engineDir);
    console.log('[afterPack] +x gezet op pii-engine binaries');
  }

  const bytes = folderSize(engineDir);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(`[afterPack] pii-engine bundle-grootte: ${mb} MB`);
};

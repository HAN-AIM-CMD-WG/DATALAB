/**
 * Sealing and opening ``mapping.bin``, the encrypted list of originals behind
 * the pseudonyms.
 *
 * Encryption is Electron's safeStorage: a key held by the operating system
 * (Keychain on macOS, DPAPI on Windows, the Secret Service on Linux) and tied
 * to this user on this machine. It does not authenticate the data (AES-CBC on
 * macOS, DPAPI on Windows), so the file also carries an HMAC-SHA256 over the
 * ciphertext. The HMAC key lives in the app's own folder, encrypted the same
 * way. A changed file is refused instead of yielding wrong originals.
 *
 * On Linux without a keyring, safeStorage falls back to a password that is
 * hard-coded in Chromium and still reports itself as available. We treat
 * that as no encryption at all.
 */

import { app, safeStorage } from 'electron';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const MAGIC = Buffer.from('ANONIMISEER-MAPPING-2\n', 'utf8');
const MAC_BYTES = 32;

export class MappingError extends Error {}

/** Why mappings cannot be stored safely on this machine, or ``null`` when they can. */
export function encryptionProblem(): string | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return 'De sleutelbos van het besturingssysteem is niet beschikbaar.';
  }
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return (
      'Er is geen sleutelbos (keyring) gevonden. Electron zou dan versleutelen met een ' +
      'publiek bekend wachtwoord; dat is geen bescherming.'
    );
  }
  return null;
}

function macKeyPath(): string {
  return join(app.getPath('userData'), 'mapping-mac.key');
}

async function macKey(create: boolean): Promise<Buffer | null> {
  try {
    const stored = await fs.readFile(macKeyPath());
    return Buffer.from(safeStorage.decryptString(stored), 'base64');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!create) return null;
  const key = randomBytes(32);
  await fs.writeFile(macKeyPath(), safeStorage.encryptString(key.toString('base64')), {
    mode: 0o600,
    flag: 'wx',
  });
  return key;
}

function mac(key: Buffer, ciphertext: Buffer): Buffer {
  return createHmac('sha256', key).update(MAGIC).update(ciphertext).digest();
}

/** Encrypt ``json`` and add the HMAC. Call only when ``encryptionProblem()`` is null. */
export async function sealMapping(json: string): Promise<Buffer> {
  const problem = encryptionProblem();
  if (problem) throw new MappingError(problem);
  const ciphertext = safeStorage.encryptString(json);
  const key = await macKey(true);
  return Buffer.concat([MAGIC, mac(key as Buffer, ciphertext), ciphertext]);
}

/**
 * Check and decrypt a mapping file. ``verified`` is false for files from
 * Anonimiseer 0.1, which have no HMAC and cannot be checked for changes.
 */
export async function openMapping(data: Buffer): Promise<{ json: string; verified: boolean }> {
  const problem = encryptionProblem();
  if (problem) throw new MappingError(problem);

  let ciphertext = data;
  let verified = false;
  if (data.subarray(0, MAGIC.length).equals(MAGIC)) {
    const tag = data.subarray(MAGIC.length, MAGIC.length + MAC_BYTES);
    ciphertext = data.subarray(MAGIC.length + MAC_BYTES);
    const key = await macKey(false);
    if (key === null || tag.length !== MAC_BYTES || !timingSafeEqual(tag, mac(key, ciphertext))) {
      throw new MappingError(
        'Deze mapping is gewijzigd, of hoort bij een andere gebruiker of computer.'
      );
    }
    verified = true;
  }
  try {
    return { json: safeStorage.decryptString(ciphertext), verified };
  } catch {
    throw new MappingError(
      'Deze mapping kan op deze computer niet worden geopend. Een mapping werkt alleen voor ' +
        'dezelfde gebruiker op dezelfde computer.'
    );
  }
}

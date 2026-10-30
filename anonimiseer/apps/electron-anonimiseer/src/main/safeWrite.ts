import { promises as fs } from 'node:fs';

/**
 * Write via a tmp file and a rename, readable by the user only.
 *
 * Every file the app writes can hold personal data: anonymised output may
 * still contain what detection missed, and restored output and the mapping
 * hold originals by design. Without a mode they would get 0644 and be
 * readable by every user on the machine.
 */
export async function atomicWrite(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  try {
    await fs.rename(tmp, path);
  } catch (error) {
    // Otherwise a tmp file with the full content stays behind while the user
    // sees an error and assumes nothing was written.
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

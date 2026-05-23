import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const APPDATA = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming');
const NEW_DIR = join(APPDATA, 'digi-deck');
const OLD_DIR = join(APPDATA, 'ancient-crown');

/**
 * Migrate %APPDATA%\ancient-crown to %APPDATA%\digi-deck on first run after the
 * rename. Tries an atomic directory rename first, falls back to recursive copy
 * if the old dir is on a different drive or otherwise can't be moved.
 */
export async function migrateAppData(): Promise<void> {
  if (await exists(NEW_DIR)) return;          // already on the new layout
  if (!(await exists(OLD_DIR))) return;       // nothing to migrate

  try {
    await fs.rename(OLD_DIR, NEW_DIR);
    console.log(`[migrate] moved ${OLD_DIR} → ${NEW_DIR}`);
    return;
  } catch (err) {
    console.warn(`[migrate] rename failed (${(err as Error).message}); copying instead`);
  }

  try {
    await fs.cp(OLD_DIR, NEW_DIR, { recursive: true });
    console.log(`[migrate] copied ${OLD_DIR} → ${NEW_DIR}`);
    console.log(`[migrate] old folder kept as backup — delete it when you're satisfied`);
  } catch (err) {
    console.error('[migrate] copy failed:', (err as Error).message);
  }
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

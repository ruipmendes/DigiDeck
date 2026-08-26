import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/**
 * Icon-pack discovery + serving.
 *
 * MVP intent: users drop unzipped icon sets into
 * `%APPDATA%/digi-deck/icon-packs/<pack>/` and every `.svg` under that
 * directory becomes pickable in the tile icon picker as `<pack>:<name>`.
 *
 * The Simple Icons project (3000+ CC0 brand marks) is the poster child —
 * download their zip, extract into `icon-packs/simple-icons/`, restart the
 * server, and every brand becomes selectable. Custom packs work the same way.
 *
 * Nested subdirectories are honoured: a file at
 * `icon-packs/simple-icons/gaming/steam.svg` is exposed as `simple-icons:gaming/steam`.
 * That keeps larger packs tidy without forcing them to flatten.
 *
 * Discovery is refresh-on-request rather than a persistent index — tiny
 * per-hit fs walk, and users can drop new SVGs in without a server restart.
 * A 5-second in-memory cache absorbs the icon-picker's chatty polls.
 */

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
export const ICON_PACKS_DIR = join(APP_DIR, 'icon-packs');

const CACHE_TTL_MS = 5_000;

/** Ensure the icon-packs directory exists on disk. Called at server startup
 *  so the picker's help text points at a real folder the user can click through
 *  in Explorer, even before they install their first pack. */
export async function ensureIconPacksDir(): Promise<void> {
  await fs.mkdir(ICON_PACKS_DIR, { recursive: true });
}

export type IconPack = {
  /** Pack folder name — used as the prefix in the tile `icon` field. */
  name: string;
  /** Sorted list of icon names inside the pack. Names include subfolder
   *  prefixes (e.g. `gaming/steam`) but never a `.svg` extension. */
  icons: string[];
};

type Cache = { at: number; packs: IconPack[] };
let cache: Cache | null = null;

export async function listIconPacks(): Promise<IconPack[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.packs;
  const packs = await scanIconPacks();
  cache = { at: Date.now(), packs };
  return packs;
}

/** Force a re-scan on the next call — call from the pack-management panel
 *  after a user manually drops in a folder, so they don't have to wait for
 *  the TTL. */
export function invalidateIconPacksCache(): void {
  cache = null;
}

async function scanIconPacks(): Promise<IconPack[]> {
  const packs: IconPack[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(ICON_PACKS_DIR);
  } catch {
    // Directory hasn't been created yet — no packs installed. Not an error.
    return [];
  }
  for (const entry of entries) {
    if (!isValidPackName(entry)) continue;
    const packDir = join(ICON_PACKS_DIR, entry);
    let stat;
    try { stat = await fs.stat(packDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const icons = await walkSvgs(packDir);
    if (icons.length === 0) continue;
    icons.sort();
    packs.push({ name: entry, icons });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  return packs;
}

async function walkSvgs(root: string, subPath = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(join(root, subPath), { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = subPath ? `${subPath}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const nested = await walkSvgs(root, rel);
      out.push(...nested);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.svg')) {
      // Strip extension for the picker's icon-name.
      out.push(rel.slice(0, -4));
    }
  }
  return out;
}

/** Resolve a `<pack>:<name>` request to a filesystem path, refusing anything
 *  that escapes the pack root (path-traversal guard). Returns null if the pack
 *  or icon doesn't exist — the caller should 404. */
export async function resolveIconPath(pack: string, iconName: string): Promise<string | null> {
  if (!isValidPackName(pack)) return null;
  if (!isValidIconName(iconName)) return null;
  const packDir = resolve(ICON_PACKS_DIR, pack);
  // Reject if `pack` somehow escaped the packs dir (belt + suspenders — we
  // already validated the name, but resolve gives us the definitive answer).
  const packsRoot = resolve(ICON_PACKS_DIR);
  if (!packDir.startsWith(packsRoot + sep) && packDir !== packsRoot) return null;

  const filePath = resolve(packDir, `${iconName}.svg`);
  if (!filePath.startsWith(packDir + sep)) return null;

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return filePath;
  } catch {
    return null;
  }
}

/** Read one icon's raw SVG bytes. Used by the HTTP handler that serves
 *  `/api/icon-packs/<pack>/<name>.svg`. Returns null when the icon doesn't
 *  exist so the caller can return 404. */
export async function readIcon(pack: string, iconName: string): Promise<Buffer | null> {
  const path = await resolveIconPath(pack, iconName);
  if (!path) return null;
  return fs.readFile(path);
}

function isValidPackName(name: string): boolean {
  // Folder names — allow letters, digits, dash, dot, underscore. No slashes,
  // no leading dots, no upper-length runaway.
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name);
}

function isValidIconName(name: string): boolean {
  // Icon names may contain subfolder prefixes (e.g. `gaming/steam`). Allow
  // forward slashes, letters/digits/dash/dot/underscore. No `..`, no `\`,
  // reasonable length cap.
  if (!name || name.length > 256) return false;
  if (name.includes('..')) return false;
  if (name.includes('\\')) return false;
  if (name.startsWith('/') || name.endsWith('/')) return false;
  return /^[a-z0-9][a-z0-9._/-]*$/i.test(name);
}

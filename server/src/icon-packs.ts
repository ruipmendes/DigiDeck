import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';

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
/** Sidecar for per-pack settings (tint mode today; room for more later).
 *  Kept OUTSIDE the packs folder so users can sync `icon-packs/` externally
 *  without dragging our settings along. */
const PACK_SETTINGS_FILE = join(APP_DIR, 'icon-pack-settings.json');

const CACHE_TTL_MS = 5_000;
/** Sane cap for zip uploads — Simple Icons' full pack is ~5 MB, so 50 MB is
 *  generous with no realistic ceiling in sight. */
const MAX_PACK_FILES = 10_000;
/** Reject SVGs bigger than this. Real-world icon SVGs are 1-4 KB; anything
 *  vastly larger is either not an icon or an attempt to blow up the disk. */
const MAX_SVG_BYTES = 512 * 1024;

/** Ensure the icon-packs directory exists on disk. Called at server startup
 *  so the picker's help text points at a real folder the user can click through
 *  in Explorer, even before they install their first pack. */
export async function ensureIconPacksDir(): Promise<void> {
  await fs.mkdir(ICON_PACKS_DIR, { recursive: true });
}

/** How the client renders a pack's SVGs. `invert` is our default and matches
 *  Simple Icons' black-on-transparent convention (light-on-dark tile). `none`
 *  preserves original colors — the right choice for packs that already ship
 *  colored SVGs (screenshots of app icons, streamer logos in brand colors). */
export type TintMode = 'invert' | 'none';

export type IconPack = {
  /** Pack folder name — used as the prefix in the tile `icon` field. */
  name: string;
  /** Sorted list of icon names inside the pack. Names include subfolder
   *  prefixes (e.g. `gaming/steam`) but never a `.svg` extension. */
  icons: string[];
  /** Per-pack render setting. Default `invert` matches existing behavior. */
  tint: TintMode;
};

type Cache = { at: number; packs: IconPack[] };
let cache: Cache | null = null;

export async function listIconPacks(): Promise<IconPack[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.packs;
  const packs = await scanIconPacks();
  cache = { at: Date.now(), packs };
  return packs;
}

/** Persist a pack's tint mode. `invert` is the default, so we omit rather
 *  than write it — keeps the sidecar minimal for users on defaults. */
export async function setPackTint(name: string, tint: TintMode): Promise<void> {
  if (!isValidPackName(name)) throw new Error(`invalid pack name "${name}"`);
  if (tint !== 'invert' && tint !== 'none') throw new Error(`invalid tint "${tint}"`);
  const settings = await readPackSettings();
  if (tint === 'invert') delete settings[name];
  else settings[name] = { tint };
  await writePackSettings(settings);
  invalidateIconPacksCache();
}

/** Extract a zip into `icon-packs/<packName>/`. Auto-detects and strips a
 *  common folder prefix so GitHub-style archives (`repo-branch/…`) land clean
 *  at the pack root. Overwrites existing files so users can re-upload updated
 *  packs. Rejects zip entries that would escape the pack dir. */
export async function installPackFromZip(zipBuffer: Buffer, packName: string): Promise<{ pack: string; iconCount: number }> {
  if (!isValidPackName(packName)) {
    throw new Error(`invalid pack name "${packName}" — use letters, digits, dot, dash, underscore`);
  }
  let zip: AdmZip;
  try { zip = new AdmZip(zipBuffer); }
  catch (err) { throw new Error(`not a valid zip: ${(err as Error).message}`); }
  const entries = zip.getEntries();
  if (entries.length > MAX_PACK_FILES) {
    throw new Error(`zip has ${entries.length} entries — cap is ${MAX_PACK_FILES}`);
  }
  // Collect SVG entries with normalized forward-slash paths.
  const svgEntries = entries
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.svg'))
    .map((e) => ({ path: e.entryName.replace(/\\/g, '/'), entry: e }));
  if (svgEntries.length === 0) throw new Error('zip contained no .svg files');
  const commonPrefix = detectCommonPrefix(svgEntries.map((s) => s.path));

  const packDir = resolve(ICON_PACKS_DIR, packName);
  const packsRoot = resolve(ICON_PACKS_DIR);
  if (!packDir.startsWith(packsRoot + sep) && packDir !== packsRoot) {
    throw new Error('pack path resolution failed');
  }
  await fs.mkdir(packDir, { recursive: true });

  let written = 0;
  for (const { path: p, entry } of svgEntries) {
    // Strip the common prefix so `simple-icons-14.x/icons/adobe.svg` lands
    // as `adobe.svg` at the pack root.
    const rel = commonPrefix && p.startsWith(commonPrefix) ? p.slice(commonPrefix.length) : p;
    // Belt + suspenders: reject anything that resolves outside the pack dir.
    if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) continue;
    const dest = resolve(packDir, rel);
    if (!dest.startsWith(packDir + sep)) continue;
    // Reject before decompressing to keep an oversized entry from being
    // materialized into memory. The header's `size` is the uncompressed size.
    if (entry.header.size > MAX_SVG_BYTES) continue;
    const data = entry.getData();
    if (data.length > MAX_SVG_BYTES) continue; // header lied — belt + suspenders
    await fs.mkdir(resolve(dest, '..'), { recursive: true });
    await fs.writeFile(dest, data);
    written++;
  }
  invalidateIconPacksCache();
  return { pack: packName, iconCount: written };
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
  const settings = await readPackSettings();
  for (const entry of entries) {
    if (!isValidPackName(entry)) continue;
    const packDir = join(ICON_PACKS_DIR, entry);
    let stat;
    try { stat = await fs.stat(packDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const icons = await walkSvgs(packDir);
    if (icons.length === 0) continue;
    icons.sort();
    const tint = settings[entry]?.tint === 'none' ? 'none' : 'invert';
    packs.push({ name: entry, icons, tint });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));
  return packs;
}

type PackSettings = Record<string, { tint?: TintMode }>;

async function readPackSettings(): Promise<PackSettings> {
  try {
    const raw = await fs.readFile(PACK_SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PackSettings;
  } catch { return {}; }
}

async function writePackSettings(settings: PackSettings): Promise<void> {
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.writeFile(PACK_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

/** Longest slash-terminated prefix shared by every path — used to strip
 *  container folders from a GitHub-style archive so files land clean at the
 *  pack root. Returns empty string when there's no useful shared prefix. */
function detectCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) {
    const idx = paths[0].lastIndexOf('/');
    return idx > 0 ? paths[0].slice(0, idx + 1) : '';
  }
  let prefix = paths[0];
  for (let i = 1; i < paths.length; i++) {
    while (!paths[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  // Only strip up to a full slash-terminated segment; a partial filename
  // prefix would corrupt the leaf names.
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash > 0 ? prefix.slice(0, lastSlash + 1) : '';
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

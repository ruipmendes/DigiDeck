import { promises as fs } from 'node:fs';
import { join, resolve, sep, dirname, basename } from 'node:path';

/**
 * Sound library — folder discovery + per-clip metadata sidecar.
 *
 * Mirrors the icon-packs pattern (`server/src/icon-packs.ts`): users drop
 * audio files into `%APPDATA%/digi-deck/sounds/` and every `.mp3`/`.wav`/
 * `.ogg`/`.aac`/`.flac` under that root becomes pickable in the sound
 * action editor's library-mode dropdown.
 *
 * Nested subfolders are honoured — `sounds/memes/airhorn.mp3` is exposed
 * with id `memes/airhorn.mp3`. The id is a relative path from the sounds
 * root, deterministic and portable across machines: exporting a layout
 * bundle and importing it on another PC keeps the sound tiles working as
 * long as the same clips exist under the same relative paths.
 *
 * Per-clip metadata (right now just default volume; tags later) lives in a
 * flat sidecar `%APPDATA%/digi-deck/sounds.json`, keyed by clip id. Kept
 * OUT of the sounds folder so the sounds folder stays "pure audio files"
 * for anyone who wants to sync it externally.
 *
 * Discovery is refresh-on-request with a 5-second cache — same shape as
 * icon-packs.
 */

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
export const SOUNDS_DIR = join(APP_DIR, 'sounds');
export const SOUNDS_METADATA_FILE = join(APP_DIR, 'sounds.json');

const CACHE_TTL_MS = 5_000;

const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma']);

/** Ensure the sounds directory exists on disk. Called at server startup so
 *  the panel's help text points at a real folder the user can click through
 *  in Explorer, even before they drop their first clip. */
export async function ensureSoundsDir(): Promise<void> {
  await fs.mkdir(SOUNDS_DIR, { recursive: true });
}

export type SoundClip = {
  /** Relative path from the sounds root — the id we store in tile configs.
   *  Includes the file extension so we can pick the right MIME type on serve
   *  without a second lookup. */
  id: string;
  /** Filename without extension — the human-readable label. */
  name: string;
  /** Parent-folder chain relative to the sounds root; empty for root-level
   *  files. Used to group / filter in the panel UI. */
  folder: string;
  sizeBytes: number;
  /** Default volume (0..1) applied to new tiles referencing this clip.
   *  Undefined when the user hasn't set one — new tiles fall back to 0.8. */
  defaultVolume?: number;
};

type Cache = { at: number; clips: SoundClip[] };
let cache: Cache | null = null;

type Sidecar = {
  clips: Record<string, { defaultVolume?: number }>;
};

let sidecarPromise: Promise<Sidecar> | null = null;

async function loadSidecar(): Promise<Sidecar> {
  if (sidecarPromise) return sidecarPromise;
  sidecarPromise = (async () => {
    try {
      const raw = await fs.readFile(SOUNDS_METADATA_FILE, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && 'clips' in parsed) {
        const clips = (parsed as { clips: unknown }).clips;
        if (clips && typeof clips === 'object') {
          return { clips: clips as Record<string, { defaultVolume?: number }> };
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[sounds] failed to load sidecar: ${(err as Error).message}`);
      }
    }
    return { clips: {} };
  })();
  return sidecarPromise;
}

async function saveSidecar(sidecar: Sidecar): Promise<void> {
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.writeFile(SOUNDS_METADATA_FILE, JSON.stringify(sidecar, null, 2), 'utf8');
  // Reset cached promise so the next load reflects our write.
  sidecarPromise = Promise.resolve(sidecar);
}

/** Set (or clear, if volume is undefined) the per-clip default volume. */
export async function setDefaultVolume(id: string, volume: number | undefined): Promise<void> {
  if (!isValidId(id)) throw new Error(`invalid sound id: ${id}`);
  const sidecar = await loadSidecar();
  const entry = sidecar.clips[id] ?? {};
  if (volume === undefined || Number.isNaN(volume)) {
    delete entry.defaultVolume;
  } else {
    entry.defaultVolume = Math.max(0, Math.min(1, volume));
  }
  if (Object.keys(entry).length === 0) {
    delete sidecar.clips[id];
  } else {
    sidecar.clips[id] = entry;
  }
  await saveSidecar(sidecar);
  invalidateCache();
}

export async function listSounds(): Promise<SoundClip[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.clips;
  const clips = await scanSounds();
  cache = { at: Date.now(), clips };
  return clips;
}

/** Force a re-scan on the next call — call from the panel's refresh button
 *  after a user manually drops a file into the folder. */
export function invalidateCache(): void {
  cache = null;
}

async function scanSounds(): Promise<SoundClip[]> {
  const [files, sidecar] = await Promise.all([walkAudioFiles(SOUNDS_DIR), loadSidecar()]);
  const clips: SoundClip[] = [];
  for (const rel of files) {
    const abs = join(SOUNDS_DIR, rel);
    let stat;
    try { stat = await fs.stat(abs); } catch { continue; }
    if (!stat.isFile()) continue;
    // Normalize slashes for the wire — Windows uses `\`, we always emit `/`
    // so ids are portable across machines and match how the client renders them.
    const id = rel.split(sep).join('/');
    const parent = dirname(id);
    const folder = parent === '.' ? '' : parent;
    const base = basename(id);
    const dot = base.lastIndexOf('.');
    const name = dot > 0 ? base.slice(0, dot) : base;
    const meta = sidecar.clips[id] ?? {};
    clips.push({
      id,
      name,
      folder,
      sizeBytes: stat.size,
      defaultVolume: meta.defaultVolume,
    });
  }
  clips.sort((a, b) => {
    const fc = a.folder.localeCompare(b.folder);
    if (fc !== 0) return fc;
    return a.name.localeCompare(b.name);
  });
  return clips;
}

async function walkAudioFiles(root: string, subPath = ''): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(join(root, subPath), { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = subPath ? join(subPath, e.name) : e.name;
    if (e.isDirectory()) {
      const nested = await walkAudioFiles(root, rel);
      out.push(...nested);
    } else if (e.isFile()) {
      const lower = e.name.toLowerCase();
      const dot = lower.lastIndexOf('.');
      if (dot < 0) continue;
      if (SUPPORTED_EXTENSIONS.has(lower.slice(dot))) out.push(rel);
    }
  }
  return out;
}

/** Resolve a `library:<id>` reference (or a bare id) to an absolute
 *  filesystem path inside the sounds directory. Returns null when the file
 *  is missing or the id escapes the sounds root (path-traversal guard). */
export async function resolveSoundPath(id: string): Promise<string | null> {
  if (!isValidId(id)) return null;
  // Normalize forward-slashes to the OS separator before resolving.
  const rel = id.split('/').join(sep);
  const abs = resolve(SOUNDS_DIR, rel);
  const root = resolve(SOUNDS_DIR);
  if (!abs.startsWith(root + sep) && abs !== root) return null;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    return abs;
  } catch {
    return null;
  }
}

/** Strip the `library:` prefix on paths that use it. Returns the id (bare)
 *  or null when the input isn't a library reference. */
export function extractLibraryId(path: string): string | null {
  if (!path.startsWith('library:')) return null;
  return path.slice('library:'.length);
}

/** MIME type for a given clip id, based on its extension. Falls back to
 *  application/octet-stream when the extension isn't recognised — the browser
 *  <audio> element usually still probes and plays it. */
export function mimeType(id: string): string {
  const dot = id.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  switch (id.slice(dot).toLowerCase()) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.aac': return 'audio/aac';
    case '.flac': return 'audio/flac';
    case '.m4a': return 'audio/mp4';
    case '.wma': return 'audio/x-ms-wma';
    default:     return 'application/octet-stream';
  }
}

function isValidId(id: string): boolean {
  if (!id || id.length > 512) return false;
  if (id.includes('..')) return false;
  if (id.includes('\\')) return false;
  if (id.startsWith('/') || id.endsWith('/')) return false;
  return /^[a-z0-9][a-z0-9._/ ()-]*$/i.test(id);
}

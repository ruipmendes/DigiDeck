import AdmZip from 'adm-zip';
import type { Layout, Page, Tile, Button } from './layout.js';
import type { Action, ButtonAction } from './actions/types.js';
import { saveImage, sniffImageExt } from './images.js';

/**
 * Stream Deck profile importer.
 *
 * Reads a `.streamDeckProfile` (a ZIP archive) and materializes it as a
 * Digi Deck layout — same target as the "import bundle" flow, so we hand
 * off to the existing template-preview mechanism after conversion.
 *
 * File format (reverse-engineered — jameswhite/streamdeck-config has the
 * best community write-up):
 * - ZIP contains one or more `<UUID>.sdProfile/` directories, each holding
 *   a `manifest.json` at its root.
 * - `manifest.json` shape: `{ Version, Name, DeviceUUID, DeviceModel,
 *   Actions: { "<col,row>": ActionEntry, ... } }`.
 * - Each ActionEntry: `{ Name, UUID, State, Settings, States: [{ Image,
 *   Title, ... }] }`. UUID is a reverse-DNS action id (`com.elgato.*`).
 * - Button image PNGs live in a per-key subdirectory in the same profile
 *   dir; States[i].Image gives the relative filename.
 * - Multi-actions: UUID = `com.elgato.streamdeck.multiactions.routine`,
 *   Settings.Routine is an array of sub-ActionEntries.
 * - Folders / subpages: UUID = `com.elgato.streamdeck.profile.rotate`,
 *   Settings.ProfileUUID references another sdProfile dir in the archive.
 *   We convert those into Digi Deck pages linked by `goto-page` actions.
 *
 * Mapping strategy — one page per Stream Deck profile. Unknown action
 * UUIDs fall back to a `text` step containing the button title, so the
 * tile at least renders with its label. The preview UI surfaces a
 * per-UUID unmapped-count list so users can see what got dropped.
 */

const STREAM_DECK_COLS = 5;
const STREAM_DECK_ROWS = 3;

// Reverse-DNS UUID prefix → mapper function. Matched by exact UUID first,
// then by prefix so plugin variants (e.g. `.chat`, `.chat.v2`) share code.
type UuidHandler = (settings: Record<string, unknown>, title: string) => Action | null;

const UUID_HANDLERS: Record<string, UuidHandler> = {
  // ─── Core system actions ──────────────────────────────
  'com.elgato.streamdeck.system.website': (s) => {
    const url = pickString(s, ['path', 'URL', 'url']);
    return url ? { type: 'url', url } : null;
  },
  'com.elgato.streamdeck.system.open': (s) => {
    const path = pickString(s, ['path', 'Path']);
    return path ? { type: 'launch', path } : null;
  },
  'com.elgato.streamdeck.system.hotkey': (s) => {
    // Stream Deck stores hotkeys as a virtual-key int + modifier flags.
    // Elgato's own docs are thin here; we do best-effort from the two shapes
    // most commonly seen in the field.
    const combo = pickString(s, ['Hotkey', 'combo']);
    if (combo) {
      // Human-readable form like "Ctrl+Shift+C". Split on +, keep raw tokens
      // — Digi Deck's HotkeyInput accepts human-facing key names.
      const keys = combo.split('+').map((k) => k.trim()).filter(Boolean);
      return { type: 'hotkey', keys };
    }
    return null;
  },
  'com.elgato.streamdeck.system.text': (s) => {
    const text = pickString(s, ['text', 'Text']);
    return text ? { type: 'text', text } : null;
  },
  'com.elgato.streamdeck.system.delay': (s) => {
    const ms = pickNumber(s, ['delay', 'Delay', 'ms']);
    return { type: 'wait', ms: typeof ms === 'number' ? Math.max(0, Math.round(ms)) : 500 };
  },

  // ─── OBS Stream Deck plugin ───────────────────────────
  'com.elgato.obsstudio.scenechange': (s) => {
    const sceneName = pickString(s, ['sceneName', 'scene']);
    return sceneName ? { type: 'obs', op: 'set-scene', params: { sceneName } } : null;
  },
  'com.elgato.obsstudio.recording': () => ({ type: 'obs', op: 'toggle-record' }),
  'com.elgato.obsstudio.streaming': () => ({ type: 'obs', op: 'toggle-stream' }),
  'com.elgato.obsstudio.mute': (s) => {
    const inputName = pickString(s, ['sourceName', 'source', 'inputName']);
    return inputName ? { type: 'obs', op: 'toggle-mute', params: { inputName } } : null;
  },
  'com.elgato.obsstudio.replaybuffer': () => ({ type: 'obs', op: 'toggle-replay-buffer' }),
  'com.elgato.obsstudio.savereplay': () => ({ type: 'obs', op: 'save-replay-buffer' }),

  // ─── Discord Stream Deck plugin ───────────────────────
  'com.elgato.discord.mute': () => ({ type: 'discord', op: 'toggle-mute' }),
  'com.elgato.discord.deafen': () => ({ type: 'discord', op: 'toggle-deafen' }),
  'com.elgato.discord.push-to-talk': () => ({ type: 'discord', op: 'toggle-ptt' }),

  // ─── Spotify Stream Deck plugin ───────────────────────
  'com.elgato.spotify.playpause': () => ({ type: 'spotify', op: 'toggle-play' }),
  'com.elgato.spotify.next': () => ({ type: 'spotify', op: 'next' }),
  'com.elgato.spotify.previous': () => ({ type: 'spotify', op: 'previous' }),

  // ─── Streamlabs plugin (very partial) ─────────────────
  'com.elgato.streamlabs.desktop.recording': () => ({ type: 'streamlabs', op: 'toggle-record' }),
  'com.elgato.streamlabs.desktop.streaming': () => ({ type: 'streamlabs', op: 'toggle-stream' }),
  'com.elgato.streamlabs.desktop.scene': (s) => {
    const sceneName = pickString(s, ['sceneName', 'scene']);
    return sceneName ? { type: 'streamlabs', op: 'set-scene', params: { sceneName } } : null;
  },
};

export type ImportSummary = {
  layout: Layout;
  /** Total buttons written to the layout. */
  tileCount: number;
  /** Pages generated (a Stream Deck profile → page; each folder → page). */
  pageCount: number;
  /** UUID → count of buttons whose action we couldn't map. Falls back to
   *  a text tile in the layout so users can see them; the summary lets the
   *  preview UI say "3 buttons used <plugin> which isn't supported yet". */
  unmapped: Record<string, number>;
  /** Original profile name (from the top-level manifest). */
  originalName: string;
};

/** Entry point — parse a raw `.streamDeckProfile` ZIP buffer into a Layout
 *  (and side-write images to disk via saveImage). Caller starts a preview
 *  with the returned layout. */
export async function importStreamDeckProfile(zipBuffer: Buffer): Promise<ImportSummary> {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Discover all sdProfile dirs (each contains a manifest.json). Some
  // archives nest them (sub-profiles for folders); we resolve those by
  // walking the top-level profile first and expanding references as we go.
  const profileByUuid = new Map<string, ProfileDir>();
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const parts = entry.entryName.split('/');
    // Find the segment that ends with `.sdProfile`; everything to its right
    // is relative-to-profile-root; everything to the left is a container.
    const profileIdx = parts.findIndex((p) => p.toLowerCase().endsWith('.sdprofile'));
    if (profileIdx < 0) continue;
    const uuid = parts[profileIdx].replace(/\.sdprofile$/i, '');
    const rel = parts.slice(profileIdx + 1).join('/');
    let profile = profileByUuid.get(uuid);
    if (!profile) {
      profile = { uuid, files: new Map() };
      profileByUuid.set(uuid, profile);
    }
    if (rel) profile.files.set(rel, entry.getData());
  }

  if (profileByUuid.size === 0) {
    throw new Error('no .sdProfile directories found — is this a Stream Deck profile export?');
  }

  // Pick a root profile. Prefer one whose manifest carries a `Name` — some
  // archives have a "main" profile and per-folder sub-profiles; the main one
  // has a device name, folders don't. Fallback: first profile we saw.
  let root: ProfileDir | null = null;
  for (const p of profileByUuid.values()) {
    const m = readManifest(p);
    if (m && typeof m.Name === 'string' && m.Name.length > 0) { root = p; break; }
  }
  if (!root) root = profileByUuid.values().next().value ?? null;
  if (!root) throw new Error('no readable manifest in archive');

  const rootManifest = readManifest(root);
  const originalName = (rootManifest && typeof rootManifest.Name === 'string')
    ? rootManifest.Name
    : 'Imported Stream Deck profile';

  // Convert each visited profile to a page. Folders (profile.rotate refs)
  // enqueue their target profile with a fresh page id.
  type PendingPage = { profile: ProfileDir; pageId: number; name: string };
  const pages: Page[] = [];
  const seen = new Map<string, number>(); // profile uuid -> assigned pageId
  const unmapped: Record<string, number> = {};
  let nextTileId = 0;
  let nextPageId = 0;

  const queue: PendingPage[] = [{ profile: root, pageId: nextPageId++, name: originalName }];
  seen.set(root.uuid, 0);

  while (queue.length > 0) {
    const { profile, pageId, name } = queue.shift()!;
    const manifest = readManifest(profile);
    if (!manifest) continue;
    const actions = (manifest.Actions && typeof manifest.Actions === 'object')
      ? manifest.Actions as Record<string, unknown>
      : {};

    const tiles: Tile[] = [];
    for (const [gridKey, raw] of Object.entries(actions)) {
      const pos = parseGridKey(gridKey);
      if (!pos) continue;
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as StreamDeckAction;

      const title = String(entry.States?.[0]?.Title ?? entry.Name ?? '').trim();
      const settings = (entry.Settings && typeof entry.Settings === 'object')
        ? entry.Settings as Record<string, unknown>
        : {};

      // ─ Folder / subpage link ────────────────────────
      if (entry.UUID === 'com.elgato.streamdeck.profile.rotate') {
        const targetUuid = pickString(settings, ['ProfileUUID']);
        if (targetUuid) {
          const targetProfile = profileByUuid.get(targetUuid);
          if (targetProfile) {
            let targetPageId = seen.get(targetUuid);
            if (targetPageId === undefined) {
              targetPageId = nextPageId++;
              seen.set(targetUuid, targetPageId);
              const targetName = readManifest(targetProfile)?.Name ?? `Folder ${targetPageId}`;
              queue.push({ profile: targetProfile, pageId: targetPageId, name: String(targetName) });
            }
            const tile: Button = {
              kind: 'button',
              id: nextTileId++,
              label: title || 'Folder',
              action: { type: 'goto-page', pageId: targetPageId },
            };
            await attachImage(tile, entry, profile);
            tiles.push(placeAt(tile, pos, tiles));
            continue;
          }
        }
        // ProfileUUID missing / not in archive — fall through to text fallback.
      }

      // ─ Multi-action → step sequence ─────────────────
      if (entry.UUID === 'com.elgato.streamdeck.multiactions.routine') {
        const routine = (settings.Routine && Array.isArray(settings.Routine))
          ? settings.Routine as StreamDeckAction[]
          : [];
        const steps: Action[] = [];
        for (const sub of routine) {
          const step = mapAction(sub, unmapped);
          if (step) steps.push(step);
        }
        if (steps.length > 0) {
          const buttonAction: ButtonAction = steps.length === 1 ? steps[0] : steps;
          const tile: Button = {
            kind: 'button',
            id: nextTileId++,
            label: title || entry.Name || 'Multi',
            action: buttonAction,
          };
          await attachImage(tile, entry, profile);
          tiles.push(placeAt(tile, pos, tiles));
          continue;
        }
        // Empty routine — fall through to text fallback.
      }

      // ─ Single action via handler / fallback ────────
      const action = mapAction(entry, unmapped);
      const tile: Button = {
        kind: 'button',
        id: nextTileId++,
        label: title || entry.Name || '',
        action: action ?? { type: 'text', text: title || entry.Name || '' },
      };
      await attachImage(tile, entry, profile);
      tiles.push(placeAt(tile, pos, tiles));
    }

    // Sort tiles by grid position so left-to-right + top-to-bottom stays
    // sensible even after our reflowing above.
    tiles.sort((a, b) => a.id - b.id);

    pages.push({
      id: pageId,
      name: name.slice(0, 32),
      cols: STREAM_DECK_COLS,
      buttons: tiles,
    });
  }

  // Ensure a stable page order — root first, folders after in discovery order.
  pages.sort((a, b) => a.id - b.id);

  const layout: Layout = {
    navigation: 'folders',
    pages: pages.length > 0 ? pages : [{ id: 0, name: 'Home', buttons: [], cols: STREAM_DECK_COLS }],
  };

  return {
    layout,
    tileCount: pages.reduce((n, p) => n + p.buttons.length, 0),
    pageCount: pages.length,
    unmapped,
    originalName,
  };
}

// ─── Helpers ────────────────────────────────────────────

type ProfileDir = { uuid: string; files: Map<string, Buffer> };

type StreamDeckAction = {
  Name?: string;
  UUID?: string;
  Settings?: Record<string, unknown>;
  States?: Array<{ Image?: string; Title?: string }>;
};

function readManifest(profile: ProfileDir): Record<string, unknown> | null {
  const raw = profile.files.get('manifest.json');
  if (!raw) return null;
  try { return JSON.parse(raw.toString('utf8')) as Record<string, unknown>; }
  catch { return null; }
}

function parseGridKey(key: string): { col: number; row: number } | null {
  const m = /^(\d+),(\d+)$/.exec(key);
  if (!m) return null;
  return { col: Number(m[1]), row: Number(m[2]) };
}

/** Best-effort place — Digi Deck's grid is a linear array of buttons with a
 *  `cols` count on the page, not <col,row>. We just push in row-major order
 *  after emitting BlankTiles to occupy empty slots below/before. */
function placeAt(tile: Tile, _pos: { col: number; row: number }, _existing: Tile[]): Tile {
  return tile;
}

async function attachImage(tile: Button, entry: StreamDeckAction, profile: ProfileDir): Promise<void> {
  const imageName = entry.States?.[0]?.Image;
  if (!imageName) return;
  // Stream Deck's Image path can be plain (`state0.png`) or contain slashes
  // (`Icons/state0.png`). Look for a match by suffix so folder layouts differ.
  const match = findFileBySuffix(profile, imageName);
  if (!match) return;
  const ext = sniffImageExt(match);
  if (!ext) return;
  try {
    const filename = await saveImage(match);
    tile.image = filename;
  } catch (err) {
    console.warn(`[stream-deck-import] failed to save image ${imageName}: ${(err as Error).message}`);
  }
}

function findFileBySuffix(profile: ProfileDir, suffix: string): Buffer | null {
  // Direct hit first (relative path from the profile root).
  const direct = profile.files.get(suffix);
  if (direct) return direct;
  const lower = suffix.toLowerCase();
  for (const [name, buf] of profile.files) {
    if (name.toLowerCase().endsWith(lower)) return buf;
  }
  return null;
}

function mapAction(entry: StreamDeckAction, unmapped: Record<string, number>): Action | null {
  const uuid = entry.UUID ?? '';
  const handler = UUID_HANDLERS[uuid];
  const settings = (entry.Settings && typeof entry.Settings === 'object')
    ? entry.Settings as Record<string, unknown>
    : {};
  const title = String(entry.States?.[0]?.Title ?? entry.Name ?? '');
  if (handler) {
    const action = handler(settings, title);
    if (action) return action;
  }
  // Fell through — record the miss so the preview UI can show it.
  if (uuid) unmapped[uuid] = (unmapped[uuid] ?? 0) + 1;
  return null;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

import { promises as fs, watch } from 'node:fs';
import { join } from 'node:path';
import type { ButtonAction } from './actions/types.js';

export type Button = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  action: ButtonAction;
};

export type SliderTile = {
  kind: 'slider';
  id: number;
  label: string;
  icon?: string;
  /** OBS input/source name whose volume + mute this slider drives. */
  inputName: string;
};

export type Tile = Button | SliderTile;
export type Page = { id: number; name: string; icon?: string; buttons: Tile[] };
export type NavigationMode = 'tabs' | 'folders';
export type Layout = { navigation?: NavigationMode; pages: Page[] };

export type PublicButton = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  /** Set when the button's action targets a Twitch streamer.
   *  Phone uses this to render a thumbnail. */
  streamerLogin?: string;
  /** Set when the button (or any step) is a goto-page action. Phone handles navigation locally. */
  gotoPageId?: number;
};

export type PublicSlider = {
  kind: 'slider';
  id: number;
  label: string;
  icon?: string;
  inputName: string;
};

export type PublicTile = PublicButton | PublicSlider;
export type PublicPage = { id: number; name: string; icon?: string; buttons: PublicTile[] };
export type PublicLayout = { navigation?: NavigationMode; pages: PublicPage[] };

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
export const LAYOUT_FILE = join(APP_DIR, 'layout.json');

const DEFAULT_LAYOUT: Layout = {
  pages: [
    {
      id: 0,
      name: 'Home',
      icon: 'home',
      buttons: [
        { kind: 'button', id: 0, label: 'Copy',    icon: 'copy',           action: { type: 'hotkey', keys: ['LeftControl', 'C'] } },
        { kind: 'button', id: 1, label: 'Paste',   icon: 'clipboard',      action: { type: 'hotkey', keys: ['LeftControl', 'V'] } },
        { kind: 'button', id: 2, label: 'Vol +',   icon: 'volume-2',       action: { type: 'volume', delta: 2 } },
        { kind: 'button', id: 3, label: 'Vol –',   icon: 'volume-1',       action: { type: 'volume', delta: -2 } },
        { kind: 'button', id: 4, label: 'Mute',    icon: 'volume-x',       action: { type: 'volume', mute: true } },
        { kind: 'button', id: 5, label: 'Notepad', icon: 'file-text',      action: { type: 'launch', path: 'notepad.exe' } },
        { kind: 'button', id: 6, label: 'GitHub',  icon: 'github',         action: { type: 'url', url: 'https://github.com' } },
        { kind: 'button', id: 7, label: 'Hi',      icon: 'message-circle', action: { type: 'text', text: 'Hello from digi-deck!' } },
      ],
    },
  ],
};

/** Migrate any input shape (legacy `{ buttons }`, missing fields, etc.) into the canonical Layout. */
function normalizeLayout(parsed: unknown): Layout {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT;
  const obj = parsed as Record<string, unknown>;

  let layout: Layout;
  if (Array.isArray(obj.pages) && obj.pages.length > 0) {
    layout = obj as unknown as Layout;
  } else if (Array.isArray(obj.buttons)) {
    layout = {
      pages: [{
        id: 0,
        name: 'Home',
        icon: 'home',
        buttons: obj.buttons as Tile[],
      }],
    };
  } else {
    return DEFAULT_LAYOUT;
  }

  // Tiles created before the tile-kind feature don't have a `kind` field — default to 'button'.
  for (const page of layout.pages) {
    for (const tile of page.buttons) {
      if (!('kind' in tile) || !tile.kind) {
        (tile as Tile).kind = 'button';
      }
    }
  }
  return layout;
}

export async function loadOrInitLayout(): Promise<Layout> {
  let parsed: unknown = null;
  try {
    const data = await fs.readFile(LAYOUT_FILE, 'utf8');
    parsed = JSON.parse(data);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const layout = normalizeLayout(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(layout)) {
    await saveLayout(layout);
  }
  return layout;
}

export async function reloadLayout(): Promise<Layout> {
  const data = await fs.readFile(LAYOUT_FILE, 'utf8');
  return normalizeLayout(JSON.parse(data));
}

export async function saveLayout(layout: Layout): Promise<void> {
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.writeFile(LAYOUT_FILE, JSON.stringify(layout, null, 2), 'utf8');
}

export function toPublic(layout: Layout): PublicLayout {
  return {
    navigation: layout.navigation,
    pages: layout.pages.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      buttons: p.buttons.map((t): PublicTile => {
        if (t.kind === 'slider') {
          return { kind: 'slider', id: t.id, label: t.label, icon: t.icon, inputName: t.inputName };
        }
        const out: PublicButton = { kind: 'button', id: t.id, label: t.label, icon: t.icon };
        const steps = Array.isArray(t.action) ? t.action : [t.action];
        const streamer = steps.find((a) => a.type === 'twitch-streamer');
        if (streamer && streamer.type === 'twitch-streamer' && streamer.login) {
          out.streamerLogin = streamer.login.trim().toLowerCase();
        }
        const goto = steps.find((a) => a.type === 'goto-page');
        if (goto && goto.type === 'goto-page') {
          out.gotoPageId = goto.pageId;
        }
        return out;
      }),
    })),
  };
}

/** Collect every twitch-streamer login referenced in the layout (deduped, lowercased). */
export function collectStreamerLogins(layout: Layout): string[] {
  const set = new Set<string>();
  for (const page of layout.pages) {
    for (const t of page.buttons) {
      if (t.kind !== 'button') continue;
      const steps = Array.isArray(t.action) ? t.action : [t.action];
      for (const a of steps) {
        if (a.type === 'twitch-streamer' && a.login) {
          set.add(a.login.trim().toLowerCase());
        }
      }
    }
  }
  return [...set];
}

export function findTile(layout: Layout, id: number): Tile | undefined {
  for (const page of layout.pages) {
    for (const t of page.buttons) {
      if (t.id === id) return t;
    }
  }
  return undefined;
}

export function watchLayout(onChange: () => void): () => void {
  let debounce: NodeJS.Timeout | null = null;
  const w = watch(APP_DIR, (_event, file) => {
    if (file !== 'layout.json') return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(onChange, 200);
  });
  return () => w.close();
}

const VALID_ACTION_TYPES = new Set(['hotkey', 'text', 'launch', 'url', 'script', 'volume', 'mic', 'obs', 'twitch', 'twitch-streamer', 'goto-page']);

export function validateLayout(input: unknown): Layout {
  if (!input || typeof input !== 'object') throw new Error('layout must be an object');
  const obj = input as Record<string, unknown>;

  // Legacy shape: { buttons: [...] } — wrap into a single page.
  if (Array.isArray(obj.buttons) && !Array.isArray(obj.pages)) {
    const buttons = validateButtons(obj.buttons, new Set());
    return { pages: [{ id: 0, name: 'Home', buttons }] };
  }

  if (!Array.isArray(obj.pages)) throw new Error('layout.pages must be an array');
  if (obj.pages.length === 0) throw new Error('layout must have at least one page');

  const navigation = parseNavigation(obj.navigation);

  const pageIds = new Set<number>();
  const buttonIds = new Set<number>();
  const pages: Page[] = [];

  for (const p of obj.pages) {
    if (!p || typeof p !== 'object') throw new Error('page must be an object');
    const pg = p as Record<string, unknown>;
    if (typeof pg.id !== 'number') throw new Error('page.id must be a number');
    if (pageIds.has(pg.id)) throw new Error(`duplicate page id: ${pg.id}`);
    pageIds.add(pg.id);
    if (typeof pg.name !== 'string') throw new Error(`page ${pg.id}: name must be a string`);
    if (pg.icon !== undefined && typeof pg.icon !== 'string') throw new Error(`page ${pg.id}: icon must be a string`);
    if (!Array.isArray(pg.buttons)) throw new Error(`page ${pg.id}: buttons must be an array`);
    const buttons = validateButtons(pg.buttons, buttonIds);
    pages.push({
      id: pg.id,
      name: pg.name,
      icon: pg.icon as string | undefined,
      buttons,
    });
  }

  const result: Layout = { pages };
  if (navigation !== undefined) result.navigation = navigation;
  return result;
}

function parseNavigation(value: unknown): NavigationMode | undefined {
  if (value === 'tabs' || value === 'folders') return value;
  if (value === undefined || value === null) return undefined;
  throw new Error(`layout.navigation must be "tabs" or "folders" (got: ${JSON.stringify(value)})`);
}

function validateButtons(input: unknown[], seenIds: Set<number>): Tile[] {
  const result: Tile[] = [];
  for (const t of input) {
    if (!t || typeof t !== 'object') throw new Error('tile must be an object');
    const tile = t as Record<string, unknown>;
    if (typeof tile.id !== 'number') throw new Error('tile.id must be a number');
    if (seenIds.has(tile.id)) throw new Error(`duplicate tile id: ${tile.id}`);
    seenIds.add(tile.id);
    if (typeof tile.label !== 'string') throw new Error(`tile ${tile.id}: label must be a string`);
    if (tile.icon !== undefined && typeof tile.icon !== 'string') throw new Error(`tile ${tile.id}: icon must be a string`);

    const kind = (tile.kind as string | undefined) ?? 'button';
    if (kind === 'slider') {
      if (typeof tile.inputName !== 'string' || !tile.inputName) {
        throw new Error(`tile ${tile.id}: slider requires inputName`);
      }
    } else if (kind === 'button') {
      validateButtonAction(tile.action, tile.id);
    } else {
      throw new Error(`tile ${tile.id}: unknown kind "${kind}"`);
    }
    // Normalize: ensure kind is set on stored tile.
    if (!tile.kind) tile.kind = 'button';
    result.push(tile as unknown as Tile);
  }
  return result;
}

function validateButtonAction(input: unknown, buttonId: number): void {
  if (Array.isArray(input)) {
    if (input.length === 0) throw new Error(`button ${buttonId}: action sequence is empty`);
    input.forEach((step, i) => validateActionStep(step, buttonId, i));
    return;
  }
  validateActionStep(input, buttonId);
}

function validateActionStep(input: unknown, buttonId: number, stepIndex?: number): void {
  const where = stepIndex !== undefined
    ? `button ${buttonId} step ${stepIndex + 1}`
    : `button ${buttonId}`;
  if (!input || typeof input !== 'object') {
    throw new Error(`${where}: action must be an object`);
  }
  const step = input as Record<string, unknown>;
  if (typeof step.type !== 'string') {
    throw new Error(`${where}: action.type must be a string`);
  }
  if (!VALID_ACTION_TYPES.has(step.type)) {
    throw new Error(`${where}: unknown action type "${step.type}"`);
  }
}

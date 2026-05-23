import { promises as fs, watch } from 'node:fs';
import { join } from 'node:path';
import type { Action } from './actions/types.js';

export type Button = { id: number; label: string; icon?: string; action: Action };
export type Page = { id: number; name: string; icon?: string; buttons: Button[] };
export type Layout = { pages: Page[] };

export type PublicButton = { id: number; label: string; icon?: string };
export type PublicPage = { id: number; name: string; icon?: string; buttons: PublicButton[] };
export type PublicLayout = { pages: PublicPage[] };

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
        { id: 0, label: 'Copy',    icon: 'copy',           action: { type: 'hotkey', keys: ['LeftControl', 'C'] } },
        { id: 1, label: 'Paste',   icon: 'clipboard',      action: { type: 'hotkey', keys: ['LeftControl', 'V'] } },
        { id: 2, label: 'Vol +',   icon: 'volume-2',       action: { type: 'volume', delta: 2 } },
        { id: 3, label: 'Vol –',   icon: 'volume-1',       action: { type: 'volume', delta: -2 } },
        { id: 4, label: 'Mute',    icon: 'volume-x',       action: { type: 'volume', mute: true } },
        { id: 5, label: 'Notepad', icon: 'file-text',      action: { type: 'launch', path: 'notepad.exe' } },
        { id: 6, label: 'GitHub',  icon: 'github',         action: { type: 'url', url: 'https://github.com' } },
        { id: 7, label: 'Hi',      icon: 'message-circle', action: { type: 'text', text: 'Hello from ancient-crown!' } },
      ],
    },
  ],
};

/** Migrate any input shape (legacy `{ buttons }`, missing fields, etc.) into the canonical Layout. */
function normalizeLayout(parsed: unknown): Layout {
  if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.pages) && obj.pages.length > 0) {
    return obj as unknown as Layout;
  }
  if (Array.isArray(obj.buttons)) {
    return {
      pages: [{
        id: 0,
        name: 'Home',
        icon: 'home',
        buttons: obj.buttons as Button[],
      }],
    };
  }
  return DEFAULT_LAYOUT;
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
    pages: layout.pages.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      buttons: p.buttons.map(({ id, label, icon }) => ({ id, label, icon })),
    })),
  };
}

export function findButton(layout: Layout, id: number): Button | undefined {
  for (const page of layout.pages) {
    for (const b of page.buttons) {
      if (b.id === id) return b;
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

const VALID_ACTION_TYPES = new Set(['hotkey', 'text', 'launch', 'url', 'script', 'volume', 'obs', 'twitch']);

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

  return { pages };
}

function validateButtons(input: unknown[], seenIds: Set<number>): Button[] {
  const result: Button[] = [];
  for (const b of input) {
    if (!b || typeof b !== 'object') throw new Error('button must be an object');
    const btn = b as Record<string, unknown>;
    if (typeof btn.id !== 'number') throw new Error('button.id must be a number');
    if (seenIds.has(btn.id)) throw new Error(`duplicate button id: ${btn.id}`);
    seenIds.add(btn.id);
    if (typeof btn.label !== 'string') throw new Error(`button ${btn.id}: label must be a string`);
    if (btn.icon !== undefined && typeof btn.icon !== 'string') throw new Error(`button ${btn.id}: icon must be a string`);
    const action = btn.action as Record<string, unknown> | undefined;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      throw new Error(`button ${btn.id}: missing action`);
    }
    if (!VALID_ACTION_TYPES.has(action.type)) {
      throw new Error(`button ${btn.id}: unknown action type "${action.type}"`);
    }
    result.push(btn as unknown as Button);
  }
  return result;
}

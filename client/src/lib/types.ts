export type ObsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam' | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene' | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source';

export type ObsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

export type TwitchOp = 'chat';

export type MicOp = 'toggle-mute' | 'mute' | 'unmute';

export type Action =
  | { type: 'hotkey'; keys: string[] }
  | { type: 'text'; text: string }
  | { type: 'launch'; path: string; args?: string[]; cwd?: string }
  | { type: 'url'; url: string }
  | { type: 'script'; script: string }
  | { type: 'volume'; delta?: number; mute?: boolean }
  | { type: 'mic'; op: MicOp }
  | { type: 'obs'; op: ObsOp; params?: ObsActionParams }
  | { type: 'twitch'; op: TwitchOp; text: string }
  | { type: 'twitch-streamer'; login: string }
  | { type: 'goto-page'; pageId: number }
  | { type: 'wait'; ms: number };

export type ActionType = Action['type'];

/** A button's action is either a single step or an ordered sequence of steps. */
export type ButtonAction = Action | Action[];

export type Button = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  /** Uploaded image filename (server-side, under %APPDATA%/digi-deck/images/). Wins over `icon`. */
  image?: string;
  action: ButtonAction;
  /** Optional action fired on hold (~500ms). When absent, holding still triggers the primary action. */
  longPressAction?: ButtonAction;
};

export type SliderTile = {
  kind: 'slider';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  /** OBS input name this slider drives (volume + mute). */
  inputName: string;
};

export type Tile = Button | SliderTile;
export type Page = { id: number; name: string; icon?: string; image?: string; cols?: number; buttons: Tile[] };
export type NavigationMode = 'tabs' | 'folders';
export type Layout = { navigation?: NavigationMode; pages: Page[] };

export type TileKind = Tile['kind'];

export function defaultTile(kind: TileKind, id: number): Tile {
  if (kind === 'slider') {
    return { kind: 'slider', id, label: 'Slider', inputName: '' };
  }
  return { kind: 'button', id, label: 'New', action: defaultAction('hotkey') };
}

export type PublicButton = { id: number; label: string; icon?: string };
export type PublicPage = { id: number; name: string; icon?: string; buttons: PublicButton[] };
export type PublicLayout = { pages: PublicPage[] };

export function nextButtonId(layout: Layout): number {
  let max = -1;
  for (const p of layout.pages) for (const t of p.buttons) if (t.id > max) max = t.id;
  return max + 1;
}

/** Backwards-compat alias. */
export const nextTileId = nextButtonId;

export function nextPageId(layout: Layout): number {
  return layout.pages.reduce((m, p) => Math.max(m, p.id), -1) + 1;
}

export function defaultAction(type: ActionType): Action {
  switch (type) {
    case 'hotkey': return { type: 'hotkey', keys: [] };
    case 'text':   return { type: 'text', text: '' };
    case 'launch': return { type: 'launch', path: '' };
    case 'url':    return { type: 'url', url: '' };
    case 'script': return { type: 'script', script: '' };
    case 'volume': return { type: 'volume', delta: 2 };
    case 'mic':    return { type: 'mic', op: 'toggle-mute' };
    case 'obs':    return { type: 'obs', op: 'toggle-record' };
    case 'twitch': return { type: 'twitch', op: 'chat', text: '' };
    case 'twitch-streamer': return { type: 'twitch-streamer', login: '' };
    case 'goto-page': return { type: 'goto-page', pageId: 0 };
    case 'wait': return { type: 'wait', ms: 200 };
  }
}

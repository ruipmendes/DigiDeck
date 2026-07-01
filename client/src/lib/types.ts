export type ObsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam' | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene' | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source';

export type ObsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

export type TwitchOp = 'chat';

export type KickOp = 'chat';

export type MicOp = 'toggle-mute' | 'mute' | 'unmute';

export type StreamlabsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam'
  | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene'
  | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source';

export type StreamlabsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

export type Action =
  | { type: 'hotkey'; keys: string[] }
  | { type: 'text'; text: string }
  | { type: 'launch'; path: string; args?: string[]; cwd?: string }
  | { type: 'url'; url: string }
  | { type: 'script'; script: string }
  | { type: 'volume'; delta?: number; mute?: boolean }
  | { type: 'mic'; op: MicOp }
  | { type: 'obs'; op: ObsOp; params?: ObsActionParams }
  | { type: 'streamlabs'; op: StreamlabsOp; params?: StreamlabsActionParams }
  | { type: 'twitch'; op: TwitchOp; text: string }
  | { type: 'twitch-streamer'; login: string }
  | { type: 'kick'; op: KickOp; text: string }
  | { type: 'kick-streamer'; slug: string }
  | { type: 'goto-page'; pageId: number }
  | { type: 'wait'; ms: number };

export type ActionType = Action['type'];

/** A button's action is either a single step or an ordered sequence of steps. */
export type ButtonAction = Action | Action[];

export type ImageFit = 'cover' | 'fill' | 'contain';

export type Button = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  /** Uploaded image filename (server-side, under %APPDATA%/digi-deck/images/). Wins over `icon`. */
  image?: string;
  /** How to fit the image inside the tile. Defaults to 'cover'. */
  imageFit?: ImageFit;
  /** Hex color override for active-state border / flash / source dot. */
  accentColor?: string;
  action: ButtonAction;
  /** Optional action fired on hold (~500ms). When absent, holding still triggers the primary action. */
  longPressAction?: ButtonAction;
};

export type SliderProvider = 'obs' | 'streamlabs';

export type SliderTile = {
  kind: 'slider';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  /** Hex color override for the fader fill. */
  accentColor?: string;
  /** Which integration owns this slider. Defaults to 'obs' when omitted. */
  provider?: SliderProvider;
  /** Audio input name this slider drives (volume + mute). */
  inputName: string;
};

/** Spacer tile — no label, no action, no visuals. Just occupies one grid slot. */
export type BlankTile = {
  kind: 'blank';
  id: number;
};

export type Tile = Button | SliderTile | BlankTile;
export type Page = {
  id: number;
  name: string;
  icon?: string;
  image?: string;
  cols?: number;
  background?: string;
  /** Uploaded image filename used as the page-wide phone backdrop. */
  backgroundImage?: string;
  buttons: Tile[];
};
export type NavigationMode = 'tabs' | 'folders';
export type Layout = { navigation?: NavigationMode; pages: Page[] };

export type TileKind = Tile['kind'];

export function defaultTile(kind: TileKind, id: number): Tile {
  if (kind === 'slider') {
    return { kind: 'slider', id, label: 'Slider', inputName: '' };
  }
  if (kind === 'blank') {
    return { kind: 'blank', id };
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
    case 'streamlabs': return { type: 'streamlabs', op: 'toggle-record' };
    case 'twitch': return { type: 'twitch', op: 'chat', text: '' };
    case 'twitch-streamer': return { type: 'twitch-streamer', login: '' };
    case 'kick': return { type: 'kick', op: 'chat', text: '' };
    case 'kick-streamer': return { type: 'kick-streamer', slug: '' };
    case 'goto-page': return { type: 'goto-page', pageId: 0 };
    case 'wait': return { type: 'wait', ms: 200 };
  }
}

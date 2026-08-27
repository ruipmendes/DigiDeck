export type ObsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam' | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene' | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source'
  | 'media-play' | 'media-pause' | 'media-restart' | 'media-stop'
  | 'media-next' | 'media-previous'
  | 'refresh-browser-source';

export type ObsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

/** Which integrations are enabled at the current moment — used to gate action
 *  picker entries and slider providers on integration availability. */
export type IntegrationStatus = {
  obs: boolean; twitch: boolean; streamlabs: boolean; kick: boolean; discord: boolean; spotify: boolean; hue: boolean;
  /** True when the connected Spotify account has Premium. Used to gate playback
   *  control tiles — free-tier accounts get a lock icon instead of being able
   *  to pick play/pause/next/previous/volume. */
  spotifyPremium: boolean;
};

export type TwitchOp =
  | 'chat'
  | 'chat-announcement'
  | 'run-ad'
  | 'snooze-ad'
  | 'create-clip'
  | 'stream-marker'
  | 'clear-chat'
  | 'toggle-shield-mode'
  | 'toggle-emote-only'
  | 'toggle-sub-only'
  | 'toggle-follower-only'
  | 'toggle-slow-mode'
  | 'start-raid'
  | 'cancel-raid'
  | 'shoutout'
  | 'update-title'
  | 'update-category'
  | 'create-poll'
  | 'create-prediction';

export type TwitchAnnouncementColor = 'primary' | 'blue' | 'green' | 'orange' | 'purple';

export type TwitchActionParams = {
  text?: string;
  color?: TwitchAnnouncementColor;
  adLength?: number;
  duration?: number;
  target?: string;
  title?: string;
  gameName?: string;
  choices?: string[];
  outcomes?: string[];
};

export type TwitchPromptField = 'target' | 'title' | 'gameName';
export type TwitchPrompt = { field: TwitchPromptField; label: string; placeholder?: string };

export type KickOp =
  | 'chat'
  | 'delete-message'
  | 'ban-user'
  | 'unban-user'
  | 'update-title'
  | 'update-category'
  | 'run-ad';

export type KickActionParams = {
  text?: string;
  messageId?: string;
  target?: string;
  banDuration?: number;
  banReason?: string;
  title?: string;
  category?: string;
  adLength?: number;
};

export type KickPromptField = 'text' | 'messageId' | 'target' | 'title' | 'category' | 'banReason';
export type KickPrompt = { field: KickPromptField; label: string; placeholder?: string };

export type DiscordOp =
  | 'toggle-mute' | 'mute' | 'unmute'
  | 'toggle-deafen' | 'deafen' | 'undeafen'
  | 'toggle-ptt'
  | 'toggle-noise-suppression'
  | 'toggle-auto-gain'
  | 'toggle-echo-cancellation'
  | 'join-channel'
  | 'leave-channel'
  | 'set-user-volume'
  | 'mute-user'
  | 'unmute-user'
  | 'pull-user'
  | 'move-user'
  | 'kick-user';

export type DiscordActionParams = {
  channelId?: string;
  userId?: string;
  volume?: number;
};

export type DiscordPromptField = 'channelId' | 'userId';
export type DiscordChoicesSource =
  | 'discord-voice-channels'
  | 'discord-channel-members'
  | 'discord-guild-voice-members';
export type DiscordPrompt = {
  field: DiscordPromptField;
  label: string;
  placeholder?: string;
  choicesSource?: DiscordChoicesSource;
};

export type MicOp = 'toggle-mute' | 'mute' | 'unmute';

export type SpotifyOp = 'toggle-play' | 'play' | 'pause' | 'next' | 'previous';

export type HueOp =
  | 'scene-on'
  | 'light-on' | 'light-off' | 'light-toggle'
  | 'room-on' | 'room-off' | 'room-toggle';

export type HueActionParams = {
  lightId?: string;
  roomId?: string;
  sceneId?: string;
};

export type AppAudioOp = 'toggle-mute' | 'mute' | 'unmute' | 'set-volume';
export type AppAudioActionParams = { appName?: string; volumePercent?: number };

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
  | { type: 'app-audio'; op: AppAudioOp; params?: AppAudioActionParams }
  | { type: 'obs'; op: ObsOp; params?: ObsActionParams }
  | { type: 'streamlabs'; op: StreamlabsOp; params?: StreamlabsActionParams }
  | { type: 'twitch'; op: TwitchOp; text?: string; params?: TwitchActionParams; prompts?: TwitchPrompt[] }
  | { type: 'twitch-streamer'; login: string }
  | { type: 'kick'; op: KickOp; text?: string; params?: KickActionParams; prompts?: KickPrompt[] }
  | { type: 'kick-streamer'; slug: string; avatarUrl?: string }
  | { type: 'discord'; op: DiscordOp; params?: DiscordActionParams; prompts?: DiscordPrompt[] }
  | { type: 'spotify'; op: SpotifyOp }
  | { type: 'hue'; op: HueOp; params?: HueActionParams }
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

export type SliderProvider = 'obs' | 'streamlabs' | 'discord' | 'spotify' | 'app-audio' | 'hue';

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

/** Live roster of the Discord voice channel the account is currently in.
 *  Renders as a wide card with per-user volume + mute controls. */
export type DiscordVoicePanelTile = {
  kind: 'discord-voice-panel';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  accentColor?: string;
};

/** Numeric LiveMeta sources that can feed a chart tile. */
export type ChartSource = 'obs.droppedFrames' | 'spotify.volumePercent' | 'kick.viewerCount' | 'system.cpu' | 'system.ram' | 'system.gpu';

/** Small sparkline tile — no tap action; renders a rolling trace of a
 *  numeric LiveMeta value. Value mode plots raw; delta mode plots
 *  raw - previous (useful for monotonic counters like droppedFrames). */
export type ChartTile = {
  kind: 'chart';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  accentColor?: string;
  source: ChartSource;
  mode?: 'value' | 'delta';
  color?: string;
  min?: number;
  max?: number;
};

export type Tile = Button | SliderTile | BlankTile | DiscordVoicePanelTile | ChartTile;
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
  if (kind === 'discord-voice-panel') {
    return { kind: 'discord-voice-panel', id, label: 'Voice channel' };
  }
  if (kind === 'chart') {
    return { kind: 'chart', id, label: 'Drops', source: 'obs.droppedFrames', mode: 'delta' };
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
    case 'app-audio': return { type: 'app-audio', op: 'toggle-mute' };
    case 'obs':    return { type: 'obs', op: 'toggle-record' };
    case 'streamlabs': return { type: 'streamlabs', op: 'toggle-record' };
    case 'twitch': return { type: 'twitch', op: 'chat', text: '' };
    case 'twitch-streamer': return { type: 'twitch-streamer', login: '' };
    case 'kick': return { type: 'kick', op: 'chat', text: '' };
    case 'kick-streamer': return { type: 'kick-streamer', slug: '' };
    case 'discord': return { type: 'discord', op: 'toggle-mute' };
    case 'spotify': return { type: 'spotify', op: 'toggle-play' };
    case 'hue':     return { type: 'hue', op: 'room-toggle', params: {} };
    case 'goto-page': return { type: 'goto-page', pageId: 0 };
    case 'wait': return { type: 'wait', ms: 200 };
  }
}

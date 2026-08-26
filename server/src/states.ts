import type { Action } from './actions/types.js';
import type { Tile, Layout } from './layout.js';
import type { ObsStatus } from './integrations/obs.js';
import type { StreamlabsStatus } from './integrations/streamlabs.js';
import type { TwitchStatus } from './integrations/twitch.js';
import type { KickStatus } from './integrations/kick.js';
import type { DiscordStatus, DiscordChannelMember } from './integrations/discord.js';
import type { SpotifyStatus } from './integrations/spotify.js';
import { getSpotify } from './integrations/spotify.js';
import { getAppAudio } from './actions/appAudio.js';
import { getStreamers } from './integrations/twitch-streamers.js';
import { getKickStreamers } from './integrations/kick-streamers.js';
import { getMic } from './actions/mic.js';

export type ButtonState = {
  id: number;
  active?: boolean;
  /** Visual style hint for active state. Default is the standard blue; 'source' renders green. */
  kind?: 'source';
  unavailable?: boolean;
  /** Twitch streamer profile image URL (when the action is twitch-streamer and the poller has data). */
  thumbnail?: string;
  /** Whether the streamer is currently live. Undefined when not yet known. */
  live?: boolean;
  /** Dynamic icon URL rendered as the tile background — e.g. the target
   *  guild's icon on a Discord join-channel tile. Overridden by an author-
   *  uploaded `tile.image` when both are present. */
  iconUrl?: string;
  /** Current value for slider tiles (0..1). */
  sliderValue?: number;
  /** Current mute state for slider tiles. */
  sliderMuted?: boolean;
  /** Live roster for a discord-voice-panel tile. */
  voicePanelMembers?: DiscordChannelMember[];
  /** True when a voice-panel tile is unavailable because Discord isn't
   *  connected or the user isn't in a voice channel. */
  voicePanelDisconnected?: boolean;
};

export function computeButtonStates(
  layout: Layout,
  obs: ObsStatus,
  twitch: TwitchStatus,
  streamlabs: StreamlabsStatus,
  kick: KickStatus,
  discord: DiscordStatus,
): ButtonState[] {
  const out: ButtonState[] = [];
  for (const page of layout.pages) {
    for (const tile of page.buttons) {
      const s = computeOne(tile, obs, twitch, streamlabs, kick, discord);
      if (s) out.push(s);
    }
  }
  return out;
}

function computeOne(t: Tile, obs: ObsStatus, twitch: TwitchStatus, streamlabs: StreamlabsStatus, kick: KickStatus, discord: DiscordStatus): ButtonState | null {
  if (t.kind === 'blank') return null;
  if (t.kind === 'discord-voice-panel') {
    if (discord.state !== 'connected' || !discord.currentVoiceChannelId) {
      return { id: t.id, voicePanelDisconnected: true };
    }
    return { id: t.id, voicePanelMembers: discord.channelMembers ?? [] };
  }
  if (t.kind === 'slider') {
    const provider = t.provider ?? 'obs';
    if (provider === 'discord') {
      if (discord.state !== 'connected') return { id: t.id, unavailable: true };
      if (t.inputName === 'sensitivity') {
        if (discord.voiceThreshold === undefined) return { id: t.id, unavailable: true };
        // threshold -100..0 dB → slider 1..0 (higher slider = more sensitive).
        const value = Math.max(0, Math.min(1, -discord.voiceThreshold / 100));
        // While Discord is auto-adjusting, the "muted" pip signals "manual override off".
        return { id: t.id, sliderValue: value, sliderMuted: !!discord.voiceAutoThreshold };
      }
      const isOutput = t.inputName === 'output';
      const raw = isOutput ? discord.outputVolume : discord.inputVolume;
      if (raw === undefined) return { id: t.id, unavailable: true };
      // Discord reports 0-100 (input) or 0-200 (output); phone protocol is 0-1.
      // Output maps against the full 0-200 range so the slider covers Discord's
      // boost band; slider 0.5 = 100 % "normal", 1.0 = 200 % max.
      const scale = isOutput ? 200 : 100;
      const value = Math.max(0, Math.min(1, raw / scale));
      const muted = isOutput ? !!discord.deaf : !!discord.mute;
      return { id: t.id, sliderValue: value, sliderMuted: muted };
    }
    if (provider === 'spotify') {
      const spotify = getSpotify().status();
      if (spotify.state !== 'connected') return { id: t.id, unavailable: true };
      if (spotify.volumePercent === undefined) return { id: t.id, unavailable: true };
      // Spotify's active-device volume is 0..100; phone protocol is 0..1.
      // The "muted" pip lights when playback is paused — the slider tile's
      // tap-to-mute action maps to toggle-play for Spotify.
      const value = Math.max(0, Math.min(1, spotify.volumePercent / 100));
      const muted = !spotify.isPlaying;
      return { id: t.id, sliderValue: value, sliderMuted: muted };
    }
    if (provider === 'app-audio') {
      const session = getAppAudio().getSessions().find(
        (s) => s.name.toLowerCase() === t.inputName.toLowerCase(),
      );
      if (!session) return { id: t.id, unavailable: true };
      return { id: t.id, sliderValue: session.volume, sliderMuted: session.muted };
    }
    const src = provider === 'streamlabs' ? streamlabs : obs;
    if (src.state !== 'connected') return { id: t.id, unavailable: true };
    const value = src.inputVolumes[t.inputName];
    const muted = src.mutedInputs.includes(t.inputName);
    if (value === undefined) return { id: t.id, unavailable: true };
    return { id: t.id, sliderValue: value, sliderMuted: muted };
  }
  if (t.kind === 'chart') {
    // Chart tiles read their value directly from LiveMeta on the client —
    // no server-side ButtonState needed. Skip entirely.
    return null;
  }

  const steps: Action[] = Array.isArray(t.action) ? t.action : [t.action];

  let active: boolean | undefined;
  let kind: ButtonState['kind'];
  let unavailable = false;
  let thumbnail: string | undefined;
  let live: boolean | undefined;
  let iconUrl: string | undefined;

  for (const step of steps) {
    const s = computeStepState(step, obs, twitch, streamlabs, kick, discord);
    if (!s) continue;
    if (s.unavailable) unavailable = true;
    if (active === undefined && s.active !== undefined) {
      active = s.active;
      kind = s.kind;
    }
    if (thumbnail === undefined && s.thumbnail) thumbnail = s.thumbnail;
    if (live === undefined && s.live !== undefined) live = s.live;
    if (iconUrl === undefined && s.iconUrl) iconUrl = s.iconUrl;
  }

  const hasAnything =
    active !== undefined || unavailable || thumbnail !== undefined || live !== undefined || iconUrl !== undefined;
  if (!hasAnything) return null;

  const state: ButtonState = { id: t.id };
  if (active !== undefined) state.active = active;
  if (kind && active) state.kind = kind;
  if (unavailable) state.unavailable = true;
  if (thumbnail !== undefined) state.thumbnail = thumbnail;
  if (live !== undefined) state.live = live;
  if (iconUrl !== undefined) state.iconUrl = iconUrl;
  return state;
}

type StepState = {
  active?: boolean;
  kind?: ButtonState['kind'];
  unavailable?: boolean;
  thumbnail?: string;
  live?: boolean;
  iconUrl?: string;
};

function computeStepState(a: Action, obs: ObsStatus, twitch: TwitchStatus, streamlabs: StreamlabsStatus, kick: KickStatus, discord: DiscordStatus): StepState | null {
  if (a.type === 'obs') {
    const unavailable = obs.state !== 'connected';
    let active: boolean | undefined;
    let kind: ButtonState['kind'];
    let iconUrl: string | undefined;
    switch (a.op) {
      case 'toggle-record':
      case 'start-record':
      case 'stop-record':
        active = obs.recording;
        break;
      case 'toggle-stream':
      case 'start-stream':
      case 'stop-stream':
        active = obs.streaming;
        break;
      case 'toggle-virtual-cam':
        active = obs.virtualCam;
        break;
      case 'set-scene': {
        const sceneName = a.params?.sceneName;
        active = !!sceneName && sceneName === obs.currentScene;
        // Live scene preview as the tile background — the server polls a fresh
        // screenshot every few seconds for every scene referenced by a
        // set-scene tile, so users see what each scene contains at a glance.
        if (sceneName) iconUrl = obs.sceneThumbnails?.[sceneName];
        break;
      }
      case 'toggle-mute':
        active = !!a.params?.inputName && obs.mutedInputs.includes(a.params.inputName);
        break;
      case 'toggle-source':
      case 'show-source':
      case 'hide-source':
        if (a.params?.sceneName && a.params?.sourceName) {
          const key = `${a.params.sceneName}::${a.params.sourceName}`;
          const visible = obs.sourceStates[key];
          if (visible !== undefined) {
            active = a.op === 'hide-source' ? !visible : visible;
          }
        }
        kind = 'source';
        break;
    }
    return { active, kind, unavailable, iconUrl };
  }

  if (a.type === 'streamlabs') {
    const unavailable = streamlabs.state !== 'connected';
    let active: boolean | undefined;
    let kind: ButtonState['kind'];
    switch (a.op) {
      case 'toggle-record':
      case 'start-record':
      case 'stop-record':
        active = streamlabs.recording;
        break;
      case 'toggle-stream':
      case 'start-stream':
      case 'stop-stream':
        active = streamlabs.streaming;
        break;
      case 'toggle-virtual-cam':
        active = streamlabs.virtualCam;
        break;
      case 'toggle-replay-buffer':
      case 'save-replay-buffer':
        active = streamlabs.replayBuffer;
        break;
      case 'set-scene':
        active = !!a.params?.sceneName && a.params.sceneName === streamlabs.currentScene;
        break;
      case 'toggle-mute':
        active = !!a.params?.inputName && streamlabs.mutedInputs.includes(a.params.inputName);
        break;
      case 'toggle-source':
      case 'show-source':
      case 'hide-source':
        if (a.params?.sceneName && a.params?.sourceName) {
          const key = `${a.params.sceneName}::${a.params.sourceName}`;
          const visible = streamlabs.sourceStates[key];
          if (visible !== undefined) {
            active = a.op === 'hide-source' ? !visible : visible;
          }
        }
        kind = 'source';
        break;
    }
    return { active, kind, unavailable };
  }

  if (a.type === 'twitch') {
    return { unavailable: twitch.state !== 'connected' };
  }

  if (a.type === 'twitch-streamer') {
    const info = getStreamers().get(a.login);
    if (!info) return null;
    return { thumbnail: info.profileImageUrl, live: info.live };
  }

  if (a.type === 'kick') {
    return { unavailable: kick.state !== 'connected' };
  }

  if (a.type === 'kick-streamer') {
    const info = getKickStreamers().get(a.slug);
    // User-pasted avatarUrl wins — Kick's OAuth API doesn't expose other users'
    // profile pics, so this field lets people supply a stable image from
    // files.kick.com (right-click the avatar on kick.com → Copy image address).
    const thumbnail = a.avatarUrl || info?.profileImageUrl || undefined;
    const live = info?.live;
    if (thumbnail === undefined && live === undefined) return null;
    return { thumbnail, live };
  }

  if (a.type === 'mic') {
    const mic = getMic();
    if (!mic.isAvailable()) return { unavailable: true };
    const muted = mic.isMuted();
    if (muted === undefined) return null;
    // "active" when the mic IS muted — matches OBS toggle-mute convention.
    return { active: muted };
  }

  if (a.type === 'discord') {
    const unavailable = discord.state !== 'connected';
    let active: boolean | undefined;
    let iconUrl: string | undefined;
    switch (a.op) {
      case 'toggle-mute':   case 'mute':   case 'unmute':   active = discord.mute; break;
      case 'toggle-deafen': case 'deafen': case 'undeafen': active = discord.deaf; break;
      case 'toggle-ptt':               active = discord.voiceMode === 'PUSH_TO_TALK'; break;
      case 'toggle-noise-suppression': active = discord.noiseSuppression; break;
      case 'toggle-auto-gain':         active = discord.automaticGainControl; break;
      case 'toggle-echo-cancellation': active = discord.echoCancellation; break;
      case 'join-channel': {
        const cid = a.params?.channelId;
        // Light the tile when we're currently in the channel this button joins.
        active = !!cid && discord.currentVoiceChannelId === cid;
        // Render the target guild's icon as the tile background. Present only
        // once the icon cache has been primed; falls back to a plain tile otherwise.
        if (cid) iconUrl = discord.channelIcons?.[cid];
        break;
      }
      case 'leave-channel':
        active = discord.currentVoiceChannelId != null;
        break;
    }
    return { active, unavailable, iconUrl };
  }

  if (a.type === 'spotify') {
    const spotify: SpotifyStatus = getSpotify().status();
    const unavailable = spotify.state !== 'connected';
    let active: boolean | undefined;
    switch (a.op) {
      case 'toggle-play': case 'play': case 'pause':
        // "Active" = something is playing. Same convention as OBS toggle-record.
        active = spotify.isPlaying;
        break;
    }
    // Album cover as the tile background for playback tiles, so users can see
    // what's currently playing at a glance — same mechanism Discord uses for
    // guild icons on join-channel tiles.
    const iconUrl = spotify.coverUrl;
    return { active, unavailable, iconUrl };
  }

  return null;
}

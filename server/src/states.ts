import type { Action } from './actions/types.js';
import type { Tile, Layout } from './layout.js';
import type { ObsStatus } from './integrations/obs.js';
import type { StreamlabsStatus } from './integrations/streamlabs.js';
import type { TwitchStatus } from './integrations/twitch.js';
import { getStreamers } from './integrations/twitch-streamers.js';
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
  /** Current value for slider tiles (0..1). */
  sliderValue?: number;
  /** Current mute state for slider tiles. */
  sliderMuted?: boolean;
};

export function computeButtonStates(
  layout: Layout,
  obs: ObsStatus,
  twitch: TwitchStatus,
  streamlabs: StreamlabsStatus,
): ButtonState[] {
  const out: ButtonState[] = [];
  for (const page of layout.pages) {
    for (const tile of page.buttons) {
      const s = computeOne(tile, obs, twitch, streamlabs);
      if (s) out.push(s);
    }
  }
  return out;
}

function computeOne(t: Tile, obs: ObsStatus, twitch: TwitchStatus, streamlabs: StreamlabsStatus): ButtonState | null {
  if (t.kind === 'blank') return null;
  if (t.kind === 'slider') {
    const provider = t.provider ?? 'obs';
    const src = provider === 'streamlabs' ? streamlabs : obs;
    if (src.state !== 'connected') return { id: t.id, unavailable: true };
    const value = src.inputVolumes[t.inputName];
    const muted = src.mutedInputs.includes(t.inputName);
    if (value === undefined) return { id: t.id, unavailable: true };
    return { id: t.id, sliderValue: value, sliderMuted: muted };
  }

  const steps: Action[] = Array.isArray(t.action) ? t.action : [t.action];

  let active: boolean | undefined;
  let kind: ButtonState['kind'];
  let unavailable = false;
  let thumbnail: string | undefined;
  let live: boolean | undefined;

  for (const step of steps) {
    const s = computeStepState(step, obs, twitch, streamlabs);
    if (!s) continue;
    if (s.unavailable) unavailable = true;
    if (active === undefined && s.active !== undefined) {
      active = s.active;
      kind = s.kind;
    }
    if (thumbnail === undefined && s.thumbnail) thumbnail = s.thumbnail;
    if (live === undefined && s.live !== undefined) live = s.live;
  }

  const hasAnything =
    active !== undefined || unavailable || thumbnail !== undefined || live !== undefined;
  if (!hasAnything) return null;

  const state: ButtonState = { id: t.id };
  if (active !== undefined) state.active = active;
  if (kind && active) state.kind = kind;
  if (unavailable) state.unavailable = true;
  if (thumbnail !== undefined) state.thumbnail = thumbnail;
  if (live !== undefined) state.live = live;
  return state;
}

type StepState = {
  active?: boolean;
  kind?: ButtonState['kind'];
  unavailable?: boolean;
  thumbnail?: string;
  live?: boolean;
};

function computeStepState(a: Action, obs: ObsStatus, twitch: TwitchStatus, streamlabs: StreamlabsStatus): StepState | null {
  if (a.type === 'obs') {
    const unavailable = obs.state !== 'connected';
    let active: boolean | undefined;
    let kind: ButtonState['kind'];
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
      case 'set-scene':
        active = !!a.params?.sceneName && a.params.sceneName === obs.currentScene;
        break;
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
    return { active, kind, unavailable };
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

  if (a.type === 'mic') {
    const mic = getMic();
    if (!mic.isAvailable()) return { unavailable: true };
    const muted = mic.isMuted();
    if (muted === undefined) return null;
    // "active" when the mic IS muted — matches OBS toggle-mute convention.
    return { active: muted };
  }

  return null;
}

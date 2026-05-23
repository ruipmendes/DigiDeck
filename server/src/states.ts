import type { Button, Layout } from './layout.js';
import type { ObsStatus } from './integrations/obs.js';
import type { TwitchStatus } from './integrations/twitch.js';

export type ButtonState = {
  id: number;
  active?: boolean;
  /** Visual style hint for active state. Default is the standard blue; 'source' renders green. */
  kind?: 'source';
  unavailable?: boolean;
};

export function computeButtonStates(
  layout: Layout,
  obs: ObsStatus,
  twitch: TwitchStatus,
): ButtonState[] {
  const out: ButtonState[] = [];
  for (const page of layout.pages) {
    for (const button of page.buttons) {
      const s = computeOne(button, obs, twitch);
      if (s) out.push(s);
    }
  }
  return out;
}

function computeOne(b: Button, obs: ObsStatus, twitch: TwitchStatus): ButtonState | null {
  const a = b.action;

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
        if (a.params?.sceneName && a.params?.sourceName) {
          const key = `${a.params.sceneName}::${a.params.sourceName}`;
          active = obs.sourceStates[key];
        }
        kind = 'source';
        break;
      // toggle-replay-buffer, save-replay-buffer: no tracked "on" state for now
    }
    if (active === undefined && !unavailable) return null;
    const state: ButtonState = { id: b.id };
    if (active !== undefined) state.active = active;
    if (kind && active) state.kind = kind;
    if (unavailable) state.unavailable = true;
    return state;
  }

  if (a.type === 'twitch') {
    const unavailable = twitch.state !== 'connected';
    if (!unavailable) return null;
    return { id: b.id, unavailable: true };
  }

  return null;
}

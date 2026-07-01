import { execHotkey } from './hotkey.js';
import { execText } from './text.js';
import { execLaunch } from './launch.js';
import { execUrl } from './url.js';
import { execScript } from './script.js';
import { execVolume } from './volume.js';
import { getObs } from '../integrations/obs.js';
import type { ObsOp, ObsActionParams } from '../integrations/obs.js';
import { getStreamlabs } from '../integrations/streamlabs.js';
import type { StreamlabsOp, StreamlabsActionParams } from '../integrations/streamlabs.js';
import { getTwitch } from '../integrations/twitch.js';
import type { TwitchOp } from '../integrations/twitch.js';
import { getKick } from '../integrations/kick.js';
import type { KickOp } from '../integrations/kick.js';
import { getMic } from './mic.js';
import type { MicOp } from './mic.js';

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
  | { type: 'kick-streamer'; slug: string; avatarUrl?: string }
  | { type: 'goto-page'; pageId: number }
  | { type: 'wait'; ms: number };

/** A button's action is either a single step or an ordered sequence. */
export type ButtonAction = Action | Action[];

/** Run one action step. */
async function executeStep(step: Action): Promise<void> {
  switch (step.type) {
    case 'hotkey': return execHotkey(step.keys);
    case 'text':   return execText(step.text);
    case 'launch': return execLaunch(step.path, step.args, step.cwd);
    case 'url':    return execUrl(step.url);
    case 'script': return execScript(step.script);
    case 'volume': return execVolume({ delta: step.delta, mute: step.mute });
    case 'mic':    return getMic().execute(step.op);
    case 'obs':    return getObs().execute(step.op, step.params);
    case 'streamlabs': return getStreamlabs().execute(step.op, step.params);
    case 'twitch': return getTwitch().execute(step.op, { text: step.text });
    case 'twitch-streamer':
      // Open the channel in the PC's default browser — same machine that's
      // running OBS/streaming, so the host can put it on screen.
      return execUrl(`https://twitch.tv/${step.login}`);
    case 'kick': return getKick().execute(step.op, { text: step.text });
    case 'kick-streamer':
      return execUrl(`https://kick.com/${step.slug}`);
    case 'goto-page':
      // Navigation is handled entirely on the phone — server has nothing to do.
      return;
    case 'wait':
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, step.ms)));
  }
}

/** Run a button's action — single step or sequence. Aborts on first failing step. */
export async function executeAction(action: ButtonAction): Promise<void> {
  const steps = Array.isArray(action) ? action : [action];
  for (let i = 0; i < steps.length; i++) {
    try {
      await executeStep(steps[i]);
    } catch (err) {
      const msg = (err as Error).message;
      if (steps.length > 1) {
        throw new Error(`step ${i + 1}/${steps.length} (${steps[i].type}) failed: ${msg}`);
      }
      throw err;
    }
  }
}

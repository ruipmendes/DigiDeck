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
import type { TwitchOp, TwitchActionParams, TwitchPrompt } from '../integrations/twitch.js';
import { getKick } from '../integrations/kick.js';
import type { KickOp, KickActionParams, KickPrompt } from '../integrations/kick.js';
import { getDiscord } from '../integrations/discord.js';
import type { DiscordOp, DiscordActionParams, DiscordPrompt } from '../integrations/discord.js';
import { getSpotify } from '../integrations/spotify.js';
import type { SpotifyOp } from '../integrations/spotify.js';
import { getHue } from '../integrations/hue.js';
import type { HueOp, HueActionParams } from '../integrations/hue.js';
import { getHomeAssistant } from '../integrations/homeassistant.js';
import type { HomeAssistantOp, HomeAssistantActionParams } from '../integrations/homeassistant.js';
import { getMic } from './mic.js';
import type { MicOp } from './mic.js';
import { getAppAudio } from './appAudio.js';
import type { AppAudioOp, AppAudioActionParams } from './appAudio.js';

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
  | { type: 'homeassistant'; op: HomeAssistantOp; params?: HomeAssistantActionParams }
  | { type: 'goto-page'; pageId: number }
  | { type: 'wait'; ms: number };

/** A button's action is either a single step or an ordered sequence. */
export type ButtonAction = Action | Action[];

/** Optional gate injected at server startup. When present and returning false,
 *  `script` and `launch` steps refuse to fire with a user-visible error. */
let shellActionsAllowed: (() => boolean) | null = null;
export function setShellActionsGate(gate: () => boolean): void { shellActionsAllowed = gate; }

/** Run one action step. */
async function executeStep(step: Action): Promise<void> {
  switch (step.type) {
    case 'hotkey': return execHotkey(step.keys);
    case 'text':   return execText(step.text);
    case 'launch':
      if (shellActionsAllowed && !shellActionsAllowed()) {
        throw new Error('Launch actions are disabled. Enable in Config → Integrations → Security.');
      }
      return execLaunch(step.path, step.args, step.cwd);
    case 'url':    return execUrl(step.url);
    case 'script':
      if (shellActionsAllowed && !shellActionsAllowed()) {
        throw new Error('Script actions are disabled. Enable in Config → Integrations → Security.');
      }
      return execScript(step.script);
    case 'volume': return execVolume({ delta: step.delta, mute: step.mute });
    case 'mic':    return getMic().execute(step.op);
    case 'app-audio': return getAppAudio().execute(step.op, step.params);
    case 'obs':    return getObs().execute(step.op, step.params);
    case 'streamlabs': return getStreamlabs().execute(step.op, step.params);
    case 'twitch': return getTwitch().execute(step.op, { ...step.params, text: step.text ?? step.params?.text });
    case 'twitch-streamer':
      // Open the channel in the PC's default browser — same machine that's
      // running OBS/streaming, so the host can put it on screen.
      return execUrl(`https://twitch.tv/${step.login}`);
    case 'kick': return getKick().execute(step.op, { ...step.params, text: step.text ?? step.params?.text });
    case 'kick-streamer':
      return execUrl(`https://kick.com/${step.slug}`);
    case 'discord': return getDiscord().execute(step.op, step.params);
    case 'spotify': return getSpotify().execute(step.op);
    case 'hue':     return getHue().execute(step.op, step.params);
    case 'homeassistant': return getHomeAssistant().execute(step.op, step.params);
    case 'goto-page':
      // Navigation is handled entirely on the phone — server has nothing to do.
      return;
    case 'wait':
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, step.ms)));
  }
}

/**
 * Merge prompt-at-press values into any step that declared a matching prompt.
 * The phone collects one flat `Record<field, value>` per press; each step that
 * declared a prompt with that field name receives the value in its `params`.
 * Steps without prompts are returned unchanged.
 */
export function withPromptValues(action: ButtonAction, promptValues: Record<string, string> | undefined): ButtonAction {
  if (!promptValues) return action;
  const merge = (step: Action): Action => {
    if (step.type === 'twitch' && step.prompts?.length) {
      const merged: Record<string, string> = {};
      for (const p of step.prompts) {
        const v = promptValues[p.field];
        if (v !== undefined) merged[p.field] = v;
      }
      if (Object.keys(merged).length === 0) return step;
      return { ...step, params: { ...step.params, ...merged } };
    }
    if (step.type === 'discord' && step.prompts?.length) {
      const merged: Record<string, string> = {};
      for (const p of step.prompts) {
        const v = promptValues[p.field];
        if (v !== undefined) merged[p.field] = v;
      }
      if (Object.keys(merged).length === 0) return step;
      return { ...step, params: { ...step.params, ...merged } };
    }
    if (step.type === 'kick' && step.prompts?.length) {
      const merged: Record<string, string> = {};
      for (const p of step.prompts) {
        const v = promptValues[p.field];
        if (v !== undefined) merged[p.field] = v;
      }
      if (Object.keys(merged).length === 0) return step;
      return { ...step, params: { ...step.params, ...merged } };
    }
    return step;
  };
  return Array.isArray(action) ? action.map(merge) : merge(action);
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

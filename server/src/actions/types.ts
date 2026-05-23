import { execHotkey } from './hotkey.js';
import { execText } from './text.js';
import { execLaunch } from './launch.js';
import { execUrl } from './url.js';
import { execScript } from './script.js';
import { execVolume } from './volume.js';
import { getObs } from '../integrations/obs.js';
import type { ObsOp, ObsActionParams } from '../integrations/obs.js';
import { getTwitch } from '../integrations/twitch.js';
import type { TwitchOp } from '../integrations/twitch.js';

export type Action =
  | { type: 'hotkey'; keys: string[] }
  | { type: 'text'; text: string }
  | { type: 'launch'; path: string; args?: string[]; cwd?: string }
  | { type: 'url'; url: string }
  | { type: 'script'; script: string }
  | { type: 'volume'; delta?: number; mute?: boolean }
  | { type: 'obs'; op: ObsOp; params?: ObsActionParams }
  | { type: 'twitch'; op: TwitchOp; text: string };

export async function executeAction(action: Action): Promise<void> {
  switch (action.type) {
    case 'hotkey': return execHotkey(action.keys);
    case 'text':   return execText(action.text);
    case 'launch': return execLaunch(action.path, action.args, action.cwd);
    case 'url':    return execUrl(action.url);
    case 'script': return execScript(action.script);
    case 'volume': return execVolume({ delta: action.delta, mute: action.mute });
    case 'obs':    return getObs().execute(action.op, action.params);
    case 'twitch': return getTwitch().execute(action.op, { text: action.text });
  }
}

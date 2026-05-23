export type ObsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam' | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene' | 'toggle-mute' | 'toggle-source';

export type ObsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

export type TwitchOp = 'chat';

export type Action =
  | { type: 'hotkey'; keys: string[] }
  | { type: 'text'; text: string }
  | { type: 'launch'; path: string; args?: string[]; cwd?: string }
  | { type: 'url'; url: string }
  | { type: 'script'; script: string }
  | { type: 'volume'; delta?: number; mute?: boolean }
  | { type: 'obs'; op: ObsOp; params?: ObsActionParams }
  | { type: 'twitch'; op: TwitchOp; text: string };

export type ActionType = Action['type'];

export type Button = { id: number; label: string; icon?: string; action: Action };
export type Page = { id: number; name: string; icon?: string; buttons: Button[] };
export type Layout = { pages: Page[] };

export type PublicButton = { id: number; label: string; icon?: string };
export type PublicPage = { id: number; name: string; icon?: string; buttons: PublicButton[] };
export type PublicLayout = { pages: PublicPage[] };

export function nextButtonId(layout: Layout): number {
  let max = -1;
  for (const p of layout.pages) for (const b of p.buttons) if (b.id > max) max = b.id;
  return max + 1;
}

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
    case 'obs':    return { type: 'obs', op: 'toggle-record' };
    case 'twitch': return { type: 'twitch', op: 'chat', text: '' };
  }
}

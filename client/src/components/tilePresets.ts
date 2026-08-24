/**
 * Curated preset tiles. Selecting one from the "+ from library" picker inserts
 * a fully-configured tile — no dropdown-diving required.
 *
 * Each preset knows how to make itself given a fresh tile id. Presets can be
 * any tile kind (button / slider / blank / discord-voice-panel).
 *
 * Keep the list short and Stream-Deck-y: things a first-time user would
 * recognise and want on day one, not an exhaustive catalogue (the action
 * picker fills that role).
 */
import type { Tile } from '../lib/types';

export type TilePreset = {
  key: string;
  category: string;
  label: string;
  hint?: string;
  iconName?: string;
  keywords: string;
  create(id: number): Tile;
};

export const TILE_PRESETS: TilePreset[] = [
  // ─── Starters ───────────────────────────────────────
  { key: 'blank-button', category: 'Starters', label: 'Blank button', hint: 'Empty tile — configure any action', iconName: 'square',
    keywords: 'blank empty custom button plain',
    create: (id) => ({ kind: 'button', id, label: 'New', action: { type: 'hotkey', keys: [] } }) },
  { key: 'blank-slider', category: 'Starters', label: 'Blank slider', hint: 'Audio mixer fader (pick provider + input)', iconName: 'sliders',
    keywords: 'blank slider fader mixer audio volume',
    create: (id) => ({ kind: 'slider', id, label: 'Slider', inputName: '' }) },
  { key: 'blank-spacer', category: 'Starters', label: 'Blank spacer', hint: 'Empty grid slot for layout', iconName: 'minus',
    keywords: 'blank spacer empty slot gap',
    create: (id) => ({ kind: 'blank', id }) },

  // ─── System ─────────────────────────────────────────
  { key: 'volume-up',   category: 'System', label: 'Volume up',   iconName: 'volume-2',
    keywords: 'volume up louder raise',
    create: (id) => ({ kind: 'button', id, label: 'Vol +', icon: 'volume-2', action: { type: 'volume', delta: 2 } }) },
  { key: 'volume-down', category: 'System', label: 'Volume down', iconName: 'volume-1',
    keywords: 'volume down quieter lower',
    create: (id) => ({ kind: 'button', id, label: 'Vol –', icon: 'volume-1', action: { type: 'volume', delta: -2 } }) },
  { key: 'mic-toggle',  category: 'System', label: 'Toggle mic mute', iconName: 'mic-off',
    keywords: 'mic microphone mute toggle',
    create: (id) => ({ kind: 'button', id, label: 'Mic', icon: 'mic-off', action: { type: 'mic', op: 'toggle-mute' } }) },

  // ─── OBS ────────────────────────────────────────────
  { key: 'obs-record', category: 'OBS Studio', label: 'Toggle recording', iconName: 'obs',
    keywords: 'obs record recording toggle',
    create: (id) => ({ kind: 'button', id, label: 'Record', icon: 'obs', action: { type: 'obs', op: 'toggle-record' } }) },
  { key: 'obs-stream', category: 'OBS Studio', label: 'Toggle stream', iconName: 'obs',
    keywords: 'obs stream toggle live broadcast',
    create: (id) => ({ kind: 'button', id, label: 'Stream', icon: 'obs', action: { type: 'obs', op: 'toggle-stream' } }) },
  { key: 'obs-replay-save', category: 'OBS Studio', label: 'Save replay buffer', iconName: 'obs',
    keywords: 'obs replay buffer save instant clip',
    create: (id) => ({ kind: 'button', id, label: 'Replay', icon: 'obs', action: { type: 'obs', op: 'save-replay-buffer' } }) },
  { key: 'obs-audio-slider', category: 'OBS Studio', label: 'Audio input slider', hint: 'Pick input in the editor', iconName: 'sliders',
    keywords: 'obs audio input mixer slider volume mic',
    create: (id) => ({ kind: 'slider', id, label: 'Mic', provider: 'obs', inputName: '' }) },

  // ─── Twitch ─────────────────────────────────────────
  { key: 'twitch-clip', category: 'Twitch', label: 'Create clip', iconName: 'twitch',
    keywords: 'twitch clip create record moment',
    create: (id) => ({ kind: 'button', id, label: 'Clip', icon: 'twitch', action: { type: 'twitch', op: 'create-clip' } }) },
  { key: 'twitch-shield', category: 'Twitch', label: 'Toggle Shield Mode', iconName: 'twitch',
    keywords: 'twitch shield mode moderation raid safety',
    create: (id) => ({ kind: 'button', id, label: 'Shield', icon: 'twitch', action: { type: 'twitch', op: 'toggle-shield-mode' } }) },
  { key: 'twitch-chat', category: 'Twitch', label: 'Send chat message', hint: 'Enter text in the editor', iconName: 'twitch',
    keywords: 'twitch chat message command send',
    create: (id) => ({ kind: 'button', id, label: 'Chat', icon: 'twitch', action: { type: 'twitch', op: 'chat', text: '' } }) },
  { key: 'twitch-raid', category: 'Twitch', label: 'Start raid (ask on tap)', hint: 'Prompts for target streamer on tap', iconName: 'twitch',
    keywords: 'twitch raid start target streamer prompt ask',
    create: (id) => ({ kind: 'button', id, label: 'Raid', icon: 'twitch', action: {
      type: 'twitch', op: 'start-raid',
      prompts: [{ field: 'target', label: 'Streamer', placeholder: 'e.g. ninja (login, no @)' }],
    } }) },

  // ─── Discord ────────────────────────────────────────
  { key: 'discord-mute', category: 'Discord', label: 'Toggle mic mute', iconName: 'discord',
    keywords: 'discord mic mute toggle voice',
    create: (id) => ({ kind: 'button', id, label: 'Mute', icon: 'discord', action: { type: 'discord', op: 'toggle-mute' } }) },
  { key: 'discord-deafen', category: 'Discord', label: 'Toggle deafen', iconName: 'discord',
    keywords: 'discord deafen toggle sound off',
    create: (id) => ({ kind: 'button', id, label: 'Deafen', icon: 'discord', action: { type: 'discord', op: 'toggle-deafen' } }) },
  { key: 'discord-panel', category: 'Discord', label: 'Voice channel panel', hint: 'Live roster with per-user volume + mute', iconName: 'discord',
    keywords: 'discord voice channel panel members roster live',
    create: (id) => ({ kind: 'discord-voice-panel', id, label: 'Voice channel' }) },
  { key: 'discord-join-ask', category: 'Discord', label: 'Join channel (ask on tap)', hint: 'Pick channel on the phone at press-time', iconName: 'discord',
    keywords: 'discord join channel ask on tap prompt picker',
    create: (id) => ({ kind: 'button', id, label: 'Join VC', icon: 'discord', action: {
      type: 'discord', op: 'join-channel',
      prompts: [{ field: 'channelId', label: 'Voice channel', placeholder: 'channel id', choicesSource: 'discord-voice-channels' }],
    } }) },
  { key: 'discord-leave', category: 'Discord', label: 'Leave voice channel', iconName: 'discord',
    keywords: 'discord leave voice channel disconnect exit',
    create: (id) => ({ kind: 'button', id, label: 'Leave VC', icon: 'discord', action: { type: 'discord', op: 'leave-channel' } }) },
  { key: 'discord-audio-slider', category: 'Discord', label: 'Discord mic slider', iconName: 'discord',
    keywords: 'discord mic microphone input slider volume',
    create: (id) => ({ kind: 'slider', id, label: 'Mic', provider: 'discord', inputName: 'input' }) },

  // ─── Flow ───────────────────────────────────────────
  { key: 'flow-goto', category: 'Flow', label: 'Go to page (folder)', hint: 'Pick destination page in editor', iconName: 'folder',
    keywords: 'goto page folder navigate switch',
    create: (id) => ({ kind: 'button', id, label: 'Folder', icon: 'folder', action: { type: 'goto-page', pageId: 0 } }) },
];

export function filterPresets(query: string): TilePreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return TILE_PRESETS;
  const tokens = q.split(/\s+/);
  return TILE_PRESETS.filter((p) => {
    const haystack = `${p.label} ${p.category} ${p.keywords} ${p.hint ?? ''}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

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
import { ACTION_PICKER_ENTRIES } from './actionPickerEntries';

export type TilePreset = {
  key: string;
  category: string;
  label: string;
  hint?: string;
  iconName?: string;
  keywords: string;
  /** True for presets whose action needs a Premium tier the free user can't
   *  reach (currently only Spotify). Hidden from the picker for free-tier
   *  users — same policy as ActionPicker. */
  requiresPremium?: boolean;
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
  { key: 'app-mute-discord',   category: 'System', label: 'Duck Discord (mute app)', hint: 'Mute Discord specifically — leaves other audio alone', iconName: 'volume-x',
    keywords: 'discord duck mute app per app audio session',
    create: (id) => ({ kind: 'button', id, label: 'Mute Discord', icon: 'volume-x', action: { type: 'app-audio', op: 'toggle-mute', params: { appName: 'Discord' } } }) },
  { key: 'app-audio-slider',   category: 'System', label: 'Per-app volume slider', hint: 'Drives one specific app; pick it in the editor', iconName: 'sliders',
    keywords: 'per app audio volume slider mixer duck discord spotify',
    create: (id) => ({ kind: 'slider', id, label: 'App', provider: 'app-audio', inputName: '' }) },

  // ─── OBS ────────────────────────────────────────────
  { key: 'obs-record', category: 'OBS Studio', label: 'Toggle recording', iconName: 'obs',
    keywords: 'obs record recording toggle',
    create: (id) => ({ kind: 'button', id, label: 'Record', icon: 'obs', action: { type: 'obs', op: 'toggle-record' } }) },
  { key: 'obs-record-timer', category: 'OBS Studio', label: 'Recording timer', hint: 'Live REC hh:mm:ss on the tile (dynamic label)', iconName: 'obs',
    keywords: 'obs record recording timer elapsed live dynamic label',
    create: (id) => ({ kind: 'button', id, label: 'REC {obs.recordingTime}', icon: 'obs', action: { type: 'obs', op: 'toggle-record' } }) },
  { key: 'obs-stream', category: 'OBS Studio', label: 'Toggle stream', iconName: 'obs',
    keywords: 'obs stream toggle live broadcast',
    create: (id) => ({ kind: 'button', id, label: 'Stream', icon: 'obs', action: { type: 'obs', op: 'toggle-stream' } }) },
  { key: 'obs-stream-timer', category: 'OBS Studio', label: 'Streaming timer', hint: 'Live STREAM hh:mm:ss on the tile', iconName: 'obs',
    keywords: 'obs stream streaming timer elapsed live dynamic label broadcast',
    create: (id) => ({ kind: 'button', id, label: 'STREAM {obs.streamingTime}', icon: 'obs', action: { type: 'obs', op: 'toggle-stream' } }) },
  { key: 'obs-dropped-frames', category: 'OBS Studio', label: 'Dropped frames indicator', hint: 'Live dropped-frame count', iconName: 'obs',
    keywords: 'obs dropped frames indicator health monitor stats live dynamic label',
    create: (id) => ({ kind: 'button', id, label: 'Dropped: {obs.droppedFrames}', icon: 'obs', action: { type: 'obs', op: 'toggle-record' } }) },
  { key: 'obs-drops-chart', category: 'OBS Studio', label: 'Drops sparkline', hint: 'Live chart tile of dropped-frames rate', iconName: 'obs',
    keywords: 'obs drops dropped frames chart sparkline graph trend delta',
    create: (id) => ({ kind: 'chart', id, label: 'Drops', source: 'obs.droppedFrames', mode: 'delta' }) },
  { key: 'obs-replay-save', category: 'OBS Studio', label: 'Save replay buffer', iconName: 'obs',
    keywords: 'obs replay buffer save instant clip',
    create: (id) => ({ kind: 'button', id, label: 'Replay', icon: 'obs', action: { type: 'obs', op: 'save-replay-buffer' } }) },
  { key: 'obs-audio-slider', category: 'OBS Studio', label: 'Audio input slider', hint: 'Pick input in the editor', iconName: 'sliders',
    keywords: 'obs audio input mixer slider volume mic',
    create: (id) => ({ kind: 'slider', id, label: 'Mic', provider: 'obs', inputName: '' }) },
  { key: 'obs-media-play', category: 'OBS Studio', label: 'Soundboard: play media', hint: 'Pick media source in editor', iconName: 'play',
    keywords: 'obs media play soundboard clip video audio replay',
    create: (id) => ({ kind: 'button', id, label: 'Play', icon: 'play', action: { type: 'obs', op: 'media-play' } }) },
  { key: 'obs-media-restart', category: 'OBS Studio', label: 'Soundboard: restart media', hint: 'Play from the beginning', iconName: 'refresh-cw',
    keywords: 'obs media restart soundboard clip video audio replay',
    create: (id) => ({ kind: 'button', id, label: 'Restart', icon: 'refresh-cw', action: { type: 'obs', op: 'media-restart' } }) },
  { key: 'obs-refresh-browser', category: 'OBS Studio', label: 'Refresh browser source', hint: 'Bypass cache reload — great for chat overlays', iconName: 'refresh-cw',
    keywords: 'obs browser source refresh reload chat overlay widget',
    create: (id) => ({ kind: 'button', id, label: 'Reload', icon: 'refresh-cw', action: { type: 'obs', op: 'refresh-browser-source' } }) },

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

  // ─── Kick ───────────────────────────────────────────
  { key: 'kick-viewer-count', category: 'Kick', label: 'Viewer count label', hint: 'Live {kick.viewerCount} label — polled every 30 s', iconName: 'kick',
    keywords: 'kick viewer count viewers live dynamic label stream',
    create: (id) => ({ kind: 'button', id, label: '{kick.viewerCount}\nviewers', icon: 'kick', action: { type: 'url', url: 'https://kick.com/' } }) },
  { key: 'kick-viewer-chart', category: 'Kick', label: 'Viewer count sparkline', hint: 'Live chart of your Kick viewer count', iconName: 'kick',
    keywords: 'kick viewer count viewers chart sparkline graph trend live',
    create: (id) => ({ kind: 'chart', id, label: 'Viewers', source: 'kick.viewerCount', mode: 'value' }) },

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

  // ─── Spotify ────────────────────────────────────────
  { key: 'spotify-play-pause', category: 'Spotify', label: 'Play / Pause', hint: 'Auto-toggles; shows album cover as tile bg', iconName: 'spotify',
    keywords: 'spotify play pause toggle music album cover', requiresPremium: true,
    create: (id) => ({ kind: 'button', id, label: 'Play', icon: 'spotify', action: { type: 'spotify', op: 'toggle-play' } }) },
  { key: 'spotify-next', category: 'Spotify', label: 'Next track', iconName: 'skip-forward',
    keywords: 'spotify next skip forward track song music', requiresPremium: true,
    create: (id) => ({ kind: 'button', id, label: 'Next', icon: 'skip-forward', action: { type: 'spotify', op: 'next' } }) },
  { key: 'spotify-previous', category: 'Spotify', label: 'Previous track', iconName: 'skip-back',
    keywords: 'spotify previous back track song music', requiresPremium: true,
    create: (id) => ({ kind: 'button', id, label: 'Prev', icon: 'skip-back', action: { type: 'spotify', op: 'previous' } }) },
  { key: 'spotify-now-playing', category: 'Spotify', label: 'Now playing (dynamic label)', hint: 'Live track + artist; tap toggles play', iconName: 'spotify',
    keywords: 'spotify now playing track artist dynamic label live music', requiresPremium: true,
    create: (id) => ({ kind: 'button', id, label: '{spotify.track}', icon: 'spotify', action: { type: 'spotify', op: 'toggle-play' } }) },
  { key: 'spotify-volume-slider', category: 'Spotify', label: 'Spotify volume slider', hint: 'Controls the active device volume', iconName: 'spotify',
    keywords: 'spotify volume slider music device fader mixer', requiresPremium: true,
    create: (id) => ({ kind: 'slider', id, label: 'Spotify', provider: 'spotify', inputName: 'volume' }) },
  { key: 'spotify-volume-chart', category: 'Spotify', label: 'Spotify volume chart', hint: 'Live sparkline of the current device volume', iconName: 'spotify',
    keywords: 'spotify volume chart sparkline graph trend music', requiresPremium: true,
    create: (id) => ({ kind: 'chart', id, label: 'Vol %', source: 'spotify.volumePercent', mode: 'value', min: 0, max: 100 }) },

  // ─── Philips Hue ────────────────────────────────────
  { key: 'hue-scene', category: 'Philips Hue', label: 'Activate scene', hint: 'Pick a Hue scene in the editor', iconName: 'sun',
    keywords: 'hue philips scene light mood ambient activate',
    create: (id) => ({ kind: 'button', id, label: 'Scene', icon: 'sun', action: { type: 'hue', op: 'scene-on', params: {} } }) },
  { key: 'hue-room-toggle', category: 'Philips Hue', label: 'Toggle room lights', hint: 'Pick a room in the editor; lights up when the room is on', iconName: 'home',
    keywords: 'hue philips room lights toggle group zone on off',
    create: (id) => ({ kind: 'button', id, label: 'Lights', icon: 'home', action: { type: 'hue', op: 'room-toggle', params: {} } }) },
  { key: 'hue-room-slider', category: 'Philips Hue', label: 'Room brightness slider', hint: 'Drag to dim; tap to toggle on/off', iconName: 'sun',
    keywords: 'hue philips room brightness dim slider group light',
    create: (id) => ({ kind: 'slider', id, label: 'Room', provider: 'hue', inputName: 'room:' }) },
  { key: 'hue-light-slider', category: 'Philips Hue', label: 'Light brightness slider', hint: 'Drag to dim a single bulb', iconName: 'zap',
    keywords: 'hue philips light bulb brightness dim slider individual',
    create: (id) => ({ kind: 'slider', id, label: 'Light', provider: 'hue', inputName: 'light:' }) },

  // ─── OpenRGB ────────────────────────────────────────
  { key: 'openrgb-profile', category: 'OpenRGB', label: 'Load RGB profile', hint: 'Activate a saved OpenRGB profile (Aura / MSI / Corsair / …)', iconName: 'zap',
    keywords: 'openrgb rgb aura mystic light chroma icue profile scene mood',
    create: (id) => ({ kind: 'button', id, label: 'RGB', icon: 'zap', action: { type: 'openrgb', op: 'load-profile', params: {} } }) },

  // ─── Home Assistant ─────────────────────────────────
  { key: 'ha-scene',       category: 'Home Assistant', label: 'HA: Activate scene',       hint: 'Pick a scene entity in the editor', iconName: 'sun',
    keywords: 'home assistant ha scene activate mood',
    create: (id) => ({ kind: 'button', id, label: 'Scene', icon: 'sun', action: { type: 'homeassistant', op: 'scene-activate', params: {} } }) },
  { key: 'ha-light-toggle', category: 'Home Assistant', label: 'HA: Toggle light',        hint: 'Pick a light in the editor; lights up when on', iconName: 'zap',
    keywords: 'home assistant ha light toggle on off',
    create: (id) => ({ kind: 'button', id, label: 'Light', icon: 'zap', action: { type: 'homeassistant', op: 'light-toggle', params: {} } }) },
  { key: 'ha-script',      category: 'Home Assistant', label: 'HA: Run script',           iconName: 'code',
    keywords: 'home assistant ha script run automation',
    create: (id) => ({ kind: 'button', id, label: 'Script', icon: 'code', action: { type: 'homeassistant', op: 'script-run', params: {} } }) },
  { key: 'ha-light-slider', category: 'Home Assistant', label: 'HA: Light brightness slider', hint: 'Drag to dim; tap to toggle', iconName: 'zap',
    keywords: 'home assistant ha light brightness slider dim',
    create: (id) => ({ kind: 'slider', id, label: 'Light', provider: 'homeassistant', inputName: 'light:' }) },
  { key: 'ha-media-slider', category: 'Home Assistant', label: 'HA: Media player volume slider', hint: 'Drag to set volume; tap to play/pause', iconName: 'music',
    keywords: 'home assistant ha media player volume slider sonos',
    create: (id) => ({ kind: 'slider', id, label: 'Media', provider: 'homeassistant', inputName: 'media:' }) },

  // ─── System metrics (chart tiles) ───────────────────
  { key: 'system-cpu-chart', category: 'System', label: 'CPU % sparkline', hint: 'Live chart of the PC\'s CPU utilisation', iconName: 'zap',
    keywords: 'system cpu chart sparkline graph load monitor performance',
    create: (id) => ({ kind: 'chart', id, label: 'CPU', source: 'system.cpu', mode: 'value', min: 0, max: 100 }) },
  { key: 'system-ram-chart', category: 'System', label: 'RAM % sparkline', hint: 'Live chart of used memory %', iconName: 'settings',
    keywords: 'system ram memory chart sparkline graph load monitor performance',
    create: (id) => ({ kind: 'chart', id, label: 'RAM', source: 'system.ram', mode: 'value', min: 0, max: 100 }) },
  { key: 'system-gpu-chart', category: 'System', label: 'GPU % sparkline', hint: 'Live chart of GPU utilisation (Windows perf counter)', iconName: 'monitor',
    keywords: 'system gpu graphics chart sparkline graph load monitor performance',
    create: (id) => ({ kind: 'chart', id, label: 'GPU', source: 'system.gpu', mode: 'value', min: 0, max: 100 }) },

  // ─── Flow ───────────────────────────────────────────
  { key: 'flow-goto', category: 'Flow', label: 'Go to page (folder)', hint: 'Pick destination page in editor', iconName: 'folder',
    keywords: 'goto page folder navigate switch',
    create: (id) => ({ kind: 'button', id, label: 'Folder', icon: 'folder', action: { type: 'goto-page', pageId: 0 } }) },
];

/** Synthesise a whole-tile preset from every ActionPickerEntry so the tile
 *  picker's search space matches what's available in per-step editing. The
 *  curated presets above still lead the empty-state view; these fill the
 *  "search returns nothing" gap for ops we didn't hand-pick. */
const SYNTHESISED_PRESETS: TilePreset[] = (() => {
  // Skip anything already covered by a curated preset — those get preference
  // for their nicer labels/icons and default configs.
  const curatedActionKeys = new Set<string>();
  for (const p of TILE_PRESETS) {
    // Curated preset keys map to an ActionPickerEntry key when applicable
    // (e.g. curated "obs-record" ↔ picker key "obs:toggle-record"). Rather
    // than a lookup table, we synthesise then dedupe by label at the picker.
    curatedActionKeys.add(p.key);
  }
  return ACTION_PICKER_ENTRIES
    .filter((e) => !curatedActionKeys.has(`action-${e.key}`))
    .map<TilePreset>((e) => ({
      key: `action-${e.key}`,
      category: e.category,
      label: e.label,
      hint: e.hint,
      iconName: e.iconName,
      keywords: e.keywords,
      create: (id) => {
        const built = e.create();
        // twitch-streamer and kick-streamer aren't action-only — they own a
        // tile-shape convention (login/slug field). Fall through as buttons.
        return {
          kind: 'button',
          id,
          label: e.label.replace(/…$/, '').replace(/^(OBS|Discord|Twitch|Kick|Streamlabs) · /, ''),
          icon: e.iconName,
          action: built,
        };
      },
    }));
})();

export function filterPresets(query: string): TilePreset[] {
  const q = query.trim().toLowerCase();
  // Empty query = curated only, so the initial view stays focused. Searching
  // widens to include every action the ActionPicker knows about — otherwise
  // "scene" hitting the tile picker returns nothing while the same query in
  // the per-step ActionPicker finds "OBS · Switch to scene".
  const pool = q ? [...TILE_PRESETS, ...SYNTHESISED_PRESETS] : TILE_PRESETS;
  if (!q) return pool;
  const tokens = q.split(/\s+/);
  return pool.filter((p) => {
    const haystack = `${p.label} ${p.category} ${p.keywords} ${p.hint ?? ''}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

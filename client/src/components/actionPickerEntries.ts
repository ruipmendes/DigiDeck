/**
 * Flat catalogue of everything an action step can be. The Stream-Deck-style
 * ActionPicker filters over these; picking one replaces the action wholesale
 * with what `create()` returns (a fresh default — params/prompts stay for the
 * per-op body to configure).
 *
 * Keep entries stable enough that per-op bodies can rely on the shape they
 * produce — e.g. picking "OBS · Switch to scene" always yields
 * `{ type: 'obs', op: 'set-scene' }` with no params, then the body renders a
 * scene picker.
 *
 * `keywords` is lowercased and space-joined; the filter matches substrings
 * against it.
 */
import type { Action, IntegrationStatus } from '../lib/types';

export type ActionPickerEntry = {
  key: string;
  /** Category label — used as a section header when the query is empty. */
  category: string;
  /** Short user-facing title, e.g. "Toggle recording". */
  label: string;
  /** Optional one-line hint below the label. */
  hint?: string;
  /** Icon name from the icons library — rendered small at the row start. */
  iconName?: string;
  /** Whitespace-separated lowercase search terms. */
  keywords: string;
  /** Which integration status flag gates this entry — undefined means always available. */
  requires?: keyof IntegrationStatus;
  /** True when the target service requires a paid tier to use this action.
   *  Spotify is the only case today: playback control is Premium-only. When
   *  the user's account isn't Premium, the entry shows a lock icon and refuses
   *  to be picked. Set on entries whose server-side execution would 403. */
  requiresPremium?: boolean;
  create(): Action;
};

const desktop: ActionPickerEntry[] = [
  { key: 'hotkey',  category: 'Desktop input', label: 'Hotkey',            hint: 'Send a key combo',                  iconName: 'command',       keywords: 'hotkey key press shortcut combo keyboard',
    create: () => ({ type: 'hotkey', keys: [] }) },
  { key: 'text',    category: 'Desktop input', label: 'Type text',         hint: 'Type a string at the cursor',       iconName: 'file-text',     keywords: 'text type string write input',
    create: () => ({ type: 'text', text: '' }) },
  { key: 'url',     category: 'Desktop input', label: 'Open URL / file',   hint: 'Launch a link or open a file',      iconName: 'external-link', keywords: 'url open link web browser file path',
    create: () => ({ type: 'url', url: '' }) },
  { key: 'launch',  category: 'Desktop input', label: 'Launch app',        hint: 'Run an executable or shortcut',     iconName: 'terminal',      keywords: 'launch app run start exe executable program',
    create: () => ({ type: 'launch', path: '' }) },
  { key: 'script',  category: 'Desktop input', label: 'Run PowerShell',    hint: 'Execute PowerShell commands',       iconName: 'code',          keywords: 'script powershell shell command bash exec',
    create: () => ({ type: 'script', script: '' }) },
];

const audio: ActionPickerEntry[] = [
  { key: 'volume:up',    category: 'Audio', label: 'Volume up',   iconName: 'volume-2', keywords: 'volume up louder raise increase speaker system',
    create: () => ({ type: 'volume', delta: 2 }) },
  { key: 'volume:down',  category: 'Audio', label: 'Volume down', iconName: 'volume-1', keywords: 'volume down quieter lower decrease speaker system',
    create: () => ({ type: 'volume', delta: -2 }) },
  { key: 'volume:mute',  category: 'Audio', label: 'Toggle system mute', iconName: 'volume-x', keywords: 'volume mute silence toggle system speaker',
    create: () => ({ type: 'volume', mute: true }) },
  { key: 'mic:toggle',   category: 'Audio', label: 'Toggle microphone mute', iconName: 'mic-off',  keywords: 'mic microphone mute toggle',
    create: () => ({ type: 'mic', op: 'toggle-mute' }) },
  { key: 'mic:mute',     category: 'Audio', label: 'Mute microphone',       iconName: 'mic-off',  keywords: 'mic microphone mute off',
    create: () => ({ type: 'mic', op: 'mute' }) },
  { key: 'mic:unmute',   category: 'Audio', label: 'Unmute microphone',     iconName: 'mic',      keywords: 'mic microphone unmute on',
    create: () => ({ type: 'mic', op: 'unmute' }) },
  { key: 'app-audio:toggle-mute', category: 'Audio', label: 'Toggle app mute',       hint: 'Mute a specific running app (Discord, Spotify, …)', iconName: 'volume-x', keywords: 'app audio mute toggle discord spotify chrome duck per app session',
    create: () => ({ type: 'app-audio', op: 'toggle-mute', params: { appName: '' } }) },
  { key: 'app-audio:mute',        category: 'Audio', label: 'Mute app',              hint: 'Force-mute a specific running app',                  iconName: 'volume-x', keywords: 'app audio mute discord spotify chrome per app session',
    create: () => ({ type: 'app-audio', op: 'mute', params: { appName: '' } }) },
  { key: 'app-audio:unmute',      category: 'Audio', label: 'Unmute app',            hint: 'Force-unmute a specific running app',                iconName: 'volume-2', keywords: 'app audio unmute discord spotify chrome per app session',
    create: () => ({ type: 'app-audio', op: 'unmute', params: { appName: '' } }) },
  { key: 'app-audio:set-volume',  category: 'Audio', label: 'Set app volume',        hint: 'Preset volume for a specific running app',           iconName: 'volume-1', keywords: 'app audio volume set discord spotify chrome duck per app session preset',
    create: () => ({ type: 'app-audio', op: 'set-volume', params: { appName: '', volumePercent: 50 } }) },
];

const obsEntries = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string }> = [
    { op: 'toggle-record',        label: 'Toggle recording',       kw: 'record recording toggle' },
    { op: 'start-record',         label: 'Start recording',        kw: 'record recording start' },
    { op: 'stop-record',          label: 'Stop recording',         kw: 'record recording stop' },
    { op: 'toggle-stream',        label: 'Toggle stream',          kw: 'stream toggle live broadcast' },
    { op: 'start-stream',         label: 'Start stream',           kw: 'stream start live broadcast go live' },
    { op: 'stop-stream',          label: 'Stop stream',            kw: 'stream stop end broadcast' },
    { op: 'toggle-virtual-cam',   label: 'Toggle virtual camera',  kw: 'virtual camera cam toggle' },
    { op: 'toggle-replay-buffer', label: 'Toggle replay buffer',   kw: 'replay buffer toggle instant' },
    { op: 'save-replay-buffer',   label: 'Save replay buffer',     kw: 'replay buffer save instant clip' },
    { op: 'set-scene',            label: 'Switch to scene…',       hint: 'Pick the scene in the editor',       kw: 'scene switch change set' },
    { op: 'toggle-mute',          label: 'Toggle audio input mute…', hint: 'Pick the input in the editor',    kw: 'mute audio input source toggle' },
    { op: 'show-source',          label: 'Show source…',           hint: 'Pick scene + source in editor',      kw: 'source show visibility' },
    { op: 'hide-source',          label: 'Hide source…',           hint: 'Pick scene + source in editor',      kw: 'source hide visibility' },
    { op: 'toggle-source',        label: 'Toggle source visibility…', hint: 'Pick scene + source in editor',   kw: 'source toggle visibility' },
    { op: 'media-play',           label: 'Play media source…',      hint: 'Pick media input in editor',        kw: 'media play video audio soundboard clip' },
    { op: 'media-pause',          label: 'Pause media source…',     hint: 'Pick media input in editor',        kw: 'media pause video audio soundboard' },
    { op: 'media-restart',        label: 'Restart media source…',   hint: 'Play from the beginning',           kw: 'media restart video audio soundboard replay' },
    { op: 'media-stop',           label: 'Stop media source…',      hint: 'Pick media input in editor',        kw: 'media stop video audio soundboard' },
    { op: 'media-next',           label: 'Next media source…',      hint: 'Skip to next in playlist',          kw: 'media next skip video audio playlist' },
    { op: 'media-previous',       label: 'Previous media source…',  hint: 'Back one in playlist',              kw: 'media previous back video audio playlist' },
    { op: 'refresh-browser-source', label: 'Refresh browser source…', hint: 'Reload OBS browser source (bypass cache)', kw: 'browser source refresh reload chat overlay widget' },
  ];
  return rows.map((r) => ({
    key: `obs:${r.op}`, category: 'OBS Studio', label: r.label, hint: r.hint, iconName: 'obs',
    keywords: `obs ${r.kw}`, requires: 'obs' as const,
    create: () => ({ type: 'obs', op: r.op as never }) as Action,
  }));
})();

const streamlabsEntries = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string }> = [
    { op: 'toggle-record',        label: 'Toggle recording',       kw: 'record recording toggle' },
    { op: 'start-record',         label: 'Start recording',        kw: 'record recording start' },
    { op: 'stop-record',          label: 'Stop recording',         kw: 'record recording stop' },
    { op: 'toggle-stream',        label: 'Toggle stream',          kw: 'stream toggle live broadcast' },
    { op: 'start-stream',         label: 'Start stream',           kw: 'stream start live broadcast go live' },
    { op: 'stop-stream',          label: 'Stop stream',            kw: 'stream stop end broadcast' },
    { op: 'toggle-virtual-cam',   label: 'Toggle virtual camera',  kw: 'virtual camera cam toggle' },
    { op: 'toggle-replay-buffer', label: 'Toggle replay buffer',   kw: 'replay buffer toggle instant' },
    { op: 'save-replay-buffer',   label: 'Save replay buffer',     kw: 'replay buffer save instant clip' },
    { op: 'set-scene',            label: 'Switch to scene…',       hint: 'Pick the scene in the editor',       kw: 'scene switch change set' },
    { op: 'toggle-mute',          label: 'Toggle audio input mute…', hint: 'Pick the input in the editor',    kw: 'mute audio input source toggle' },
    { op: 'show-source',          label: 'Show source…',           hint: 'Pick scene + source in editor',      kw: 'source show visibility' },
    { op: 'hide-source',          label: 'Hide source…',           hint: 'Pick scene + source in editor',      kw: 'source hide visibility' },
    { op: 'toggle-source',        label: 'Toggle source visibility…', hint: 'Pick scene + source in editor',   kw: 'source toggle visibility' },
  ];
  return rows.map((r) => ({
    key: `streamlabs:${r.op}`, category: 'Streamlabs Desktop', label: r.label, hint: r.hint, iconName: 'streamlabs',
    keywords: `streamlabs ${r.kw}`, requires: 'streamlabs' as const,
    create: () => ({ type: 'streamlabs', op: r.op as never }) as Action,
  }));
})();

const twitchEntries = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string }> = [
    { op: 'chat',                    label: 'Send chat message',        hint: 'Baked-in text — great for !commands',  kw: 'chat message send command' },
    { op: 'chat-announcement',       label: 'Send /announce',           hint: 'Highlighted in-chat announcement',      kw: 'announcement announce highlighted chat message' },
    { op: 'clear-chat',              label: 'Clear chat',                                                              kw: 'clear chat delete messages' },
    { op: 'run-ad',                  label: 'Run ad',                   hint: 'Preset length; needs live stream',      kw: 'ad advertisement commercial run play' },
    { op: 'snooze-ad',               label: 'Snooze next ad',                                                          kw: 'ad snooze skip delay next' },
    { op: 'create-clip',             label: 'Create clip',              hint: 'Needs live stream',                     kw: 'clip clips create make record' },
    { op: 'stream-marker',           label: 'Create stream marker',                                                    kw: 'stream marker bookmark timestamp' },
    { op: 'toggle-shield-mode',      label: 'Toggle Shield Mode',                                                      kw: 'shield mode moderation raid harassment safety' },
    { op: 'toggle-emote-only',       label: 'Toggle emote-only chat',                                                  kw: 'emote only chat mode restrict' },
    { op: 'toggle-sub-only',         label: 'Toggle sub-only chat',                                                    kw: 'subscriber sub only chat mode restrict' },
    { op: 'toggle-follower-only',    label: 'Toggle follower-only chat',                                               kw: 'follower only chat mode restrict' },
    { op: 'toggle-slow-mode',        label: 'Toggle slow-mode chat',                                                   kw: 'slow mode chat rate limit' },
    { op: 'start-raid',              label: 'Start raid',               hint: 'Preset target or ask on tap',           kw: 'raid start target streamer send' },
    { op: 'cancel-raid',             label: 'Cancel raid',                                                             kw: 'raid cancel stop abort' },
    { op: 'shoutout',                label: 'Send shoutout',                                                           kw: 'shoutout so promote streamer' },
    { op: 'update-title',            label: 'Update stream title',                                                     kw: 'title update change stream name' },
    { op: 'update-category',         label: 'Update category / game',                                                  kw: 'category game update change directory' },
    { op: 'create-poll',             label: 'Create poll',              hint: 'Question + choices in editor',          kw: 'poll create question vote choices' },
    { op: 'create-prediction',       label: 'Create prediction',        hint: 'Title + outcomes in editor',            kw: 'prediction bet channel points outcomes' },
  ];
  const list: ActionPickerEntry[] = rows.map((r) => ({
    key: `twitch:${r.op}`, category: 'Twitch', label: r.label, hint: r.hint, iconName: 'twitch',
    keywords: `twitch ${r.kw}`, requires: 'twitch' as const,
    create: () => ({ type: 'twitch', op: r.op as never, text: r.op === 'chat' ? '' : undefined }) as Action,
  }));
  list.push({
    key: 'twitch-streamer', category: 'Twitch', label: 'Streamer tile',
    hint: 'Live thumbnail + click-to-open — not an action',
    iconName: 'twitch', keywords: 'twitch streamer tile thumbnail live indicator profile',
    requires: 'twitch',
    create: () => ({ type: 'twitch-streamer', login: '' }),
  });
  return list;
})();

const kickEntries: ActionPickerEntry[] = [
  { key: 'kick:chat', category: 'Kick', label: 'Send chat message', iconName: 'kick',
    keywords: 'kick chat message send command', requires: 'kick',
    create: () => ({ type: 'kick', op: 'chat', text: '' }) },
  { key: 'kick:delete-message', category: 'Kick', label: 'Delete chat message', hint: 'Prompts for the message id at press time',
    iconName: 'kick', keywords: 'kick chat delete message moderation mod remove', requires: 'kick',
    create: () => ({ type: 'kick', op: 'delete-message', params: {}, prompts: [{ field: 'messageId', label: 'Message id', placeholder: 'kick message id (uuid)' }] }) },
  { key: 'kick:ban-user', category: 'Kick', label: 'Ban / timeout user', hint: 'Preset duration + prompt for target username',
    iconName: 'kick', keywords: 'kick ban timeout moderation mod user chat', requires: 'kick',
    create: () => ({ type: 'kick', op: 'ban-user', params: { banDuration: 60 }, prompts: [{ field: 'target', label: 'User to ban', placeholder: 'kick username' }, { field: 'banReason', label: 'Reason (optional)', placeholder: 'why?' }] }) },
  { key: 'kick:unban-user', category: 'Kick', label: 'Unban user', hint: 'Prompt for target username',
    iconName: 'kick', keywords: 'kick unban timeout remove moderation mod user', requires: 'kick',
    create: () => ({ type: 'kick', op: 'unban-user', params: {}, prompts: [{ field: 'target', label: 'User to unban', placeholder: 'kick username' }] }) },
  { key: 'kick:update-title', category: 'Kick', label: 'Update stream title', hint: 'Prompt for the new title on tap',
    iconName: 'kick', keywords: 'kick title update change stream broadcast', requires: 'kick',
    create: () => ({ type: 'kick', op: 'update-title', params: {}, prompts: [{ field: 'title', label: 'New stream title', placeholder: 'stream title' }] }) },
  { key: 'kick:update-category', category: 'Kick', label: 'Update category', hint: 'Prompt for category name; Kick resolves the id',
    iconName: 'kick', keywords: 'kick category game update change directory', requires: 'kick',
    create: () => ({ type: 'kick', op: 'update-category', params: {}, prompts: [{ field: 'category', label: 'Category name', placeholder: 'e.g. Just Chatting' }] }) },
  { key: 'kick:run-ad', category: 'Kick', label: 'Run ad', hint: 'Preset length (7–300 s)',
    iconName: 'kick', keywords: 'kick ad advertisement commercial run play break', requires: 'kick',
    create: () => ({ type: 'kick', op: 'run-ad', params: { adLength: 60 } }) },
  { key: 'kick-streamer', category: 'Kick', label: 'Streamer tile', hint: 'Live thumbnail + click-to-open — not an action',
    iconName: 'kick', keywords: 'kick streamer tile thumbnail live indicator profile',
    requires: 'kick',
    create: () => ({ type: 'kick-streamer', slug: '' }) },
];

const discordEntries = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string }> = [
    { op: 'toggle-mute',               label: 'Toggle mic mute',                                                             kw: 'mic mute toggle voice' },
    { op: 'mute',                      label: 'Mute mic',                                                                    kw: 'mic mute voice' },
    { op: 'unmute',                    label: 'Unmute mic',                                                                  kw: 'mic unmute voice' },
    { op: 'toggle-deafen',             label: 'Toggle deafen',                                                               kw: 'deafen toggle sound off' },
    { op: 'deafen',                    label: 'Deafen',                                                                      kw: 'deafen sound off' },
    { op: 'undeafen',                  label: 'Undeafen',                                                                    kw: 'undeafen sound on' },
    { op: 'toggle-ptt',                label: 'Toggle push-to-talk mode',                                                    kw: 'push to talk ptt voice activity mode' },
    { op: 'toggle-noise-suppression',  label: 'Toggle noise suppression',   hint: 'Krisp',                                    kw: 'noise suppression krisp toggle filter' },
    { op: 'toggle-auto-gain',          label: 'Toggle automatic gain control',                                                kw: 'automatic gain control agc toggle mic' },
    { op: 'toggle-echo-cancellation',  label: 'Toggle echo cancellation',                                                    kw: 'echo cancellation toggle mic filter' },
    { op: 'join-channel',              label: 'Join voice channel',         hint: 'Pick channel in editor or ask on tap',    kw: 'join voice channel enter server' },
    { op: 'leave-channel',             label: 'Leave voice channel',                                                         kw: 'leave voice channel disconnect exit' },
    { op: 'set-user-volume',           label: 'Set member volume',          hint: 'Preset volume + pick member',              kw: 'member user volume set adjust' },
    { op: 'mute-user',                 label: 'Mute member (for me)',       hint: 'Client-side only',                          kw: 'member user mute silence' },
    { op: 'unmute-user',               label: 'Unmute member (for me)',     hint: 'Client-side only',                          kw: 'member user unmute' },
    { op: 'pull-user',                 label: 'Pull member into my channel', hint: 'Requires Move Members perm',              kw: 'member user pull move drag call' },
    { op: 'move-user',                 label: 'Move member to a channel',   hint: 'Requires Move Members perm',               kw: 'member user move drag call' },
    { op: 'kick-user',                 label: 'Kick member from voice',     hint: 'Disconnect them; requires Move Members',   kw: 'member user kick disconnect boot remove voice' },
  ];
  return rows.map((r) => ({
    key: `discord:${r.op}`, category: 'Discord', label: r.label, hint: r.hint, iconName: 'discord',
    keywords: `discord ${r.kw}`, requires: 'discord' as const,
    create: () => ({ type: 'discord', op: r.op as never }) as Action,
  }));
})();

const openRgbEntries: ActionPickerEntry[] = [
  { key: 'openrgb:load-profile', category: 'OpenRGB', label: 'Load RGB profile', hint: 'Pick a saved OpenRGB profile in the editor', iconName: 'zap',
    keywords: 'openrgb rgb aura mystic light chroma icue profile scene mood gaming streaming', requires: 'openrgb',
    create: () => ({ type: 'openrgb', op: 'load-profile', params: {} }) },
];

const homeAssistantEntries: ActionPickerEntry[] = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string; icon: string }> = [
    { op: 'light-toggle',       label: 'HA: Toggle light',       hint: 'Pick the light in the editor',      icon: 'zap',   kw: 'home assistant light toggle' },
    { op: 'light-on',           label: 'HA: Turn light on',      icon: 'sun',   kw: 'home assistant light on' },
    { op: 'light-off',          label: 'HA: Turn light off',     icon: 'moon',  kw: 'home assistant light off' },
    { op: 'switch-toggle',      label: 'HA: Toggle switch',      hint: 'Also drives input_boolean',         icon: 'zap',   kw: 'home assistant switch toggle boolean' },
    { op: 'switch-on',          label: 'HA: Switch on',          icon: 'zap',   kw: 'home assistant switch on' },
    { op: 'switch-off',         label: 'HA: Switch off',         icon: 'zap',   kw: 'home assistant switch off' },
    { op: 'scene-activate',     label: 'HA: Activate scene',     icon: 'sun',   kw: 'home assistant scene activate' },
    { op: 'script-run',         label: 'HA: Run script',         icon: 'code',  kw: 'home assistant script run' },
    { op: 'automation-trigger', label: 'HA: Trigger automation', icon: 'zap',   kw: 'home assistant automation trigger' },
    { op: 'media-play-pause',   label: 'HA: Media play / pause', icon: 'play',        kw: 'home assistant media player play pause' },
    { op: 'media-next',         label: 'HA: Media next',         icon: 'skip-forward', kw: 'home assistant media next track' },
    { op: 'media-previous',     label: 'HA: Media previous',     icon: 'skip-back',   kw: 'home assistant media previous track' },
    { op: 'cover-toggle',       label: 'HA: Toggle cover',       hint: 'Blinds / garage / shutter',         icon: 'menu',  kw: 'home assistant cover toggle blind shutter garage' },
    { op: 'service-call',       label: 'HA: Call any service',   hint: 'Advanced — pick a domain.service',   icon: 'terminal', kw: 'home assistant service call advanced climate temperature' },
  ];
  return rows.map((r) => ({
    key: `homeassistant:${r.op}`, category: 'Home Assistant', label: r.label, hint: r.hint, iconName: r.icon,
    keywords: `home assistant ha ${r.kw}`, requires: 'homeassistant' as const,
    create: () => ({ type: 'homeassistant', op: r.op as never, params: {} }) as Action,
  }));
})();

const hueEntries: ActionPickerEntry[] = [
  { key: 'hue:scene-on', category: 'Philips Hue', label: 'Activate scene', hint: 'Pick a Hue scene in the editor', iconName: 'sun',
    keywords: 'hue philips scene light mood ambient activate', requires: 'hue',
    create: () => ({ type: 'hue', op: 'scene-on', params: {} }) },
  { key: 'hue:room-toggle', category: 'Philips Hue', label: 'Toggle room lights', hint: 'Pick a room in the editor', iconName: 'home',
    keywords: 'hue philips room lights toggle group zone on off', requires: 'hue',
    create: () => ({ type: 'hue', op: 'room-toggle', params: {} }) },
  { key: 'hue:room-on', category: 'Philips Hue', label: 'Turn room on', iconName: 'sun',
    keywords: 'hue philips room lights on turn group zone', requires: 'hue',
    create: () => ({ type: 'hue', op: 'room-on', params: {} }) },
  { key: 'hue:room-off', category: 'Philips Hue', label: 'Turn room off', iconName: 'moon',
    keywords: 'hue philips room lights off turn group zone', requires: 'hue',
    create: () => ({ type: 'hue', op: 'room-off', params: {} }) },
  { key: 'hue:light-toggle', category: 'Philips Hue', label: 'Toggle a specific light', iconName: 'zap',
    keywords: 'hue philips light bulb toggle on off individual', requires: 'hue',
    create: () => ({ type: 'hue', op: 'light-toggle', params: {} }) },
  { key: 'hue:light-on', category: 'Philips Hue', label: 'Turn light on', iconName: 'sun',
    keywords: 'hue philips light bulb on turn individual', requires: 'hue',
    create: () => ({ type: 'hue', op: 'light-on', params: {} }) },
  { key: 'hue:light-off', category: 'Philips Hue', label: 'Turn light off', iconName: 'moon',
    keywords: 'hue philips light bulb off turn individual', requires: 'hue',
    create: () => ({ type: 'hue', op: 'light-off', params: {} }) },
];

const spotifyEntries = ((): ActionPickerEntry[] => {
  const rows: Array<{ op: string; label: string; hint?: string; kw: string }> = [
    { op: 'toggle-play', label: 'Play / Pause',            hint: 'Auto-toggles based on current state',        kw: 'play pause toggle music' },
    { op: 'play',        label: 'Play',                                                                        kw: 'play resume music start' },
    { op: 'pause',       label: 'Pause',                                                                       kw: 'pause stop music' },
    { op: 'next',        label: 'Next track',                                                                  kw: 'next skip forward track song' },
    { op: 'previous',    label: 'Previous track',                                                              kw: 'previous back track song' },
  ];
  return rows.map((r) => ({
    key: `spotify:${r.op}`, category: 'Spotify', label: r.label, hint: r.hint, iconName: 'spotify',
    keywords: `spotify music ${r.kw}`, requires: 'spotify' as const,
    // All Spotify playback ops go through Spotify's Web API player endpoints,
    // which return 403 for free-tier accounts. Lock them in the picker so the
    // user can't configure a tile that would always fail.
    requiresPremium: true,
    create: () => ({ type: 'spotify', op: r.op as never }) as Action,
  }));
})();

const flow: ActionPickerEntry[] = [
  { key: 'goto-page', category: 'Flow', label: 'Go to page (folder)', iconName: 'folder', keywords: 'goto page folder navigate switch',
    create: () => ({ type: 'goto-page', pageId: 0 }) },
  { key: 'wait',      category: 'Flow', label: 'Wait (delay)',        iconName: 'clock',  keywords: 'wait delay pause sleep',
    create: () => ({ type: 'wait', ms: 200 }) },
];

export const ACTION_PICKER_ENTRIES: ActionPickerEntry[] = [
  ...desktop,
  ...audio,
  ...obsEntries,
  ...streamlabsEntries,
  ...twitchEntries,
  ...kickEntries,
  ...discordEntries,
  ...spotifyEntries,
  ...hueEntries,
  ...homeAssistantEntries,
  ...openRgbEntries,
  ...flow,
];

/** Match a filter query against an entry — case-insensitive substring across
 *  label, category, keywords, and hint. Multi-token queries require every
 *  token to appear somewhere (order-independent). */
export function filterEntries(entries: ActionPickerEntry[], query: string): ActionPickerEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/);
  return entries.filter((e) => {
    const haystack = `${e.label} ${e.category} ${e.keywords} ${e.hint ?? ''}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

/** Best-guess match: given an existing Action, find the entry that would have
 *  produced it. Used to highlight the "current pick" in the picker so users
 *  can see what they're editing. Falls back to null when nothing fits. */
export function entryFor(action: Action): ActionPickerEntry | null {
  const byOp = (type: string, op: string): ActionPickerEntry | null =>
    ACTION_PICKER_ENTRIES.find((e) => e.key === `${type}:${op}`) ?? null;
  switch (action.type) {
    case 'hotkey':          return ACTION_PICKER_ENTRIES.find((e) => e.key === 'hotkey') ?? null;
    case 'text':            return ACTION_PICKER_ENTRIES.find((e) => e.key === 'text') ?? null;
    case 'url':             return ACTION_PICKER_ENTRIES.find((e) => e.key === 'url') ?? null;
    case 'launch':          return ACTION_PICKER_ENTRIES.find((e) => e.key === 'launch') ?? null;
    case 'script':          return ACTION_PICKER_ENTRIES.find((e) => e.key === 'script') ?? null;
    case 'volume':
      if (action.mute) return ACTION_PICKER_ENTRIES.find((e) => e.key === 'volume:mute') ?? null;
      return (action.delta ?? 0) >= 0
        ? ACTION_PICKER_ENTRIES.find((e) => e.key === 'volume:up') ?? null
        : ACTION_PICKER_ENTRIES.find((e) => e.key === 'volume:down') ?? null;
    case 'mic':             return byOp('mic', action.op);
    case 'app-audio':       return byOp('app-audio', action.op);
    case 'obs':             return byOp('obs', action.op);
    case 'streamlabs':      return byOp('streamlabs', action.op);
    case 'twitch':          return byOp('twitch', action.op);
    case 'twitch-streamer': return ACTION_PICKER_ENTRIES.find((e) => e.key === 'twitch-streamer') ?? null;
    case 'kick':            return byOp('kick', action.op);
    case 'kick-streamer':   return ACTION_PICKER_ENTRIES.find((e) => e.key === 'kick-streamer') ?? null;
    case 'discord':         return byOp('discord', action.op);
    case 'spotify':         return byOp('spotify', action.op);
    case 'hue':             return byOp('hue', action.op);
    case 'homeassistant':   return byOp('homeassistant', action.op);
    case 'openrgb':         return byOp('openrgb', action.op);
    case 'goto-page':       return ACTION_PICKER_ENTRIES.find((e) => e.key === 'goto-page') ?? null;
    case 'wait':            return ACTION_PICKER_ENTRIES.find((e) => e.key === 'wait') ?? null;
    default:                return null;
  }
}

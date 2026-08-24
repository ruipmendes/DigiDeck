import { useEffect, useState } from 'react';
import type { Action, DiscordActionParams, DiscordOp, DiscordPrompt, DiscordPromptField } from '../../lib/types';
import * as api from '../../lib/api';
import { inputStyle, selectStyle } from './shared';

type DiscordNeeds = 'channel' | 'user' | 'user+volume' | 'user-guild' | 'user-guild+channel' | null;
type DiscordOpDef = { value: DiscordOp; label: string; needs: DiscordNeeds };
type DiscordOpGroup = { label: string; options: DiscordOpDef[] };

const DISCORD_OP_GROUPS: DiscordOpGroup[] = [
  {
    label: 'Mute',
    options: [
      { value: 'toggle-mute', label: 'Toggle mic mute', needs: null },
      { value: 'mute',        label: 'Mute mic',        needs: null },
      { value: 'unmute',      label: 'Unmute mic',      needs: null },
    ],
  },
  {
    label: 'Deafen',
    options: [
      { value: 'toggle-deafen', label: 'Toggle deafen', needs: null },
      { value: 'deafen',        label: 'Deafen',        needs: null },
      { value: 'undeafen',      label: 'Undeafen',      needs: null },
    ],
  },
  {
    label: 'Voice mode & filters',
    options: [
      { value: 'toggle-ptt',               label: 'Toggle push-to-talk mode',       needs: null },
      { value: 'toggle-noise-suppression', label: 'Toggle noise suppression (Krisp)', needs: null },
      { value: 'toggle-auto-gain',         label: 'Toggle automatic gain control',  needs: null },
      { value: 'toggle-echo-cancellation', label: 'Toggle echo cancellation',       needs: null },
    ],
  },
  {
    label: 'Voice channel',
    options: [
      { value: 'join-channel',  label: 'Join voice channel…', needs: 'channel' },
      { value: 'leave-channel', label: 'Leave voice channel', needs: null },
    ],
  },
  {
    label: 'Per-member',
    options: [
      { value: 'set-user-volume', label: 'Set member volume…', needs: 'user+volume' },
      { value: 'mute-user',       label: 'Mute member…',        needs: 'user' },
      { value: 'unmute-user',     label: 'Unmute member…',      needs: 'user' },
    ],
  },
  {
    label: 'Move members',
    options: [
      { value: 'pull-user', label: 'Pull member into my channel…', needs: 'user-guild' },
      { value: 'move-user', label: 'Move member to channel…',      needs: 'user-guild+channel' },
      { value: 'kick-user', label: 'Kick member from voice…',      needs: 'user-guild' },
    ],
  },
];

/** Prompt metadata is a function of `(op, field)` because the same field name
 *  (`userId`) means different things for different ops — channel-mute ops want
 *  members of the current channel, while pull/move want everyone in voice
 *  across the guild. */
function discordPromptMeta(op: DiscordOp, field: DiscordPromptField): { label: string; placeholder: string; choicesSource: 'discord-voice-channels' | 'discord-channel-members' | 'discord-guild-voice-members' } {
  if (field === 'channelId') {
    return { label: 'Voice channel', placeholder: 'channel id', choicesSource: 'discord-voice-channels' };
  }
  // field === 'userId'
  if (op === 'pull-user' || op === 'move-user') {
    return { label: 'Member (anywhere in server)', placeholder: 'user id', choicesSource: 'discord-guild-voice-members' };
  }
  return { label: 'Member (current channel)', placeholder: 'user id', choicesSource: 'discord-channel-members' };
}

export function DiscordBody({ action, onChange }: { action: Extract<Action, { type: 'discord' }>; onChange: (a: Action) => void }) {
  const opMeta = DISCORD_OP_GROUPS.flatMap((g) => g.options).find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const params = action.params ?? {};

  // Config-time channel picker: fetch the voice-channel list when the op needs it,
  // so a channelId preset comes from a dropdown instead of a raw ID paste. Falls
  // back to text input if the fetch fails (Discord disconnected, no `guilds` scope, etc.).
  const [voiceChannels, setVoiceChannels] = useState<Array<{ id: string; channelName: string; guildId: string; guildName: string }> | null>(null);
  const [voiceChannelsError, setVoiceChannelsError] = useState<string | null>(null);
  const [scopeGuildId, setScopeGuildId] = useState<string | null>(null);
  // "Just my server" (default) restricts the dropdown to the user's Primary
  // server (Discord panel setting), falling back to whichever guild their
  // current voice channel is in. "Show all" removes the filter. UI-only state.
  const [showAllGuilds, setShowAllGuilds] = useState(false);
  useEffect(() => {
    if (needs !== 'channel' && needs !== 'user-guild+channel') return;
    let alive = true;
    Promise.all([
      api.getDiscordVoiceChannels().catch((err: Error) => { throw err; }),
      api.getDiscordState().catch(() => null),
    ]).then(([chs, dc]) => {
      if (!alive) return;
      setVoiceChannels(chs);
      setVoiceChannelsError(null);
      setScopeGuildId(dc?.config.primaryGuildId || dc?.status.currentVoiceGuildId || null);
    }).catch((err: Error) => {
      if (alive) { setVoiceChannels([]); setVoiceChannelsError(err.message); }
    });
    return () => { alive = false; };
  }, [needs]);

  const filteredChannels = (() => {
    if (!voiceChannels) return null;
    if (showAllGuilds || !scopeGuildId) return voiceChannels;
    return voiceChannels.filter((c) => c.guildId === scopeGuildId);
  })();

  const setOp = (op: DiscordOp) => {
    onChange({ type: 'discord', op, params: undefined, prompts: undefined });
  };

  const promptFor = (field: DiscordPromptField): DiscordPrompt | undefined =>
    action.prompts?.find((p) => p.field === field);

  const setPromptEnabled = (field: DiscordPromptField, enabled: boolean) => {
    const rest = (action.prompts ?? []).filter((p) => p.field !== field);
    if (enabled) {
      const meta = discordPromptMeta(action.op, field);
      const nextPrompts = [...rest, { field, label: meta.label, placeholder: meta.placeholder, choicesSource: meta.choicesSource }];
      const nextParams: DiscordActionParams = { ...params };
      delete nextParams[field];
      onChange({ ...action, params: Object.keys(nextParams).length ? nextParams : undefined, prompts: nextPrompts });
    } else {
      onChange({ ...action, prompts: rest.length ? rest : undefined });
    }
  };

  const renderPromptableIdField = (
    field: DiscordPromptField,
    presetPlaceholder: string,
    hint: string,
    presetOptions?: Array<{ value: string; label: string }>,
    presetError?: string | null,
  ) => {
    const p = promptFor(field);
    const value = (params[field] as string | undefined) ?? '';
    const hasDropdown = !!presetOptions && presetOptions.length > 0;
    // If the dropdown is available but the current value isn't in the list, fall
    // back to showing the text input so a hand-pasted ID isn't silently wiped.
    const valueInList = hasDropdown && (value === '' || presetOptions.some((o) => o.value === value));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!p && hasDropdown && valueInList && (
          <select
            value={value}
            onChange={(e) => onChange({ ...action, params: { ...params, [field]: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— {presetPlaceholder} —</option>
            {presetOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {!p && (!hasDropdown || !valueInList) && (
          <input
            value={value}
            onChange={(e) => onChange({ ...action, params: { ...params, [field]: e.target.value.trim() } })}
            placeholder={presetPlaceholder}
            style={inputStyle}
            spellCheck={false}
            autoCapitalize="none"
          />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af' }}>
          <input
            type="checkbox"
            checked={!!p}
            onChange={(e) => setPromptEnabled(field, e.target.checked)}
          />
          Ask on tap {p && '— phone shows a picker before firing'}
        </label>
        {!p && presetError && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>
            Couldn't fetch list ({presetError}) — paste the id manually.
          </span>
        )}
        {!p && <span style={{ fontSize: 11, color: '#6b7280' }}>{hint}</span>}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value={action.op} onChange={(e) => setOp(e.target.value as DiscordOp)} style={selectStyle}>
        {DISCORD_OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {needs === 'channel' && (
        <>
          {renderPromptableIdField(
            'channelId',
            'pick a voice channel',
            'Or paste a channel id (Discord → User Settings → Advanced → Developer Mode → right-click a voice channel → Copy Channel ID).',
            filteredChannels?.map((c) => ({ value: c.id, label: showAllGuilds ? `${c.guildName} · ${c.channelName}` : c.channelName })),
            voiceChannelsError,
          )}
          {!promptFor('channelId') && voiceChannels && voiceChannels.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
              <input
                type="checkbox"
                checked={showAllGuilds}
                onChange={(e) => setShowAllGuilds(e.target.checked)}
              />
              Show channels from all servers {!showAllGuilds && !scopeGuildId && '— set a Primary server on the Discord panel to define "my server"'}
            </label>
          )}
        </>
      )}

      {(needs === 'user' || needs === 'user+volume') && renderPromptableIdField(
        'userId',
        'Discord user id',
        'Right-click a user (with Developer Mode on) → Copy User ID. Or check "Ask on tap" to pick from the current channel at press-time.',
      )}

      {(needs === 'user-guild' || needs === 'user-guild+channel') && renderPromptableIdField(
        'userId',
        'Discord user id',
        'Or check "Ask on tap" to pick from everyone currently in voice across your Primary server (or the guild you\'re in).',
      )}

      {needs === 'user-guild+channel' && (
        <>
          {renderPromptableIdField(
            'channelId',
            'pick a voice channel',
            'Destination channel — where to move the picked member.',
            filteredChannels?.map((c) => ({ value: c.id, label: showAllGuilds ? `${c.guildName} · ${c.channelName}` : c.channelName })),
            voiceChannelsError,
          )}
          {!promptFor('channelId') && voiceChannels && voiceChannels.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
              <input
                type="checkbox"
                checked={showAllGuilds}
                onChange={(e) => setShowAllGuilds(e.target.checked)}
              />
              Show channels from all servers
            </label>
          )}
        </>
      )}

      {needs === 'user+volume' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            max={200}
            value={params.volume ?? 100}
            onChange={(e) => onChange({ ...action, params: { ...params, volume: Math.max(0, Math.min(200, Number(e.target.value) || 0)) } })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>volume % (100 = normal, 0–200)</span>
        </div>
      )}
    </div>
  );
}

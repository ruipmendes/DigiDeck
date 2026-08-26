import type { Action, KickOp, KickPrompt, KickPromptField } from '../../lib/types';
import { inputStyle, selectStyle } from './shared';

/** Per-op UI needs — the params required to author the tile. `null` = no extra
 *  fields beyond the op picker. `prompt-only` fields are always ask-on-tap
 *  (message id, ban reason) — nobody hard-codes them in the tile. */
type KickNeeds =
  | 'chat-text'
  | 'delete-message'
  | 'ban-user'
  | 'unban-user'
  | 'title'
  | 'category'
  | 'run-ad'
  | null;

type KickOpDef = { value: KickOp; label: string; needs: KickNeeds };
type KickOpGroup = { label: string; options: KickOpDef[] };

const KICK_OP_GROUPS: KickOpGroup[] = [
  {
    label: 'Chat',
    options: [
      { value: 'chat',           label: 'Send chat message',        needs: 'chat-text' },
      { value: 'delete-message', label: 'Delete chat message…',     needs: 'delete-message' },
    ],
  },
  {
    label: 'Moderation',
    options: [
      { value: 'ban-user',   label: 'Ban / timeout user…',  needs: 'ban-user' },
      { value: 'unban-user', label: 'Unban user…',           needs: 'unban-user' },
    ],
  },
  {
    label: 'Broadcast',
    options: [
      { value: 'update-title',    label: 'Update stream title…', needs: 'title' },
      { value: 'update-category', label: 'Update category…',     needs: 'category' },
      { value: 'run-ad',          label: 'Run ad…',              needs: 'run-ad' },
    ],
  },
];

const KICK_OPS: KickOpDef[] = KICK_OP_GROUPS.flatMap((g) => g.options);

const PROMPT_META: Record<KickPromptField, { label: string; placeholder: string }> = {
  text:       { label: 'Chat message',   placeholder: 'e.g. !discord' },
  messageId:  { label: 'Message id',     placeholder: 'kick message id (uuid)' },
  target:     { label: 'User',           placeholder: 'kick username' },
  title:      { label: 'Stream title',   placeholder: 'e.g. Late-night runs' },
  category:   { label: 'Category name',  placeholder: 'e.g. Just Chatting' },
  banReason:  { label: 'Reason',         placeholder: 'why? (optional, max 100)' },
};

// Kick's ban endpoint accepts durations in minutes, 1-10080 (one week).
// Preset options mirror Twitch's ad-length row for consistent UX.
const BAN_DURATIONS: { value: number; label: string }[] = [
  { value: 0,      label: 'Permanent ban' },
  { value: 1,      label: 'Timeout 1 min' },
  { value: 5,      label: 'Timeout 5 min' },
  { value: 10,     label: 'Timeout 10 min' },
  { value: 60,     label: 'Timeout 1 hour' },
  { value: 1440,   label: 'Timeout 24 hours' },
  { value: 10080,  label: 'Timeout 1 week' },
];

// Kick allows 7-300 seconds — same shape as Twitch.
const AD_LENGTHS = [30, 60, 90, 120, 150, 180, 240, 300];

export function KickBody({ action, onChange }: {
  action: Extract<Action, { type: 'kick' }>;
  onChange: (a: Action) => void;
}) {
  const opMeta = KICK_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const params = action.params ?? {};

  const setOp = (op: KickOp) => {
    // Reset op-specific params + prompts so stale values from one op don't
    // leak into the next.
    onChange({ type: 'kick', op, text: op === 'chat' ? (action.text ?? '') : undefined, params: undefined, prompts: undefined });
  };

  const promptFor = (field: KickPromptField): KickPrompt | undefined =>
    action.prompts?.find((p) => p.field === field);

  const setPromptEnabled = (field: KickPromptField, enabled: boolean) => {
    const rest = (action.prompts ?? []).filter((p) => p.field !== field);
    if (enabled) {
      const meta = PROMPT_META[field];
      const nextPrompts: KickPrompt[] = [...rest, { field, label: meta.label, placeholder: meta.placeholder }];
      const nextParams = { ...(action.params ?? {}) } as Record<string, unknown>;
      delete nextParams[field];
      onChange({
        ...action,
        params: Object.keys(nextParams).length ? nextParams as typeof action.params : undefined,
        prompts: nextPrompts,
      });
    } else {
      onChange({ ...action, prompts: rest.length ? rest : undefined });
    }
  };

  const renderPromptableField = (field: KickPromptField) => {
    const p = promptFor(field);
    const meta = PROMPT_META[field];
    const value = (params[field] as string | undefined) ?? '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!p && (
          <input
            value={value}
            onChange={(e) => onChange({ ...action, params: { ...params, [field]: e.target.value } })}
            placeholder={meta.placeholder}
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
          Ask on tap {p && '— phone shows a dialog before firing'}
        </label>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as KickOp)}
        style={selectStyle}
      >
        {KICK_OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {needs === 'chat-text' && (
        <input
          value={action.text ?? ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="!command or chat message (e.g. !discord)"
          style={inputStyle}
        />
      )}

      {needs === 'delete-message' && renderPromptableField('messageId')}

      {needs === 'ban-user' && (
        <>
          {renderPromptableField('target')}
          <select
            value={params.banDuration ?? 0}
            onChange={(e) => onChange({ ...action, params: { ...params, banDuration: Number(e.target.value) } })}
            style={selectStyle}
          >
            {BAN_DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          {renderPromptableField('banReason')}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Requires the linked Kick account to have moderator on the target channel.
          </span>
        </>
      )}

      {needs === 'unban-user' && renderPromptableField('target')}

      {needs === 'title' && renderPromptableField('title')}

      {needs === 'category' && (
        <>
          {renderPromptableField('category')}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Digi Deck resolves the name to Kick's numeric category id via <code>GET /public/v2/categories?name=…</code>. First match wins — use the exact category name from Kick's directory.
          </span>
        </>
      )}

      {needs === 'run-ad' && (
        <select
          value={params.adLength ?? 60}
          onChange={(e) => onChange({ ...action, params: { ...params, adLength: Number(e.target.value) } })}
          style={selectStyle}
        >
          {AD_LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
        </select>
      )}
    </div>
  );
}

import { X, Plus } from 'lucide-react';
import type { Action, TwitchOp, TwitchActionParams, TwitchAnnouncementColor, TwitchPrompt, TwitchPromptField } from '../../lib/types';
import { inputStyle, selectStyle, addStepBtnStyle, stepIconBtn } from './shared';

type TwitchNeeds = 'chat-text' | 'announcement' | 'run-ad' | 'marker' | 'follower-only' | 'slow-mode' | 'target' | 'title' | 'gameName' | 'poll' | 'prediction' | null;
type TwitchOpDef = { value: TwitchOp; label: string; needs: TwitchNeeds };
type TwitchOpGroup = { label: string; options: TwitchOpDef[] };

const TWITCH_OP_GROUPS: TwitchOpGroup[] = [
  {
    label: 'Chat',
    options: [
      { value: 'chat',              label: 'Send chat message',       needs: 'chat-text' },
      { value: 'chat-announcement', label: 'Send /announce…',          needs: 'announcement' },
      { value: 'clear-chat',        label: 'Clear chat',               needs: null },
    ],
  },
  {
    label: 'Ads',
    options: [
      { value: 'run-ad',    label: 'Run ad…',        needs: 'run-ad' },
      { value: 'snooze-ad', label: 'Snooze next ad', needs: null },
    ],
  },
  {
    label: 'Clips & markers',
    options: [
      { value: 'create-clip',   label: 'Create clip',          needs: null },
      { value: 'stream-marker', label: 'Create stream marker…', needs: 'marker' },
    ],
  },
  {
    label: 'Moderation',
    options: [
      { value: 'toggle-shield-mode', label: 'Toggle Shield Mode', needs: null },
    ],
  },
  {
    label: 'Chat modes',
    options: [
      { value: 'toggle-emote-only',    label: 'Toggle emote-only',      needs: null },
      { value: 'toggle-sub-only',      label: 'Toggle sub-only',        needs: null },
      { value: 'toggle-follower-only', label: 'Toggle follower-only…',  needs: 'follower-only' },
      { value: 'toggle-slow-mode',     label: 'Toggle slow mode…',      needs: 'slow-mode' },
    ],
  },
  {
    label: 'Broadcast',
    options: [
      { value: 'start-raid',      label: 'Start raid…',           needs: 'target' },
      { value: 'cancel-raid',     label: 'Cancel raid',           needs: null },
      { value: 'shoutout',        label: 'Send shoutout…',        needs: 'target' },
      { value: 'update-title',    label: 'Update stream title…',  needs: 'title' },
      { value: 'update-category', label: 'Update category…',      needs: 'gameName' },
    ],
  },
  {
    label: 'Polls & predictions',
    options: [
      { value: 'create-poll',       label: 'Create poll…',       needs: 'poll' },
      { value: 'create-prediction', label: 'Create prediction…', needs: 'prediction' },
    ],
  },
];

const PROMPT_META: Record<TwitchPromptField, { label: string; placeholder: string }> = {
  target:   { label: 'Streamer',        placeholder: 'e.g. ninja (login, no @)' },
  title:    { label: 'Stream title',    placeholder: 'e.g. Speedrunning Elden Ring' },
  gameName: { label: 'Game / category', placeholder: 'e.g. Elden Ring' },
};

const TWITCH_OPS: TwitchOpDef[] = TWITCH_OP_GROUPS.flatMap((g) => g.options);

const ANNOUNCEMENT_COLORS: { value: TwitchAnnouncementColor; label: string }[] = [
  { value: 'primary', label: 'Channel color' },
  { value: 'blue',    label: 'Blue' },
  { value: 'green',   label: 'Green' },
  { value: 'orange',  label: 'Orange' },
  { value: 'purple',  label: 'Purple' },
];

const AD_LENGTHS = [30, 60, 90, 120, 150, 180];

export function TwitchBody({ action, onChange }: { action: Extract<Action, { type: 'twitch' }>; onChange: (a: Action) => void }) {
  const opMeta = TWITCH_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const params = action.params ?? {};

  const setOp = (op: TwitchOp) => {
    // Reset op-specific params + prompts on op change so stale values don't leak between ops.
    onChange({ type: 'twitch', op, text: op === 'chat' ? (action.text ?? '') : undefined, params: undefined, prompts: undefined });
  };

  const promptFor = (field: TwitchPromptField): TwitchPrompt | undefined =>
    action.prompts?.find((p) => p.field === field);

  const setPromptEnabled = (field: TwitchPromptField, enabled: boolean) => {
    const rest = (action.prompts ?? []).filter((p) => p.field !== field);
    if (enabled) {
      const meta = PROMPT_META[field];
      const nextPrompts = [...rest, { field, label: meta.label, placeholder: meta.placeholder }];
      const nextParams = { ...(action.params ?? {}) };
      delete nextParams[field];
      onChange({ ...action, params: Object.keys(nextParams).length ? nextParams : undefined, prompts: nextPrompts });
    } else {
      onChange({ ...action, prompts: rest.length ? rest : undefined });
    }
  };

  const renderPromptableField = (field: TwitchPromptField) => {
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
      <select value={action.op} onChange={(e) => setOp(e.target.value as TwitchOp)} style={selectStyle}>
        {TWITCH_OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {needs === 'chat-text' && (
        <input
          value={action.text ?? ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="!command or chat message (e.g. !website)"
          style={inputStyle}
        />
      )}

      {needs === 'announcement' && (
        <>
          <input
            value={action.text ?? ''}
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            placeholder="announcement text (shows highlighted in chat)"
            style={inputStyle}
          />
          <select
            value={params.color ?? 'primary'}
            onChange={(e) => onChange({ ...action, params: { ...params, color: e.target.value as TwitchAnnouncementColor } })}
            style={selectStyle}
          >
            {ANNOUNCEMENT_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </>
      )}

      {needs === 'run-ad' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={params.adLength ?? 30}
            onChange={(e) => onChange({ ...action, params: { ...params, adLength: Number(e.target.value) } })}
            style={selectStyle}
          >
            {AD_LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Ad plays pre-roll to viewers.</span>
        </div>
      )}

      {needs === 'marker' && (
        <input
          value={action.text ?? ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="marker description (optional, ≤140 chars)"
          maxLength={140}
          style={inputStyle}
        />
      )}

      {needs === 'follower-only' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            max={129600}
            value={params.duration ?? 10}
            onChange={(e) => onChange({ ...action, params: { ...params, duration: Math.max(0, Number(e.target.value) || 0) } })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>min follow age (minutes) when turning ON</span>
        </div>
      )}

      {needs === 'slow-mode' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={3}
            max={120}
            value={params.duration ?? 30}
            onChange={(e) => onChange({ ...action, params: { ...params, duration: Math.max(3, Math.min(120, Number(e.target.value) || 30)) } })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>seconds between messages when turning ON (3–120)</span>
        </div>
      )}

      {needs === 'target' && renderPromptableField('target')}
      {needs === 'title' && renderPromptableField('title')}
      {needs === 'gameName' && renderPromptableField('gameName')}

      {(needs === 'poll' || needs === 'prediction') && (
        <PollForm
          kind={needs}
          params={params}
          onChange={(nextParams) => onChange({ ...action, params: nextParams })}
        />
      )}

      <span style={{ fontSize: 11, color: '#6b7280' }}>
        Requires Twitch connected with the new scopes. If a button says "insufficient permission", click <em>Disconnect</em> then <em>Connect to Twitch</em> on the Twitch panel.
      </span>
    </div>
  );
}

function PollForm({ kind, params, onChange }: {
  kind: 'poll' | 'prediction';
  params: TwitchActionParams;
  onChange: (next: TwitchActionParams) => void;
}) {
  const isPoll = kind === 'poll';
  const key: 'choices' | 'outcomes' = isPoll ? 'choices' : 'outcomes';
  const min = 2;
  const max = isPoll ? 5 : 10;
  const titleCap = isPoll ? 60 : 45;
  const defaultDuration = isPoll ? 60 : 120;
  const items = (params[key] ?? ['', '']) as string[];
  // Ensure at least two rows are always visible so the editor is never blank.
  const rows = items.length < min ? [...items, ...Array(min - items.length).fill('')] : items;

  const setItems = (next: string[]) => onChange({ ...params, [key]: next });
  const updateItem = (i: number, v: string) => setItems(rows.map((r, idx) => (idx === i ? v : r)));
  const addItem = () => { if (rows.length < max) setItems([...rows, '']); };
  const removeItem = (i: number) => { if (rows.length > min) setItems(rows.filter((_, idx) => idx !== i)); };

  const rowNoun = isPoll ? 'choice' : 'outcome';
  const durationLabel = isPoll ? 'poll duration' : 'prediction window';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        value={params.title ?? ''}
        onChange={(e) => onChange({ ...params, title: e.target.value })}
        placeholder={isPoll ? 'poll question (e.g. Which map?)' : 'prediction title (e.g. Will I clear this in 3 tries?)'}
        maxLength={titleCap}
        style={inputStyle}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={v}
              onChange={(e) => updateItem(i, e.target.value)}
              placeholder={`${rowNoun} ${i + 1}`}
              maxLength={25}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              disabled={rows.length <= min}
              aria-label={`remove ${rowNoun}`}
              title={rows.length <= min ? `min ${min} ${rowNoun}s` : `remove ${rowNoun}`}
              style={stepIconBtn(rows.length <= min)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          disabled={rows.length >= max}
          style={{ ...addStepBtnStyle, opacity: rows.length >= max ? 0.5 : 1 }}
        >
          <Plus size={12} /> add {rowNoun} {rows.length >= max && `(max ${max})`}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          min={isPoll ? 15 : 1}
          max={1800}
          value={params.duration ?? defaultDuration}
          onChange={(e) => onChange({ ...params, duration: Math.max(1, Math.min(1800, Number(e.target.value) || defaultDuration)) })}
          style={{ ...inputStyle, width: 90 }}
        />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          seconds — {durationLabel} ({isPoll ? '15–1800' : '1–1800'})
        </span>
      </div>
    </div>
  );
}

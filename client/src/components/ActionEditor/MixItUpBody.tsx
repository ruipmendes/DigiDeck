import { useEffect, useMemo, useState } from 'react';
import type { Action, MixItUpOp, MixItUpPlatform } from '../../lib/types';
import * as api from '../../lib/api';
import type { MixItUpCommand, MixItUpCounter } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

const COMMAND_OPS: MixItUpOp[] = ['run-command', 'enable-command', 'disable-command', 'toggle-command'];
const COUNTER_OPS: MixItUpOp[] = ['counter-set', 'counter-update', 'counter-reset'];

const OP_LABELS: Record<MixItUpOp, string> = {
  'run-command':    'Run command…',
  'enable-command': 'Enable command…',
  'disable-command':'Disable command…',
  'toggle-command': 'Toggle command…',
  'chat-message':   'Send chat message…',
  'chat-clear':     'Clear chat',
  'counter-set':    'Set counter…',
  'counter-update': 'Adjust counter (+/-)…',
  'counter-reset':  'Reset counter…',
};

const PLATFORMS: MixItUpPlatform[] = ['Twitch', 'YouTube', 'Trovo', 'Kick'];

export function MixItUpBody({ action, onChange }: {
  action: Extract<Action, { type: 'mixitup' }>;
  onChange: (a: Action) => void;
}) {
  const [commands, setCommands] = useState<MixItUpCommand[]>([]);
  const [counters, setCounters] = useState<MixItUpCounter[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getMixItUpState();
        if (!alive) return;
        setCommands(data.status.commands ?? []);
        setCounters(data.status.counters ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const params = action.params ?? {};
  const needsCommand = COMMAND_OPS.includes(action.op);
  const needsCounter = COUNTER_OPS.includes(action.op);
  const needsCounterValue = action.op === 'counter-set' || action.op === 'counter-update';
  const isChatMessage = action.op === 'chat-message';

  // Sort + group the command dropdown so a MIU setup with hundreds of commands
  // stays scannable — enabled first, then by group, then by name (server-side
  // sorted, but we reapply here in case the state hasn't caught up yet).
  const sortedCommands = useMemo(() => {
    return [...commands].sort((a, b) => {
      const ge = (a.enabled === false ? 1 : 0) - (b.enabled === false ? 1 : 0);
      if (ge !== 0) return ge;
      const gc = (a.group ?? '').localeCompare(b.group ?? '');
      if (gc !== 0) return gc;
      return a.name.localeCompare(b.name);
    });
  }, [commands]);

  const setOp = (op: MixItUpOp) => {
    // Preserve the currently-selected command/counter across ops of the same
    // family so the user doesn't lose their target when switching between
    // e.g. enable/disable/toggle.
    const preserveCommand = COMMAND_OPS.includes(op) ? params.commandId : undefined;
    const preserveCounter = COUNTER_OPS.includes(op) ? params.counterName : undefined;
    onChange({
      type: 'mixitup',
      op,
      params: {
        commandId: preserveCommand,
        counterName: preserveCounter,
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as MixItUpOp)}
        style={selectStyle}
      >
        <optgroup label="Commands">
          {COMMAND_OPS.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </optgroup>
        <optgroup label="Chat">
          <option value="chat-message">{OP_LABELS['chat-message']}</option>
          <option value="chat-clear">{OP_LABELS['chat-clear']}</option>
        </optgroup>
        <optgroup label="Counters">
          {COUNTER_OPS.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </optgroup>
      </select>

      {needsCommand && (
        sortedCommands.length > 0 ? (
          <select
            value={params.commandId ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, commandId: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— pick a Mix It Up command —</option>
            {sortedCommands.map((c) => (
              <option key={c.id} value={c.id}>
                {c.enabled === false ? '(off) ' : ''}{c.group ? `${c.group} · ` : ''}{c.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              value={params.commandId ?? ''}
              onChange={(e) => onChange({ ...action, params: { ...params, commandId: e.target.value.trim() } })}
              placeholder="command UUID (copy from Mix It Up)"
              spellCheck={false}
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Mix It Up not connected — start Mix It Up and enable the Developer API to populate this dropdown.
              </span>
            )}
          </>
        )
      )}

      {action.op === 'run-command' && (
        <>
          <input
            value={params.arguments ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, arguments: e.target.value } })}
            placeholder="arguments (optional, treated like chat args)"
            style={inputStyle}
          />
          <label style={{ fontSize: 12, color: '#9ca3af', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={!!params.ignoreRequirements}
              onChange={(e) => onChange({ ...action, params: { ...params, ignoreRequirements: e.target.checked } })}
            />
            Bypass cooldowns, costs, and role requirements
          </label>
        </>
      )}

      {isChatMessage && (
        <>
          <input
            value={action.text ?? params.text ?? ''}
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            placeholder="chat message"
            style={inputStyle}
          />
          <select
            value={params.platform ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...action,
                params: { ...params, platform: v ? (v as MixItUpPlatform) : undefined },
              });
            }}
            style={selectStyle}
          >
            <option value="">All connected platforms</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </>
      )}

      {needsCounter && (
        counters.length > 0 ? (
          <select
            value={params.counterName ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, counterName: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— pick a counter —</option>
            {counters.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.amount})</option>)}
          </select>
        ) : (
          <input
            value={params.counterName ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, counterName: e.target.value } })}
            placeholder="counter name (as shown in Mix It Up)"
            spellCheck={false}
            style={inputStyle}
          />
        )
      )}

      {needsCounterValue && (
        <input
          type="number"
          value={params.counterValue ?? 0}
          onChange={(e) => onChange({ ...action, params: { ...params, counterValue: Number(e.target.value) || 0 } })}
          placeholder={action.op === 'counter-set' ? 'new value' : 'delta (e.g. 1 or -1)'}
          style={inputStyle}
        />
      )}
    </div>
  );
}

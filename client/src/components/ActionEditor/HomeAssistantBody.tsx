import { useEffect, useMemo, useState } from 'react';
import type { Action, HomeAssistantOp } from '../../lib/types';
import * as api from '../../lib/api';
import type { HomeAssistantEntity } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

/** Op → the domain(s) whose entities are valid targets. Used to filter the
 *  entity dropdown so users don't scroll past 100 lights looking for a switch. */
const OP_DOMAINS: Record<Exclude<HomeAssistantOp, 'service-call'>, string[]> = {
  'light-on': ['light'], 'light-off': ['light'], 'light-toggle': ['light'],
  'switch-on': ['switch', 'input_boolean'], 'switch-off': ['switch', 'input_boolean'], 'switch-toggle': ['switch', 'input_boolean'],
  'scene-activate': ['scene'],
  'script-run': ['script'],
  'automation-trigger': ['automation'],
  'media-play': ['media_player'], 'media-pause': ['media_player'], 'media-play-pause': ['media_player'],
  'media-next': ['media_player'], 'media-previous': ['media_player'],
  'cover-open': ['cover'], 'cover-close': ['cover'], 'cover-toggle': ['cover'],
};

const OP_GROUPS: { label: string; ops: { value: HomeAssistantOp; label: string }[] }[] = [
  {
    label: 'Lights',
    ops: [
      { value: 'light-toggle', label: 'Toggle light' },
      { value: 'light-on',     label: 'Turn light on' },
      { value: 'light-off',    label: 'Turn light off' },
    ],
  },
  {
    label: 'Switches',
    ops: [
      { value: 'switch-toggle', label: 'Toggle switch / input_boolean' },
      { value: 'switch-on',     label: 'Turn switch on' },
      { value: 'switch-off',    label: 'Turn switch off' },
    ],
  },
  {
    label: 'Scenes / scripts / automations',
    ops: [
      { value: 'scene-activate',     label: 'Activate scene' },
      { value: 'script-run',         label: 'Run script' },
      { value: 'automation-trigger', label: 'Trigger automation' },
    ],
  },
  {
    label: 'Media players',
    ops: [
      { value: 'media-play-pause', label: 'Play / pause' },
      { value: 'media-play',       label: 'Play' },
      { value: 'media-pause',      label: 'Pause' },
      { value: 'media-next',       label: 'Next track' },
      { value: 'media-previous',   label: 'Previous track' },
    ],
  },
  {
    label: 'Covers',
    ops: [
      { value: 'cover-toggle', label: 'Toggle cover' },
      { value: 'cover-open',   label: 'Open cover' },
      { value: 'cover-close',  label: 'Close cover' },
    ],
  },
  {
    label: 'Advanced',
    ops: [
      { value: 'service-call', label: 'Call any service…' },
    ],
  },
];

export function HomeAssistantBody({ action, onChange }: {
  action: Extract<Action, { type: 'homeassistant' }>;
  onChange: (a: Action) => void;
}) {
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getHomeAssistantState();
        if (!alive) return;
        setEntities(data.status.entities ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const params = action.params ?? {};

  const domains = action.op === 'service-call' ? null : OP_DOMAINS[action.op];
  const filtered = useMemo(() => {
    let list = entities;
    if (domains) list = list.filter((e) => domains.includes(e.domain));
    const q = filter.trim().toLowerCase();
    if (q) list = list.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
    return list;
  }, [entities, domains, filter]);

  const setOp = (op: HomeAssistantOp) => {
    onChange({ type: 'homeassistant', op, params: {} });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as HomeAssistantOp)}
        style={selectStyle}
      >
        {OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {action.op !== 'service-call' && (
        <>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`filter ${domains?.[0] ?? 'entities'}…`}
            style={inputStyle}
          />
          {filtered.length > 0 ? (
            <select
              value={filtered.some((e) => e.id === params.entityId) ? params.entityId : ''}
              onChange={(e) => onChange({ ...action, params: { ...params, entityId: e.target.value } })}
              style={selectStyle}
            >
              <option value="">— pick an entity —</option>
              {filtered.map((e) => (
                <option key={e.id} value={e.id}>{e.name} · {e.id}</option>
              ))}
            </select>
          ) : (
            <>
              <input
                value={params.entityId ?? ''}
                onChange={(e) => onChange({ ...action, params: { ...params, entityId: e.target.value } })}
                placeholder="entity_id (e.g. light.living_room)"
                style={inputStyle}
                spellCheck={false}
                autoCapitalize="off"
              />
              {!connected && (
                <span style={{ fontSize: 11, color: '#f59e0b' }}>
                  Home Assistant not connected — link it in Integrations and this dropdown will populate.
                </span>
              )}
            </>
          )}
        </>
      )}

      {action.op === 'service-call' && (
        <>
          <input
            value={params.service ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, service: e.target.value } })}
            placeholder="domain.service (e.g. climate.set_temperature)"
            style={inputStyle}
            spellCheck={false}
            autoCapitalize="off"
          />
          <input
            value={params.entityId ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, entityId: e.target.value } })}
            placeholder="entity_id (optional)"
            style={inputStyle}
            spellCheck={false}
            autoCapitalize="off"
          />
          <textarea
            value={params.serviceData ? JSON.stringify(params.serviceData, null, 2) : ''}
            onChange={(e) => {
              const text = e.target.value;
              if (!text.trim()) {
                onChange({ ...action, params: { ...params, serviceData: undefined } });
                return;
              }
              try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                onChange({ ...action, params: { ...params, serviceData: parsed } });
              } catch {
                // Leave stale value in the textarea; user fixes JSON before saving.
              }
            }}
            placeholder='{ "temperature": 22 }'
            rows={4}
            spellCheck={false}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Extra JSON payload merged with <code>{"{entity_id}"}</code>. Leave blank for services that only take an entity.
          </span>
        </>
      )}
    </div>
  );
}

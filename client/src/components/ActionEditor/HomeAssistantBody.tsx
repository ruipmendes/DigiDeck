import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, HomeAssistantOp } from '../../lib/types';
import * as api from '../../lib/api';
import type { HomeAssistantEntity } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

/** Op → the domain(s) whose entities are valid targets. Used to filter the
 *  entity picker so users don't scroll past 100 lights looking for a switch. */
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

const MAX_RESULTS = 50;

export function HomeAssistantBody({ action, onChange }: {
  action: Extract<Action, { type: 'homeassistant' }>;
  onChange: (a: Action) => void;
}) {
  const [entities, setEntities] = useState<HomeAssistantEntity[]>([]);
  const [connected, setConnected] = useState(false);

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
        <EntityCombobox
          entities={entities}
          domains={domains}
          connected={connected}
          value={params.entityId ?? ''}
          onChange={(id) => onChange({ ...action, params: { ...params, entityId: id } })}
        />
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

/**
 * Typeahead combobox for HA entities.
 *
 * Replaces the earlier "text filter + dropdown" pair with a single search
 * input backed by an inline result list. The old pair became unusable
 * once an HA setup crossed ~50 entities — the dropdown was a wall to
 * scroll and the filter was decoupled from the persisted value.
 *
 * Behavior:
 *   - Closed + a value picked → input shows "<name>" with the entity_id below.
 *   - Focused → results dropdown appears with the currently-picked entity
 *     preselected via keyboard nav; typing narrows the list.
 *   - Click a row (or press Enter on the highlighted one) → picks it and closes.
 *   - Result list capped at MAX_RESULTS so wide setups don't blow the DOM.
 *   - Falls back to a plain text input when there are zero entities (offline,
 *     never-loaded, or a manual entity_id the deck author wants to type).
 */
function EntityCombobox({
  entities,
  domains,
  connected,
  value,
  onChange,
}: {
  entities: HomeAssistantEntity[];
  domains: string[] | null;
  connected: boolean;
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // Debounce blur-close so click events on list items still register — the
  // click fires on mouseup, which lands AFTER blur.
  const closeTimer = useRef<number | null>(null);

  const domainScoped = useMemo(() => {
    if (!domains) return entities;
    return entities.filter((e) => domains.includes(e.domain));
  }, [entities, domains]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return domainScoped.slice(0, MAX_RESULTS);
    // Match on either the friendly name or the raw entity_id — most searches
    // are name-driven ("living room"), but power users search by domain
    // prefix ("light.").
    return domainScoped
      .filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [domainScoped, query]);

  const picked = entities.find((e) => e.id === value);

  // Reset highlight when the visible list changes so arrow keys don't try to
  // hit an index past the end.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Scroll the highlighted row into view when arrows move past the visible
  // slice of the dropdown.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const openList = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  };
  const closeList = () => {
    closeTimer.current = window.setTimeout(() => { setOpen(false); }, 120);
  };

  const commit = (e: HomeAssistantEntity) => {
    onChange(e.id);
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && filtered[highlight]) {
      e.preventDefault();
      commit(filtered[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // No entities loaded at all → plain text input fallback + a hint. Keeps
  // deck authors unblocked when HA is offline.
  if (entities.length === 0) {
    return (
      <>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="entity_id (e.g. light.living_room)"
          style={inputStyle}
          spellCheck={false}
          autoCapitalize="off"
        />
        {!connected && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>
            Home Assistant not connected — link it in Integrations and this search will populate with your entities.
          </span>
        )}
      </>
    );
  }

  const inputValue = open ? query : (picked?.name ?? '');

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => { setQuery(e.target.value); openList(); }}
          onFocus={openList}
          onBlur={closeList}
          onKeyDown={onKeyDown}
          placeholder={picked ? picked.id : (domains ? `search ${domains.join(' / ')}…` : 'search entities…')}
          style={{ ...inputStyle, paddingRight: picked ? 30 : 10 }}
          spellCheck={false}
          autoCapitalize="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {picked && !open && (
          <button
            type="button"
            onClick={clear}
            title="clear selection"
            aria-label="clear selection"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 0, color: '#6b7280',
              cursor: 'pointer', fontSize: 14, padding: 2,
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0,
            background: '#0a0a0a', border: '1px solid #374151', borderRadius: 6,
            maxHeight: 240, overflowY: 'auto',
            margin: 0, padding: 4, listStyle: 'none', zIndex: 20,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {filtered.length === 0 ? (
            <li style={{ padding: '8px 10px', color: '#6b7280', fontSize: 12 }}>
              No matches{query ? ` for "${query}"` : ''}.
            </li>
          ) : (
            filtered.map((e, i) => {
              const isSel = i === highlight;
              return (
                <li
                  key={e.id}
                  role="option"
                  aria-selected={isSel}
                  onMouseDown={(ev) => { ev.preventDefault(); commit(e); }}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                    background: isSel ? '#1e293b' : 'transparent',
                    color: '#e5e7eb',
                    display: 'flex', gap: 8, alignItems: 'baseline',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{e.name}</span>
                  <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{e.id}</span>
                </li>
              );
            })
          )}
          {domainScoped.length > MAX_RESULTS && filtered.length === MAX_RESULTS && (
            <li style={{ padding: '6px 10px', color: '#6b7280', fontSize: 11, textAlign: 'center' }}>
              Showing first {MAX_RESULTS} of {domainScoped.length}. Type to narrow.
            </li>
          )}
        </ul>
      )}

      {picked && !open && (
        <span style={{ fontSize: 11, color: '#6b7280', marginTop: 2, display: 'block' }}>
          {picked.id}
        </span>
      )}
    </div>
  );
}

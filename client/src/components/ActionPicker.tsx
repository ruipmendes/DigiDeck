/**
 * Stream-Deck-style action picker. Renders inline (not modal) so it fits
 * mobile and stacks naturally under the tile it belongs to.
 *
 * States:
 *   - collapsed: shows a "trigger" chip with the current pick's category +
 *     label, click to expand
 *   - expanded: search input + scrollable result list; empty query → grouped
 *     by category with headers, non-empty query → flat filtered list.
 *
 * Availability: entries with a `requires` integration are dimmed and marked
 * "needs X" when that integration is disabled, but still selectable — users
 * often configure buttons while a target integration is off.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import type { Action, IntegrationStatus } from '../lib/types';
import { getIcon } from '../lib/icons';
import { ACTION_PICKER_ENTRIES, filterEntries, entryFor, type ActionPickerEntry } from './actionPickerEntries';

type Props = {
  current: Action;
  onPick: (next: Action) => void;
  integrationStatus?: IntegrationStatus;
};

export function ActionPicker({ current, onPick, integrationStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const currentEntry = entryFor(current);

  const filtered = useMemo(() => filterEntries(ACTION_PICKER_ENTRIES, query), [query]);
  // Reset the highlight to the first result any time the filter changes.
  useEffect(() => { setHighlighted(0); }, [query]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  function pick(e: ActionPickerEntry) {
    onPick(e.create());
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); return; }
    if (e.key === 'Enter')     { e.preventDefault(); if (filtered[highlighted]) pick(filtered[highlighted]); return; }
    if (e.key === 'Escape')    { e.preventDefault(); setOpen(false); setQuery(''); return; }
  }

  // Group only when the query is empty — filtered results render flat.
  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const groups: Record<string, ActionPickerEntry[]> = {};
    for (const e of filtered) {
      (groups[e.category] ??= []).push(e);
    }
    return groups;
  }, [filtered, query]);

  const isAvailable = (e: ActionPickerEntry): boolean => {
    if (!e.requires) return true;
    if (!integrationStatus) return true;
    return integrationStatus[e.requires];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
        title="Change action"
      >
        <PickerRowIcon iconName={currentEntry?.iconName} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.2 }}>
            {currentEntry?.category ?? 'Action'}
          </span>
          <span style={{ fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
            {currentEntry?.label ?? current.type}
          </span>
        </div>
        <ChevronDown size={16} style={{ color: '#9ca3af', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>

      {open && (
        <div style={panelStyle}>
          <div style={searchRow}>
            <Search size={14} style={{ color: '#6b7280' }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search actions… (e.g. mute, scene, raid)"
              style={searchInput}
              spellCheck={false}
              autoCapitalize="none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="clear" style={clearBtn}>
                <X size={12} />
              </button>
            )}
          </div>

          <div style={listWrap}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                No actions match "{query}"
              </div>
            )}
            {grouped
              ? Object.entries(grouped).map(([cat, entries]) => (
                <div key={cat}>
                  <div style={groupHeader}>{cat}</div>
                  {entries.map((e) => (
                    <PickerRow
                      key={e.key}
                      entry={e}
                      highlighted={filtered[highlighted]?.key === e.key}
                      available={isAvailable(e)}
                      current={currentEntry?.key === e.key}
                      onPick={() => pick(e)}
                      onHover={() => setHighlighted(filtered.indexOf(e))}
                    />
                  ))}
                </div>
              ))
              : filtered.map((e, i) => (
                <PickerRow
                  key={e.key}
                  entry={e}
                  highlighted={i === highlighted}
                  available={isAvailable(e)}
                  current={currentEntry?.key === e.key}
                  onPick={() => pick(e)}
                  onHover={() => setHighlighted(i)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({ entry, highlighted, available, current, onPick, onHover }: {
  entry: ActionPickerEntry;
  highlighted: boolean;
  available: boolean;
  current: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={highlighted}
      onMouseEnter={onHover}
      onClick={onPick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        cursor: 'pointer',
        background: highlighted ? '#1f2937' : 'transparent',
        borderLeft: current ? '3px solid #3b82f6' : '3px solid transparent',
        opacity: available ? 1 : 0.6,
      }}
    >
      <PickerRowIcon iconName={entry.iconName} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.label}
        </span>
        {entry.hint && (
          <span style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.hint}
          </span>
        )}
      </div>
      {!available && entry.requires && (
        <span style={{ fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.3 }}>
          needs {String(entry.requires)}
        </span>
      )}
    </div>
  );
}

function PickerRowIcon({ iconName }: { iconName?: string }) {
  const Icon = iconName ? getIcon(iconName) : null;
  return (
    <div style={{ width: 20, display: 'flex', justifyContent: 'center', color: '#9ca3af' }}>
      {Icon ? <Icon size={16} /> : <span style={{ width: 16, height: 16 }} />}
    </div>
  );
}

const triggerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 10px',
  background: '#0a0a0a',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  cursor: 'pointer',
  textAlign: 'left',
};

const panelStyle: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid #374151',
  borderRadius: 6,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const searchRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderBottom: '1px solid #1f2937',
  background: '#111827',
};

const searchInput: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 0,
  color: '#fff',
  fontSize: 14,
  outline: 'none',
  padding: '4px 0',
};

const clearBtn: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#9ca3af',
  cursor: 'pointer',
  padding: 2,
};

const listWrap: React.CSSProperties = {
  maxHeight: 360,
  overflowY: 'auto',
  overflowX: 'hidden',
};

const groupHeader: React.CSSProperties = {
  padding: '6px 12px 4px',
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
  background: '#0a0a0a',
  position: 'sticky',
  top: 0,
};

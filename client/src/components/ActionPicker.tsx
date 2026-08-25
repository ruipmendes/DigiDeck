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
import { Search, ChevronDown, X, Lock } from 'lucide-react';
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

  // Hide fully-paywalled entries when the user's account can't run them at all —
  // Spotify playback is the only case today. Different from "not available":
  // "needs X" entries still show (dimmed) so users can plan ahead. Spotify's
  // premium wall isn't a temporary state we can encourage — free-tier accounts
  // literally can't run any spotify op we ship — so we hide them outright.
  const visibleEntries = useMemo(() => {
    if (integrationStatus?.spotify && !integrationStatus?.spotifyPremium) {
      return ACTION_PICKER_ENTRIES.filter((e) => !(e.requires === 'spotify' && e.requiresPremium));
    }
    return ACTION_PICKER_ENTRIES;
  }, [integrationStatus?.spotify, integrationStatus?.spotifyPremium]);
  const filtered = useMemo(() => filterEntries(visibleEntries, query), [visibleEntries, query]);
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

  // Premium-gated entries (Spotify playback control) get a lock icon and can't
  // be picked when the linked account isn't Premium. Different from "needs X":
  // integration IS connected, just the API refuses to run this specific op for
  // free-tier accounts. Falls back to `available` when we have no status.
  const isLocked = (e: ActionPickerEntry): boolean => {
    if (!e.requiresPremium) return false;
    if (!integrationStatus) return false;
    if (e.requires === 'spotify') return !integrationStatus.spotifyPremium;
    return false;
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
                      locked={isLocked(e)}
                      current={currentEntry?.key === e.key}
                      onPick={() => { if (!isLocked(e)) pick(e); }}
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
                  locked={isLocked(e)}
                  current={currentEntry?.key === e.key}
                  onPick={() => { if (!isLocked(e)) pick(e); }}
                  onHover={() => setHighlighted(i)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({ entry, highlighted, available, locked, current, onPick, onHover }: {
  entry: ActionPickerEntry;
  highlighted: boolean;
  available: boolean;
  locked: boolean;
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
      title={locked ? 'Requires Spotify Premium' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        cursor: locked ? 'not-allowed' : 'pointer',
        background: highlighted && !locked ? '#1f2937' : 'transparent',
        borderLeft: current ? '3px solid #3b82f6' : '3px solid transparent',
        opacity: locked ? 0.45 : available ? 1 : 0.6,
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
      {locked && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.3 }}>
          <Lock size={10} /> Premium
        </span>
      )}
      {!locked && !available && entry.requires && (
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

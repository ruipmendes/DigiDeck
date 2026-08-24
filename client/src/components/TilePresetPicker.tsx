/**
 * Modal picker for the "+ from library" flow. Same visual language as the
 * ActionPicker (search + categorised list) but scoped to whole-tile
 * presets — landing on one inserts a fully-configured tile in the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getIcon } from '../lib/icons';
import { TILE_PRESETS, filterPresets, type TilePreset } from './tilePresets';

type Props = {
  onPick: (preset: TilePreset) => void;
  onCancel: () => void;
};

export function TilePresetPicker({ onPick, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterPresets(query), [query]);

  useEffect(() => { setHighlighted(0); }, [query]);
  useEffect(() => { setTimeout(() => searchRef.current?.focus(), 0); }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); return; }
    if (e.key === 'Enter')     { e.preventDefault(); if (filtered[highlighted]) onPick(filtered[highlighted]); return; }
    if (e.key === 'Escape')    { e.preventDefault(); onCancel(); return; }
  }

  const grouped = useMemo(() => {
    if (query.trim()) return null;
    const groups: Record<string, TilePreset[]> = {};
    for (const p of TILE_PRESETS) (groups[p.category] ??= []).push(p);
    return groups;
  }, [query]);

  return (
    <div role="dialog" aria-modal="true" onClick={onCancel} style={backdrop}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={header}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Add from library</span>
          <button type="button" onClick={onCancel} aria-label="close" style={closeBtn}>
            <X size={16} />
          </button>
        </div>
        <div style={searchRow}>
          <Search size={14} style={{ color: '#6b7280' }} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search presets… (e.g. record, mute, clip, panel)"
            style={searchInput}
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
        <div style={listWrap}>
          {filtered.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
              No presets match "{query}"
            </div>
          )}
          {grouped
            ? Object.entries(grouped).map(([cat, ps]) => (
              <div key={cat}>
                <div style={groupHeader}>{cat}</div>
                {ps.map((p) => (
                  <PresetRow
                    key={p.key}
                    preset={p}
                    highlighted={filtered[highlighted]?.key === p.key}
                    onPick={() => onPick(p)}
                    onHover={() => setHighlighted(filtered.indexOf(p))}
                  />
                ))}
              </div>
            ))
            : filtered.map((p, i) => (
              <PresetRow
                key={p.key}
                preset={p}
                highlighted={i === highlighted}
                onPick={() => onPick(p)}
                onHover={() => setHighlighted(i)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function PresetRow({ preset, highlighted, onPick, onHover }: {
  preset: TilePreset;
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const Icon = preset.iconName ? getIcon(preset.iconName) : null;
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
        padding: '10px 14px',
        cursor: 'pointer',
        background: highlighted ? '#1f2937' : 'transparent',
      }}
    >
      <div style={{ width: 22, display: 'flex', justifyContent: 'center', color: '#9ca3af' }}>
        {Icon ? <Icon size={18} /> : <span style={{ width: 18, height: 18 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preset.label}
        </span>
        {preset.hint && (
          <span style={{ fontSize: 11, color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {preset.hint}
          </span>
        )}
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0, 0, 0, 0.65)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '10vh', zIndex: 1000, padding: 16,
};

const panel: React.CSSProperties = {
  background: '#0a0a0a',
  border: '1px solid #374151',
  borderRadius: 10,
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
  width: '100%', maxWidth: 460,
  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
};

const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid #1f2937',
  background: '#111827',
  color: '#fff',
};

const closeBtn: React.CSSProperties = {
  marginLeft: 'auto',
  background: 'transparent', border: 0,
  color: '#9ca3af', cursor: 'pointer', padding: 2,
};

const searchRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px',
  borderBottom: '1px solid #1f2937',
  background: '#111827',
};

const searchInput: React.CSSProperties = {
  flex: 1,
  background: 'transparent', border: 0,
  color: '#fff', fontSize: 14, outline: 'none',
  padding: '4px 0',
};

const listWrap: React.CSSProperties = {
  maxHeight: '60vh',
  overflowY: 'auto',
};

const groupHeader: React.CSSProperties = {
  padding: '8px 14px 6px',
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
  background: '#0a0a0a',
  position: 'sticky', top: 0,
};

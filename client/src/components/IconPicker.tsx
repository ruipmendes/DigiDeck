import { useEffect, useRef, useState } from 'react';
import { ICONS, ICON_NAMES, getIcon } from '../lib/icons';

type Props = { value?: string; onChange: (icon: string | undefined) => void };

export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  const Icon = getIcon(value);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = query
    ? ICON_NAMES.filter((n) => n.includes(query.toLowerCase()))
    : ICON_NAMES;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 56, height: 56,
          background: '#0a0a0a',
          border: '1px solid #374151',
          borderRadius: 8,
          color: '#fff',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title={value ? `icon: ${value}` : 'pick icon'}
      >
        {Icon ? <Icon size={24} strokeWidth={1.75} /> : <span style={{ fontSize: 10, color: '#6b7280' }}>none</span>}
      </button>

      {open && (
        <div
          ref={popRef}
          style={{
            position: 'absolute',
            top: '100%', left: 0,
            marginTop: 6,
            background: '#0a0a0a',
            border: '1px solid #374151',
            borderRadius: 10,
            padding: 10,
            width: 320,
            zIndex: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search icons…"
            autoFocus
            style={{
              width: '100%',
              padding: '6px 8px',
              background: '#111827',
              color: '#fff',
              border: '1px solid #374151',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 8,
            }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: 4,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            <button
              onClick={() => { onChange(undefined); setOpen(false); }}
              style={iconCellStyle(!value)}
              title="no icon"
            >
              <span style={{ fontSize: 9, color: '#6b7280' }}>none</span>
            </button>
            {filtered.map((name) => {
              const I = ICONS[name];
              return (
                <button
                  key={name}
                  onClick={() => { onChange(name); setOpen(false); }}
                  style={iconCellStyle(name === value)}
                  title={name}
                >
                  <I size={18} strokeWidth={1.75} />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1 / -1', color: '#6b7280', fontSize: 12, padding: 8 }}>
                no icons match "{query}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function iconCellStyle(active: boolean): React.CSSProperties {
  return {
    width: 34, height: 34,
    background: active ? '#1d4ed8' : '#111827',
    border: '1px solid ' + (active ? '#3b82f6' : '#374151'),
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  };
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ICONS, ICON_NAMES, getIcon } from '../lib/icons';
import * as api from '../lib/api';
import type { IconPack } from '../lib/api';

type Props = { value?: string; onChange: (icon: string | undefined) => void };

/**
 * Icon picker with built-in + pack sections.
 *
 * Value format:
 *   - Built-in icons: bare name (e.g. `mic`, `folder`, `discord`).
 *   - Pack icons:     `<pack>:<name>` (e.g. `simple-icons:spotify`, or
 *                     `simple-icons:brands/steam` for nested subdirs).
 *
 * Packs are user-installed folders under `%APPDATA%/digi-deck/icon-packs/`.
 * The picker fetches the list on open and refreshes it after the user hits
 * "Refresh" — no restart needed to see newly-dropped SVGs.
 */
export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [packs, setPacks] = useState<IconPack[]>([]);
  const [packsDir, setPacksDir] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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

  // Load packs on open. Cheap (server caches for 5s), and this way freshly-
  // dropped packs surface as soon as the user reopens the picker.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.listIconPacks()
      .then((data) => { if (alive) { setPacks(data.packs); setPacksDir(data.dir); } })
      .catch(() => { /* no packs; not fatal */ });
    return () => { alive = false; };
  }, [open]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const data = await api.refreshIconPacks();
      setPacks(data.packs);
      setPacksDir(data.dir);
    } catch { /* leave old list */ }
    finally { setRefreshing(false); }
  }

  const q = query.trim().toLowerCase();

  const filteredBuiltin = useMemo(
    () => (q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES),
    [q],
  );
  const filteredPacks = useMemo(() => {
    if (!q) return packs;
    return packs
      .map((p) => ({ name: p.name, icons: p.icons.filter((i) => i.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) }))
      .filter((p) => p.icons.length > 0);
  }, [packs, q]);

  const totalResults = filteredBuiltin.length + filteredPacks.reduce((n, p) => n + p.icons.length, 0);

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
            width: 360,
            zIndex: 10,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search icons…"
              autoFocus
              style={{
                flex: 1,
                padding: '6px 8px',
                background: '#111827',
                color: '#fff',
                border: '1px solid #374151',
                borderRadius: 6,
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={refreshing}
              title="rescan icon-packs folder"
              style={{
                padding: '4px 10px',
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 6,
                color: '#e5e7eb',
                fontSize: 12,
                cursor: refreshing ? 'wait' : 'pointer',
              }}
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Section title="Built-in">
              <IconGrid>
                <button
                  onClick={() => { onChange(undefined); setOpen(false); }}
                  style={iconCellStyle(!value)}
                  title="no icon"
                >
                  <span style={{ fontSize: 9, color: '#6b7280' }}>none</span>
                </button>
                {filteredBuiltin.map((name) => {
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
              </IconGrid>
            </Section>

            {filteredPacks.map((pack) => (
              <Section key={pack.name} title={pack.name} count={pack.icons.length}>
                <IconGrid>
                  {pack.icons.map((iconName) => {
                    const fullName = `${pack.name}:${iconName}`;
                    return (
                      <button
                        key={fullName}
                        onClick={() => { onChange(fullName); setOpen(false); }}
                        style={iconCellStyle(fullName === value)}
                        title={iconName}
                      >
                        <img
                          src={api.iconPackUrl(pack.name, iconName)}
                          alt=""
                          width={18}
                          height={18}
                          style={{ objectFit: 'contain', display: 'block', filter: 'invert(1) brightness(1.5)' }}
                          draggable={false}
                          loading="lazy"
                        />
                      </button>
                    );
                  })}
                </IconGrid>
              </Section>
            ))}

            {totalResults === 0 && (
              <div style={{ color: '#6b7280', fontSize: 12, padding: 8 }}>
                no icons match "{query}"
              </div>
            )}

            {packs.length === 0 && !q && (
              <div style={{ color: '#6b7280', fontSize: 11, padding: '4px 4px 0', lineHeight: 1.6 }}>
                Drop an unzipped icon pack (folder of <code>.svg</code> files) into<br />
                {packsDir && <code style={{ userSelect: 'all', color: '#9ca3af' }}>{packsDir}</code>}<br />
                then hit ↻. Simple Icons' zip is a great start.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 6, padding: '0 2px', display: 'flex', gap: 6 }}>
        <span>{title}</span>
        {count !== undefined && <span>({count})</span>}
      </div>
      {children}
    </div>
  );
}

function IconGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gap: 4,
      }}
    >
      {children}
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { ICONS, ICON_NAMES, getIcon, setPackTints, tintFilter } from '../lib/icons';
import * as api from '../lib/api';
import type { IconPack, TintMode } from '../lib/api';

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
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
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
      .then((data) => { if (alive) { setPacks(data.packs); setPacksDir(data.dir); setPackTints(data.packs); } })
      .catch(() => { /* no packs; not fatal */ });
    return () => { alive = false; };
  }, [open]);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    try {
      const data = await api.refreshIconPacks();
      setPacks(data.packs);
      setPacksDir(data.dir);
      setPackTints(data.packs);
    } catch { /* leave old list */ }
    finally { setRefreshing(false); }
  }

  async function onUpload(file: File): Promise<void> {
    setUploadMessage(null);
    // Default the pack name to the file's stem, sanitized to the server's
    // allowed character set (letters, digits, dot, dash, underscore).
    const defaultName = file.name.replace(/\.zip$/i, '').replace(/[^a-z0-9._-]/gi, '-');
    const name = window.prompt('Name this pack (letters, digits, - _ only):', defaultName);
    if (!name) return;
    setUploading(true);
    try {
      const result = await api.uploadIconPack(name.trim(), file);
      setPacks(result.packs);
      setPacksDir(result.dir);
      setPackTints(result.packs);
      setUploadMessage(`Installed ${result.iconCount} icon(s) into "${result.pack}".`);
    } catch (err) {
      setUploadMessage(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  async function changeTint(pack: string, tint: TintMode): Promise<void> {
    // Optimistic local update so the section flips instantly; server call
    // reconciles with the authoritative list. On failure we revert by
    // pulling the list again.
    setPacks((prev) => prev.map((p) => (p.name === pack ? { ...p, tint } : p)));
    setPackTints([{ name: pack, tint }]);
    try {
      const data = await api.setIconPackTint(pack, tint);
      setPacks(data.packs);
      setPackTints(data.packs);
    } catch {
      try {
        const data = await api.listIconPacks();
        setPacks(data.packs);
        setPackTints(data.packs);
      } catch { /* leave optimistic state */ }
    }
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
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploading}
              title="upload an icon-pack zip"
              style={{
                padding: '4px 10px',
                background: '#1f2937',
                border: '1px solid #374151',
                borderRadius: 6,
                color: '#e5e7eb',
                fontSize: 12,
                cursor: uploading ? 'wait' : 'pointer',
              }}
            >
              {uploading ? '…' : '+ zip'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
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
          {uploadMessage && (
            <div style={{ fontSize: 11, color: uploadMessage.startsWith('Upload failed') ? '#f87171' : '#9ca3af', marginBottom: 6, padding: '0 2px' }}>
              {uploadMessage}
            </div>
          )}

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

            {filteredPacks.map((pack) => {
              const packMeta = packs.find((p) => p.name === pack.name);
              const tint: TintMode = packMeta?.tint ?? 'invert';
              const filter = tintFilter(tint);
              return (
                <Section
                  key={pack.name}
                  title={pack.name}
                  count={pack.icons.length}
                  right={
                    <TintToggle
                      value={tint}
                      onChange={(next) => { void changeTint(pack.name, next); }}
                    />
                  }
                >
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
                            style={{ objectFit: 'contain', display: 'block', ...(filter ? { filter } : null) }}
                            draggable={false}
                            loading="lazy"
                          />
                        </button>
                      );
                    })}
                  </IconGrid>
                </Section>
              );
            })}

            {totalResults === 0 && (
              <div style={{ color: '#6b7280', fontSize: 12, padding: 8 }}>
                no icons match "{query}"
              </div>
            )}

            {packs.length === 0 && !q && (
              <div style={{ color: '#6b7280', fontSize: 11, padding: '4px 4px 0', lineHeight: 1.6 }}>
                Click <strong>+ zip</strong> above to install a pack, or drop unzipped folders into<br />
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

function Section({ title, count, right, children }: { title: string; count?: number; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6b7280', marginBottom: 6, padding: '0 2px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{title}</span>
        {count !== undefined && <span>({count})</span>}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      {children}
    </div>
  );
}

/** Small two-choice toggle for per-pack tint. `invert` (default) inverts the
 *  SVG so monochrome-black packs like Simple Icons show light-on-dark;
 *  `native` skips the filter so packs that already ship colored SVGs render
 *  as-drawn. */
function TintToggle({ value, onChange }: { value: TintMode; onChange: (next: TintMode) => void }) {
  return (
    <span style={{ display: 'inline-flex', border: '1px solid #374151', borderRadius: 4, overflow: 'hidden' }}>
      {(['invert', 'none'] as TintMode[]).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => { if (m !== value) onChange(m); }}
          style={{
            fontSize: 10,
            padding: '1px 6px',
            background: m === value ? '#374151' : 'transparent',
            color: m === value ? '#e5e7eb' : '#9ca3af',
            border: 0,
            cursor: 'pointer',
            textTransform: 'lowercase',
          }}
          title={m === 'invert' ? 'render inverted (monochrome-black packs)' : 'render native colors'}
        >
          {m === 'none' ? 'native' : m}
        </button>
      ))}
    </span>
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

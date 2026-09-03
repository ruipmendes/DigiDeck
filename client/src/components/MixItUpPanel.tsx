import { useEffect, useState } from 'react';
import { Bot, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { MixItUpPublicConfig, MixItUpStatus } from '../lib/api';

export function MixItUpPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<MixItUpPublicConfig | null>(null);
  const [status, setStatus] = useState<MixItUpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [hostDraft, setHostDraft] = useState('');
  const [portDraft, setPortDraft] = useState('8911');

  async function refresh() {
    try {
      const data = await api.getMixItUpState();
      setConfig(data.config);
      setStatus(data.status);
      setHostDraft((prev) => prev || data.config.host);
      setPortDraft((prev) => (prev && prev !== '8911') ? prev : String(data.config.port));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const port = Number(portDraft) || 8911;
      const data = await api.putMixItUpConfig({ enabled: true, host: hostDraft.trim() || '127.0.0.1', port });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const data = await api.reconnectMixItUp();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putMixItUpConfig({ enabled: !config.enabled, host: config.host, port: config.port });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;
  const commands = status?.commands ?? [];
  const counters = status?.counters ?? [];

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 14 }}>
      <button
        onClick={alwaysOpen ? undefined : () => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', background: 'transparent', border: 0, color: '#fff',
          padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {!alwaysOpen && (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        <Bot size={18} style={{ color: '#a78bfa' }} />
        <strong>Mix It Up</strong>
        <StatusBadge state={state} />
        {state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            {commands.length} commands{status?.version ? ` · v${status.version}` : ''}
          </span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Mix It Up integration</button>
          )}

          {state !== 'disabled' && (
            <>
              <details open={state !== 'connected'} style={{ fontSize: 13, color: '#d1d5db' }}>
                <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: enable Developer API in Mix It Up</summary>
                <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                  <li>Open <strong>Mix It Up</strong> → <em>Services</em>.</li>
                  <li>Find the <em>Developer API</em> section and click <strong>Connect</strong>.</li>
                  <li>Confirm the port (default 8911) matches the value below.</li>
                </ol>
                <a href="https://mixitup.bot/docs/reference/developer-api" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#60a5fa', display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                  Mix It Up docs <ExternalLink size={11} />
                </a>
              </details>

              <div style={grid}>
                <label style={lbl}>Host</label>
                <input value={hostDraft} onChange={(e) => setHostDraft(e.target.value)} placeholder="127.0.0.1" style={inp} spellCheck={false} autoCapitalize="off" />
                <label style={lbl}>Port</label>
                <input value={portDraft} onChange={(e) => setPortDraft(e.target.value)} placeholder="8911" style={inp} spellCheck={false} inputMode="numeric" />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={save} disabled={busy} style={secondaryBtn}>Save</button>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
              </div>
            </>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#9ca3af' }}>
                <span>{commands.length} commands</span>
                <span>{counters.length} counters</span>
                {status?.version && <span>v{status.version}</span>}
              </div>
              {commands.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {commands.slice(0, 10).map((c) => (
                    <span
                      key={c.id}
                      title={c.group ? `${c.group} · ${c.type ?? ''}` : c.type ?? ''}
                      style={{
                        padding: '2px 8px',
                        background: c.enabled === false ? '#1f2937' : '#312e81',
                        borderRadius: 4, fontSize: 12, color: '#e5e7eb',
                        border: c.enabled === false ? '1px solid #374151' : '1px solid #6366f1',
                        opacity: c.enabled === false ? 0.6 : 1,
                      }}
                    >
                      {c.name}
                    </span>
                  ))}
                  {commands.length > 10 && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>+{commands.length - 10} more</span>
                  )}
                </div>
              )}
            </div>
          )}

          {state === 'error' && (
            <div style={{ fontSize: 12, color: '#f87171' }}>{status?.error || 'Unknown error'}</div>
          )}

          {state !== 'disabled' && (
            <button
              onClick={toggleEnabled}
              disabled={busy}
              style={{
                background: 'transparent', border: 0, color: '#6b7280', cursor: 'pointer',
                padding: 0, fontSize: 11, textDecoration: 'underline', alignSelf: 'flex-start',
              }}
            >
              disable integration
            </button>
          )}

          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:        { color: '#22c55e', label: 'â— connected' },
    connecting:       { color: '#eab308', label: 'â—‹ connecting' },
    disconnected:     { color: '#6b7280', label: 'â—‹ disconnected' },
    error:            { color: '#ef4444', label: 'Ã— error' },
    disabled:         { color: '#6b7280', label: 'â—‹ disabled' },
    'not-configured': { color: '#6b7280', label: 'â—‹ needs config' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '60px 1fr', gap: 8, alignItems: 'center', marginTop: 8 };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#a78bfa', color: '#111',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

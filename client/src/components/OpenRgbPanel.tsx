import { useEffect, useState } from 'react';
import { Cpu, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { OpenRgbPublicConfig, OpenRgbStatus } from '../lib/api';

export function OpenRgbPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<OpenRgbPublicConfig | null>(null);
  const [status, setStatus] = useState<OpenRgbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [hostDraft, setHostDraft] = useState('');
  const [portDraft, setPortDraft] = useState<number>(6742);

  async function refresh() {
    try {
      const data = await api.getOpenRgbState();
      setConfig(data.config);
      setStatus(data.status);
      setHostDraft((prev) => prev || data.config.host);
      setPortDraft((prev) => prev || data.config.port);
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
      const data = await api.putOpenRgbConfig({
        enabled: true,
        host: hostDraft.trim() || '127.0.0.1',
        port: portDraft || 6742,
      });
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
      const data = await api.reconnectOpenRgb();
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
      const data = await api.putOpenRgbConfig({ enabled: !config.enabled, host: config.host, port: config.port });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;

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
        <Cpu size={18} style={{ color: '#f472b6' }} />
        <strong>OpenRGB</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.deviceCount !== undefined && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.deviceCount} devices</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable OpenRGB integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected to <code style={codeStyle}>{status?.host}:{status?.port}</code>
              {status?.deviceCount !== undefined && (
                <span style={{ marginLeft: 4, color: '#9ca3af' }}>· {status.deviceCount} RGB device{status.deviceCount === 1 ? '' : 's'}</span>
              )}
              {status?.profiles !== undefined && (
                <span style={{ marginLeft: 4, color: '#9ca3af' }}>· {status.profiles.length} profile{status.profiles.length === 1 ? '' : 's'}</span>
              )}
              {status?.profiles && status.profiles.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {status.profiles.slice(0, 12).map((p) => (
                    <span key={p} style={{ padding: '2px 8px', background: '#1f2937', borderRadius: 4, fontSize: 12, color: '#e5e7eb' }}>
                      {p}
                    </span>
                  ))}
                  {status.profiles.length > 12 && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>+{status.profiles.length - 12} more</span>
                  )}
                </div>
              )}
              {status?.profiles !== undefined && status.profiles.length === 0 && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#f59e0b' }}>
                  No profiles saved yet. Set up a color / effect combo in OpenRGB → <em>Profiles</em> tab → <em>Save Profile</em>. Digi Deck tiles activate them by name.
                </div>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> refresh</button>
              </div>
            </div>
          )}

          {(state === 'connecting' || state === 'disconnected') && (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              {state === 'connecting' ? 'Connecting…' : 'Disconnected. Retrying every 5 s.'}
              <div style={{ marginTop: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> retry now</button>
              </div>
            </div>
          )}

          {(state === 'not-configured' || state === 'error') && (
            <details open style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: install OpenRGB + enable the SDK server</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Download OpenRGB from <a href="https://openrgb.org/releases.html" target="_blank" rel="noreferrer" style={{ color: '#a78bfa', display: 'inline-flex', alignItems: 'center', gap: 3 }}>openrgb.org/releases <ExternalLink size={11} /></a> (portable — no install required).</li>
                <li>Launch it. It'll scan your RGB devices — motherboard, GPU, keyboards, mice, RAM, coolers, everything it can find.</li>
                <li>Compose the color / effect combos you want and save each as a <strong>Profile</strong> in the <em>Profiles</em> tab (e.g. "Gaming", "Streaming", "Chill").</li>
                <li>Enable the SDK server: <em>Settings → General Settings → Enable Server</em>, then <em>SDK Server</em> tab → <em>Start</em>. Default port is <code>6742</code>.</li>
                <li>Below, keep host as <code>127.0.0.1</code> unless OpenRGB is on a different PC. Click Save.</li>
              </ol>
              <div style={grid}>
                <label style={lbl}>Host</label>
                <input
                  value={hostDraft}
                  onChange={(e) => setHostDraft(e.target.value)}
                  placeholder="127.0.0.1"
                  style={inp}
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <label style={lbl}>Port</label>
                <input
                  type="number"
                  value={portDraft}
                  onChange={(e) => setPortDraft(Number(e.target.value) || 6742)}
                  placeholder="6742"
                  style={{ ...inp, width: 100 }}
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={save}
                  disabled={busy || !hostDraft.trim()}
                  style={primaryBtn}
                >
                  {busy ? 'Saving…' : 'Save & connect'}
                </button>
              </div>
              {state === 'error' && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>
                  {status?.error || 'Unknown error'}
                </div>
              )}
            </details>
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
    disconnected:     { color: '#9ca3af', label: 'Ã— disconnected' },
    error:            { color: '#ef4444', label: 'Ã— error' },
    disabled:         { color: '#6b7280', label: 'â—‹ disabled' },
    'not-configured': { color: '#6b7280', label: 'â—‹ needs setup' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginTop: 8 };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const codeStyle: React.CSSProperties = { color: '#fff', background: '#0a0a0a', padding: '1px 6px', borderRadius: 4, fontSize: 12 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#f472b6', color: '#111',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

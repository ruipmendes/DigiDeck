import { useEffect, useState } from 'react';
import { Star, RefreshCw, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import * as api from '../lib/api';
import type { NanoleafPublicConfig, NanoleafStatus } from '../lib/api';

export function NanoleafPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<NanoleafPublicConfig | null>(null);
  const [status, setStatus] = useState<NanoleafStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [hostDraft, setHostDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getNanoleafState();
      setConfig(data.config);
      setStatus(data.status);
      setHostDraft((prev) => prev || data.config.host);
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

  async function saveHost() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.putNanoleafConfig({ enabled: true, host: hostDraft.trim() });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.connectNanoleaf();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Unlink Nanoleaf? You\'ll need to press the controller button and re-link to reconnect.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectNanoleaf();
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
      const data = await api.reconnectNanoleaf();
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
      const data = await api.putNanoleafConfig({ enabled: !config.enabled, host: config.host });
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
        <Star size={18} style={{ color: '#c084fc' }} />
        <strong>Nanoleaf</strong>
        <StatusBadge state={state} />
        {state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status?.name ?? status?.host}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Nanoleaf integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected to <code style={codeStyle}>{status?.name ?? status?.host}</code>
              <div style={{ marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#9ca3af' }}>
                {status?.panelCount !== undefined && <span>{status.panelCount} panels</span>}
                <span>{status?.isOn ? <>Power: <span style={{ color: '#22c55e' }}>on</span></> : <>Power: <span style={{ color: '#6b7280' }}>off</span></>}</span>
                {status?.brightness !== undefined && <span>Brightness: {status.brightness}%</span>}
                {status?.currentEffect && <span>Effect: <em>{status.currentEffect}</em></span>}
                {status?.firmwareVersion && <span>FW {status.firmwareVersion}</span>}
              </div>
              {status?.effects && status.effects.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {status.effects.slice(0, 12).map((e) => (
                    <span
                      key={e}
                      style={{
                        padding: '2px 8px', background: e === status?.currentEffect ? '#312e81' : '#1f2937',
                        borderRadius: 4, fontSize: 12, color: '#e5e7eb',
                        border: e === status?.currentEffect ? '1px solid #6366f1' : '1px solid transparent',
                      }}
                    >
                      {e}
                    </span>
                  ))}
                  {status.effects.length > 12 && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>+{status.effects.length - 12} more</span>
                  )}
                </div>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> refresh</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Unlink</button>
              </div>
            </div>
          )}

          {(state === 'not-configured' || state === 'needs-auth' || state === 'error') && (
            <details open style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: IP + link-button</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Get the controller IP from the Nanoleaf mobile app: <em>Settings → My Nanoleaf → the device → IP address</em>.</li>
                <li>Paste it below and click <em>Save IP</em>.</li>
                <li>Hold the controller's power button for 5–7 seconds until the LED starts flashing (pairing mode).</li>
                <li>Click <em>Link controller</em> below within 30 seconds.</li>
              </ol>
              <div style={grid}>
                <label style={lbl}>IP</label>
                <input
                  value={hostDraft}
                  onChange={(e) => setHostDraft(e.target.value)}
                  placeholder="192.168.x.x"
                  style={inp}
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={saveHost} disabled={busy || !hostDraft.trim()} style={secondaryBtn}>Save IP</button>
                {state === 'needs-auth' && (
                  <button onClick={link} disabled={busy} style={primaryBtn}>
                    <Zap size={14} /> {busy ? 'Linking…' : 'Link controller'}
                  </button>
                )}
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
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ connecting' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs IP' },
    'needs-auth':     { color: '#eab308', label: '○ press link button' },
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
const codeStyle: React.CSSProperties = { color: '#fff', background: '#0a0a0a', padding: '1px 6px', borderRadius: 4, fontSize: 12 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#c084fc', color: '#111',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const dangerBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#7f1d1d', color: '#fff',
  border: 0, borderRadius: 6, fontSize: 13, cursor: 'pointer',
};

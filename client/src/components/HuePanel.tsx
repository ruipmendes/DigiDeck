import { useEffect, useState } from 'react';
import { Lightbulb, RefreshCw, ChevronDown, ChevronRight, Search } from 'lucide-react';
import * as api from '../lib/api';
import type { HuePublicConfig, HueStatus } from '../lib/api';

export function HuePanel() {
  const [config, setConfig] = useState<HuePublicConfig | null>(null);
  const [status, setStatus] = useState<HueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [bridgeIpDraft, setBridgeIpDraft] = useState('');
  const [discovered, setDiscovered] = useState<Array<{ id: string; ip: string }>>([]);
  const [discovering, setDiscovering] = useState(false);

  async function refresh() {
    try {
      const data = await api.getHueState();
      setConfig(data.config);
      setStatus(data.status);
      setBridgeIpDraft((prev) => prev || data.config.bridgeIp);
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

  async function discover() {
    setDiscovering(true);
    setError(null);
    try {
      const bridges = await api.discoverHueBridges();
      setDiscovered(bridges);
      if (bridges.length === 1 && !bridgeIpDraft) setBridgeIpDraft(bridges[0].ip);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function saveIp() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.putHueConfig({ enabled: true, bridgeIp: bridgeIpDraft.trim() });
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
      const data = await api.connectHue();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Unlink the Hue bridge? You\'ll need to press the link button again to reconnect.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectHue();
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
      const data = await api.reconnectHue();
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
      const data = await api.putHueConfig({ enabled: !config.enabled, bridgeIp: config.bridgeIp });
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
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', background: 'transparent', border: 0, color: '#fff',
          padding: 0, cursor: 'pointer', textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Lightbulb size={18} style={{ color: '#fbbf24' }} />
        <strong>Philips Hue</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.bridgeIp && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.bridgeName ?? status.bridgeIp}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Hue integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Linked to <code style={codeStyle}>{status?.bridgeName ?? status?.bridgeIp}</code>{' '}
              {status?.rooms && status?.lights && status?.scenes && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>
                  · {status.rooms.length} rooms · {status.lights.length} lights · {status.scenes.length} scenes
                </span>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> refresh</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Unlink</button>
              </div>
            </div>
          )}

          {(state === 'not-configured' || state === 'needs-auth') && (
            <div style={{ fontSize: 13, color: '#d1d5db', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <strong>Step 1 — Point Digi Deck at your bridge.</strong>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <input
                    value={bridgeIpDraft}
                    onChange={(e) => setBridgeIpDraft(e.target.value)}
                    placeholder="192.168.x.x"
                    style={{ ...inp, flex: 1, minWidth: 140 }}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                  <button onClick={() => { void discover(); }} disabled={discovering} style={secondaryBtn} title="Auto-discover bridges on your network via discovery.meethue.com">
                    <Search size={14} /> {discovering ? 'searching…' : 'auto-discover'}
                  </button>
                  <button onClick={saveIp} disabled={busy || !bridgeIpDraft.trim()} style={primaryBtn}>Save IP</button>
                </div>
                {discovered.length > 0 && (
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: '#9ca3af', lineHeight: 1.6 }}>
                    {discovered.map((b) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => setBridgeIpDraft(b.ip)}
                          style={{ background: 'transparent', border: 0, color: '#a78bfa', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                        >
                          {b.ip}
                        </button>{' '}
                        <span style={{ color: '#6b7280' }}>({b.id.slice(0, 6)}…)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {state === 'needs-auth' && (
                <div>
                  <strong>Step 2 — Press the round button on your Hue bridge, then click Link.</strong> Within 30 s.
                  <div style={{ marginTop: 8 }}>
                    <button onClick={link} disabled={busy} style={primaryBtn}>
                      {busy ? 'Linking…' : 'Link bridge'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {state === 'error' && (
            <div style={{ fontSize: 13, color: '#f87171' }}>
              {status?.error || 'Unknown error'}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}>Retry</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Reset</button>
              </div>
            </div>
          )}

          {state !== 'disabled' && state !== 'not-configured' && (
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
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ connecting' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs bridge IP' },
    'needs-auth':     { color: '#eab308', label: '○ press link button' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const codeStyle: React.CSSProperties = { color: '#fff', background: '#0a0a0a', padding: '1px 6px', borderRadius: 4, fontSize: 12 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#fbbf24', color: '#111',
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

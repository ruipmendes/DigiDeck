import { useEffect, useState } from 'react';
import { Mic, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { VoicemodPublicConfig, VoicemodStatus } from '../lib/api';

export function VoicemodPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<VoicemodPublicConfig | null>(null);
  const [status, setStatus] = useState<VoicemodStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [hostDraft, setHostDraft] = useState('');
  const [portDraft, setPortDraft] = useState('59129');
  const [keyDraft, setKeyDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getVoicemodState();
      setConfig(data.config);
      setStatus(data.status);
      setHostDraft((prev) => prev || data.config.host);
      setPortDraft((prev) => (prev && prev !== '59129') ? prev : String(data.config.port));
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
      const port = Number(portDraft) || 59129;
      const data = await api.putVoicemodConfig({
        enabled: true,
        host: hostDraft.trim() || '127.0.0.1',
        port,
        clientKey: keyDraft.trim() || undefined,
      });
      setConfig(data.config);
      setStatus(data.status);
      setKeyDraft(''); // empty out the input; the server has it now
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const data = await api.reconnectVoicemod();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleEnabled() {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putVoicemodConfig({
        enabled: !config.enabled,
        host: config.host,
        port: config.port,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function clearKey() {
    if (!config) return;
    if (!confirm('Clear the Voicemod client key? You\'ll need to paste a new one to reconnect.')) return;
    setBusy(true);
    try {
      const data = await api.putVoicemodConfig({
        enabled: config.enabled,
        host: config.host,
        port: config.port,
        clientKey: null,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const state = status?.state;
  const voices = status?.voices ?? [];
  const sounds = status?.sounds ?? [];

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
        <Mic size={18} style={{ color: '#f472b6' }} />
        <strong>Voicemod</strong>
        <StatusBadge state={state} />
        {state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            {voices.length} voice{voices.length === 1 ? '' : 's'} · {sounds.length} sound{sounds.length === 1 ? '' : 's'}
          </span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: alwaysOpen ? 0 : 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Voicemod integration</button>
          )}

          {state !== 'disabled' && (
            <>
              <details open={state !== 'connected'} style={{ fontSize: 13, color: '#d1d5db' }}>
                <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: get a client key from Voicemod</summary>
                <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                  <li>Visit Voicemod's <em>Control API</em> registration form (free, single-page).</li>
                  <li>Fill in your app details (name, contact); Voicemod emails a client key.</li>
                  <li>Paste it below + save. Make sure the Voicemod desktop app is running.</li>
                </ol>
                <a href="https://control-api.voicemod.net/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#60a5fa', display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                  Voicemod Control API portal <ExternalLink size={11} />
                </a>
              </details>

              <div style={grid}>
                <label style={lbl}>Host</label>
                <input value={hostDraft} onChange={(e) => setHostDraft(e.target.value)} placeholder="127.0.0.1" style={inp} spellCheck={false} autoCapitalize="off" />
                <label style={lbl}>Port</label>
                <input value={portDraft} onChange={(e) => setPortDraft(e.target.value)} placeholder="59129" style={inp} spellCheck={false} inputMode="numeric" />
                <label style={lbl}>Client key</label>
                <input
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder={config.hasClientKey ? '••• saved — paste to replace' : 'paste your Voicemod key'}
                  style={inp}
                  spellCheck={false}
                  autoCapitalize="off"
                  type="password"
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={save} disabled={busy} style={secondaryBtn}>Save</button>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
                {config.hasClientKey && (
                  <button onClick={clearKey} disabled={busy} style={{ ...secondaryBtn, background: '#7f1d1d', border: 0 }}>Clear key</button>
                )}
              </div>
            </>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#9ca3af' }}>
                <span>
                  Voice changer:{' '}
                  <span style={{ color: status?.voiceChangerEnabled ? '#22c55e' : '#6b7280' }}>
                    {status?.voiceChangerEnabled ? 'on' : 'off'}
                  </span>
                </span>
                <span>
                  Mic:{' '}
                  <span style={{ color: status?.micMuted ? '#f87171' : '#22c55e' }}>
                    {status?.micMuted ? 'muted' : 'live'}
                  </span>
                </span>
                {status?.currentVoiceId && (() => {
                  const cur = voices.find((v) => v.id === status.currentVoiceId);
                  return <span>Voice: <em>{cur?.friendlyName ?? status.currentVoiceId}</em></span>;
                })()}
              </div>
              {voices.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {voices.slice(0, 10).map((v) => (
                    <span
                      key={v.id}
                      title={v.isCustom ? 'Custom voice' : 'Built-in voice'}
                      style={{
                        padding: '2px 8px',
                        background: v.id === status?.currentVoiceId ? '#831843' : '#1f2937',
                        borderRadius: 4, fontSize: 12, color: '#e5e7eb',
                        border: v.id === status?.currentVoiceId ? '1px solid #ec4899' : '1px solid transparent',
                      }}
                    >
                      {v.favorited ? '★ ' : ''}{v.friendlyName}
                    </span>
                  ))}
                  {voices.length > 10 && (
                    <span style={{ fontSize: 12, color: '#6b7280' }}>+{voices.length - 10} more</span>
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
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ connecting' },
    disconnected:     { color: '#6b7280', label: '○ disconnected' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs config' },
    'needs-auth':     { color: '#eab308', label: '○ needs client key' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center', marginTop: 8 };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
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

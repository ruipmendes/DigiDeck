import { useEffect, useState } from 'react';
import { Sliders, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { VoicemeeterPublicConfig, VoicemeeterStatus } from '../lib/api';

export function VoicemeeterPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<VoicemeeterPublicConfig | null>(null);
  const [status, setStatus] = useState<VoicemeeterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);

  async function refresh() {
    try {
      const data = await api.getVoicemeeterState();
      setConfig(data.config);
      setStatus(data.status);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reconnect() {
    setBusy(true);
    try {
      const data = await api.reconnectVoicemeeter();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleEnabled() {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putVoicemeeterConfig({ enabled: !config.enabled });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const state = status?.state;
  const strips = status?.strips ?? [];
  const buses = status?.buses ?? [];

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
        <Sliders size={18} style={{ color: '#60a5fa' }} />
        <strong>Voicemeeter</strong>
        <StatusBadge state={state} />
        {state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            {status?.edition ? cap(status.edition) : ''}{status?.version ? ` · v${status.version}` : ''}
          </span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: alwaysOpen ? 0 : 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Voicemeeter integration</button>
          )}

          {state !== 'disabled' && (
            <>
              <details open={state !== 'connected'} style={{ fontSize: 13, color: '#d1d5db' }}>
                <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: install Voicemeeter, then launch it</summary>
                <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                  <li>Install <strong>Voicemeeter</strong>, <strong>Banana</strong>, or <strong>Potato</strong> from vb-audio.com (free, donationware).</li>
                  <li>Launch the Voicemeeter app. Digi Deck attaches within a couple of seconds — no config needed.</li>
                  <li>In Voicemeeter, set your inputs (mic, virtual VAIO for Discord/browsers, etc.) and route them to A1 (headphones) / B1 (stream capture in OBS) as you'd like.</li>
                </ol>
                <a href="https://vb-audio.com/Voicemeeter/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#60a5fa', display: 'inline-flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
                  Voicemeeter downloads <ExternalLink size={11} />
                </a>
              </details>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
              </div>
            </>
          )}

          {state === 'connected' && (strips.length > 0 || buses.length > 0) && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Strips</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {strips.map((s) => (
                  <div key={s.index} style={rowStyle}>
                    <span style={{ minWidth: 22, fontSize: 11, color: '#6b7280' }}>{s.index}</span>
                    <span style={{ minWidth: 130, color: s.mute ? '#f87171' : '#e5e7eb', fontWeight: s.physical ? 500 : 400 }}>
                      {s.label}{s.mute ? ' (M)' : ''}{s.solo ? ' (S)' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 55 }}>{s.gain.toFixed(1)} dB</span>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {Object.entries(s.routes).map(([r, on]) => (
                        <span key={r} style={routePill(!!on, r.startsWith('A'))}>{r}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 4 }}>Buses</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {buses.map((b) => (
                  <div key={b.index} style={rowStyle}>
                    <span style={{ minWidth: 22, fontSize: 11, color: '#6b7280' }}>{b.kind}</span>
                    <span style={{ minWidth: 130, color: b.mute ? '#f87171' : '#e5e7eb' }}>
                      {b.label}{b.mute ? ' (M)' : ''}
                    </span>
                    <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 55 }}>{b.gain.toFixed(1)} dB</span>
                  </div>
                ))}
              </div>
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

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function StatusBadge({ state }: { state?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ waiting for app' },
    disconnected:     { color: '#6b7280', label: '○ disconnected' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs config' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '3px 4px', fontSize: 12,
};
function routePill(on: boolean, isA: boolean): React.CSSProperties {
  return {
    padding: '1px 5px', borderRadius: 3, fontSize: 10, letterSpacing: 0.5,
    background: on ? (isA ? '#164e63' : '#312e81') : '#1f2937',
    color: on ? '#e5e7eb' : '#6b7280',
    border: on ? `1px solid ${isA ? '#0891b2' : '#6366f1'}` : '1px solid #374151',
  };
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#60a5fa', color: '#111',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

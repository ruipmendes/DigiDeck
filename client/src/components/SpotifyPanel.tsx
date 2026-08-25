import { useEffect, useState } from 'react';
import { Music, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Lock } from 'lucide-react';
import * as api from '../lib/api';
import type { SpotifyPublicConfig, SpotifyStatus } from '../lib/api';

export function SpotifyPanel() {
  const [config, setConfig] = useState<SpotifyPublicConfig | null>(null);
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getSpotifyState();
      setConfig(data.config);
      setStatus(data.status);
      setClientIdDraft((prev) => prev || data.config.clientId);
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

  async function saveCredentials() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.putSpotifyConfig({ enabled: true, clientId: clientIdDraft.trim() });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.getSpotifyAuthorize();
      window.open(url, '_blank');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from Spotify? You\'ll need to re-authorize to control playback.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectSpotify();
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
      const data = await api.reconnectSpotify();
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function recheckSubscription() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.recheckSpotifySubscription();
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
      const data = await api.putSpotifyConfig({ enabled: !config.enabled, clientId: config.clientId });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;
  const needsSetup = state === 'not-configured' || (state === 'needs-auth' && !config?.clientId);

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
        <Music size={18} style={{ color: '#1db954' }} />
        <strong>Spotify</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.username && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.username}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Spotify integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected{status?.username ? <>{' '}as <code style={codeStyle}>{status.username}</code></> : null}{' '}
              {config.isPremium
                ? <span style={{ fontSize: 11, color: '#1db954', textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 4 }}>· Premium</span>
                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 4 }}><Lock size={10} /> Free tier</span>
              }
              {!config.isPremium && (
                <div style={{ marginTop: 6, padding: '6px 8px', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, fontSize: 11, color: '#f59e0b', lineHeight: 1.5 }}>
                  Spotify's Web API requires the linked account (and the Developer app owner) to have Premium. Spotify tiles won't appear in the tile editor. If you upgrade, hit <em>Recheck</em> below and they'll reappear — no reconnect needed.
                </div>
              )}
              {status?.track && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {status.coverUrl && (
                    <img
                      src={status.coverUrl}
                      alt=""
                      style={{ width: 44, height: 44, borderRadius: 4, objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 13, color: '#fff' }}>
                      {status.isPlaying ? '▶︎ ' : '⏸ '}{status.track}
                    </span>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>{status.artist}</span>
                    {status.deviceName && (
                      <span style={{ fontSize: 11, color: '#6b7280' }}>on {status.deviceName}</span>
                    )}
                  </div>
                </div>
              )}
              {!status?.track && (
                <div style={{ marginTop: 6, fontSize: 12, color: '#9ca3af' }}>
                  Nothing playing. Start a track in any Spotify client to see it here.
                </div>
              )}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> refresh</button>
                {!config.isPremium && (
                  <button onClick={recheckSubscription} disabled={busy} style={secondaryBtn} title="Re-check your Spotify tier">
                    <RefreshCw size={14} /> recheck subscription
                  </button>
                )}
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
              </div>
            </div>
          )}

          {state === 'connecting' && (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>Connecting to Spotify…</div>
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

          {state === 'needs-auth' && !needsSetup && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Client ID saved. Click below to authorize the app on Spotify — a new tab will open.
              <div style={{ marginTop: 10 }}>
                <button onClick={connect} disabled={busy} style={primaryBtn}>
                  <ExternalLink size={14} /> Connect to Spotify
                </button>
              </div>
            </div>
          )}

          {needsSetup && (
            <details open={state === 'not-configured'} style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: Spotify Developer app</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Visit <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" style={{ color: '#1db954' }}>developer.spotify.com/dashboard</a> and click <em>Create app</em>.</li>
                <li>Give it a name (e.g. "Digi Deck") and any description.</li>
                <li>Set <strong>Redirect URI</strong> to: <code style={{ ...codeStyle, userSelect: 'all' }}>http://127.0.0.1:8765/api/integrations/spotify/callback</code></li>
                <li>Under <em>Which API/SDKs are you planning to use?</em>, tick <strong>Web API</strong>.</li>
                <li>Save. On the app's settings page, copy the <strong>Client ID</strong> and paste it below. (No client secret needed — Digi Deck uses PKCE.)</li>
              </ol>

              <div style={grid}>
                <label style={lbl}>Client ID</label>
                <input
                  value={clientIdDraft}
                  onChange={(e) => setClientIdDraft(e.target.value)}
                  style={inp}
                  placeholder="abcd1234efgh5678…"
                  autoComplete="off"
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={saveCredentials}
                  disabled={busy || !clientIdDraft.trim()}
                  style={primaryBtn}
                >
                  {busy ? 'Saving…' : 'Save Client ID'}
                </button>
              </div>
            </details>
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
    'not-configured': { color: '#6b7280', label: '○ needs setup' },
    'needs-auth':     { color: '#eab308', label: '○ needs auth' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center', marginTop: 8 };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const codeStyle: React.CSSProperties = { color: '#fff', background: '#0a0a0a', padding: '1px 6px', borderRadius: 4, fontSize: 12 };
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#1db954', color: '#fff',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
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

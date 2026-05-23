import { useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { TwitchPublicConfig, TwitchStatus } from '../lib/api';

export function TwitchPanel() {
  const [config, setConfig] = useState<TwitchPublicConfig | null>(null);
  const [status, setStatus] = useState<TwitchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [clientSecretDraft, setClientSecretDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getTwitchState();
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
      const data = await api.putTwitchConfig({
        enabled: true,
        clientId: clientIdDraft.trim(),
        clientSecret: clientSecretDraft.trim() || undefined,
      });
      setConfig(data.config);
      setStatus(data.status);
      setClientSecretDraft('');
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
      const { url } = await api.getTwitchAuthorize();
      window.open(url, '_blank');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from Twitch? You\'ll need to re-authorize to send chat messages.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectTwitch();
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
      const data = await api.reconnectTwitch();
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
      const data = await api.putTwitchConfig({
        enabled: !config.enabled,
        clientId: config.clientId,
      });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;
  const needsSetup = state === 'not-configured' || (state === 'needs-auth' && (!config?.clientId || !config?.hasSecret));

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
        <MessageCircle size={18} style={{ color: '#a78bfa' }} />
        <strong>Twitch chat</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.username && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>@{status.username}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Twitch integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected as <code style={codeStyle}>@{status?.username}</code> — chats go to <code style={codeStyle}>{status?.channel}</code>.
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
              </div>
            </div>
          )}

          {(state === 'connecting' || state === 'disconnected') && (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              {state === 'connecting' ? 'Connecting to Twitch IRC…' : 'Disconnected. Retrying every few seconds.'}
              <div style={{ marginTop: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect now</button>
              </div>
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

          {state === 'needs-auth' && !needsSetup && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Credentials saved. Click below to authorize the app on Twitch — a new tab will open.
              <div style={{ marginTop: 10 }}>
                <button onClick={connect} disabled={busy} style={primaryBtn}>
                  <ExternalLink size={14} /> Connect to Twitch
                </button>
              </div>
            </div>
          )}

          {needsSetup && (
            <details open={state === 'not-configured'} style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: Twitch Developer app</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Visit <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>dev.twitch.tv/console/apps</a> → <em>Register Your Application</em>.</li>
                <li>Set <strong>OAuth Redirect URL</strong> to: <code style={{ ...codeStyle, userSelect: 'all' }}>http://localhost:8765/api/integrations/twitch/callback</code></li>
                <li>Category: <em>Application Integration</em>. Click <em>Create</em>.</li>
                <li>Copy the <strong>Client ID</strong>; click <em>New Secret</em> and copy that too.</li>
                <li>Paste both below.</li>
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
                <label style={lbl}>Client Secret</label>
                <input
                  type="password"
                  value={clientSecretDraft}
                  onChange={(e) => setClientSecretDraft(e.target.value)}
                  style={inp}
                  placeholder={config.hasSecret ? '(saved — leave blank to keep)' : 'paste secret from Twitch console'}
                  autoComplete="off"
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={saveCredentials}
                  disabled={busy || !clientIdDraft.trim() || (!config.hasSecret && !clientSecretDraft.trim())}
                  style={primaryBtn}
                >
                  {busy ? 'Saving…' : 'Save credentials'}
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
    disconnected:     { color: '#9ca3af', label: '× disconnected' },
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
  padding: '8px 14px', background: '#a78bfa', color: '#fff',
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

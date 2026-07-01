import { useEffect, useState } from 'react';
import { MessageCircle, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { KickPublicConfig, KickStatus } from '../lib/api';

export function KickPanel() {
  const [config, setConfig] = useState<KickPublicConfig | null>(null);
  const [status, setStatus] = useState<KickStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState('');
  const [clientSecretDraft, setClientSecretDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getKickState();
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
      const data = await api.putKickConfig({
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
      const { url } = await api.getKickAuthorize();
      window.open(url, '_blank');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from Kick? You\'ll need to re-authorize to send chat messages.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectKick();
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
      const data = await api.reconnectKick();
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
      const data = await api.putKickConfig({
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
        <MessageCircle size={18} style={{ color: '#53fc18' }} />
        <strong>Kick chat</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.slug && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.slug}</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Kick integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected as <code style={codeStyle}>{status?.slug}</code> — chats go to <code style={codeStyle}>{status?.channel}</code>.
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
              </div>
            </div>
          )}

          {state === 'connecting' && (
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              Connecting to Kick…
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
              Credentials saved. Click below to authorize the app on Kick — a new tab will open.
              <div style={{ marginTop: 10 }}>
                <button onClick={connect} disabled={busy} style={primaryBtn}>
                  <ExternalLink size={14} /> Connect to Kick
                </button>
              </div>
            </div>
          )}

          {needsSetup && (
            <details open={state === 'not-configured'} style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: Kick Developer app</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Visit <a href="https://kick.com/settings/developer" target="_blank" rel="noreferrer" style={{ color: '#53fc18' }}>kick.com/settings/developer</a> → <em>Create a new application</em>.</li>
                <li>Set <strong>Redirect URI</strong> to: <code style={{ ...codeStyle, userSelect: 'all' }}>http://localhost:8765/api/integrations/kick/callback</code></li>
                <li>Enable the <strong>user:read</strong>, <strong>channel:read</strong>, and <strong>chat:write</strong> scopes.</li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> after creating.</li>
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
                  placeholder={config.hasSecret ? '(saved — leave blank to keep)' : 'paste secret from Kick console'}
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
  padding: '8px 14px', background: '#53fc18', color: '#000',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600,
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

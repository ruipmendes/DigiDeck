import { useEffect, useMemo, useState } from 'react';
import { HomeIcon, RefreshCw, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import * as api from '../lib/api';
import type { HomeAssistantPublicConfig, HomeAssistantStatus } from '../lib/api';

export function HomeAssistantPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<HomeAssistantPublicConfig | null>(null);
  const [status, setStatus] = useState<HomeAssistantStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [urlDraft, setUrlDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getHomeAssistantState();
      setConfig(data.config);
      setStatus(data.status);
      setUrlDraft((prev) => prev || data.config.baseUrl);
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
      const data = await api.putHomeAssistantConfig({
        enabled: true,
        baseUrl: urlDraft.trim(),
        token: tokenDraft.trim() || undefined,
      });
      setConfig(data.config);
      setStatus(data.status);
      setTokenDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect from Home Assistant? Digi Deck will forget the access token.')) return;
    setBusy(true);
    try {
      const data = await api.disconnectHomeAssistant();
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
      const data = await api.reconnectHomeAssistant();
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
      const data = await api.putHomeAssistantConfig({ enabled: !config.enabled, baseUrl: config.baseUrl });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = status?.state;

  // Grouped entity summary — how many of each domain are exposed. Helps
  // users confirm the token has access to what they expect.
  const entitySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of status?.entities ?? []) counts[e.domain] = (counts[e.domain] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  }, [status?.entities]);

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
        <HomeIcon size={18} style={{ color: '#41bdf5' }} />
        <strong>Home Assistant</strong>
        <StatusBadge state={state} />
        {state === 'connected' && status?.entities && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{status.entities.length} entities</span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Home Assistant integration</button>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              Connected to <code style={codeStyle}>{status?.baseUrl}</code>
              {status?.version && <span style={{ marginLeft: 4, color: '#9ca3af' }}>· HA {status.version}</span>}
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#9ca3af' }}>
                {entitySummary.map(([domain, count]) => (
                  <span key={domain} style={{ padding: '2px 8px', background: '#1f2937', borderRadius: 4 }}>
                    {count} {domain}
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> refresh</button>
                <button onClick={disconnect} disabled={busy} style={dangerBtn}>Disconnect</button>
              </div>
            </div>
          )}

          {(state === 'not-configured' || state === 'needs-auth' || state === 'error') && (
            <details open style={{ fontSize: 13, color: '#d1d5db' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Setup: URL + Long-Lived Access Token</summary>
              <ol style={{ marginTop: 8, paddingLeft: 20, color: '#9ca3af', fontSize: 12, lineHeight: 1.6 }}>
                <li>Your HA URL — usually something like <code style={codeStyle}>http://homeassistant.local:8123</code> (or the LAN IP + port 8123).</li>
                <li>In HA: click your profile avatar (bottom-left) → <strong>Security</strong> tab → scroll to <strong>Long-Lived Access Tokens</strong> → <em>Create Token</em>. Copy the whole string — you can only see it once. <a href="https://my.home-assistant.io/redirect/profile_security/" target="_blank" rel="noreferrer" style={{ color: '#a78bfa', display: 'inline-flex', alignItems: 'center', gap: 3 }}>Open Profile <ExternalLink size={11} /></a></li>
                <li>Paste both below and click <em>Save</em>. Digi Deck verifies the connection and lists your entities.</li>
              </ol>
              <div style={grid}>
                <label style={lbl}>URL</label>
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="http://homeassistant.local:8123"
                  style={inp}
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <label style={lbl}>Token</label>
                <input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder={config.hasToken ? '(saved — leave blank to keep)' : 'paste long-lived access token'}
                  style={inp}
                  autoComplete="off"
                />
              </div>
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={save}
                  disabled={busy || !urlDraft.trim() || (!config.hasToken && !tokenDraft.trim())}
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
    error:            { color: '#ef4444', label: 'Ã— error' },
    disabled:         { color: '#6b7280', label: 'â—‹ disabled' },
    'not-configured': { color: '#6b7280', label: 'â—‹ needs URL' },
    'needs-auth':     { color: '#eab308', label: 'â—‹ needs token' },
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
  padding: '8px 14px', background: '#41bdf5', color: '#fff',
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

import { useEffect, useState } from 'react';
import { Tv, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import * as api from '../lib/api';
import type { StreamlabsPublicConfig, StreamlabsStatus } from '../lib/api';

export function StreamlabsPanel() {
  const [config, setConfig] = useState<StreamlabsPublicConfig | null>(null);
  const [status, setStatus] = useState<StreamlabsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Token edits are tracked locally; we only send it on save when non-empty so we
  // don't have to round-trip the secret through the wire on every fetch.
  const [tokenDraft, setTokenDraft] = useState<string>('');

  async function refresh() {
    try {
      const data = await api.getStreamlabsState();
      setConfig((prev) => prev ?? data.config);
      setStatus(data.status);
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
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.putStreamlabsConfig({
        enabled: config.enabled,
        host: config.host,
        port: config.port,
        token: tokenDraft.length > 0 ? tokenDraft : undefined,
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

  async function reconnect() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.reconnectStreamlabs();
      setStatus(data.status);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const showInlineRetry =
    status?.state === 'error' ||
    status?.state === 'disconnected' ||
    !!status?.retryStopped;

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 14 }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpanded((p) => !p); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', color: '#fff',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Tv size={18} />
        <strong>Streamlabs Desktop</strong>
        <StatusBadge state={status?.state} />
        {status?.retryStopped && (
          <span style={{ fontSize: 11, color: '#f59e0b' }}>retries paused</span>
        )}
        {showInlineRetry && (
          <button
            onClick={(e) => { e.stopPropagation(); void reconnect(); }}
            disabled={busy}
            title={status?.retryStopped ? 'auto-retries stopped — try now' : 'try connecting now'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: status?.retryStopped ? '3px 9px' : '3px 7px',
              background: status?.retryStopped ? '#1d4ed8' : 'transparent',
              color: '#fff',
              border: `1px solid ${status?.retryStopped ? '#3b82f6' : '#374151'}`,
              borderRadius: 6, fontSize: 11, cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            <RefreshCw size={11} />
            {status?.retryStopped ? 'retry' : ''}
          </button>
        )}
        {status?.state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            {status.scenes.length} scenes · {status.inputs.length} inputs
          </span>
        )}
      </div>

      {status?.error && status.state !== 'connected' && (
        <div style={{ fontSize: 12, color: '#f87171', marginTop: 8, marginLeft: 26 }}>{status.error}</div>
      )}

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={row}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            <span>Enable Streamlabs integration</span>
          </label>

          <div style={grid}>
            <label style={lbl}>Host</label>
            <input
              value={config.host}
              onChange={(e) => setConfig({ ...config, host: e.target.value })}
              style={inp}
              placeholder="127.0.0.1"
            />
            <label style={lbl}>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => setConfig({ ...config, port: Number(e.target.value) || 59650 })}
              style={inp}
            />
            <label style={lbl}>Token</label>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              style={inp}
              placeholder={config.hasToken ? '(token saved — leave blank to keep)' : 'paste API token from Streamlabs'}
              autoComplete="off"
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={busy} style={primaryBtn}>
              {busy ? 'Saving…' : 'Save & reconnect'}
            </button>
            <button onClick={reconnect} disabled={busy} style={secondaryBtn}>
              <RefreshCw size={14} /> reconnect
            </button>
          </div>

          <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
            In Streamlabs Desktop: <strong>Settings → Remote Control → show details</strong>. Copy the token and paste it above. Default port is <code>59650</code>.
          </div>

          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:    { color: '#22c55e', label: '● connected' },
    connecting:   { color: '#eab308', label: '○ connecting' },
    disconnected: { color: '#9ca3af', label: '× disconnected' },
    error:        { color: '#ef4444', label: '× error' },
    disabled:     { color: '#6b7280', label: '○ disabled' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e5e7eb' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, alignItems: 'center' };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#3b82f6', color: '#fff',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  padding: '8px 12px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 6,
};

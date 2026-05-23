import { useEffect, useState } from 'react';
import { useMacroWS } from './ws';
import { ButtonGrid } from './components/ButtonGrid';
import { readUrlTokenAndStore, getStoredToken, clearToken } from './lib/token';

const STORAGE_KEY = 'digi-deck:ws_url';
const defaultUrl = () => `ws://${window.location.hostname}:8765`;

export function GridApp() {
  const [token, setToken] = useState<string | null>(() => {
    const fromUrl = readUrlTokenAndStore();
    return fromUrl ?? getStoredToken();
  });
  const [url, setUrl] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? defaultUrl(),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const { status, layout, lastAck, buttonStates, press } = useMacroWS(url, token);

  useEffect(() => {
    document.title = 'Digi Deck';
  }, []);

  if (!token) return <NotPaired />;

  const statusLabel =
    status === 'open' ? '● connected'
      : status === 'connecting' ? '○ connecting'
      : '× disconnected';
  const statusColor =
    status === 'open' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444';

  function saveUrl(e: React.FormEvent) {
    e.preventDefault();
    if (draft === null) return;
    const trimmed = draft.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    setUrl(trimmed);
    setDraft(null);
  }

  function unpair() {
    if (!confirm('Forget the auth token? You\'ll need to scan the QR again.')) return;
    clearToken();
    setToken(null);
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 16 }}>Digi Deck</strong>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={unpair}
            style={{ fontSize: 12, color: '#9ca3af', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}
            title="forget auth token"
          >
            unpair
          </button>
          <a href="/config" style={{ fontSize: 12, color: '#9ca3af', textDecoration: 'none' }}>⚙ config</a>
          <span style={{ fontSize: 12, color: statusColor }}>{statusLabel}</span>
        </div>
      </header>

      {draft !== null ? (
        <form onSubmit={saveUrl} style={{ display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ws://192.168.1.10:8765"
            style={{ flex: 1, padding: 8, fontSize: 14, background: '#1f1f1f', color: '#fff', border: '1px solid #333', borderRadius: 6 }}
            autoFocus
          />
          <button type="submit" style={{ padding: '8px 12px', background: '#3b82f6', border: 0, borderRadius: 6, color: '#fff' }}>Save</button>
          <button type="button" onClick={() => setDraft(null)} style={{ padding: '8px 12px', background: '#333', border: 0, borderRadius: 6, color: '#fff' }}>Cancel</button>
        </form>
      ) : (
        <button
          onClick={() => setDraft(url)}
          style={{ fontSize: 12, opacity: 0.6, alignSelf: 'flex-start', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: '#fff' }}
        >
          {url} ✎
        </button>
      )}

      <ButtonGrid layout={layout} lastAck={lastAck} buttonStates={buttonStates} onPress={press} />
    </div>
  );
}

function NotPaired() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, height: '100%', padding: 24, textAlign: 'center', color: '#e5e7eb',
    }}>
      <div style={{ fontSize: 48, opacity: 0.6 }}>🔒</div>
      <h2 style={{ margin: 0 }}>Not paired</h2>
      <p style={{ color: '#9ca3af', fontSize: 14, maxWidth: 320, lineHeight: 1.5 }}>
        On your PC, open <code style={{ color: '#fff' }}>http://localhost:5173/config</code>,
        click <strong>Pair phone</strong>, and scan the QR code with this device's camera.
      </p>
    </div>
  );
}

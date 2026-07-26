import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Shield, AlertTriangle } from 'lucide-react';
import * as api from '../lib/api';

/**
 * Compact panel exposing the shell-actions toggle. When off, `script` (PowerShell)
 * and `launch` actions refuse to fire — reduces blast radius if a future auth
 * gap ever exposes the WebSocket / API to an untrusted caller.
 */
export function SecurityPanel() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getSecurityConfig()
      .then((c) => { if (alive) setEnabled(!!c.allowShellActions); })
      .catch((e) => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      const next = !enabled;
      const c = await api.putSecurityConfig({ allowShellActions: next });
      setEnabled(!!c.allowShellActions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          background: 'transparent',
          border: 0,
          color: '#fff',
          cursor: 'pointer',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Shield size={16} />
        <strong style={{ fontSize: 14 }}>Security</strong>
        <span style={{ marginLeft: 12, fontSize: 12, color: enabled === false ? '#22c55e' : '#9ca3af' }}>
          {enabled === null ? '…' : enabled ? 'shell actions enabled' : 'shell actions disabled'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px 40px', color: '#d1d5db', fontSize: 13, lineHeight: 1.5 }}>
          <p style={{ marginTop: 0 }}>
            <strong>Shell actions</strong> — <em>Launch</em> (open any executable) and{' '}
            <em>Run PowerShell</em> (execute an arbitrary script). Turn these off to shrink the
            blast radius: if the tool ever gets tricked into firing a tile you didn't press, the
            worst it can do is send keystrokes or open URLs — no code execution.
          </p>
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: enabled ? '#1f2937' : '#0f2419',
              border: `1px solid ${enabled ? '#374151' : '#166534'}`,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
              <input
                type="checkbox"
                checked={!!enabled}
                disabled={busy || enabled === null}
                onChange={toggle}
                style={{ transform: 'scale(1.2)' }}
              />
              <span style={{ color: '#e5e7eb', fontWeight: 600 }}>
                Allow shell actions (Launch + Run PowerShell)
              </span>
            </label>
          </div>
          {enabled && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} />
              Any tile with a Launch or PowerShell step can run arbitrary code on this PC.
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

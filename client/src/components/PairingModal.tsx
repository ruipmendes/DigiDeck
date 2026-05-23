import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import * as api from '../lib/api';
import type { Pairing } from '../lib/api';

type Props = { open: boolean; onClose: () => void };

export function PairingModal({ open, onClose }: Props) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPairing(null);
    setError(null);
    api.getPairing()
      .then(setPairing)
      .catch((e) => setError((e as Error).message));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111827',
          borderRadius: 12,
          padding: 24,
          maxWidth: 520,
          width: '100%',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <button
          onClick={onClose}
          aria-label="close"
          style={{
            position: 'absolute', top: 12, right: 12,
            background: 'transparent', border: 0,
            color: '#9ca3af', cursor: 'pointer', padding: 4,
          }}
        >
          <X size={20} />
        </button>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Pair a phone</h2>
        <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 0 }}>
          Open your phone's camera (same Wi-Fi) and scan a QR code below. The PWA opens and remembers the auth token, so future visits just work.
        </p>

        {error && (
          <div style={{ background: '#7f1d1d', color: '#fee2e2', padding: 12, borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {!pairing && !error && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>
        )}

        {pairing && pairing.urls.length === 0 && (
          <div style={{ color: '#fbbf24', fontSize: 13 }}>
            No LAN IPs detected. Make sure Wi-Fi / Ethernet is connected.
          </div>
        )}

        {pairing && pairing.urls.map((url) => (
          <div
            key={url}
            style={{
              display: 'flex', gap: 16, alignItems: 'center',
              padding: 12, marginTop: 12,
              background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 10,
            }}
          >
            <div style={{ background: '#fff', padding: 8, borderRadius: 8, flexShrink: 0 }}>
              <QRCodeSVG value={url} size={140} level="M" />
            </div>
            <div style={{ fontSize: 12, color: '#d1d5db', wordBreak: 'break-all', fontFamily: 'monospace' }}>
              {url}
            </div>
          </div>
        ))}

        {pairing && (
          <details style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
            <summary style={{ cursor: 'pointer' }}>show token</summary>
            <code style={{ display: 'block', marginTop: 6, padding: 8, background: '#0a0a0a', borderRadius: 6, wordBreak: 'break-all' }}>
              {pairing.token}
            </code>
          </details>
        )}
      </div>
    </div>
  );
}

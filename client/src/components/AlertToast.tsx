import { useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import type { AlertMessage } from '../ws';

/**
 * Deck-wide alert banner — slides down from the top of the viewport whenever
 * the server fires an `alert` message (sub / raid / cheer / follow / stream
 * start-stop). Auto-dismisses after 5 s; tapping the X dismisses early.
 * Several alerts stack vertically if they land in a burst.
 *
 * Positioned `fixed` with a high z-index so it floats over whatever page the
 * deck has open — fixes the "wrong page" visibility problem a per-tile flash
 * would have had.
 */

const AUTO_DISMISS_MS = 5_000;

const EVENT_ACCENT: Record<string, string> = {
  'twitch.raid':           '#f59e0b',
  'twitch.subscribe':      '#a78bfa',
  'twitch.cheer':          '#22c55e',
  'twitch.follow':         '#38bdf8',
  'twitch.stream-online':  '#22c55e',
  'twitch.stream-offline': '#9ca3af',
};

export function AlertToastStack({
  alerts,
  onDismiss,
}: {
  alerts: AlertMessage[];
  onDismiss: (id: number) => void;
}) {
  if (alerts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0px)',
        left: 0,
        right: 0,
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: 10,
        pointerEvents: 'none',
      }}
    >
      {alerts.map((a) => (
        <AlertToast key={a.id} alert={a} onDismiss={() => onDismiss(a.id)} />
      ))}
    </div>
  );
}

function AlertToast({ alert, onDismiss }: { alert: AlertMessage; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const accent = EVENT_ACCENT[alert.event] ?? '#a78bfa';
  return (
    <div
      role="status"
      style={{
        pointerEvents: 'auto',
        background: '#111827',
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 420,
        width: '92%',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        color: '#fff',
        animation: 'digi-alert-in 180ms ease-out',
      }}
    >
      <Bell size={16} style={{ color: accent, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {alert.title}
        </div>
        {alert.body && (
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {alert.body}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="dismiss alert"
        style={{
          background: 'transparent',
          border: 0,
          color: '#9ca3af',
          cursor: 'pointer',
          padding: 4,
          flexShrink: 0,
        }}
      >
        <X size={16} />
      </button>
      <style>{`@keyframes digi-alert-in { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  );
}

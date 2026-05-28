import { useEffect } from 'react';
import { Eye, Check, X } from 'lucide-react';
import * as api from '../lib/api';

type Props = {
  title: string;
  /** If provided, shows an "Apply" button. */
  onApply?: () => void;
  /** If provided, shows an "Exit" button. */
  onExit?: () => void;
  /** Subtle subtitle. Defaults to "taps are inactive on the phone". */
  subtitle?: string;
  /** Use the compact, no-action variant intended for the phone grid. */
  compact?: boolean;
};

export function PreviewBanner({ title, onApply, onExit, subtitle, compact }: Props) {
  return (
    <div
      role="status"
      style={{
        background: 'linear-gradient(90deg, #4c1d95 0%, #5b21b6 100%)',
        border: '1px solid #6d28d9',
        borderRadius: 8,
        padding: compact ? '8px 12px' : '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: '#fff',
        flexWrap: 'wrap',
      }}
    >
      <Eye size={compact ? 14 : 16} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: compact ? 12 : 13, fontWeight: 600 }}>
          Previewing: {title}
        </span>
        {!compact && (
          <span style={{ fontSize: 11, color: '#e9d5ff' }}>
            {subtitle ?? 'taps on the phone are inactive while previewing'}
          </span>
        )}
      </div>
      {onExit && (
        <button
          onClick={onExit}
          style={bannerBtnStyle('#1f1f1f', '#4b5563')}
          title="exit preview without applying"
        >
          <X size={14} /> Exit
        </button>
      )}
      {onApply && (
        <button
          onClick={onApply}
          style={bannerBtnStyle('#22c55e', '#16a34a')}
          title="apply this layout permanently"
        >
          <Check size={14} /> Apply
        </button>
      )}
    </div>
  );
}

/** Heartbeat hook: pings every 10s while `active` is true; also fires a beacon on unload. */
export function usePreviewHeartbeat(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void api.heartbeatPreview();
    const t = setInterval(() => { void api.heartbeatPreview(); }, 10_000);
    const onUnload = () => { api.exitPreviewBeacon(); };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [active]);
}

function bannerBtnStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: '6px 12px',
    background: bg,
    color: '#fff',
    border: `1px solid ${border}`,
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };
}

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Plug } from 'lucide-react';
import * as api from '../lib/api';
import { ObsPanel } from './ObsPanel';
import { StreamlabsPanel } from './StreamlabsPanel';
import { TwitchPanel } from './TwitchPanel';

type StatusKind = 'connected' | 'connecting' | 'disconnected' | 'error' | 'disabled' | 'needs-auth' | 'not-configured';

type Summary = {
  obs:        { enabled: boolean; state: StatusKind };
  streamlabs: { enabled: boolean; state: StatusKind };
  twitch:     { enabled: boolean; state: StatusKind };
};

const DEFAULT_SUMMARY: Summary = {
  obs:        { enabled: false, state: 'disabled' },
  streamlabs: { enabled: false, state: 'disabled' },
  twitch:     { enabled: false, state: 'disabled' },
};

/**
 * Integrations are collapsed by default — most users set them up once
 * and rarely touch them. A one-row summary shows status at a glance;
 * click to expand into the existing per-integration cards.
 *
 * The summary row polls its own status independently of the cards (cheap,
 * localhost-only calls); the cards continue to poll themselves while
 * mounted. No double work while the panel is collapsed.
 */
export function IntegrationsPanel() {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary>(DEFAULT_SUMMARY);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [obs, sl, tw] = await Promise.all([
          api.getObsState().catch(() => null),
          api.getStreamlabsState().catch(() => null),
          api.getTwitchState().catch(() => null),
        ]);
        if (!alive) return;
        setSummary({
          obs:        { enabled: !!obs?.config.enabled, state: (obs?.status.state as StatusKind) ?? 'disabled' },
          streamlabs: { enabled: !!sl?.config.enabled,  state: (sl?.status.state  as StatusKind) ?? 'disabled' },
          twitch:     { enabled: !!tw?.config.enabled,  state: (tw?.status.state  as StatusKind) ?? 'disabled' },
        });
      } catch { /* harmless */ }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

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
        <Plug size={16} />
        <strong style={{ fontSize: 14 }}>Integrations</strong>
        <span style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 12, flexWrap: 'wrap' }}>
          <Pill name="OBS"        s={summary.obs} />
          <Pill name="Streamlabs" s={summary.streamlabs} />
          <Pill name="Twitch"     s={summary.twitch} />
        </span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ObsPanel />
          <StreamlabsPanel />
          <TwitchPanel />
        </div>
      )}
    </div>
  );
}

function Pill({ name, s }: { name: string; s: { enabled: boolean; state: StatusKind } }) {
  const { color, label } = describe(s);
  return (
    <span
      title={`${name}: ${label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#e5e7eb' }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: color === '#22c55e' ? '0 0 6px rgba(34,197,94,0.6)' : 'none' }} />
      {name}
    </span>
  );
}

function describe(s: { enabled: boolean; state: StatusKind }): { color: string; label: string } {
  if (!s.enabled)                  return { color: '#374151', label: 'not enabled' };
  switch (s.state) {
    case 'connected':              return { color: '#22c55e', label: 'connected' };
    case 'connecting':              return { color: '#eab308', label: 'connecting…' };
    case 'needs-auth':              return { color: '#eab308', label: 'needs auth' };
    case 'not-configured':          return { color: '#eab308', label: 'not configured' };
    case 'disconnected':            return { color: '#9ca3af', label: 'disconnected' };
    case 'error':                   return { color: '#ef4444', label: 'error' };
    case 'disabled': default:       return { color: '#374151', label: 'disabled' };
  }
}

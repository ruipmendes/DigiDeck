import { useEffect, useState } from 'react';
import { Rocket, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import * as api from '../lib/api';
import type { EliteDangerousPublicConfig, EliteDangerousStatus, EliteMission } from '../lib/api';

export function EliteDangerousPanel({ alwaysOpen = false }: { alwaysOpen?: boolean } = {}) {
  const [config, setConfig] = useState<EliteDangerousPublicConfig | null>(null);
  const [status, setStatus] = useState<EliteDangerousStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(alwaysOpen);
  const [pathDraft, setPathDraft] = useState('');

  async function refresh() {
    try {
      const data = await api.getEliteDangerousState();
      setConfig(data.config);
      setStatus(data.status);
      setPathDraft((prev) => prev || data.config.journalPath);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.putEliteDangerousConfig({ enabled: true, journalPath: pathDraft.trim() });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const data = await api.reconnectEliteDangerous();
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function toggleEnabled() {
    if (!config) return;
    setBusy(true);
    try {
      const data = await api.putEliteDangerousConfig({ enabled: !config.enabled, journalPath: config.journalPath });
      setConfig(data.config);
      setStatus(data.status);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const state = status?.state;

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
        <Rocket size={18} style={{ color: '#f97316' }} />
        <strong>Elite Dangerous</strong>
        <StatusBadge state={state} />
        {state === 'connected' && (
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            {status?.commander ? `CMDR ${status.commander}` : 'watching journal'}
          </span>
        )}
      </button>

      {expanded && config && (
        <div style={{ marginTop: 14, marginLeft: alwaysOpen ? 0 : 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {state === 'disabled' && (
            <button onClick={toggleEnabled} disabled={busy} style={primaryBtn}>Enable Elite Dangerous integration</button>
          )}

          {state !== 'disabled' && (
            <>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                Read-only integration — watches Elite's Journal + Status.json so dynamic labels ({'{'}elite.system{'}'}, {'{'}elite.fuelPercent{'}'}, …) and chart tiles work. No output API; use hotkey actions for in-game controls.
              </div>
              <div style={grid}>
                <label style={lbl}>Journal path</label>
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  placeholder="C:\\Users\\<you>\\Saved Games\\Frontier Developments\\Elite Dangerous"
                  style={inp}
                  spellCheck={false}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={save} disabled={busy} style={secondaryBtn}>Save</button>
                <button onClick={reconnect} disabled={busy} style={secondaryBtn}><RefreshCw size={14} /> reconnect</button>
              </div>
            </>
          )}

          {state === 'connected' && (
            <div style={{ fontSize: 13, color: '#d1d5db' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12 }}>
                {status?.commander && (<><span style={metaKey}>Commander</span><span>{status.commander}</span></>)}
                {status?.ship && (<><span style={metaKey}>Ship</span><span>{status.shipName ? `${status.shipName} (${status.ship})` : status.ship}</span></>)}
                {status?.system && (<><span style={metaKey}>System</span><span>{status.system}{status.station ? ` · ${status.station}` : ''}</span></>)}
                {status?.credits !== undefined && (<><span style={metaKey}>Credits</span><span>{status.credits.toLocaleString()} Cr</span></>)}
                {status?.fuelMain !== undefined && (
                  <>
                    <span style={metaKey}>Fuel</span>
                    <span>
                      {status.fuelMain.toFixed(2)} t
                      {status.fuelCapacity ? ` / ${status.fuelCapacity} t (${Math.round((status.fuelMain / status.fuelCapacity) * 100)}%)` : ''}
                    </span>
                  </>
                )}
                {status?.cargoTons !== undefined && (<><span style={metaKey}>Cargo</span><span>{status.cargoTons} t</span></>)}
              </div>
              {status?.flags && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {activeFlagLabels(status.flags).map((f) => (
                    <span key={f} style={flagPill}>{f}</span>
                  ))}
                </div>
              )}
              {status?.missions && status.missions.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 0.5, marginBottom: 4 }}>
                    ACTIVE MISSIONS ({status.missions.length}
                    {status?.missionTotalReward ? ` · ${formatCredits(status.missionTotalReward)} pending` : ''})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {status.missions.slice(0, 8).map((m) => (
                      <MissionRow key={m.missionId} m={m} />
                    ))}
                    {status.missions.length > 8 && (
                      <span style={{ fontSize: 11, color: '#6b7280' }}>+{status.missions.length - 8} more</span>
                    )}
                  </div>
                </div>
              )}
              {status?.activeJournal && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>tailing {status.activeJournal}</div>
              )}
            </div>
          )}

          {state === 'error' && (
            <div style={{ fontSize: 12, color: '#f87171' }}>{status?.error || 'Unknown error'}</div>
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

/** Only surface flags that are currently on — the "active flight state" view
 *  the panel wants. Ordered by ~streamer relevance. */
function activeFlagLabels(f: NonNullable<EliteDangerousStatus['flags']>): string[] {
  const out: string[] = [];
  if (f.docked) out.push('DOCKED');
  else if (f.landed) out.push('LANDED');
  else if (f.supercruise) out.push('SUPERCRUISE');
  if (f.hardpointsDeployed) out.push('HARDPOINTS');
  if (f.cargoScoopDeployed) out.push('SCOOP DOWN');
  if (f.scoopingFuel) out.push('FUEL SCOOP');
  if (f.landingGearDown) out.push('GEAR');
  if (f.silentRunning) out.push('SILENT');
  if (f.nightVision) out.push('NIGHT VISION');
  if (f.fsdCharging) out.push('FSD CHARGE');
  if (f.fsdCooldown) out.push('FSD COOL');
  if (f.lowFuel) out.push('LOW FUEL');
  if (f.overHeating) out.push('OVERHEAT');
  return out;
}

function MissionRow({ m }: { m: EliteMission }) {
  const [now, setNow] = useState(Date.now());
  // Local 1 Hz tick so the "expires in" countdown updates smoothly between
  // server broadcasts — same trick the OBS recording-time label uses.
  useEffect(() => {
    if (m.expiresAt === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [m.expiresAt]);
  const remaining = m.expiresAt !== undefined ? Math.max(0, m.expiresAt - now) : undefined;
  const expiredSoon = remaining !== undefined && remaining < 10 * 60 * 1000; // < 10 min
  const dest = m.destinationSystem
    ? (m.destinationStation ? `${m.destinationSystem} · ${m.destinationStation}` : m.destinationSystem)
    : '';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 6,
      padding: '4px 6px',
      background: '#111827',
      borderRadius: 4,
      fontSize: 12,
      opacity: m.detailed ? 1 : 0.75,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.localisedName || m.name || `Mission ${m.missionId}`}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.faction}{dest ? ` → ${dest}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 90 }}>
        {m.reward !== undefined && (
          <span style={{ fontSize: 11, color: '#22c55e' }}>{formatCredits(m.reward)}</span>
        )}
        {remaining !== undefined && (
          <span style={{ fontSize: 10, color: expiredSoon ? '#f87171' : '#9ca3af' }}>
            {formatCountdown(remaining)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatCredits(cr: number): string {
  if (cr >= 1_000_000_000) return `${(cr / 1_000_000_000).toFixed(2)}B Cr`;
  if (cr >= 1_000_000)     return `${(cr / 1_000_000).toFixed(2)}M Cr`;
  if (cr >= 1_000)         return `${(cr / 1_000).toFixed(0)}k Cr`;
  return `${cr} Cr`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function StatusBadge({ state }: { state?: string }) {
  const map: Record<string, { color: string; label: string }> = {
    connected:        { color: '#22c55e', label: '● connected' },
    connecting:       { color: '#eab308', label: '○ connecting' },
    disconnected:     { color: '#6b7280', label: '○ disconnected' },
    error:            { color: '#ef4444', label: '× error' },
    disabled:         { color: '#6b7280', label: '○ disabled' },
    'not-configured': { color: '#6b7280', label: '○ needs config' },
  };
  const m = map[state ?? ''] ?? { color: '#fff', label: state ?? '?' };
  return <span style={{ fontSize: 12, color: m.color }}>{m.label}</span>;
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center', marginTop: 8 };
const lbl: React.CSSProperties = { fontSize: 13, color: '#9ca3af' };
const inp: React.CSSProperties = {
  padding: '8px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13,
};
const metaKey: React.CSSProperties = { color: '#6b7280' };
const flagPill: React.CSSProperties = {
  padding: '1px 6px', background: '#7c2d12', color: '#fed7aa',
  borderRadius: 3, fontSize: 10, letterSpacing: 0.5, border: '1px solid #ea580c',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', background: '#f97316', color: '#111',
  border: 0, borderRadius: 6, fontSize: 14, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 500,
};
const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};

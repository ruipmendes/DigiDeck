import { useEffect, useState } from 'react';
import type { Action, VoicemeeterOp, VoicemeeterRoute } from '../../lib/types';
import * as api from '../../lib/api';
import type { VoicemeeterStrip, VoicemeeterBus } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

const OP_GROUPS: { label: string; ops: { value: VoicemeeterOp; label: string; needs: 'strip' | 'strip-route' | 'bus' | 'none' }[] }[] = [
  {
    label: 'Strips (inputs)',
    ops: [
      { value: 'strip-mute-toggle',  label: 'Toggle strip mute…',          needs: 'strip' },
      { value: 'strip-mute',         label: 'Mute strip…',                 needs: 'strip' },
      { value: 'strip-unmute',       label: 'Unmute strip…',               needs: 'strip' },
      { value: 'strip-solo-toggle',  label: 'Toggle strip solo…',          needs: 'strip' },
      { value: 'strip-route-toggle', label: 'Toggle strip route…',         needs: 'strip-route' },
      { value: 'strip-route-on',     label: 'Enable strip route…',         needs: 'strip-route' },
      { value: 'strip-route-off',    label: 'Disable strip route…',        needs: 'strip-route' },
    ],
  },
  {
    label: 'Buses (outputs)',
    ops: [
      { value: 'bus-mute-toggle', label: 'Toggle bus mute…',   needs: 'bus' },
      { value: 'bus-mute',        label: 'Mute bus…',          needs: 'bus' },
      { value: 'bus-unmute',      label: 'Unmute bus…',        needs: 'bus' },
    ],
  },
  {
    label: 'Engine',
    ops: [
      { value: 'restart-audio-engine', label: 'Restart audio engine', needs: 'none' },
    ],
  },
];

const OP_META: Record<VoicemeeterOp, { needs: 'strip' | 'strip-route' | 'bus' | 'none' }> = Object.fromEntries(
  OP_GROUPS.flatMap((g) => g.ops.map((o) => [o.value, { needs: o.needs }])),
) as Record<VoicemeeterOp, { needs: 'strip' | 'strip-route' | 'bus' | 'none' }>;

export function VoicemeeterBody({ action, onChange }: {
  action: Extract<Action, { type: 'voicemeeter' }>;
  onChange: (a: Action) => void;
}) {
  const [strips, setStrips] = useState<VoicemeeterStrip[]>([]);
  const [buses, setBuses] = useState<VoicemeeterBus[]>([]);
  const [connected, setConnected] = useState(false);
  const [availableRoutes, setAvailableRoutes] = useState<VoicemeeterRoute[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getVoicemeeterState();
        if (!alive) return;
        setStrips(data.status.strips ?? []);
        setBuses(data.status.buses ?? []);
        setConnected(data.status.state === 'connected');
        // Any route present on any strip is available for the current edition.
        const routes = new Set<VoicemeeterRoute>();
        for (const s of data.status.strips ?? []) {
          for (const k of Object.keys(s.routes)) routes.add(k as VoicemeeterRoute);
        }
        setAvailableRoutes([...routes] as VoicemeeterRoute[]);
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const meta = OP_META[action.op] ?? { needs: 'none' as const };
  const params = action.params ?? {};

  const setOp = (op: VoicemeeterOp) => {
    // Preserve index / route when switching within the same "needs" family so
    // users don't have to re-pick when toggling between e.g. mute vs unmute.
    const nextMeta = OP_META[op] ?? { needs: 'none' as const };
    const preserveIndex = (meta.needs === nextMeta.needs || (meta.needs !== 'none' && nextMeta.needs !== 'none' && meta.needs.startsWith(nextMeta.needs.slice(0, 5))))
      ? params.index
      : undefined;
    const preserveRoute = nextMeta.needs === 'strip-route' ? params.route : undefined;
    onChange({ type: 'voicemeeter', op, params: { index: preserveIndex, route: preserveRoute } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as VoicemeeterOp)}
        style={selectStyle}
      >
        {OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {(meta.needs === 'strip' || meta.needs === 'strip-route') && (
        strips.length > 0 ? (
          <select
            value={params.index ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, index: Number(e.target.value) } })}
            style={selectStyle}
          >
            <option value="">— pick a strip —</option>
            {strips.map((s) => (
              <option key={s.index} value={s.index}>
                {s.index}: {s.label}{s.physical ? '' : ' (virtual)'}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="number"
              min={0}
              value={params.index ?? ''}
              onChange={(e) => onChange({ ...action, params: { ...params, index: Number(e.target.value) || 0 } })}
              placeholder="strip index (0-based)"
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Voicemeeter not connected — start it and this dropdown will populate with your strips.
              </span>
            )}
          </>
        )
      )}

      {meta.needs === 'strip-route' && (
        <select
          value={params.route ?? ''}
          onChange={(e) => onChange({ ...action, params: { ...params, route: e.target.value as VoicemeeterRoute } })}
          style={selectStyle}
        >
          <option value="">— pick a route —</option>
          {(availableRoutes.length > 0 ? availableRoutes : ['A1','A2','A3','A4','A5','B1','B2','B3'] as const).map((r) => (
            <option key={r} value={r}>{r}{r.startsWith('A') ? ' (physical out)' : ' (virtual out — OBS captures)'}</option>
          ))}
        </select>
      )}

      {meta.needs === 'bus' && (
        buses.length > 0 ? (
          <select
            value={params.index ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, index: Number(e.target.value) } })}
            style={selectStyle}
          >
            <option value="">— pick a bus —</option>
            {buses.map((b) => (
              <option key={b.index} value={b.index}>{b.kind}: {b.label}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="number"
              min={0}
              value={params.index ?? ''}
              onChange={(e) => onChange({ ...action, params: { ...params, index: Number(e.target.value) || 0 } })}
              placeholder="bus index (0-based)"
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Voicemeeter not connected — start it and this dropdown will populate with your buses.
              </span>
            )}
          </>
        )
      )}
    </div>
  );
}

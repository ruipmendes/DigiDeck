import { useEffect, useState } from 'react';
import type { Action, NanoleafOp } from '../../lib/types';
import * as api from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

const OPS: { value: NanoleafOp; label: string; needs: 'effect' | null }[] = [
  { value: 'power-toggle',   label: 'Toggle panels',      needs: null },
  { value: 'power-on',       label: 'Turn panels on',     needs: null },
  { value: 'power-off',      label: 'Turn panels off',    needs: null },
  { value: 'effect-select',  label: 'Activate effect…',   needs: 'effect' },
  { value: 'identify',       label: 'Identify (pulse)',   needs: null },
];

export function NanoleafBody({ action, onChange }: {
  action: Extract<Action, { type: 'nanoleaf' }>;
  onChange: (a: Action) => void;
}) {
  const [effects, setEffects] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getNanoleafState();
        if (!alive) return;
        setEffects(data.status.effects ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const opMeta = OPS.find((o) => o.value === action.op) ?? OPS[0];
  const params = action.params ?? {};

  const setOp = (op: NanoleafOp) => {
    onChange({ type: 'nanoleaf', op, params: {} });
  };

  const value = params.effectName ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as NanoleafOp)}
        style={selectStyle}
      >
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {opMeta.needs === 'effect' && (
        effects.length > 0 ? (
          <select
            value={effects.includes(value) ? value : ''}
            onChange={(e) => onChange({ ...action, params: { ...params, effectName: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— pick a Nanoleaf effect —</option>
            {effects.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        ) : (
          <>
            <input
              value={value}
              onChange={(e) => onChange({ ...action, params: { ...params, effectName: e.target.value } })}
              placeholder="effect name (exact, as shown in the Nanoleaf app)"
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Nanoleaf not connected — link it in Integrations and this dropdown will populate with your saved effects.
              </span>
            )}
          </>
        )
      )}
    </div>
  );
}

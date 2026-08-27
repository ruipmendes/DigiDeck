import { useEffect, useState } from 'react';
import type { Action, HueOp } from '../../lib/types';
import * as api from '../../lib/api';
import type { HueLight, HueRoom, HueScene } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

const HUE_OPS: { value: HueOp; label: string; needs: 'scene' | 'light' | 'room' }[] = [
  { value: 'scene-on',     label: 'Activate scene',        needs: 'scene' },
  { value: 'room-toggle',  label: 'Toggle room lights',    needs: 'room' },
  { value: 'room-on',      label: 'Turn room on',          needs: 'room' },
  { value: 'room-off',     label: 'Turn room off',         needs: 'room' },
  { value: 'light-toggle', label: 'Toggle a specific light', needs: 'light' },
  { value: 'light-on',     label: 'Turn light on',         needs: 'light' },
  { value: 'light-off',    label: 'Turn light off',        needs: 'light' },
];

/**
 * Hue action editor. Op picker + a target dropdown scoped to what the op
 * needs — the target list comes from the connected bridge's live inventory
 * (polled every 4 s while the editor is open) so newly-created rooms /
 * scenes appear without a restart.
 */
export function HueBody({ action, onChange }: {
  action: Extract<Action, { type: 'hue' }>;
  onChange: (a: Action) => void;
}) {
  const [lights, setLights] = useState<HueLight[]>([]);
  const [rooms, setRooms] = useState<HueRoom[]>([]);
  const [scenes, setScenes] = useState<HueScene[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getHueState();
        if (!alive) return;
        setLights(data.status.lights ?? []);
        setRooms(data.status.rooms ?? []);
        setScenes(data.status.scenes ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave lists empty */ }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const opMeta = HUE_OPS.find((o) => o.value === action.op) ?? HUE_OPS[0];
  const params = action.params ?? {};

  const setOp = (op: HueOp) => {
    // Reset the target field on op change so the wrong-kind id doesn't linger.
    onChange({ type: 'hue', op, params: {} });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => setOp(e.target.value as HueOp)}
        style={selectStyle}
      >
        {HUE_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {opMeta.needs === 'scene' && (
        <TargetPicker
          kind="scene"
          value={params.sceneId ?? ''}
          items={scenes.map((s) => ({ id: s.id, label: s.groupName ? `${s.groupName} · ${s.name}` : s.name }))}
          connected={connected}
          onChange={(id) => onChange({ ...action, params: { ...params, sceneId: id } })}
        />
      )}
      {opMeta.needs === 'room' && (
        <TargetPicker
          kind="room"
          value={params.roomId ?? ''}
          items={rooms.map((r) => ({ id: r.id, label: r.name }))}
          connected={connected}
          onChange={(id) => onChange({ ...action, params: { ...params, roomId: id } })}
        />
      )}
      {opMeta.needs === 'light' && (
        <TargetPicker
          kind="light"
          value={params.lightId ?? ''}
          items={lights.map((l) => ({ id: l.id, label: l.name }))}
          connected={connected}
          onChange={(id) => onChange({ ...action, params: { ...params, lightId: id } })}
        />
      )}
    </div>
  );
}

function TargetPicker({ kind, value, items, connected, onChange }: {
  kind: 'scene' | 'light' | 'room';
  value: string;
  items: Array<{ id: string; label: string }>;
  connected: boolean;
  onChange: (id: string) => void;
}) {
  if (items.length > 0) {
    return (
      <select
        value={items.some((i) => i.id === value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">— pick a Hue {kind} —</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
      </select>
    );
  }
  return (
    <>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Hue ${kind} id`}
        style={inputStyle}
      />
      {!connected && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>
          Hue not connected — link a bridge in Integrations, then this dropdown will populate with your {kind}s.
        </span>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import type { Action, ActionType, ObsOp } from '../lib/types';
import { defaultAction } from '../lib/types';
import * as api from '../lib/api';
import { HotkeyInput } from './HotkeyInput';

const TYPES: { value: ActionType; label: string }[] = [
  { value: 'hotkey', label: 'Hotkey' },
  { value: 'text',   label: 'Type text' },
  { value: 'launch', label: 'Launch app' },
  { value: 'url',    label: 'Open URL / file' },
  { value: 'script', label: 'PowerShell script' },
  { value: 'volume', label: 'Volume' },
  { value: 'obs',    label: 'OBS Studio' },
  { value: 'twitch', label: 'Twitch chat' },
];

type Props = { action: Action; onChange: (a: Action) => void };

export function ActionEditor({ action, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.type}
        onChange={(e) => onChange(defaultAction(e.target.value as ActionType))}
        style={selectStyle}
      >
        {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <Body action={action} onChange={onChange} />
    </div>
  );
}

function Body({ action, onChange }: Props) {
  switch (action.type) {
    case 'hotkey':
      return (
        <HotkeyInput
          value={action.keys}
          onChange={(keys) => onChange({ type: 'hotkey', keys })}
        />
      );
    case 'text':
      return (
        <input
          value={action.text}
          onChange={(e) => onChange({ type: 'text', text: e.target.value })}
          placeholder="text to type at cursor"
          style={inputStyle}
        />
      );
    case 'launch':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            value={action.path}
            onChange={(e) => onChange({ ...action, path: e.target.value })}
            placeholder="path or binary (e.g. notepad.exe)"
            style={inputStyle}
          />
          <input
            value={action.args?.join(', ') ?? ''}
            onChange={(e) => onChange({
              ...action,
              args: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })}
            placeholder="args (comma-separated, optional)"
            style={inputStyle}
          />
        </div>
      );
    case 'url':
      return (
        <input
          value={action.url}
          onChange={(e) => onChange({ type: 'url', url: e.target.value })}
          placeholder="https://… or steam://… or file path"
          style={inputStyle}
        />
      );
    case 'script':
      return (
        <textarea
          value={action.script}
          onChange={(e) => onChange({ type: 'script', script: e.target.value })}
          placeholder="PowerShell command(s)"
          rows={3}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
        />
      );
    case 'volume': {
      const mode: 'up' | 'down' | 'mute' =
        action.mute ? 'mute' : (action.delta ?? 0) >= 0 ? 'up' : 'down';
      const amount = Math.abs(action.delta ?? 2) || 2;
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as 'up' | 'down' | 'mute';
              if (m === 'mute') onChange({ type: 'volume', mute: true });
              else onChange({ type: 'volume', delta: m === 'up' ? amount : -amount });
            }}
            style={selectStyle}
          >
            <option value="up">Volume up</option>
            <option value="down">Volume down</option>
            <option value="mute">Mute toggle</option>
          </select>
          {mode !== 'mute' && (
            <>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>steps:</label>
              <input
                type="number"
                value={amount}
                min={1}
                max={20}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                  onChange({ type: 'volume', delta: mode === 'up' ? n : -n });
                }}
                style={{ ...inputStyle, width: 70 }}
              />
            </>
          )}
        </div>
      );
    }
    case 'obs':
      return <ObsBody action={action} onChange={onChange} />;
    case 'twitch':
      return (
        <input
          value={action.text}
          onChange={(e) => onChange({ type: 'twitch', op: 'chat', text: e.target.value })}
          placeholder="!command or chat message (e.g. !website)"
          style={inputStyle}
        />
      );
  }
}

type ObsNeeds = 'scene' | 'input' | 'scene+source' | null;
const OBS_OPS: { value: ObsOp; label: string; needs: ObsNeeds }[] = [
  { value: 'toggle-record',        label: 'Toggle recording',        needs: null },
  { value: 'start-record',         label: 'Start recording',         needs: null },
  { value: 'stop-record',          label: 'Stop recording',          needs: null },
  { value: 'toggle-stream',        label: 'Toggle stream',           needs: null },
  { value: 'start-stream',         label: 'Start stream',            needs: null },
  { value: 'stop-stream',          label: 'Stop stream',             needs: null },
  { value: 'toggle-virtual-cam',   label: 'Toggle virtual camera',   needs: null },
  { value: 'toggle-replay-buffer', label: 'Toggle replay buffer',    needs: null },
  { value: 'save-replay-buffer',   label: 'Save replay buffer',      needs: null },
  { value: 'set-scene',            label: 'Switch to scene…',        needs: 'scene' },
  { value: 'toggle-mute',          label: 'Toggle input mute…',      needs: 'input' },
  { value: 'toggle-source',        label: 'Toggle source visibility in scene…', needs: 'scene+source' },
];

function ObsBody({ action, onChange }: { action: Extract<Action, { type: 'obs' }>; onChange: (a: Action) => void }) {
  const [snap, setSnap] = useState<{
    scenes: string[];
    inputs: string[];
    sceneItems: Record<string, string[]>;
    connected: boolean;
  } | null>(null);

  useEffect(() => {
    api.getObsState()
      .then((d) => setSnap({
        scenes: d.status.scenes,
        inputs: d.status.inputs,
        sceneItems: d.status.sceneItems ?? {},
        connected: d.status.state === 'connected',
      }))
      .catch(() => setSnap({ scenes: [], inputs: [], sceneItems: {}, connected: false }));
  }, []);

  const opMeta = OBS_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const currentSceneName = action.params?.sceneName ?? '';
  const sourcesInScene = currentSceneName ? (snap?.sceneItems[currentSceneName] ?? []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => onChange({ type: 'obs', op: e.target.value as ObsOp, params: action.params })}
        style={selectStyle}
      >
        {OBS_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {needs === 'scene' && (
        <PickOrType
          value={action.params?.sceneName ?? ''}
          options={snap?.scenes ?? []}
          placeholder="scene name"
          onChange={(v) => onChange({ ...action, params: { ...action.params, sceneName: v } })}
        />
      )}
      {needs === 'input' && (
        <PickOrType
          value={action.params?.inputName ?? ''}
          options={snap?.inputs ?? []}
          placeholder="input name (e.g. Mic/Aux)"
          onChange={(v) => onChange({ ...action, params: { ...action.params, inputName: v } })}
        />
      )}
      {needs === 'scene+source' && (
        <>
          <PickOrType
            value={action.params?.sceneName ?? ''}
            options={snap?.scenes ?? []}
            placeholder="scene"
            onChange={(v) => onChange({ ...action, params: { ...action.params, sceneName: v, sourceName: '' } })}
          />
          <PickOrType
            value={action.params?.sourceName ?? ''}
            options={sourcesInScene}
            placeholder={currentSceneName ? 'source in that scene' : 'pick a scene first'}
            onChange={(v) => onChange({ ...action, params: { ...action.params, sourceName: v } })}
          />
        </>
      )}

      {snap && !snap.connected && needs && (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          OBS not connected — type names manually, or connect OBS to pick from a list.
        </span>
      )}
    </div>
  );
}

function PickOrType({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder: string; onChange: (v: string) => void;
}) {
  if (options.length > 0) {
    return (
      <select
        value={options.includes(value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">— {placeholder} —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={inputStyle}
    />
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: '#0a0a0a',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  alignSelf: 'flex-start',
  paddingRight: 28,
};

import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import type { Action, ActionType, ButtonAction, MicOp, ObsOp, StreamlabsOp } from '../lib/types';
import { defaultAction } from '../lib/types';
import * as api from '../lib/api';
import { HotkeyInput } from './HotkeyInput';

type PageRef = { id: number; name: string };
export type IntegrationStatus = { obs: boolean; twitch: boolean; streamlabs: boolean };

type Props = {
  action: ButtonAction;
  onChange: (a: ButtonAction) => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

export function ActionEditor({ action, onChange, pages, integrationStatus }: Props) {
  const steps: Action[] = Array.isArray(action) ? action : [action];

  function commit(next: Action[]) {
    if (next.length === 0) return;            // shouldn't happen — guard
    if (next.length === 1) onChange(next[0]); // collapse back to single object
    else onChange(next);
  }

  function updateStep(i: number, a: Action) {
    const next = [...steps];
    next[i] = a;
    commit(next);
  }

  function removeStep(i: number) {
    commit(steps.filter((_, idx) => idx !== i));
  }

  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }

  function addStep() {
    commit([...steps, defaultAction('hotkey')]);
  }

  if (steps.length === 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ActionStepEditor
          action={steps[0]}
          onChange={(a) => updateStep(0, a)}
          pages={pages}
          integrationStatus={integrationStatus}
        />
        <button onClick={addStep} style={addStepBtnStyle} type="button">
          <Plus size={12} /> add step
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.3 }}>
        {steps.length}-STEP SEQUENCE · runs in order, stops on first failure
      </div>
      {steps.map((step, i) => (
        <StepCard
          key={i}
          index={i}
          total={steps.length}
          step={step}
          onChange={(a) => updateStep(i, a)}
          onRemove={() => removeStep(i)}
          onMoveUp={() => moveStep(i, -1)}
          onMoveDown={() => moveStep(i, 1)}
          pages={pages}
          integrationStatus={integrationStatus}
        />
      ))}
      <button onClick={addStep} style={addStepBtnStyle} type="button">
        <Plus size={12} /> add step
      </button>
    </div>
  );
}

type StepCardProps = {
  index: number;
  total: number;
  step: Action;
  onChange: (a: Action) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

function StepCard({ index, total, step, onChange, onRemove, onMoveUp, onMoveDown, pages, integrationStatus }: StepCardProps) {
  return (
    <div
      style={{
        background: '#0a0a0a',
        border: '1px solid #1f2937',
        borderRadius: 8,
        padding: 8,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 8,
        alignItems: 'start',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#6b7280',
          fontWeight: 600,
          alignSelf: 'center',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {index + 1}
      </div>
      <ActionStepEditor action={step} onChange={onChange} pages={pages} integrationStatus={integrationStatus} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="move up"
          title="move up"
          style={stepIconBtn(index === 0)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="move down"
          title="move down"
          style={stepIconBtn(index === total - 1)}
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="remove step"
          title="remove step"
          style={stepIconBtn(false)}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

type ActionOption = { value: ActionType; label: string };
type ActionGroup = { label: string; options: ActionOption[] };

const ACTION_GROUPS: ActionGroup[] = [
  {
    label: 'Desktop input',
    options: [
      { value: 'hotkey', label: 'Hotkey' },
      { value: 'text',   label: 'Type text' },
      { value: 'url',    label: 'Open URL / file' },
      { value: 'launch', label: 'Launch app' },
      { value: 'script', label: 'Run PowerShell' },
    ],
  },
  {
    label: 'Audio',
    options: [
      { value: 'volume', label: 'Volume (speaker)' },
      { value: 'mic',    label: 'Microphone mute' },
    ],
  },
  {
    label: 'Streaming',
    options: [
      { value: 'obs',             label: 'OBS Studio' },
      { value: 'streamlabs',      label: 'Streamlabs Desktop' },
      { value: 'twitch',          label: 'Twitch chat' },
      { value: 'twitch-streamer', label: 'Twitch streamer' },
    ],
  },
  {
    label: 'Flow',
    options: [
      { value: 'goto-page', label: 'Go to page (folder)' },
      { value: 'wait',      label: 'Wait (delay)' },
    ],
  },
];

const MIC_OPS: { value: MicOp; label: string }[] = [
  { value: 'toggle-mute', label: 'Toggle mic mute' },
  { value: 'mute',        label: 'Mute mic' },
  { value: 'unmute',      label: 'Unmute mic' },
];

type StepEditorProps = {
  action: Action;
  onChange: (a: Action) => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

function isActionTypeAvailable(type: ActionType, status: IntegrationStatus | undefined, current: ActionType): boolean {
  // Always keep the currently-selected type visible so users don't lose their setting.
  if (type === current) return true;
  if (!status) return true; // no status known yet → show everything
  if (type === 'obs') return status.obs;
  if (type === 'streamlabs') return status.streamlabs;
  if (type === 'twitch' || type === 'twitch-streamer') return status.twitch;
  return true;
}

function ActionStepEditor({ action, onChange, pages, integrationStatus }: StepEditorProps) {
  const filteredGroups = ACTION_GROUPS
    .map((g) => ({
      ...g,
      options: g.options.filter((o) => isActionTypeAvailable(o.value, integrationStatus, action.type)),
    }))
    .filter((g) => g.options.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.type}
        onChange={(e) => onChange(defaultAction(e.target.value as ActionType))}
        style={selectStyle}
      >
        {filteredGroups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </optgroup>
        ))}
      </select>
      <Body action={action} onChange={onChange} pages={pages} />
    </div>
  );
}

function Body({ action, onChange, pages }: StepEditorProps) {
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
    case 'mic':
      return (
        <select
          value={action.op}
          onChange={(e) => onChange({ type: 'mic', op: e.target.value as MicOp })}
          style={selectStyle}
        >
          {MIC_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'obs':
      return <ObsBody action={action} onChange={onChange} />;
    case 'streamlabs':
      return <StreamlabsBody action={action} onChange={onChange} />;
    case 'twitch':
      return (
        <input
          value={action.text}
          onChange={(e) => onChange({ type: 'twitch', op: 'chat', text: e.target.value })}
          placeholder="!command or chat message (e.g. !website)"
          style={inputStyle}
        />
      );
    case 'twitch-streamer':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            value={action.login}
            onChange={(e) => onChange({ type: 'twitch-streamer', login: e.target.value.trim().toLowerCase() })}
            placeholder="streamer login (e.g. skullbizarre)"
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Tap on the phone opens twitch.tv/{action.login || '<login>'}. Thumbnail + live state require Twitch connected.
          </span>
        </div>
      );
    case 'wait':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            step={50}
            value={action.ms}
            onChange={(e) => onChange({ type: 'wait', ms: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: 100 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>ms (pause between steps)</span>
        </div>
      );
    case 'goto-page': {
      const opts = pages ?? [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {opts.length > 0 ? (
            <select
              value={action.pageId}
              onChange={(e) => onChange({ type: 'goto-page', pageId: Number(e.target.value) })}
              style={selectStyle}
            >
              {opts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <input
              type="number"
              value={action.pageId}
              onChange={(e) => onChange({ type: 'goto-page', pageId: Number(e.target.value) || 0 })}
              placeholder="page id"
              style={inputStyle}
            />
          )}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Tap on the phone navigates to that page. Pair with the layout's <em>Folders</em> navigation mode for a back-stack with a Back tile at the top.
          </span>
        </div>
      );
    }
  }
}

type ObsNeeds = 'scene' | 'input' | 'scene+source' | null;
type ObsOpDef = { value: ObsOp; label: string; needs: ObsNeeds };
type ObsOpGroup = { label: string; options: ObsOpDef[] };

const OBS_OP_GROUPS: ObsOpGroup[] = [
  {
    label: 'Recording',
    options: [
      { value: 'toggle-record', label: 'Toggle recording', needs: null },
      { value: 'start-record',  label: 'Start recording',  needs: null },
      { value: 'stop-record',   label: 'Stop recording',   needs: null },
    ],
  },
  {
    label: 'Streaming',
    options: [
      { value: 'toggle-stream', label: 'Toggle stream', needs: null },
      { value: 'start-stream',  label: 'Start stream',  needs: null },
      { value: 'stop-stream',   label: 'Stop stream',   needs: null },
    ],
  },
  {
    label: 'Capture',
    options: [
      { value: 'toggle-virtual-cam',   label: 'Toggle virtual camera', needs: null },
      { value: 'toggle-replay-buffer', label: 'Toggle replay buffer',  needs: null },
      { value: 'save-replay-buffer',   label: 'Save replay buffer',    needs: null },
    ],
  },
  {
    label: 'Scenes',
    options: [
      { value: 'set-scene', label: 'Switch to scene…', needs: 'scene' },
    ],
  },
  {
    label: 'Audio',
    options: [
      { value: 'toggle-mute', label: 'Toggle mute…', needs: 'input' },
    ],
  },
  {
    label: 'Sources',
    options: [
      { value: 'show-source',   label: 'Show source…',       needs: 'scene+source' },
      { value: 'hide-source',   label: 'Hide source…',       needs: 'scene+source' },
      { value: 'toggle-source', label: 'Toggle visibility…', needs: 'scene+source' },
    ],
  },
];

const OBS_OPS: ObsOpDef[] = OBS_OP_GROUPS.flatMap((g) => g.options);

type StreamlabsNeeds = 'scene' | 'input' | 'scene+source' | null;
const STREAMLABS_OPS: { value: StreamlabsOp; label: string; needs: StreamlabsNeeds }[] = [
  { value: 'toggle-record',         label: 'Toggle recording',         needs: null },
  { value: 'start-record',          label: 'Start recording',          needs: null },
  { value: 'stop-record',           label: 'Stop recording',           needs: null },
  { value: 'toggle-stream',         label: 'Toggle stream',            needs: null },
  { value: 'start-stream',          label: 'Start stream',             needs: null },
  { value: 'stop-stream',           label: 'Stop stream',              needs: null },
  { value: 'toggle-virtual-cam',    label: 'Toggle virtual camera',    needs: null },
  { value: 'toggle-replay-buffer',  label: 'Toggle replay buffer',     needs: null },
  { value: 'save-replay-buffer',    label: 'Save replay buffer',       needs: null },
  { value: 'set-scene',             label: 'Switch to scene…',         needs: 'scene' },
  { value: 'toggle-mute',           label: 'Toggle mute…',             needs: 'input' },
  { value: 'show-source',           label: 'Show source…',             needs: 'scene+source' },
  { value: 'hide-source',           label: 'Hide source…',             needs: 'scene+source' },
  { value: 'toggle-source',         label: 'Toggle visibility…',       needs: 'scene+source' },
];

function StreamlabsBody({ action, onChange }: { action: Extract<Action, { type: 'streamlabs' }>; onChange: (a: Action) => void }) {
  const [snap, setSnap] = useState<{
    scenes: string[];
    inputs: string[];
    sceneItems: Record<string, string[]>;
    sourceStates: Record<string, boolean>;
    connected: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api.getStreamlabsState()
        .then((d) => { if (alive) setSnap({
          scenes: d.status.scenes,
          inputs: d.status.inputs,
          sceneItems: d.status.sceneItems ?? {},
          sourceStates: d.status.sourceStates ?? {},
          connected: d.status.state === 'connected',
        }); })
        .catch(() => { if (alive) setSnap({ scenes: [], inputs: [], sceneItems: {}, sourceStates: {}, connected: false }); });
    }
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const opMeta = STREAMLABS_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const currentSceneName = action.params?.sceneName ?? '';
  const sourcesInScene = currentSceneName ? (snap?.sceneItems[currentSceneName] ?? []) : [];

  const sourceLabel = (sourceName: string): string => {
    if (!currentSceneName) return sourceName;
    const visible = snap?.sourceStates?.[`${currentSceneName}::${sourceName}`];
    if (visible === undefined) return sourceName;
    return `${sourceName} (${visible ? 'visible' : 'hidden'})`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => onChange({ type: 'streamlabs', op: e.target.value as StreamlabsOp, params: action.params })}
        style={selectStyle}
      >
        {STREAMLABS_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
          placeholder="audio input name (e.g. Mic/Aux)"
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
            labelOf={sourceLabel}
          />
        </>
      )}
      {snap && !snap.connected && needs && (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          Streamlabs not connected — type names manually, or connect to pick from a list.
        </span>
      )}
    </div>
  );
}

function ObsBody({ action, onChange }: { action: Extract<Action, { type: 'obs' }>; onChange: (a: Action) => void }) {
  const [snap, setSnap] = useState<{
    scenes: string[];
    inputs: string[];
    sceneItems: Record<string, string[]>;
    sourceStates: Record<string, boolean>;
    connected: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api.getObsState()
        .then((d) => { if (alive) setSnap({
          scenes: d.status.scenes,
          inputs: d.status.inputs,
          sceneItems: d.status.sceneItems ?? {},
          sourceStates: d.status.sourceStates ?? {},
          connected: d.status.state === 'connected',
        }); })
        .catch(() => { if (alive) setSnap({ scenes: [], inputs: [], sceneItems: {}, sourceStates: {}, connected: false }); });
    }
    load();
    // Refresh while the editor is open so visibility hints stay current.
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const opMeta = OBS_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const currentSceneName = action.params?.sceneName ?? '';
  const sourcesInScene = currentSceneName ? (snap?.sceneItems[currentSceneName] ?? []) : [];

  const sourceLabel = (sourceName: string): string => {
    if (!currentSceneName) return sourceName;
    const visible = snap?.sourceStates?.[`${currentSceneName}::${sourceName}`];
    if (visible === undefined) return sourceName;
    return `${sourceName} (${visible ? 'visible' : 'hidden'})`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => onChange({ type: 'obs', op: e.target.value as ObsOp, params: action.params })}
        style={selectStyle}
      >
        {OBS_OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
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
            labelOf={sourceLabel}
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

function PickOrType({ value, options, placeholder, onChange, labelOf }: {
  value: string; options: string[]; placeholder: string;
  onChange: (v: string) => void;
  labelOf?: (v: string) => string;
}) {
  if (options.length > 0) {
    return (
      <select
        value={options.includes(value) ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        <option value="">— {placeholder} —</option>
        {options.map((o) => <option key={o} value={o}>{labelOf ? labelOf(o) : o}</option>)}
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

const addStepBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '4px 10px',
  background: 'transparent',
  border: '1px dashed #4b5563',
  borderRadius: 6,
  color: '#9ca3af',
  fontSize: 11,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

function stepIconBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 0,
    color: disabled ? '#374151' : '#9ca3af',
    cursor: disabled ? 'default' : 'pointer',
    padding: 2,
    width: 20,
    height: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

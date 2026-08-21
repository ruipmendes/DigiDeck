import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, X, Plus, FolderOpen } from 'lucide-react';
import type { Action, ActionType, ButtonAction, MicOp, ObsOp, StreamlabsOp, TwitchOp, TwitchActionParams, TwitchAnnouncementColor, TwitchPrompt, TwitchPromptField } from '../lib/types';
import { defaultAction } from '../lib/types';
import * as api from '../lib/api';
import { HotkeyInput } from './HotkeyInput';

type PageRef = { id: number; name: string };
export type IntegrationStatus = { obs: boolean; twitch: boolean; streamlabs: boolean; kick: boolean };

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
      { value: 'twitch',          label: 'Twitch (chat, mod, ads, clips)' },
      { value: 'twitch-streamer', label: 'Twitch streamer tile' },
      { value: 'kick',            label: 'Kick chat' },
      { value: 'kick-streamer',   label: 'Kick streamer tile' },
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
  if (type === 'kick' || type === 'kick-streamer') return status.kick;
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
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={action.path}
              onChange={(e) => onChange({ ...action, path: e.target.value })}
              placeholder="path or binary (e.g. notepad.exe)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <BrowseFileButton
              onPicked={(p) => onChange({ ...action, path: p })}
            />
          </div>
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
      return <TwitchBody action={action} onChange={onChange} />;
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
    case 'kick':
      return (
        <input
          value={action.text}
          onChange={(e) => onChange({ type: 'kick', op: 'chat', text: e.target.value })}
          placeholder="!command or chat message (e.g. !discord)"
          style={inputStyle}
        />
      );
    case 'kick-streamer':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            value={action.slug}
            onChange={(e) => onChange({ ...action, type: 'kick-streamer', slug: e.target.value.trim().toLowerCase() })}
            placeholder="streamer slug (e.g. adin)"
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
          <input
            value={action.avatarUrl ?? ''}
            onChange={(e) => onChange({ ...action, avatarUrl: e.target.value.trim() || undefined })}
            placeholder="avatar URL (optional — paste from kick.com)"
            spellCheck={false}
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Kick's API doesn't expose other users' avatars. On kick.com/{action.slug || '<slug>'} right-click their profile picture → <em>Copy image address</em>, then paste it above. Live state auto-refreshes; a stream preview is used if no avatar URL is set.
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

type TwitchNeeds = 'chat-text' | 'announcement' | 'run-ad' | 'marker' | 'follower-only' | 'slow-mode' | 'target' | 'title' | 'gameName' | 'poll' | 'prediction' | null;
type TwitchOpDef = { value: TwitchOp; label: string; needs: TwitchNeeds };
type TwitchOpGroup = { label: string; options: TwitchOpDef[] };

const TWITCH_OP_GROUPS: TwitchOpGroup[] = [
  {
    label: 'Chat',
    options: [
      { value: 'chat',              label: 'Send chat message',       needs: 'chat-text' },
      { value: 'chat-announcement', label: 'Send /announce…',          needs: 'announcement' },
      { value: 'clear-chat',        label: 'Clear chat',               needs: null },
    ],
  },
  {
    label: 'Ads',
    options: [
      { value: 'run-ad',    label: 'Run ad…',        needs: 'run-ad' },
      { value: 'snooze-ad', label: 'Snooze next ad', needs: null },
    ],
  },
  {
    label: 'Clips & markers',
    options: [
      { value: 'create-clip',   label: 'Create clip',          needs: null },
      { value: 'stream-marker', label: 'Create stream marker…', needs: 'marker' },
    ],
  },
  {
    label: 'Moderation',
    options: [
      { value: 'toggle-shield-mode', label: 'Toggle Shield Mode', needs: null },
    ],
  },
  {
    label: 'Chat modes',
    options: [
      { value: 'toggle-emote-only',    label: 'Toggle emote-only',      needs: null },
      { value: 'toggle-sub-only',      label: 'Toggle sub-only',        needs: null },
      { value: 'toggle-follower-only', label: 'Toggle follower-only…',  needs: 'follower-only' },
      { value: 'toggle-slow-mode',     label: 'Toggle slow mode…',      needs: 'slow-mode' },
    ],
  },
  {
    label: 'Broadcast',
    options: [
      { value: 'start-raid',      label: 'Start raid…',           needs: 'target' },
      { value: 'cancel-raid',     label: 'Cancel raid',           needs: null },
      { value: 'shoutout',        label: 'Send shoutout…',        needs: 'target' },
      { value: 'update-title',    label: 'Update stream title…',  needs: 'title' },
      { value: 'update-category', label: 'Update category…',      needs: 'gameName' },
    ],
  },
  {
    label: 'Polls & predictions',
    options: [
      { value: 'create-poll',       label: 'Create poll…',       needs: 'poll' },
      { value: 'create-prediction', label: 'Create prediction…', needs: 'prediction' },
    ],
  },
];

const PROMPT_META: Record<TwitchPromptField, { label: string; placeholder: string }> = {
  target:   { label: 'Streamer',        placeholder: 'e.g. ninja (login, no @)' },
  title:    { label: 'Stream title',    placeholder: 'e.g. Speedrunning Elden Ring' },
  gameName: { label: 'Game / category', placeholder: 'e.g. Elden Ring' },
};

const TWITCH_OPS: TwitchOpDef[] = TWITCH_OP_GROUPS.flatMap((g) => g.options);

const ANNOUNCEMENT_COLORS: { value: TwitchAnnouncementColor; label: string }[] = [
  { value: 'primary', label: 'Channel color' },
  { value: 'blue',    label: 'Blue' },
  { value: 'green',   label: 'Green' },
  { value: 'orange',  label: 'Orange' },
  { value: 'purple',  label: 'Purple' },
];

const AD_LENGTHS = [30, 60, 90, 120, 150, 180];

function TwitchBody({ action, onChange }: { action: Extract<Action, { type: 'twitch' }>; onChange: (a: Action) => void }) {
  const opMeta = TWITCH_OPS.find((o) => o.value === action.op);
  const needs = opMeta?.needs ?? null;
  const params = action.params ?? {};

  const setOp = (op: TwitchOp) => {
    // Reset op-specific params + prompts on op change so stale values don't leak between ops.
    onChange({ type: 'twitch', op, text: op === 'chat' ? (action.text ?? '') : undefined, params: undefined, prompts: undefined });
  };

  const promptFor = (field: TwitchPromptField): TwitchPrompt | undefined =>
    action.prompts?.find((p) => p.field === field);

  const setPromptEnabled = (field: TwitchPromptField, enabled: boolean) => {
    const rest = (action.prompts ?? []).filter((p) => p.field !== field);
    if (enabled) {
      const meta = PROMPT_META[field];
      const nextPrompts = [...rest, { field, label: meta.label, placeholder: meta.placeholder }];
      const nextParams = { ...(action.params ?? {}) };
      delete nextParams[field];
      onChange({ ...action, params: Object.keys(nextParams).length ? nextParams : undefined, prompts: nextPrompts });
    } else {
      onChange({ ...action, prompts: rest.length ? rest : undefined });
    }
  };

  const renderPromptableField = (field: TwitchPromptField) => {
    const p = promptFor(field);
    const meta = PROMPT_META[field];
    const value = (params[field] as string | undefined) ?? '';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!p && (
          <input
            value={value}
            onChange={(e) => onChange({ ...action, params: { ...params, [field]: e.target.value } })}
            placeholder={meta.placeholder}
            style={inputStyle}
            spellCheck={false}
            autoCapitalize="none"
          />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9ca3af' }}>
          <input
            type="checkbox"
            checked={!!p}
            onChange={(e) => setPromptEnabled(field, e.target.checked)}
          />
          Ask on tap {p && '— phone shows a dialog before firing'}
        </label>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value={action.op} onChange={(e) => setOp(e.target.value as TwitchOp)} style={selectStyle}>
        {TWITCH_OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </optgroup>
        ))}
      </select>

      {needs === 'chat-text' && (
        <input
          value={action.text ?? ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="!command or chat message (e.g. !website)"
          style={inputStyle}
        />
      )}

      {needs === 'announcement' && (
        <>
          <input
            value={action.text ?? ''}
            onChange={(e) => onChange({ ...action, text: e.target.value })}
            placeholder="announcement text (shows highlighted in chat)"
            style={inputStyle}
          />
          <select
            value={params.color ?? 'primary'}
            onChange={(e) => onChange({ ...action, params: { ...params, color: e.target.value as TwitchAnnouncementColor } })}
            style={selectStyle}
          >
            {ANNOUNCEMENT_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </>
      )}

      {needs === 'run-ad' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={params.adLength ?? 30}
            onChange={(e) => onChange({ ...action, params: { ...params, adLength: Number(e.target.value) } })}
            style={selectStyle}
          >
            {AD_LENGTHS.map((s) => <option key={s} value={s}>{s} seconds</option>)}
          </select>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Ad plays pre-roll to viewers.</span>
        </div>
      )}

      {needs === 'marker' && (
        <input
          value={action.text ?? ''}
          onChange={(e) => onChange({ ...action, text: e.target.value })}
          placeholder="marker description (optional, ≤140 chars)"
          maxLength={140}
          style={inputStyle}
        />
      )}

      {needs === 'follower-only' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            max={129600}
            value={params.duration ?? 10}
            onChange={(e) => onChange({ ...action, params: { ...params, duration: Math.max(0, Number(e.target.value) || 0) } })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>min follow age (minutes) when turning ON</span>
        </div>
      )}

      {needs === 'slow-mode' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={3}
            max={120}
            value={params.duration ?? 30}
            onChange={(e) => onChange({ ...action, params: { ...params, duration: Math.max(3, Math.min(120, Number(e.target.value) || 30)) } })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>seconds between messages when turning ON (3–120)</span>
        </div>
      )}

      {needs === 'target' && renderPromptableField('target')}
      {needs === 'title' && renderPromptableField('title')}
      {needs === 'gameName' && renderPromptableField('gameName')}

      {(needs === 'poll' || needs === 'prediction') && (
        <PollForm
          kind={needs}
          params={params}
          onChange={(nextParams) => onChange({ ...action, params: nextParams })}
        />
      )}

      <span style={{ fontSize: 11, color: '#6b7280' }}>
        Requires Twitch connected with the new scopes. If a button says "insufficient permission", click <em>Disconnect</em> then <em>Connect to Twitch</em> on the Twitch panel.
      </span>
    </div>
  );
}

function PollForm({ kind, params, onChange }: {
  kind: 'poll' | 'prediction';
  params: TwitchActionParams;
  onChange: (next: TwitchActionParams) => void;
}) {
  const isPoll = kind === 'poll';
  const key: 'choices' | 'outcomes' = isPoll ? 'choices' : 'outcomes';
  const min = 2;
  const max = isPoll ? 5 : 10;
  const titleCap = isPoll ? 60 : 45;
  const defaultDuration = isPoll ? 60 : 120;
  const items = (params[key] ?? ['', '']) as string[];
  // Ensure at least two rows are always visible so the editor is never blank.
  const rows = items.length < min ? [...items, ...Array(min - items.length).fill('')] : items;

  const setItems = (next: string[]) => onChange({ ...params, [key]: next });
  const updateItem = (i: number, v: string) => setItems(rows.map((r, idx) => (idx === i ? v : r)));
  const addItem = () => { if (rows.length < max) setItems([...rows, '']); };
  const removeItem = (i: number) => { if (rows.length > min) setItems(rows.filter((_, idx) => idx !== i)); };

  const rowNoun = isPoll ? 'choice' : 'outcome';
  const durationLabel = isPoll ? 'poll duration' : 'prediction window';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        value={params.title ?? ''}
        onChange={(e) => onChange({ ...params, title: e.target.value })}
        placeholder={isPoll ? 'poll question (e.g. Which map?)' : 'prediction title (e.g. Will I clear this in 3 tries?)'}
        maxLength={titleCap}
        style={inputStyle}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={v}
              onChange={(e) => updateItem(i, e.target.value)}
              placeholder={`${rowNoun} ${i + 1}`}
              maxLength={25}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              disabled={rows.length <= min}
              aria-label={`remove ${rowNoun}`}
              title={rows.length <= min ? `min ${min} ${rowNoun}s` : `remove ${rowNoun}`}
              style={stepIconBtn(rows.length <= min)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          disabled={rows.length >= max}
          style={{ ...addStepBtnStyle, opacity: rows.length >= max ? 0.5 : 1 }}
        >
          <Plus size={12} /> add {rowNoun} {rows.length >= max && `(max ${max})`}
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="number"
          min={isPoll ? 15 : 1}
          max={1800}
          value={params.duration ?? defaultDuration}
          onChange={(e) => onChange({ ...params, duration: Math.max(1, Math.min(1800, Number(e.target.value) || defaultDuration)) })}
          style={{ ...inputStyle, width: 90 }}
        />
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          seconds — {durationLabel} ({isPoll ? '15–1800' : '1–1800'})
        </span>
      </div>
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

/**
 * Opens a native file dialog on the PC running the server and feeds the
 * chosen path back. The dialog appears on the PC regardless of which
 * device clicked the button — useful when configuring from a phone, you'd
 * still need to be at your PC to pick the file.
 */
function BrowseFileButton({ onPicked }: { onPicked: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    setBusy(true);
    setError(null);
    try {
      const picked = await api.browseForFile({
        title: 'Digi Deck — select an app to launch',
        initialDir: '%ProgramFiles%',
        filter: 'Apps and shortcuts (*.exe;*.lnk;*.bat;*.cmd)|*.exe;*.lnk;*.bat;*.cmd|All files (*.*)|*.*',
      });
      if (picked) onPicked(picked);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
      <button
        type="button"
        onClick={browse}
        disabled={busy}
        title="open a file dialog on the PC"
        style={{
          padding: '8px 10px',
          background: '#1f2937',
          color: '#fff',
          border: '1px solid #374151',
          borderRadius: 6,
          fontSize: 13,
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          opacity: busy ? 0.7 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        <FolderOpen size={14} />
        {busy ? 'Waiting…' : 'Browse…'}
      </button>
      {error && <span style={{ fontSize: 11, color: '#f87171' }}>{error}</span>}
    </div>
  );
}

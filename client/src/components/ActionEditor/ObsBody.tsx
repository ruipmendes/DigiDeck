import { useEffect, useState } from 'react';
import type { Action, ObsOp } from '../../lib/types';
import * as api from '../../lib/api';
import { PickOrType, selectStyle } from './shared';

type ObsNeeds = 'scene' | 'input' | 'scene+source' | 'media-input' | 'scene+browser-source' | null;
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
  {
    label: 'Media',
    options: [
      { value: 'media-play',     label: 'Play media…',      needs: 'media-input' },
      { value: 'media-pause',    label: 'Pause media…',     needs: 'media-input' },
      { value: 'media-restart',  label: 'Restart media…',   needs: 'media-input' },
      { value: 'media-stop',     label: 'Stop media…',      needs: 'media-input' },
      { value: 'media-next',     label: 'Next media…',      needs: 'media-input' },
      { value: 'media-previous', label: 'Previous media…',  needs: 'media-input' },
    ],
  },
  {
    label: 'Browser sources',
    options: [
      { value: 'refresh-browser-source', label: 'Refresh browser source…', needs: 'scene+browser-source' },
    ],
  },
];

const OBS_OPS: ObsOpDef[] = OBS_OP_GROUPS.flatMap((g) => g.options);

export function ObsBody({ action, onChange }: { action: Extract<Action, { type: 'obs' }>; onChange: (a: Action) => void }) {
  const [snap, setSnap] = useState<{
    scenes: string[];
    inputs: string[];
    mediaInputs: string[];
    browserSources: string[];
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
          mediaInputs: d.status.mediaInputs ?? [],
          browserSources: d.status.browserSources ?? [],
          sceneItems: d.status.sceneItems ?? {},
          sourceStates: d.status.sourceStates ?? {},
          connected: d.status.state === 'connected',
        }); })
        .catch(() => { if (alive) setSnap({ scenes: [], inputs: [], mediaInputs: [], browserSources: [], sceneItems: {}, sourceStates: {}, connected: false }); });
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
      {needs === 'media-input' && (
        <PickOrType
          value={action.params?.inputName ?? ''}
          options={snap?.mediaInputs ?? []}
          placeholder={snap?.connected && snap.mediaInputs.length === 0 ? 'no media sources found — add one in OBS first' : 'media source name'}
          onChange={(v) => onChange({ ...action, params: { ...action.params, inputName: v } })}
        />
      )}
      {needs === 'scene+browser-source' && (
        <>
          <PickOrType
            value={action.params?.sceneName ?? ''}
            options={snap?.scenes ?? []}
            placeholder="scene"
            onChange={(v) => onChange({ ...action, params: { ...action.params, sceneName: v, inputName: '' } })}
          />
          <PickOrType
            value={action.params?.inputName ?? ''}
            options={(() => {
              const s = action.params?.sceneName;
              if (!s) return [];
              const inScene = snap?.sceneItems[s] ?? [];
              // Intersect scene contents with the known browser-source list so
              // the second dropdown only offers browser sources actually placed
              // in this scene.
              const browsers = new Set(snap?.browserSources ?? []);
              return inScene.filter((name) => browsers.has(name));
            })()}
            placeholder={
              !action.params?.sceneName ? 'pick a scene first'
                : (snap?.browserSources.length ?? 0) === 0 ? 'no browser sources in OBS'
                : 'browser source in that scene'
            }
            onChange={(v) => onChange({ ...action, params: { ...action.params, inputName: v } })}
          />
        </>
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

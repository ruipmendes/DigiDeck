import { useEffect, useState } from 'react';
import type { Action, AppAudioOp } from '../../lib/types';
import * as api from '../../lib/api';
import type { AppAudioSession } from '../../lib/api';
import { inputStyle, selectStyle, PickOrType } from './shared';

const APP_AUDIO_OPS: { value: AppAudioOp; label: string }[] = [
  { value: 'toggle-mute', label: 'Toggle mute' },
  { value: 'mute',        label: 'Mute' },
  { value: 'unmute',      label: 'Unmute' },
  { value: 'set-volume',  label: 'Set volume…' },
];

/**
 * Per-app audio editor. Two moving parts:
 *   - op picker (toggle-mute / mute / unmute / set-volume)
 *   - app-name field: dropdown of currently-playing sessions when the server
 *     can see any, free-text fallback when nothing is playing yet (so users
 *     can still author tiles for an app that's not open at config time).
 *
 * `set-volume` reveals a second field for the 0–100 percent value.
 */
export function AppAudioBody({ action, onChange }: {
  action: Extract<Action, { type: 'app-audio' }>;
  onChange: (a: Action) => void;
}) {
  const [sessions, setSessions] = useState<AppAudioSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const list = await api.getAppAudioSessions();
        if (alive) setSessions(list);
      } catch { /* leave empty */ }
      finally { if (alive) setLoading(false); }
    }
    void load();
    // Keep the list fresh while the editor is open — apps go in and out
    // (VLC just opened, Discord went idle) and users expect to see them appear.
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const options = sessions.map((s) => s.name);
  const appName = action.params?.appName ?? '';
  const volumePercent = action.params?.volumePercent ?? 50;

  function setParams(patch: Partial<NonNullable<typeof action.params>>): void {
    onChange({ ...action, params: { ...action.params, ...patch } });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select
        value={action.op}
        onChange={(e) => onChange({ ...action, op: e.target.value as AppAudioOp })}
        style={selectStyle}
      >
        {APP_AUDIO_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <PickOrType
        value={appName}
        options={options}
        placeholder="pick an app (case-insensitive process name)"
        onChange={(v) => setParams({ appName: v })}
      />

      {action.op === 'set-volume' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>Volume</label>
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={volumePercent}
            onChange={(e) => setParams({ volumePercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            style={{ ...inputStyle, width: 90 }}
          />
          <span style={{ fontSize: 12, color: '#6b7280' }}>%</span>
        </div>
      )}

      {options.length === 0 && !loading && (
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          No apps are playing audio right now. You can still type an app name — it'll be resolved when the button fires. Match is case-insensitive on the process name (e.g. <code>Discord</code>, <code>Spotify</code>, <code>chrome</code>).
        </span>
      )}
      {options.length > 0 && !options.includes(appName) && appName && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>
          "{appName}" isn't in the live list right now. That's fine if it's not playing — it'll be resolved when the button fires.
        </span>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { Action } from '../../lib/types';
import * as api from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

/** OpenRGB has one op — load-profile — so the body is just a profile picker
 *  populated from the connected SDK server. Free-text fallback when OpenRGB
 *  isn't connected (or when the profile hasn't been saved yet). */
export function OpenRgbBody({ action, onChange }: {
  action: Extract<Action, { type: 'openrgb' }>;
  onChange: (a: Action) => void;
}) {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getOpenRgbState();
        if (!alive) return;
        setProfiles(data.status.profiles ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const value = action.params?.profileName ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {profiles.length > 0 ? (
        <select
          value={profiles.includes(value) ? value : ''}
          onChange={(e) => onChange({ ...action, params: { ...action.params, profileName: e.target.value } })}
          style={selectStyle}
        >
          <option value="">— pick an OpenRGB profile —</option>
          {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      ) : (
        <>
          <input
            value={value}
            onChange={(e) => onChange({ ...action, params: { ...action.params, profileName: e.target.value } })}
            placeholder="OpenRGB profile name"
            style={inputStyle}
          />
          {!connected && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>
              OpenRGB not connected — start it up (SDK Server enabled) and this dropdown will populate with your profiles.
            </span>
          )}
          {connected && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>
              Connected but no profiles saved in OpenRGB yet. Compose a color scheme, then <em>Profiles → Save Profile</em>.
            </span>
          )}
        </>
      )}
    </div>
  );
}

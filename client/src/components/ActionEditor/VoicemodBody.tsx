import { useEffect, useMemo, useState } from 'react';
import type { Action, VoicemodOp } from '../../lib/types';
import * as api from '../../lib/api';
import type { VoicemodVoice, VoicemodSound } from '../../lib/api';
import { selectStyle, inputStyle } from './shared';

const OPS: { value: VoicemodOp; label: string; needs: 'voice' | 'sound' | null }[] = [
  { value: 'voice-changer-toggle', label: 'Toggle voice changer',      needs: null },
  { value: 'select-voice',         label: 'Select voice…',              needs: 'voice' },
  { value: 'mic-mute-toggle',      label: 'Toggle Voicemod mic mute',   needs: null },
  { value: 'play-sound',           label: 'Play soundboard clip…',      needs: 'sound' },
];

export function VoicemodBody({ action, onChange }: {
  action: Extract<Action, { type: 'voicemod' }>;
  onChange: (a: Action) => void;
}) {
  const [voices, setVoices] = useState<VoicemodVoice[]>([]);
  const [sounds, setSounds] = useState<VoicemodSound[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api.getVoicemodState();
        if (!alive) return;
        setVoices(data.status.voices ?? []);
        setSounds(data.status.sounds ?? []);
        setConnected(data.status.state === 'connected');
      } catch { /* leave empty */ }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const opMeta = OPS.find((o) => o.value === action.op) ?? OPS[0];
  const params = action.params ?? {};

  // Sort voices favorites-first (matches the panel's list ordering + the
  // Voicemod app's own default). Sounds sorted by soundboard then name.
  const sortedVoices = useMemo(() => {
    return [...voices].sort((a, b) => {
      const f = (a.favorited ? 0 : 1) - (b.favorited ? 0 : 1);
      if (f !== 0) return f;
      return a.friendlyName.localeCompare(b.friendlyName);
    });
  }, [voices]);

  const setOp = (op: VoicemodOp) => {
    const meta = OPS.find((o) => o.value === op) ?? OPS[0];
    // Preserve voice/sound param across same-family switches; drop otherwise.
    onChange({
      type: 'voicemod',
      op,
      params: {
        voiceId: meta.needs === 'voice' ? params.voiceId : undefined,
        soundFileName: meta.needs === 'sound' ? params.soundFileName : undefined,
      },
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select value={action.op} onChange={(e) => setOp(e.target.value as VoicemodOp)} style={selectStyle}>
        {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {opMeta.needs === 'voice' && (
        sortedVoices.length > 0 ? (
          <select
            value={params.voiceId ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, voiceId: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— pick a voice —</option>
            {sortedVoices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.favorited ? '★ ' : ''}{v.friendlyName}{v.isCustom ? ' (custom)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              value={params.voiceId ?? ''}
              onChange={(e) => onChange({ ...action, params: { ...params, voiceId: e.target.value } })}
              placeholder="voice ID"
              spellCheck={false}
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Voicemod not connected — start the Voicemod app and this dropdown will populate.
              </span>
            )}
          </>
        )
      )}

      {opMeta.needs === 'sound' && (
        sounds.length > 0 ? (
          <select
            value={params.soundFileName ?? ''}
            onChange={(e) => onChange({ ...action, params: { ...params, soundFileName: e.target.value } })}
            style={selectStyle}
          >
            <option value="">— pick a sound —</option>
            {sounds.map((s) => (
              <option key={s.fileName} value={s.fileName}>{s.soundboard} · {s.name}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              value={params.soundFileName ?? ''}
              onChange={(e) => onChange({ ...action, params: { ...params, soundFileName: e.target.value } })}
              placeholder="sound file name (as shown in Voicemod)"
              spellCheck={false}
              style={inputStyle}
            />
            {!connected && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Voicemod not connected — start the Voicemod app and this dropdown will populate with your soundboard.
              </span>
            )}
          </>
        )
      )}
    </div>
  );
}

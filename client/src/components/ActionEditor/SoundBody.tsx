import { useEffect, useMemo, useState } from 'react';
import type { Action } from '../../lib/types';
import * as api from '../../lib/api';
import type { SoundClip } from '../../lib/api';
import { selectStyle, inputStyle, BrowseFileButton } from './shared';

/**
 * Sound action editor — two modes:
 *   1. **Library** — pick from a clip in %APPDATA%/digi-deck/sounds/. The
 *      tile stores `library:<id>` so the reference is portable across
 *      machines (bundle export/import doesn't break paths).
 *   2. **File path** — absolute path via BrowseFileButton. Backward-compat
 *      for tiles that predate the library, and for external clips (network
 *      shares, external drives) that shouldn't live in the library folder.
 *
 * Mode is inferred from the current value's shape: `library:` prefix ->
 * library mode; anything else -> file-path mode.
 *
 * When a library clip is first picked, its per-clip default volume (from
 * `sounds.json`) becomes the tile's initial volume — so a streamer who
 * calibrated "airhorn = 40 %" in the Sounds panel doesn't have to redo it
 * every time they wire the clip to a new tile.
 */

const LIBRARY_PREFIX = 'library:';

export function SoundBody({ action, onChange }: {
  action: Extract<Action, { type: 'sound' }>;
  onChange: (a: Action) => void;
}) {
  const [sounds, setSounds] = useState<SoundClip[]>([]);
  const [refreshedAt, setRefreshedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    api.listSounds()
      .then((data) => { if (alive) setSounds(data.sounds); })
      .catch(() => { if (alive) setSounds([]); });
    return () => { alive = false };
  }, [refreshedAt]);

  const isLibrary = action.path.startsWith(LIBRARY_PREFIX);
  const currentId = isLibrary ? action.path.slice(LIBRARY_PREFIX.length) : '';
  const currentClip = useMemo(() => sounds.find((s) => s.id === currentId), [sounds, currentId]);
  const missing = isLibrary && currentId && sounds.length > 0 && !currentClip;

  const volumePercent = Math.round((action.volume ?? 0.8) * 100);

  const setMode = (mode: 'library' | 'file') => {
    if (mode === 'library') {
      // `library:` (with nothing after) is our sentinel for "library mode
      // selected, no clip picked yet" — otherwise the isLibrary detection
      // via prefix would flip back to file-path mode on the next render.
      onChange({ ...action, path: isLibrary ? action.path : 'library:' });
    } else {
      // Bare '' when leaving library mode — user will type a path or hit
      // Browse. Keeping the id as a hint is more confusing than helpful.
      onChange({ ...action, path: isLibrary ? '' : action.path });
    }
  };

  const pickLibrary = (id: string) => {
    // Apply the clip's default volume when picking (unless the user has
    // already customized volume — only overwrite when volume is at the
    // implicit 0.8 default). Distinguishing "user picked 80 %" from the
    // implicit default is impossible, so we always apply — matches the
    // decision the Sounds panel is built around.
    const clip = sounds.find((s) => s.id === id);
    const volume = clip?.defaultVolume ?? action.volume ?? 0.8;
    onChange({ ...action, path: id ? `${LIBRARY_PREFIX}${id}` : '', volume });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <ModeButton active={isLibrary} onClick={() => setMode('library')}>From library</ModeButton>
        <ModeButton active={!isLibrary} onClick={() => setMode('file')}>File path</ModeButton>
      </div>

      {isLibrary ? (
        <>
          {sounds.length > 0 ? (
            <select
              value={currentClip ? currentId : ''}
              onChange={(e) => pickLibrary(e.target.value)}
              style={selectStyle}
            >
              <option value="">— pick a clip —</option>
              {sounds.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.folder ? `${s.folder} · ` : ''}{s.name}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>
              No clips in library yet. Drop audio files into <code>%APPDATA%/digi-deck/sounds/</code> and refresh the Sound library panel.
            </span>
          )}
          {missing && (
            <span style={{ fontSize: 11, color: '#f87171' }}>
              Clip <code>{currentId}</code> not found — it may have been moved or deleted.
            </span>
          )}
          <button
            type="button"
            onClick={() => setRefreshedAt(Date.now())}
            style={{
              alignSelf: 'flex-start',
              background: 'transparent', border: 0, color: '#6b7280',
              cursor: 'pointer', padding: 0, fontSize: 11, textDecoration: 'underline',
            }}
          >
            refresh library
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={action.path}
            onChange={(e) => onChange({ ...action, path: e.target.value })}
            placeholder="audio file path (mp3, wav, ogg…)"
            style={{ ...inputStyle, flex: 1 }}
            spellCheck={false}
          />
          <BrowseFileButton
            onPicked={(p) => onChange({ ...action, path: p })}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: '#9ca3af', minWidth: 60 }}>volume</label>
        <input
          type="range"
          min={0}
          max={100}
          value={volumePercent}
          onChange={(e) => onChange({ ...action, volume: Number(e.target.value) / 100 })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, color: '#e5e7eb', minWidth: 36, textAlign: 'right' }}>{volumePercent}%</span>
      </div>

      <span style={{ fontSize: 11, color: '#6b7280' }}>
        Plays through your PC's default audio output — route it to a virtual cable (VoiceMeeter / VB-Cable) to send to OBS. Library clips are portable across machines; file paths break if you move the file.
      </span>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, padding: '4px 8px',
        background: active ? '#312e81' : '#0a0a0a',
        color: active ? '#a5b4fc' : '#9ca3af',
        border: `1px solid ${active ? '#6366f1' : '#374151'}`,
        borderRadius: 4, cursor: 'pointer', fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}

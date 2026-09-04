import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, Music, Play, Square, RefreshCw, Volume2,
} from 'lucide-react';
import * as api from '../lib/api';
import type { SoundClip } from '../lib/api';

/**
 * Sound library panel — folder-registered clip catalogue with browser-side
 * preview + per-clip default volume + a "test on stream output" button that
 * plays through the deck's audio path (same code the sound tile uses).
 *
 * Discovery: files under `%APPDATA%/digi-deck/sounds/` (path shown in the
 * empty-state hint so users know where to drop clips).
 *
 * Preview: uses the config UI's own `<audio>` element — audible only through
 * the user's headphones, so they don't accidentally send the airhorn to the
 * stream while auditioning. The separate "test" button uses the server-side
 * MediaPlayer path to check "does this land right on OBS's virtual cable?".
 */

export function SoundsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [sounds, setSounds] = useState<SoundClip[]>([]);
  const [dir, setDir] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  // One <audio> element for the whole panel — swapping src is cheap and only
  // one clip can play in the preview channel at a time anyway.
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function refresh(useCache = true) {
    try {
      const data = useCache ? await api.listSounds() : await api.refreshSounds();
      setSounds(data.sounds);
      setDir(data.dir);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!expanded) return;
    void refresh();
    // Poll while open in case the user drops files into the folder externally.
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Group + filter — folder path becomes the group heading, filenames within.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sounds.filter((s) => s.name.toLowerCase().includes(q) || s.folder.toLowerCase().includes(q))
      : sounds;
    const map = new Map<string, SoundClip[]>();
    for (const s of filtered) {
      const key = s.folder || '(root)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort((a, b) => {
      // Root always first, then other folders alphabetically.
      if (a[0] === '(root)') return -1;
      if (b[0] === '(root)') return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [sounds, query]);

  function togglePreview(id: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewingId === id && !audio.paused) {
      audio.pause();
      setPreviewingId(null);
      return;
    }
    audio.src = api.soundFileUrl(id);
    audio.currentTime = 0;
    void audio.play().then(() => {
      setPreviewingId(id);
    }).catch((err) => {
      setError(`preview failed: ${(err as Error).message}`);
    });
  }

  async function testOnServer(clip: SoundClip) {
    setTestingId(clip.id);
    setError(null);
    try {
      await api.playSoundOnServer(clip.id, clip.defaultVolume ?? 0.8);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Rough estimate — the /play endpoint returns after execSound spawns,
      // not after playback ends. 250 ms so the button reads "playing" briefly.
      setTimeout(() => setTestingId((cur) => (cur === clip.id ? null : cur)), 250);
    }
  }

  async function saveDefaultVolume(id: string, volume: number) {
    setError(null);
    try {
      await api.setSoundDefaultVolume(id, volume);
      // Optimistic — the server-side sidecar is source of truth but we don't
      // need to await the next scan to reflect the write.
      setSounds((prev) => prev.map((s) => s.id === id ? { ...s, defaultVolume: volume } : s));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function forceRefresh() {
    setBusy(true);
    await refresh(false);
    setBusy(false);
  }

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={triggerBtnStyle}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Music size={16} />
        <strong style={{ fontSize: 14 }}>Sound library</strong>
        <span style={{ marginLeft: 12, fontSize: 12, color: '#9ca3af' }}>
          {sounds.length} clip{sounds.length === 1 ? '' : 's'}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <audio ref={audioRef} onEnded={() => setPreviewingId(null)} onPause={() => setPreviewingId((cur) => (cur && audioRef.current?.paused ? null : cur))} />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clips…"
              spellCheck={false}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={forceRefresh} disabled={busy} style={secondaryBtn} title="Re-scan the sounds folder">
              <RefreshCw size={14} />
            </button>
          </div>

          <div style={{ fontSize: 11, color: '#6b7280' }}>
            Drop MP3 / WAV / OGG / AAC / FLAC files into{' '}
            <code style={codeStyle}>{dir || '%APPDATA%/digi-deck/sounds'}</code> and hit refresh. Subfolders group clips together.
          </div>

          {sounds.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 12, background: '#111827', borderRadius: 8 }}>
              No clips yet. Drop audio files into the folder above and click refresh.
            </div>
          )}

          {grouped.map(([folder, clips]) => (
            <div key={folder}>
              <div style={groupHeaderStyle}>{folder.toUpperCase()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {clips.map((c) => (
                  <SoundRow
                    key={c.id}
                    clip={c}
                    isPreviewing={previewingId === c.id}
                    isTesting={testingId === c.id}
                    onPreview={() => togglePreview(c.id)}
                    onTest={() => void testOnServer(c)}
                    onVolume={(v) => void saveDefaultVolume(c.id, v)}
                  />
                ))}
              </div>
            </div>
          ))}

          {error && <div style={{ fontSize: 12, color: '#f87171' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function SoundRow({
  clip, isPreviewing, isTesting, onPreview, onTest, onVolume,
}: {
  clip: SoundClip;
  isPreviewing: boolean;
  isTesting: boolean;
  onPreview: () => void;
  onTest: () => void;
  onVolume: (v: number) => void;
}) {
  const volumePercent = Math.round((clip.defaultVolume ?? 0.8) * 100);
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={onPreview}
        title={isPreviewing ? 'Stop preview' : 'Preview in your headphones'}
        style={iconBtn(isPreviewing)}
      >
        {isPreviewing ? <Square size={12} /> : <Play size={12} />}
      </button>
      <span style={{ fontSize: 13, color: '#e5e7eb', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {clip.name}
      </span>
      <span style={{ fontSize: 11, color: '#6b7280', minWidth: 60, textAlign: 'right' }}>
        {formatSize(clip.sizeBytes)}
      </span>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 130 }}>
        <Volume2 size={11} style={{ color: '#6b7280' }} />
        <input
          type="range"
          min={0}
          max={100}
          value={volumePercent}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
          title={`Default volume: ${volumePercent}%`}
          style={{ flex: 1, minWidth: 60 }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 30, textAlign: 'right' }}>{volumePercent}%</span>
      </div>
      <button
        type="button"
        onClick={onTest}
        disabled={isTesting}
        title="Play through the deck's audio path (goes to OBS if you route it)"
        style={testBtn(isTesting)}
      >
        test
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const triggerBtnStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 0, color: '#fff',
  cursor: 'pointer', padding: '12px 14px',
  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
};

const groupHeaderStyle: React.CSSProperties = {
  fontSize: 10, letterSpacing: 0.6, color: '#6b7280',
  padding: '8px 4px 4px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 8px', background: '#111827', borderRadius: 6,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px', background: '#0a0a0a', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13,
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 8px', background: '#1f2937', color: '#fff',
  border: '1px solid #374151', borderRadius: 6, fontSize: 13, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4,
};

const codeStyle: React.CSSProperties = {
  color: '#e5e7eb', background: '#111827', padding: '1px 4px', borderRadius: 3, fontSize: 11,
};

function iconBtn(active: boolean): React.CSSProperties {
  return {
    padding: 4, background: active ? '#312e81' : '#1f2937',
    color: '#e5e7eb', border: `1px solid ${active ? '#6366f1' : '#374151'}`,
    borderRadius: 6, cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22,
  };
}

function testBtn(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px', background: active ? '#312e81' : '#0a0a0a',
    color: active ? '#a5b4fc' : '#9ca3af', border: '1px solid #374151',
    borderRadius: 4, cursor: active ? 'default' : 'pointer', fontSize: 11,
    flexShrink: 0,
  };
}

/**
 * Shared bits used by every ActionEditor body: the "pick from a list OR type
 * a value" input, the native browse-file dialog trigger, and the styles they
 * all share. Kept in one file so each per-integration body stays focused on
 * that integration's own quirks.
 */
import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import * as api from '../../lib/api';

/** Renders a dropdown when we know the possible values, falls back to a free
 *  text input otherwise. Same shape whether Discord is connected (dropdown of
 *  live channels) or not (paste an ID). */
export function PickOrType({ value, options, placeholder, onChange, labelOf }: {
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

export const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: '#0a0a0a',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 14,
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  alignSelf: 'flex-start',
  paddingRight: 28,
};

export const addStepBtnStyle: React.CSSProperties = {
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

export function stepIconBtn(disabled: boolean): React.CSSProperties {
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
export function BrowseFileButton({ onPicked }: { onPicked: (path: string) => void }) {
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

import { useEffect, useRef, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

type Props = {
  value: string[];
  onChange: (keys: string[]) => void;
};

export function HotkeyInput({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const heldRef = useRef<string[]>([]);

  function update(next: string[]) {
    heldRef.current = next;
    setHeld(next);
  }

  useEffect(() => {
    if (!recording) {
      update([]);
      return;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Escape') {
        e.preventDefault();
        update([]);
        setRecording(false);
        return;
      }
      const k = codeToNutJs(e.code);
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      if (heldRef.current.includes(k)) return; // ignore auto-repeat
      update([...heldRef.current, k]);
    }

    function onKeyUp(e: KeyboardEvent) {
      const k = codeToNutJs(e.code);
      if (!k) return;
      // Only react to releases of keys we captured — prevents the Space/Enter
      // that activated the record button from being treated as the hotkey.
      if (!heldRef.current.includes(k)) return;
      e.preventDefault();
      if (isModifier(k)) {
        update(heldRef.current.filter((x) => x !== k));
        return;
      }
      const sorted = sortKeys(heldRef.current);
      if (sorted.length > 0) onChange(sorted);
      update([]);
      setRecording(false);
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [recording, onChange]);

  const liveDisplay = recording && held.length > 0 ? held.map(displayKey).join(' + ') : null;
  const savedDisplay = !recording && value.length > 0 ? value.map(displayKey).join(' + ') : null;

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => { if (!recording) setRecording(true); }}
        style={{
          flex: 1,
          padding: '8px 12px',
          background: recording ? '#1e3a8a' : '#0a0a0a',
          color: '#fff',
          border: `1px solid ${recording ? '#3b82f6' : '#374151'}`,
          borderRadius: 6,
          fontSize: 14,
          cursor: recording ? 'default' : 'pointer',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 36,
        }}
        title={recording ? 'press your hotkey (Esc to cancel)' : 'click, then press the keys you want'}
      >
        <Keyboard size={14} style={{ color: recording ? '#f59e0b' : '#9ca3af', flexShrink: 0 }} />
        {recording ? (
          <span style={{ fontFamily: 'monospace' }}>
            <span style={{ color: '#f59e0b', fontFamily: 'system-ui' }}>● recording — </span>
            {liveDisplay ?? <span style={{ color: '#9ca3af', fontFamily: 'system-ui' }}>press keys (Esc to cancel)</span>}
          </span>
        ) : savedDisplay ? (
          <span style={{ fontFamily: 'monospace' }}>{savedDisplay}</span>
        ) : (
          <span style={{ color: '#6b7280' }}>click to record a hotkey</span>
        )}
      </button>
      {value.length > 0 && !recording && (
        <button
          type="button"
          onClick={() => onChange([])}
          style={{ background: 'transparent', border: 0, color: '#9ca3af', cursor: 'pointer', padding: 4 }}
          title="clear"
          aria-label="clear hotkey"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

// Map browser KeyboardEvent.code → nut-js Key enum names.
// We use .code (not .key) so it's layout-independent: KeyA always means A.
function codeToNutJs(code: string): string | null {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);   // KeyA → A
  if (code.startsWith('Digit') && code.length === 6) return 'Num' + code.slice(5); // Digit1 → Num1
  if (/^F\d{1,2}$/.test(code)) return code;                                // F1..F12
  return SPECIAL_MAP[code] ?? null;
}

const SPECIAL_MAP: Record<string, string> = {
  ControlLeft: 'LeftControl', ControlRight: 'RightControl',
  ShiftLeft:   'LeftShift',   ShiftRight:   'RightShift',
  AltLeft:     'LeftAlt',     AltRight:     'RightAlt',
  MetaLeft:    'LeftSuper',   MetaRight:    'RightSuper',

  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  CapsLock: 'CapsLock', NumLock: 'NumLock', ScrollLock: 'ScrollLock',
  PrintScreen: 'Print', Pause: 'Pause',

  Minus: 'Minus', Equal: 'Equal',
  BracketLeft: 'LeftBracket', BracketRight: 'RightBracket',
  Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote',
  Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backquote: 'Grave',

  // Numpad
  Numpad0: 'NumPad0', Numpad1: 'NumPad1', Numpad2: 'NumPad2', Numpad3: 'NumPad3',
  Numpad4: 'NumPad4', Numpad5: 'NumPad5', Numpad6: 'NumPad6', Numpad7: 'NumPad7',
  Numpad8: 'NumPad8', Numpad9: 'NumPad9',
  NumpadAdd: 'Add', NumpadSubtract: 'Subtract',
  NumpadMultiply: 'Multiply', NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal', NumpadEnter: 'Enter',

  // Media (may not fire in all browsers; OS often intercepts)
  AudioVolumeUp: 'AudioVolUp', AudioVolumeDown: 'AudioVolDown', AudioVolumeMute: 'AudioMute',
  MediaPlayPause: 'AudioPlay', MediaTrackNext: 'AudioNext',
  MediaTrackPrevious: 'AudioPrev', MediaStop: 'AudioStop',
};

function isModifier(name: string): boolean {
  return /^(Left|Right)(Control|Shift|Alt|Super)$/.test(name);
}

const MODIFIER_ORDER = [
  'LeftControl', 'RightControl', 'LeftShift', 'RightShift',
  'LeftAlt', 'RightAlt', 'LeftSuper', 'RightSuper',
];

function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ai = MODIFIER_ORDER.indexOf(a);
    const bi = MODIFIER_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return 0;
  });
}

const DISPLAY_MAP: Record<string, string> = {
  LeftControl: 'Ctrl', RightControl: 'Ctrl',
  LeftShift: 'Shift',  RightShift: 'Shift',
  LeftAlt: 'Alt',      RightAlt: 'Alt',
  LeftSuper: 'Win',    RightSuper: 'Win',
};

function displayKey(name: string): string {
  if (DISPLAY_MAP[name]) return DISPLAY_MAP[name];
  if (name.startsWith('Num') && /^Num\d$/.test(name)) return name.slice(3); // Num1 → 1
  return name;
}

import { useRef } from 'react';
import { Palette, X } from 'lucide-react';

type Props = {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Optional human label, e.g. "accent" or "background". Shown as title-attribute on the trigger. */
  label?: string;
};

const PRESETS: string[] = [
  '#3b82f6', // blue
  '#10b981', // green
  '#ef4444', // red
  '#f59e0b', // amber
  '#a855f7', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#6b7280', // neutral
];

export function ColorPicker({ value, onChange, label }: Props) {
  const nativeRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {PRESETS.map((hex) => {
          const isSelected = value?.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              title={hex}
              style={{
                width: 22, height: 22,
                background: hex,
                border: `2px solid ${isSelected ? '#fff' : 'transparent'}`,
                borderRadius: '50%',
                cursor: 'pointer',
                padding: 0,
                boxShadow: isSelected ? '0 0 0 1px #374151' : 'none',
              }}
              aria-label={`set ${label ?? 'color'} to ${hex}`}
            />
          );
        })}

        {/* Native picker for off-palette colors. */}
        <button
          type="button"
          onClick={() => nativeRef.current?.click()}
          title="custom color"
          style={{
            width: 22, height: 22,
            background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
            border: '1px solid #374151',
            borderRadius: '50%',
            cursor: 'pointer',
            padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={`pick custom ${label ?? 'color'}`}
        >
          <Palette size={11} color="#fff" />
        </button>
        <input
          ref={nativeRef}
          type="color"
          value={value ?? '#3b82f6'}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
          tabIndex={-1}
        />

        {/* Clear */}
        <button
          type="button"
          onClick={() => onChange(undefined)}
          disabled={!value}
          title={value ? `clear ${label ?? 'color'}` : `no ${label ?? 'color'} set`}
          style={{
            width: 22, height: 22,
            background: '#0a0a0a',
            border: '1px dashed #4b5563',
            borderRadius: '50%',
            cursor: value ? 'pointer' : 'default',
            color: value ? '#9ca3af' : '#374151',
            padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={`clear ${label ?? 'color'}`}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

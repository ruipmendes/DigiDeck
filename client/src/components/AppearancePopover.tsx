import { useEffect, useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { getIcon } from '../lib/icons';
import { imageUrl } from '../lib/api';

/** Hints used to render the trigger button's preview at a glance. */
export type AppearanceHint = {
  icon?: string;
  image?: string;
  accentColor?: string;
};

type Props = {
  hint?: AppearanceHint;
  children: React.ReactNode;
  /** Hover/aria title for the trigger. */
  title?: string;
};

/**
 * A small trigger button that opens a floating popover containing
 * appearance controls (icon + image + color, or any combination).
 *
 * The trigger shows the current state inline:
 *   - tile/page image thumbnail if set, else
 *   - lucide icon if set, else
 *   - a generic palette icon
 *   - with an accent-colored border if `accentColor` is set
 *
 * That keeps the row scannable — you can see the current customization
 * without opening the popover.
 */
export function AppearancePopover({ hint, children, title = 'Appearance' }: Props) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const Icon = getIcon(hint?.icon);
  const previewSrc = hint?.image ? imageUrl(hint.image) : null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        style={{
          width: 40, height: 40,
          background: '#0a0a0a',
          border: hint?.accentColor ? `2px solid ${hint.accentColor}` : '1px solid #374151',
          borderRadius: 8,
          color: '#fff',
          cursor: 'pointer',
          padding: 0,
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {previewSrc ? (
          <img
            src={previewSrc}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : Icon ? (
          <Icon size={18} strokeWidth={1.75} />
        ) : (
          <Palette size={16} color="#9ca3af" />
        )}
      </button>
      {open && (
        <div
          ref={popRef}
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%', left: 0,
            marginTop: 6,
            background: '#0a0a0a',
            border: '1px solid #374151',
            borderRadius: 10,
            padding: 12,
            minWidth: 300,
            zIndex: 20,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Small section header used inside the popover to label each picker. */
export function AppearanceSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

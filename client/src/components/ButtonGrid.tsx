import { useEffect, useState } from 'react';
import type { ButtonState, Layout } from '../ws';
import { getIcon } from '../lib/icons';

type Props = {
  layout: Layout | null;
  lastAck: { id: number; at: number } | null;
  buttonStates: Map<number, ButtonState>;
  onPress: (id: number) => void;
};

const PAGE_KEY = 'digi-deck:active_page';

export function ButtonGrid({ layout, lastAck, buttonStates, onPress }: Props) {
  const [flash, setFlash] = useState<number | null>(null);
  const [activePageId, setActivePageId] = useState<number>(() => {
    const stored = localStorage.getItem(PAGE_KEY);
    return stored !== null ? Number(stored) : 0;
  });

  useEffect(() => {
    if (!lastAck) return;
    setFlash(lastAck.id);
    const t = setTimeout(() => setFlash(null), 180);
    return () => clearTimeout(t);
  }, [lastAck]);

  useEffect(() => {
    localStorage.setItem(PAGE_KEY, String(activePageId));
  }, [activePageId]);

  if (!layout) {
    return <div style={{ opacity: 0.5, fontSize: 14 }}>Waiting for layout from server…</div>;
  }

  const activePage = layout.pages.find((p) => p.id === activePageId) ?? layout.pages[0];
  if (!activePage) {
    return <div style={{ opacity: 0.6 }}>No pages configured.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
      {layout.pages.length > 1 && (
        <PageTabs
          pages={layout.pages}
          activePageId={activePage.id}
          onSelect={setActivePageId}
        />
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          flex: 1,
          alignContent: 'start',
        }}
      >
        {activePage.buttons.map((b) => {
          const Icon = getIcon(b.icon);
          const state = buttonStates.get(b.id);
          const active = !!state?.active;
          const unavailable = !!state?.unavailable;
          const isSource = state?.kind === 'source';
          const activeColor = isSource ? '#10b981' : '#3b82f6';   // green for source, blue otherwise
          const activeBg    = isSource ? '#022c22' : '#172554';
          return (
            <button
              key={b.id}
              onPointerDown={() => {
                navigator.vibrate?.(15);
                onPress(b.id);
              }}
              style={{
                position: 'relative',
                background: flash === b.id ? '#3b82f6' : active ? activeBg : '#1f1f1f',
                border: active ? `2px solid ${activeColor}` : '1px solid #2a2a2a',
                borderRadius: 16,
                fontSize: 15,
                fontWeight: 500,
                padding: active ? 15 : 16, // compensate for thicker border
                whiteSpace: 'pre-line',
                transition: 'background 0.15s ease-out, border-color 0.15s, opacity 0.15s',
                cursor: 'pointer',
                touchAction: 'manipulation',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: '#fff',
                minHeight: 96,
                opacity: unavailable ? 0.4 : 1,
              }}
            >
              {Icon ? <Icon size={32} strokeWidth={1.75} /> : null}
              <span>{b.label}</span>
              {active && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: activeColor,
                    boxShadow: `0 0 10px ${activeColor}`,
                  }}
                />
              )}
              {unavailable && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    fontSize: 10,
                    color: '#9ca3af',
                    background: '#0a0a0a',
                    padding: '1px 5px',
                    borderRadius: 4,
                    border: '1px solid #374151',
                  }}
                >
                  offline
                </span>
              )}
            </button>
          );
        })}
        {activePage.buttons.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 32 }}>
            no buttons on this page
          </div>
        )}
      </div>
    </div>
  );
}

type TabsProps = {
  pages: { id: number; name: string; icon?: string }[];
  activePageId: number;
  onSelect: (id: number) => void;
};

function PageTabs({ pages, activePageId, onSelect }: TabsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        paddingBottom: 4,
        scrollbarWidth: 'none',
      }}
    >
      {pages.map((p) => {
        const Icon = getIcon(p.icon);
        const active = p.id === activePageId;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              padding: '8px 14px',
              background: active ? '#3b82f6' : '#1f1f1f',
              border: `1px solid ${active ? '#3b82f6' : '#2a2a2a'}`,
              borderRadius: 999,
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
              touchAction: 'manipulation',
            }}
          >
            {Icon ? <Icon size={14} strokeWidth={2} /> : null}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

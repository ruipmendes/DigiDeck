import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, ArrowLeft, Home } from 'lucide-react';
import type { ButtonState, Layout, Tile } from '../ws';
import { getIcon } from '../lib/icons';

type Props = {
  layout: Layout | null;
  lastAck: { id: number; at: number } | null;
  buttonStates: Map<number, ButtonState>;
  onPress: (id: number) => void;
  onSliderChange: (id: number, value: number) => void;
  onSliderMute: (id: number) => void;
};

const PAGE_KEY = 'digi-deck:active_page';
const BACK_TILE_ID = -1; // synthetic id; never collides with real tile ids (which are >= 0)

export function ButtonGrid({ layout, lastAck, buttonStates, onPress, onSliderChange, onSliderMute }: Props) {
  const [flash, setFlash] = useState<number | null>(null);
  const [activePageId, setActivePageId] = useState<number>(() => {
    const stored = localStorage.getItem(PAGE_KEY);
    return stored !== null ? Number(stored) : 0;
  });
  // History stack of page ids we navigated through via folder buttons. Cleared when
  // user picks a tab or when the layout's nav mode is 'tabs'.
  const [history, setHistory] = useState<number[]>([]);

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

  const mode = layout.navigation ?? 'tabs';
  const homePageId = layout.pages[0]?.id ?? 0;
  const showTabs = mode !== 'folders' && layout.pages.length > 1;
  // In folders mode, the back/home tile is the always-available escape hatch
  // whenever we're not on the home page — even if we landed here without
  // history (e.g. arrived via tab click then config flipped to folders).
  const showBackTile = mode === 'folders' && activePage.id !== homePageId;
  const backTileIsHome = history.length === 0;

  function selectTab(pageId: number) {
    setHistory([]);
    setActivePageId(pageId);
  }

  function gotoPage(pageId: number) {
    if (mode === 'folders') {
      setHistory((h) => [...h, activePageId]);
    }
    setActivePageId(pageId);
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setActivePageId(prev);
      return h.slice(0, -1);
    });
  }

  function goHome() {
    setHistory([]);
    setActivePageId(homePageId);
  }

  function handlePress(t: Tile) {
    // Intercept goto-page actions client-side — server has no work to do for them.
    // (The action itself stays server-side; toPublic exposes the target page id on the tile.)
    if (t.kind === 'button' && t.gotoPageId !== undefined) {
      gotoPage(t.gotoPageId);
    }
    // Send to server too: any other steps in a sequence still execute server-side.
    onPress(t.id);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
      {showTabs && (
        <PageTabs
          pages={layout.pages}
          activePageId={activePage.id}
          onSelect={selectTab}
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
        {showBackTile && (
          <BackTileView
            flash={flash === BACK_TILE_ID}
            isHome={backTileIsHome}
            onPress={backTileIsHome ? goHome : goBack}
          />
        )}
        {activePage.buttons.map((t) => {
          const state = buttonStates.get(t.id);
          if (t.kind === 'slider') {
            return (
              <SliderTileView
                key={t.id}
                tile={t}
                state={state}
                onChange={(v) => onSliderChange(t.id, v)}
                onMute={() => onSliderMute(t.id)}
              />
            );
          }
          return (
            <ButtonTileView
              key={t.id}
              tile={t}
              state={state}
              flash={flash === t.id}
              onPress={() => handlePress(t)}
            />
          );
        })}
        {activePage.buttons.length === 0 && !showBackTile && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 32 }}>
            no buttons on this page
          </div>
        )}
      </div>
    </div>
  );
}

function BackTileView({ flash, isHome, onPress }: { flash: boolean; isHome: boolean; onPress: () => void }) {
  function handle() {
    navigator.vibrate?.(10);
    onPress();
  }
  const label = isHome ? 'Home' : 'Back';
  const Icon = isHome ? Home : ArrowLeft;
  return (
    <button
      onPointerDown={handle}
      aria-label={label.toLowerCase()}
      title={label.toLowerCase()}
      style={{
        position: 'relative',
        background: flash ? '#3b82f6' : '#1f1f1f',
        border: '1px dashed #4b5563',
        borderRadius: 16,
        fontSize: 14,
        fontWeight: 500,
        padding: 16,
        cursor: 'pointer',
        touchAction: 'manipulation',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: '#9ca3af',
        minHeight: 96,
        transition: 'background 0.15s ease-out, color 0.15s',
      }}
    >
      <Icon size={32} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}

function ButtonTileView({
  tile,
  state,
  flash,
  onPress,
}: {
  tile: Extract<Tile, { kind: 'button' }>;
  state: ButtonState | undefined;
  flash: boolean;
  onPress: () => void;
}) {
  const Icon = getIcon(tile.icon);
  const active = !!state?.active;
  const unavailable = !!state?.unavailable;
  const isSource = state?.kind === 'source';
  const activeColor = isSource ? '#10b981' : '#3b82f6';
  const activeBg = isSource ? '#022c22' : '#172554';
  const isStreamer = !!tile.streamerLogin;
  const thumbnail = state?.thumbnail;
  const live = state?.live;

  function handlePress() {
    navigator.vibrate?.(15);
    onPress();
  }

  return (
    <button
      onPointerDown={handlePress}
      style={{
        position: 'relative',
        background: flash ? '#3b82f6' : active ? activeBg : '#1f1f1f',
        border: active ? `2px solid ${activeColor}` : '1px solid #2a2a2a',
        borderRadius: 16,
        fontSize: 15,
        fontWeight: 500,
        padding: active ? 15 : 16,
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
      {isStreamer && thumbnail ? (
        <div style={{ position: 'relative' }}>
          <img
            src={thumbnail}
            alt=""
            draggable={false}
            style={{
              width: 56, height: 56, borderRadius: '50%', objectFit: 'cover',
              filter: live ? 'none' : 'grayscale(100%) brightness(0.7)',
              border: live ? '2px solid #a855f7' : '2px solid #374151',
              transition: 'filter 0.2s, border-color 0.2s',
            }}
          />
          {live && (
            <span
              aria-hidden
              style={{
                position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
                background: '#ef4444', color: '#fff', fontSize: 9, lineHeight: 1,
                padding: '2px 6px', borderRadius: 4, fontWeight: 700, letterSpacing: 0.3,
              }}
            >
              LIVE
            </span>
          )}
        </div>
      ) : isStreamer ? (
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: '#1f1f1f', border: '2px solid #374151',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#9ca3af', fontSize: 18, fontWeight: 700,
          }}
        >
          {(tile.label[0] ?? '?').toUpperCase()}
        </div>
      ) : Icon ? (
        <Icon size={32} strokeWidth={1.75} />
      ) : null}
      <span>{tile.label}</span>
      {active && !isStreamer && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 10, height: 10, borderRadius: 999,
            background: activeColor, boxShadow: `0 0 10px ${activeColor}`,
          }}
        />
      )}
      {unavailable && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 8, left: 8,
            fontSize: 10, color: '#9ca3af',
            background: '#0a0a0a', padding: '1px 5px',
            borderRadius: 4, border: '1px solid #374151',
          }}
        >
          offline
        </span>
      )}
    </button>
  );
}

function SliderTileView({
  tile,
  state,
  onChange,
  onMute,
}: {
  tile: Extract<Tile, { kind: 'slider' }>;
  state: ButtonState | undefined;
  onChange: (value: number) => void;
  onMute: () => void;
}) {
  const unavailable = !!state?.unavailable;
  const serverValue = state?.sliderValue ?? 0;
  const muted = !!state?.sliderMuted;

  // Local dragging state so the slider stays responsive — server echoes back ~ms later
  // and we want optimistic update during drag.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const displayValue = dragValue ?? serverValue;
  const percent = Math.round(displayValue * 100);

  function valueFromPointer(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, x));
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (unavailable) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = valueFromPointer(e.clientX);
    setDragValue(v);
    onChange(v);
    navigator.vibrate?.(8);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const v = valueFromPointer(e.clientX);
    setDragValue(v);
    onChange(v);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Release local control; let server state take over.
    setDragValue(null);
  }

  function handleMute(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigator.vibrate?.(15);
    onMute();
  }

  const fillColor = muted ? '#6b7280' : '#3b82f6';
  const borderColor = muted ? '#7f1d1d' : '#2a2a2a';

  return (
    <div
      style={{
        position: 'relative',
        background: '#1f1f1f',
        border: muted ? `2px solid ${borderColor}` : '1px solid #2a2a2a',
        borderRadius: 16,
        padding: muted ? 11 : 12,
        display: 'flex',
        flexDirection: 'column',
        color: '#fff',
        minHeight: 96,
        opacity: unavailable ? 0.4 : 1,
        gap: 6,
        userSelect: 'none',
      }}
    >
      {/* Top row: label + mute button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {tile.label}
        </span>
        <span style={{ fontSize: 11, color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
          {muted ? 'muted' : `${percent}%`}
        </span>
        <button
          onPointerDown={handleMute}
          aria-label={muted ? 'unmute' : 'mute'}
          title={muted ? 'unmute' : 'mute'}
          style={{
            background: muted ? '#7f1d1d' : 'transparent',
            border: `1px solid ${muted ? '#dc2626' : '#374151'}`,
            color: muted ? '#fee2e2' : '#9ca3af',
            borderRadius: 6,
            padding: 4,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            touchAction: 'manipulation',
          }}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>

      {/* Slider track */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 44,
          background: '#0a0a0a',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          overflow: 'hidden',
          touchAction: 'none',
          cursor: unavailable ? 'default' : 'pointer',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: `${percent}%`,
            background: fillColor,
            transition: dragValue === null ? 'width 0.15s ease-out, background 0.2s' : 'none',
          }}
        />
        {/* Thumb indicator (vertical bar at the fill edge) */}
        <div
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: `calc(${percent}% - 2px)`,
            width: 4,
            background: '#fff',
            borderRadius: 2,
            boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            transition: dragValue === null ? 'left 0.15s ease-out' : 'none',
          }}
        />
      </div>

      {unavailable && (
        <span
          aria-hidden
          style={{
            position: 'absolute', top: 8, left: 8,
            fontSize: 10, color: '#9ca3af',
            background: '#0a0a0a', padding: '1px 5px',
            borderRadius: 4, border: '1px solid #374151',
          }}
        >
          offline
        </span>
      )}
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

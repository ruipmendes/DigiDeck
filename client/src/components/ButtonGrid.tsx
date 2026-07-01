import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, ArrowLeft, Home } from 'lucide-react';
import type { ButtonState, Layout, Tile } from '../ws';
import { getIcon } from '../lib/icons';
import { imageUrl } from '../lib/api';

/** Convert "#abc" or "#aabbcc" to rgba(...). Falls back to the alpha-only black if parsing fails. */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type Props = {
  layout: Layout | null;
  lastAck: { id: number; at: number } | null;
  lastNack: { id: number; error: string; at: number } | null;
  buttonStates: Map<number, ButtonState>;
  onPress: (id: number, longPress?: boolean) => void;
  onSliderChange: (id: number, value: number) => void;
  onSliderMute: (id: number) => void;
};

const LONG_PRESS_MS = 500;

const PAGE_KEY = 'digi-deck:active_page';
const BACK_TILE_ID = -1; // synthetic id; never collides with real tile ids (which are >= 0)

export function ButtonGrid({ layout, lastAck, lastNack, buttonStates, onPress, onSliderChange, onSliderMute }: Props) {
  // Flash state carries the tile id AND the kind of flash so failed actions
  // can briefly tint red while successful ones tint blue/accent.
  const [flash, setFlash] = useState<{ id: number; kind: 'ack' | 'nack' } | null>(null);
  const [toast, setToast] = useState<{ message: string; at: number } | null>(null);
  const [activePageId, setActivePageId] = useState<number>(() => {
    const stored = localStorage.getItem(PAGE_KEY);
    return stored !== null ? Number(stored) : 0;
  });
  // History stack of page ids we navigated through via folder buttons. Cleared when
  // user picks a tab or when the layout's nav mode is 'tabs'.
  const [history, setHistory] = useState<number[]>([]);
  // Reserve a right-side thumb strip ONLY when the page actually scrolls;
  // otherwise the gutter would needlessly shrink columns when everything fits.
  const gridRef = useRef<HTMLDivElement>(null);
  const [pageScrolls, setPageScrolls] = useState(false);
  useEffect(() => {
    function check() {
      const doc = document.documentElement;
      setPageScrolls(doc.scrollHeight > doc.clientHeight);
    }
    check();
    const grid = gridRef.current;
    const ro = grid ? new ResizeObserver(check) : null;
    if (ro && grid) ro.observe(grid);
    window.addEventListener('resize', check);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [activePageId, layout]);

  useEffect(() => {
    if (!lastAck) return;
    setFlash({ id: lastAck.id, kind: 'ack' });
    const t = setTimeout(() => setFlash(null), 180);
    return () => clearTimeout(t);
  }, [lastAck]);

  useEffect(() => {
    if (!lastNack) return;
    setFlash({ id: lastNack.id, kind: 'nack' });
    // Distinct haptic so failures feel different from a normal press.
    navigator.vibrate?.([60, 40, 60]);
    setToast({ message: lastNack.error, at: lastNack.at });
    const t = setTimeout(() => setFlash(null), 350);
    return () => clearTimeout(t);
  }, [lastNack]);

  // Auto-dismiss the toast 4s after the latest failure.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    localStorage.setItem(PAGE_KEY, String(activePageId));
  }, [activePageId]);

  // Apply the active page's custom background to the body via CSS variables.
  // Image + color compose: image (with a dark overlay for legibility) sits on top of
  // the color, so any transparent pixels in the image still show the chosen color.
  const activePageMeta = layout?.pages.find((p) => p.id === activePageId);
  const activePageBg = activePageMeta?.background;
  const activePageBgImage = activePageMeta?.backgroundImage;
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--page-bg', activePageBg ?? '#0a0a0a');
    if (activePageBgImage) {
      root.style.setProperty('--page-bg-image', `url("${imageUrl(activePageBgImage)}")`);
      root.style.setProperty('--page-bg-overlay', '0.4');
    } else {
      root.style.removeProperty('--page-bg-image');
      root.style.removeProperty('--page-bg-overlay');
    }
    return () => {
      root.style.removeProperty('--page-bg');
      root.style.removeProperty('--page-bg-image');
      root.style.removeProperty('--page-bg-overlay');
    };
  }, [activePageBg, activePageBgImage]);

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

  function handlePress(t: Tile, longPress: boolean) {
    // Goto-page only fires on a *short* press — the long-press action could be anything.
    if (!longPress && t.kind === 'button' && t.gotoPageId !== undefined) {
      gotoPage(t.gotoPageId);
    }
    // Send to server too: any other steps in a sequence still execute server-side.
    onPress(t.id, longPress);
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
        ref={gridRef}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${activePage.cols ?? 2}, 1fr)`,
          gap: 12,
          flex: 1,
          alignContent: 'start',
          // Right-side thumb strip — only when the page actually scrolls,
          // so we don't shrink columns when the whole grid already fits.
          paddingRight: pageScrolls ? 24 : 0,
        }}
      >
        {showBackTile && (
          <BackTileView
            flash={flash?.id === BACK_TILE_ID}
            isHome={backTileIsHome}
            onPress={backTileIsHome ? goHome : goBack}
          />
        )}
        {activePage.buttons.map((t) => {
          if (t.kind === 'blank') {
            return <BlankTileView key={t.id} />;
          }
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
          const tileFlash = flash?.id === t.id ? flash.kind : undefined;
          return (
            <ButtonTileView
              key={t.id}
              tile={t}
              state={state}
              flash={!!tileFlash}
              flashKind={tileFlash}
              onPress={(longPress) => handlePress(t, longPress)}
            />
          );
        })}
        {activePage.buttons.length === 0 && !showBackTile && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#6b7280', fontSize: 14, padding: 32 }}>
            no buttons on this page
          </div>
        )}
      </div>
      {toast && <ActionFailureToast message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function ActionFailureToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        background: '#7f1d1d',
        border: '1px solid #b91c1c',
        borderRadius: 8,
        padding: '10px 14px',
        color: '#fee2e2',
        fontSize: 13,
        lineHeight: 1.4,
        zIndex: 100,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontWeight: 700, color: '#fff' }}>Failed</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message}</span>
      <span style={{ opacity: 0.6, fontSize: 11 }}>tap to dismiss</span>
    </div>
  );
}

/** Invisible spacer that still occupies its grid slot — used to push real tiles to a row/column. */
function BlankTileView() {
  return <div aria-hidden style={{ minHeight: 96, pointerEvents: 'none' }} />;
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
      className="tile-press"
      onPointerDown={handle}
      onContextMenu={(e) => e.preventDefault()}
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
        transition: 'background 0.15s ease-out, color 0.15s, transform 80ms ease-out',
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
  flashKind,
  onPress,
}: {
  tile: Extract<Tile, { kind: 'button' }>;
  state: ButtonState | undefined;
  flash: boolean;
  flashKind?: 'ack' | 'nack';
  onPress: (longPress: boolean) => void;
}) {
  const Icon = getIcon(tile.icon);
  const active = !!state?.active;
  const unavailable = !!state?.unavailable;
  const isSource = state?.kind === 'source';
  const defaultActiveColor = isSource ? '#10b981' : '#3b82f6';
  const defaultActiveBg = isSource ? '#022c22' : '#172554';
  const activeColor = tile.accentColor ?? defaultActiveColor;
  const activeBg = tile.accentColor ? hexToRgba(tile.accentColor, 0.18) : defaultActiveBg;
  const flashColor =
    flashKind === 'nack' ? '#dc2626' :  // red for failure
    (tile.accentColor ?? '#3b82f6');
  // Resting border picks up the accent (thin) so the colour is visible even
  // on tiles that never enter the "active" state — otherwise picking an
  // accent on a plain Hotkey button has no visible effect.
  const restingBorder = tile.accentColor ?? '#2a2a2a';
  const isStreamer = !!tile.streamerLogin || !!tile.kickStreamerSlug;
  const isKickStreamer = !!tile.kickStreamerSlug;
  const thumbnail = state?.thumbnail;
  const live = state?.live;
  const hasImage = !!tile.image && !isStreamer;
  const longPressEnabled = !!tile.hasLongPress;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function onPointerDown() {
    navigator.vibrate?.(15);
    if (!longPressEnabled) {
      // Instant fire — no latency penalty for buttons without a long-press action.
      onPress(false);
      return;
    }
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      navigator.vibrate?.(40);
      onPress(true);
    }, LONG_PRESS_MS);
  }

  function onPointerUp() {
    if (!longPressEnabled) return;
    if (longPressFired.current) {
      // Long press already dispatched on timer fire.
      longPressFired.current = false;
      return;
    }
    clearLongPressTimer();
    onPress(false);
  }

  function onPointerCancel() {
    clearLongPressTimer();
    longPressFired.current = false;
  }

  return (
    <button
      className="tile-press"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerCancel}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'relative',
        background: flash ? flashColor : active ? activeBg : '#1f1f1f',
        border: active ? `2px solid ${activeColor}` : `1px solid ${restingBorder}`,
        borderRadius: 16,
        fontSize: 15,
        fontWeight: 500,
        padding: hasImage ? 0 : active ? 15 : 16,
        whiteSpace: 'pre-line',
        transition: 'background 0.15s ease-out, border-color 0.15s, opacity 0.15s, transform 80ms ease-out',
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
        overflow: 'hidden',
      }}
    >
      {hasImage && tile.image && (
        <>
          <img
            src={imageUrl(tile.image)}
            alt=""
            draggable={false}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'cover',
              pointerEvents: 'none',
            }}
          />
          {tile.label && (
            <span
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                padding: '6px 8px',
                background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
                textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                pointerEvents: 'none',
              }}
            >
              {tile.label}
            </span>
          )}
        </>
      )}
      {!hasImage && (
        <>
          {isStreamer && thumbnail ? (
            <div style={{ position: 'relative' }}>
              <img
                src={thumbnail}
                alt=""
                draggable={false}
                style={{
                  width: 56, height: 56, borderRadius: '50%', objectFit: 'cover',
                  filter: live ? 'none' : 'grayscale(100%) brightness(0.7)',
                  border: live
                    ? `2px solid ${isKickStreamer ? '#53fc18' : '#a855f7'}`
                    : '2px solid #374151',
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
        </>
      )}
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
  // After release, keep showing the user's intended value until the server
  // broadcast catches up. Otherwise a fast tap snaps back to the pre-tap
  // value for the ~150ms broadcast debounce window.
  const [pendingValue, setPendingValue] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const displayValue = dragValue ?? pendingValue ?? serverValue;
  const percent = Math.round(displayValue * 100);

  // Server caught up to our last sent value → release the pending.
  useEffect(() => {
    if (pendingValue === null) return;
    if (Math.abs(serverValue - pendingValue) < 0.02) {
      setPendingValue(null);
    }
  }, [serverValue, pendingValue]);

  // Safety timeout — if a broadcast never arrives (e.g., RPC silently failed),
  // drop the pending after 1s so the slider reflects reality.
  useEffect(() => {
    if (pendingValue === null) return;
    const t = setTimeout(() => setPendingValue(null), 1000);
    return () => clearTimeout(t);
  }, [pendingValue]);

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
    // Hand off to pendingValue so the slider keeps showing the user's last
    // sent value until the next server broadcast confirms it (or 1s safety).
    if (dragValue !== null) setPendingValue(dragValue);
    setDragValue(null);
  }

  function handleMute(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    navigator.vibrate?.(15);
    onMute();
  }

  const fillColor = muted ? '#6b7280' : (tile.accentColor ?? '#3b82f6');
  const borderColor = muted ? '#7f1d1d' : (tile.accentColor ?? '#2a2a2a');

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
          className="tile-press"
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
            transition: 'transform 80ms ease-out',
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
  pages: { id: number; name: string; icon?: string; image?: string }[];
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
            {p.image ? (
              <img
                src={imageUrl(p.image)}
                alt=""
                draggable={false}
                style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }}
              />
            ) : Icon ? (
              <Icon size={14} strokeWidth={2} />
            ) : null}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

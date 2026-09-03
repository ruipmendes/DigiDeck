import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Sliders, Hand, ChevronDown, ChevronRight, Square } from 'lucide-react';
import type { Tile, Page, TileKind, Layout, ButtonAction, SliderProvider, Action, ChartSource } from '../lib/types';
import { defaultTile, defaultAction } from '../lib/types';
import { ActionEditor } from './ActionEditor';
import { IconPicker } from './IconPicker';
import { ImagePicker } from './ImagePicker';
import { ColorPicker } from './ColorPicker';
import { AppearancePopover, AppearanceSection } from './AppearancePopover';
import * as api from '../lib/api';

import type { IntegrationStatus } from '../lib/types';
export type { IntegrationStatus };

type Props = {
  button: Tile;
  pages: Page[];
  currentPageId: number;
  layout: Layout;
  integrationStatus: IntegrationStatus;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (patch: Partial<Tile>) => void;
  onDelete: () => void;
  onMove: (toPageId: number) => void;
};

export function ConfigRow(props: Props) {
  if (props.button.kind === 'blank') {
    return <BlankConfigRow {...props} button={props.button} />;
  }
  return <NonBlankConfigRow {...props} button={props.button} />;
}

type NonBlankProps = Omit<Props, 'button'> & { button: Exclude<Tile, { kind: 'blank' }> };

function NonBlankConfigRow({ button, pages, currentPageId, layout, integrationStatus, expanded, onToggleExpanded, onChange, onDelete, onMove }: NonBlankProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: button.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function changeKind(newKind: TileKind) {
    if (newKind === button.kind) return;
    // Reset action/inputName when switching kinds — fields differ between types.
    const replacement = defaultTile(newKind, button.id);
    // Carry label/icon when switching button↔slider; blank has neither.
    if (replacement.kind !== 'blank') {
      replacement.label = button.label;
      replacement.icon = button.icon;
    }
    onChange(replacement);
  }

  const summary = summarizeTile(button);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 10,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Always-visible summary row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr auto auto auto auto',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          {...attributes}
          {...listeners}
          style={{ background: 'transparent', border: 0, color: '#6b7280', cursor: 'grab', padding: 4 }}
          aria-label="drag to reorder"
        >
          <GripVertical size={18} />
        </button>

        <AppearancePopover
          hint={{ icon: button.icon, image: button.image, accentColor: button.accentColor }}
          title="tile appearance"
        >
          <AppearanceSection label="Icon">
            <IconPicker value={button.icon} onChange={(icon) => onChange({ icon })} />
          </AppearanceSection>
          <AppearanceSection label="Image">
            <ImagePicker
              value={button.image}
              onChange={(image) => onChange({ image })}
              referencedElsewhere={
                button.image
                  ? api.imageReferenceCount(layout, button.image, { tileId: button.id }) > 0
                  : false
              }
              imageFit={button.kind === 'button' ? button.imageFit : undefined}
              onFitChange={
                button.kind === 'button'
                  ? (imageFit) => onChange({ imageFit } as Partial<Tile>)
                  : undefined
              }
            />
          </AppearanceSection>
          <AppearanceSection label="Accent color">
            <ColorPicker
              value={button.accentColor}
              onChange={(accentColor) => onChange({ accentColor })}
              label="accent"
            />
          </AppearanceSection>
        </AppearancePopover>

        <input
          value={button.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Label"
          style={{ ...inputStyle, padding: '6px 10px' }}
        />

        <SummaryChip text={summary} onClick={() => onToggleExpanded()} />

        {pages.length > 1 ? (
          <select
            value={currentPageId}
            onChange={(e) => {
              const to = Number(e.target.value);
              if (to !== currentPageId) onMove(to);
            }}
            title="move to page"
            style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, maxWidth: 140 }}
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentPageId ? `${p.name} (here)` : `→ ${p.name}`}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => onToggleExpanded()}
            style={toggleBtnStyle}
            aria-label={expanded ? 'collapse details' : 'expand details'}
            aria-expanded={expanded}
            title={expanded ? 'collapse details' : 'expand details'}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Edit</span>
          </button>
          <button
            onClick={onDelete}
            style={iconBtnStyle}
            aria-label="delete tile"
            title="delete"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 4px 4px 36px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={metaLabel}>Kind</span>
            <select
              value={button.kind}
              onChange={(e) => changeKind(e.target.value as TileKind)}
              title="tile kind"
              style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, maxWidth: 120 }}
            >
              <option value="button">Button</option>
              <option value="slider">Slider</option>
              <option value="blank">Blank (spacer)</option>
              <option value="discord-voice-panel">Discord voice panel</option>
              <option value="chart">Chart (sparkline)</option>
            </select>
            <span style={{ ...metaLabel, marginLeft: 'auto' }}>id: {button.id}</span>
          </div>
          {button.kind === 'slider' ? (
            <SliderEditor
              inputName={button.inputName}
              provider={button.provider ?? 'obs'}
              integrationStatus={integrationStatus}
              onChange={(patch) => onChange(patch)}
            />
          ) : button.kind === 'discord-voice-panel' ? (
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              Renders a live list of the members in whichever Discord voice channel
              you're currently in. Each row has a volume slider (0–200 %) and a
              mute-for-me toggle. No config beyond label / cosmetics.
            </span>
          ) : button.kind === 'chart' ? (
            <ChartEditor tile={button} onChange={onChange} />
          ) : (
            <>
              <ActionEditor
                action={button.action}
                onChange={(action) => onChange({ action })}
                pages={pages.map((p) => ({ id: p.id, name: p.name }))}
                integrationStatus={integrationStatus}
              />
              <LongPressEditor
                value={button.longPressAction}
                onChange={(longPressAction) => onChange({ longPressAction })}
                pages={pages.map((p) => ({ id: p.id, name: p.name }))}
                integrationStatus={integrationStatus}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

type BlankProps = Omit<Props, 'button'> & { button: Extract<Tile, { kind: 'blank' }> };

/**
 * Compact row for spacer tiles — no label/appearance/action, just drag handle,
 * a static "blank" hint, page-move, kind switcher (to convert back), and delete.
 */
function BlankConfigRow({ button, pages, currentPageId, expanded, onToggleExpanded, onChange, onDelete, onMove }: BlankProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: button.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  function changeKind(newKind: TileKind) {
    if (newKind === button.kind) return;
    onChange(defaultTile(newKind, button.id));
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: '#0a0a0a',
        border: '1px dashed #374151',
        borderRadius: 10,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr auto auto auto',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <button
          {...attributes}
          {...listeners}
          style={{ background: 'transparent', border: 0, color: '#6b7280', cursor: 'grab', padding: 4 }}
          aria-label="drag to reorder"
        >
          <GripVertical size={18} />
        </button>

        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, color: '#4b5563' }}>
          <Square size={16} strokeDasharray="3 3" />
        </span>

        <span style={{ color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
          Blank tile · holds an empty grid slot
        </span>

        {pages.length > 1 ? (
          <select
            value={currentPageId}
            onChange={(e) => {
              const to = Number(e.target.value);
              if (to !== currentPageId) onMove(to);
            }}
            title="move to page"
            style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, maxWidth: 140 }}
          >
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === currentPageId ? `${p.name} (here)` : `→ ${p.name}`}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}

        <button
          onClick={() => onToggleExpanded()}
          style={toggleBtnStyle}
          aria-label={expanded ? 'collapse details' : 'expand details'}
          aria-expanded={expanded}
          title={expanded ? 'collapse details' : 'convert to button or slider'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Edit</span>
        </button>

        <button
          onClick={onDelete}
          style={iconBtnStyle}
          aria-label="delete tile"
          title="delete"
        >
          <Trash2 size={18} />
        </button>
      </div>

      {expanded && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 4px 4px 36px' }}>
          <span style={metaLabel}>Kind</span>
          <select
            value={button.kind}
            onChange={(e) => changeKind(e.target.value as TileKind)}
            title="tile kind"
            style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, maxWidth: 160 }}
          >
            <option value="button">Button</option>
            <option value="slider">Slider</option>
            <option value="blank">Blank (spacer)</option>
          </select>
          <span style={{ ...metaLabel, marginLeft: 'auto' }}>id: {button.id}</span>
        </div>
      )}
    </div>
  );
}

function SummaryChip({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="edit action details"
      style={{
        padding: '4px 10px',
        background: '#0a0a0a',
        border: '1px solid #1f2937',
        borderRadius: 999,
        color: '#9ca3af',
        fontSize: 12,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 280,
      }}
    >
      {text}
    </button>
  );
}

function summarizeTile(tile: Tile): string {
  if (tile.kind === 'blank') return 'Spacer · empty grid slot';
  if (tile.kind === 'discord-voice-panel') return 'Discord voice panel · live channel roster';
  if (tile.kind === 'chart') return `Chart · ${tile.source}${tile.mode === 'delta' ? ' (delta)' : ''}`;
  if (tile.kind === 'slider') {
    const provider =
      tile.provider === 'streamlabs' ? 'Streamlabs' :
      tile.provider === 'discord'    ? 'Discord' :
                                       'OBS';
    return tile.inputName ? `${provider} slider · ${tile.inputName}` : `${provider} slider`;
  }
  const action = tile.action;
  if (Array.isArray(action)) {
    if (action.length === 0) return '(empty sequence)';
    const types = action.map(actionTypeShort).join(' → ');
    return `${action.length}-step · ${types}`;
  }
  return summarizeAction(action);
}

function summarizeAction(a: Action): string {
  switch (a.type) {
    case 'hotkey':           return a.keys.length > 0 ? `Hotkey · ${a.keys.join('+')}` : 'Hotkey';
    case 'text':             return a.text ? `Type · "${ellipsis(a.text, 24)}"` : 'Type text';
    case 'launch':           return a.path ? `Launch · ${trail(a.path)}` : 'Launch app';
    case 'url':              return a.url ? `Open · ${trail(a.url)}` : 'Open URL';
    case 'script':           return 'PowerShell';
    case 'volume':           return a.mute ? 'Mute toggle' : `Volume ${(a.delta ?? 0) >= 0 ? '+' : ''}${a.delta ?? 2}`;
    case 'sound':            return a.path ? `Sound · ${trail(a.path)}` : 'Play sound';
    case 'mic':              return `Mic · ${a.op}`;
    case 'app-audio':        return a.op === 'set-volume'
      ? `${a.params?.appName || 'App'} · ${a.params?.volumePercent ?? 50}%`
      : `${a.params?.appName || 'App'} · ${a.op}`;
    case 'obs':              return a.params?.sceneName ? `OBS · ${a.op} (${a.params.sceneName})` : `OBS · ${a.op}`;
    case 'streamlabs':       return a.params?.sceneName ? `Streamlabs · ${a.op} (${a.params.sceneName})` : `Streamlabs · ${a.op}`;
    case 'twitch':           return a.text ? `Twitch · "${ellipsis(a.text, 20)}"` : 'Twitch chat';
    case 'twitch-streamer':  return a.login ? `Streamer · ${a.login}` : 'Twitch streamer';
    case 'kick':             return a.op === 'chat'
      ? (a.text ? `Kick · "${ellipsis(a.text, 20)}"` : 'Kick chat')
      : `Kick · ${a.op}`;
    case 'kick-streamer':    return a.slug ? `Kick · ${a.slug}` : 'Kick streamer';
    case 'discord':          return `Discord · ${a.op}`;
    case 'spotify':          return `Spotify · ${a.op}`;
    case 'hue':              return `Hue · ${a.op}`;
    case 'openrgb':          return a.params?.profileName ? `OpenRGB · "${ellipsis(a.params.profileName, 18)}"` : 'OpenRGB · load profile';
    case 'nanoleaf':         return a.op === 'effect-select'
      ? (a.params?.effectName ? `Nanoleaf · "${ellipsis(a.params.effectName, 16)}"` : 'Nanoleaf · effect')
      : `Nanoleaf · ${a.op}`;
    case 'mixitup': {
      if (a.op === 'chat-message') return a.text ? `MIU · "${ellipsis(a.text, 20)}"` : 'MIU · chat';
      if (a.op === 'chat-clear') return 'MIU · clear chat';
      if (a.op === 'run-command' || a.op === 'enable-command' || a.op === 'disable-command' || a.op === 'toggle-command') {
        return a.params?.commandId ? `MIU · ${a.op} (cmd)` : `MIU · ${a.op}`;
      }
      if (a.op === 'counter-set' || a.op === 'counter-update' || a.op === 'counter-reset') {
        return a.params?.counterName ? `MIU · ${a.op} (${a.params.counterName})` : `MIU · ${a.op}`;
      }
      return `MIU · ${a.op}`;
    }
    case 'homeassistant':    return a.op === 'service-call'
      ? `HA · ${a.params?.service || 'service-call'}`
      : `HA · ${a.op}${a.params?.entityId ? ` (${a.params.entityId})` : ''}`;
    case 'goto-page':        return `Go to page ${a.pageId}`;
    case 'wait':             return `Wait ${a.ms}ms`;
  }
}

function actionTypeShort(a: Action): string {
  // Single-word type for compact sequence summaries.
  switch (a.type) {
    case 'twitch-streamer': return 'streamer';
    case 'goto-page':       return 'goto';
    default:                return a.type;
  }
}

function ellipsis(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function trail(s: string): string {
  // Show the last segment of a path/URL so the chip stays short.
  const parts = s.split(/[\\/]/);
  return ellipsis(parts[parts.length - 1] || s, 24);
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 0,
  color: '#9ca3af',
  cursor: 'pointer',
  padding: 4,
};

const toggleBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  background: '#1f2937',
  color: '#e5e7eb',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
};

const metaLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
};

const CHART_SOURCES: { value: ChartSource; label: string; defaultMode: 'value' | 'delta'; hint?: string }[] = [
  { value: 'obs.droppedFrames',     label: 'OBS · dropped frames',   defaultMode: 'delta', hint: 'Use delta mode — the counter climbs monotonically, delta shows when drops actually happen.' },
  { value: 'spotify.volumePercent', label: 'Spotify · volume %',     defaultMode: 'value' },
  { value: 'kick.viewerCount',      label: 'Kick · viewer count',    defaultMode: 'value', hint: 'Value only populates while the authenticated Kick account is live.' },
  { value: 'system.cpu',            label: 'System · CPU %',         defaultMode: 'value' },
  { value: 'system.ram',            label: 'System · RAM %',         defaultMode: 'value' },
  { value: 'system.gpu',            label: 'System · GPU %',         defaultMode: 'value', hint: 'Windows only — sampled via PowerShell perf counter every ~3 s (MAX across GPU engines, matches Task Manager).' },
];

function ChartEditor({
  tile,
  onChange,
}: {
  tile: Extract<Tile, { kind: 'chart' }>;
  onChange: (patch: Partial<Tile>) => void;
}) {
  const src = CHART_SOURCES.find((s) => s.value === tile.source);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>
        Rolling sparkline of a numeric integration variable. Samples once per second,
        keeps ~90 s of history. No tap action.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 46 }}>Source</span>
        <select
          value={tile.source}
          onChange={(e) => {
            const value = e.target.value as typeof CHART_SOURCES[number]['value'];
            const next = CHART_SOURCES.find((s) => s.value === value);
            onChange({ source: value, mode: next?.defaultMode ?? 'value' });
          }}
          style={selectStyle}
        >
          {CHART_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 46 }}>Mode</span>
        <select
          value={tile.mode ?? 'value'}
          onChange={(e) => onChange({ mode: e.target.value as 'value' | 'delta' })}
          style={selectStyle}
        >
          <option value="value">Value — plot raw number</option>
          <option value="delta">Delta — plot change since previous sample</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#9ca3af', minWidth: 46 }}>Range</span>
        <input
          type="number"
          value={tile.min ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ min: v === '' ? undefined : Number(v) });
          }}
          placeholder="auto min"
          style={{ ...inputStyle, width: 100 }}
        />
        <span style={{ color: '#6b7280' }}>→</span>
        <input
          type="number"
          value={tile.max ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ max: v === '' ? undefined : Number(v) });
          }}
          placeholder="auto max"
          style={{ ...inputStyle, width: 100 }}
        />
        <span style={{ fontSize: 11, color: '#6b7280' }}>leave blank to auto-scale</span>
      </div>
      {src?.hint && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>{src.hint}</span>
      )}
    </div>
  );
}

function SliderEditor({
  inputName,
  provider,
  integrationStatus,
  onChange,
}: {
  inputName: string;
  provider: SliderProvider;
  integrationStatus: IntegrationStatus;
  onChange: (patch: { inputName?: string; provider?: SliderProvider }) => void;
}) {
  const [inputs, setInputs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (provider === 'discord') {
      // Discord sliders drive singleton channels (input / output), no device list to fetch.
      let alive = true;
      api.getDiscordState()
        .then((d) => { if (alive) { setInputs([]); setConnected(d.status.state === 'connected'); } })
        .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      const t = setInterval(() => {
        api.getDiscordState()
          .then((d) => { if (alive) setConnected(d.status.state === 'connected'); })
          .catch(() => { if (alive) setConnected(false); });
      }, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    if (provider === 'app-audio') {
      // Live-poll the running audio sessions so users can pick from a
      // dropdown when the target app is already playing. Free-text input
      // still works when it isn't.
      let alive = true;
      function load() {
        api.getAppAudioSessions()
          .then((sessions) => { if (alive) { setInputs(sessions.map((s) => s.name)); setConnected(true); } })
          .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      }
      load();
      const t = setInterval(load, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    if (provider === 'hue') {
      // Hue slider — inputName encodes both "room:<id>" and "light:<id>". Pick
      // list combines both so users see everything a bridge exposes.
      let alive = true;
      function load() {
        api.getHueState()
          .then((d) => {
            if (!alive) return;
            const opts: string[] = [];
            for (const r of d.status.rooms ?? []) opts.push(`room:${r.id}`);
            for (const l of d.status.lights ?? []) opts.push(`light:${l.id}`);
            setInputs(opts);
            setConnected(d.status.state === 'connected');
          })
          .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      }
      load();
      const t = setInterval(load, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    if (provider === 'nanoleaf') {
      // Nanoleaf is a single controller — no per-input picking. Just show
      // whether it's connected.
      let alive = true;
      function load() {
        api.getNanoleafState()
          .then((d) => { if (alive) { setInputs([]); setConnected(d.status.state === 'connected'); } })
          .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      }
      load();
      const t = setInterval(load, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    if (provider === 'homeassistant') {
      // HA slider — inputName encodes `light:<entity_id>` or
      // `media:<entity_id>`. We list light + media_player entities.
      let alive = true;
      function load() {
        api.getHomeAssistantState()
          .then((d) => {
            if (!alive) return;
            const opts: string[] = [];
            for (const e of d.status.entities ?? []) {
              if (e.domain === 'light') opts.push(`light:${e.id}`);
              else if (e.domain === 'media_player') opts.push(`media:${e.id}`);
            }
            setInputs(opts);
            setConnected(d.status.state === 'connected');
          })
          .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      }
      load();
      const t = setInterval(load, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    if (provider === 'spotify') {
      // Spotify has one player volume — no input list to fetch.
      let alive = true;
      api.getSpotifyState()
        .then((d) => { if (alive) { setInputs([]); setConnected(d.status.state === 'connected'); } })
        .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
      const t = setInterval(() => {
        api.getSpotifyState()
          .then((d) => { if (alive) setConnected(d.status.state === 'connected'); })
          .catch(() => { if (alive) setConnected(false); });
      }, 4000);
      return () => { alive = false; clearInterval(t); };
    }
    let alive = true;
    function load() {
      const fetcher = provider === 'streamlabs'
        ? api.getStreamlabsState().then((d) => ({ inputs: d.status.inputs ?? [], connected: d.status.state === 'connected' }))
        : api.getObsState().then((d) => ({ inputs: d.status.inputs ?? [], connected: d.status.state === 'connected' }));
      fetcher
        .then((d) => {
          if (!alive) return;
          setInputs(d.inputs);
          setConnected(d.connected);
        })
        .catch(() => { if (alive) { setInputs([]); setConnected(false); } });
    }
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [provider]);

  const hasOptions = inputs.length > 0;
  const usingOptionList = hasOptions && (inputName === '' || inputs.includes(inputName));
  const providerLabel =
    provider === 'streamlabs' ? 'Streamlabs Desktop' :
    provider === 'discord'    ? 'Discord' :
    provider === 'spotify'    ? 'Spotify' :
    provider === 'app-audio'  ? 'Per-app audio' :
    provider === 'hue'        ? 'Philips Hue' :
    provider === 'homeassistant' ? 'Home Assistant' :
    provider === 'nanoleaf'   ? 'Nanoleaf' :
                                'OBS Studio';

  // Build the provider option list: include configured integrations, plus the
  // currently-selected provider even if its integration is disabled, so users
  // don't lose context when toggling the integration off.
  type ProviderOpt = { value: SliderProvider; label: string };
  const providerOpts: ProviderOpt[] = [];
  if (integrationStatus.obs        || provider === 'obs')        providerOpts.push({ value: 'obs',        label: 'OBS Studio' });
  if (integrationStatus.streamlabs || provider === 'streamlabs') providerOpts.push({ value: 'streamlabs', label: 'Streamlabs Desktop' });
  if (integrationStatus.discord    || provider === 'discord')    providerOpts.push({ value: 'discord',    label: 'Discord' });
  // Spotify slider is playback-control (Premium-only). Free-tier users literally
  // can't drive it, so hide the option — mirrors the ActionPicker policy.
  if ((integrationStatus.spotify && integrationStatus.spotifyPremium) || provider === 'spotify') {
    providerOpts.push({ value: 'spotify', label: 'Spotify' });
  }
  // Per-app audio doesn't need an integration to be enabled — it's system-level.
  // Always available on Windows.
  providerOpts.push({ value: 'app-audio', label: 'Per-app audio' });
  if (integrationStatus.hue        || provider === 'hue')        providerOpts.push({ value: 'hue',        label: 'Philips Hue' });
  if (integrationStatus.homeassistant || provider === 'homeassistant') providerOpts.push({ value: 'homeassistant', label: 'Home Assistant' });
  if (integrationStatus.nanoleaf   || provider === 'nanoleaf')   providerOpts.push({ value: 'nanoleaf',   label: 'Nanoleaf' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
        <Sliders size={12} /> {providerLabel} {
          provider === 'discord'   ? 'voice volume slider — drag-to-set + tap to mute/deafen' :
          provider === 'spotify'   ? 'player volume slider — drag-to-set + tap to play/pause' :
          provider === 'app-audio' ? 'per-app volume slider — drag-to-set + tap to mute the app' :
          provider === 'hue'       ? 'brightness slider — drag-to-set + tap toggles the light on/off' :
          provider === 'homeassistant' ? 'HA slider — light brightness or media_player volume; tap toggles / play-pauses' :
          provider === 'nanoleaf'   ? 'Nanoleaf brightness slider — drag-to-set + tap toggles the panels' :
          'audio mixer slider — drag-to-set-volume + tap-to-mute'
        }
      </div>
      {providerOpts.length > 0 && (
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as SliderProvider;
            // Discord sliders default to the mic ('input'); other providers reset to empty
            // so the user picks a named audio input. app-audio also starts empty —
            // the picker fills in from the live session list.
            onChange({ provider: next, inputName: next === 'discord' ? 'input' : '' });
          }}
          title="audio source provider"
          style={selectStyle}
        >
          {providerOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {providerOpts.length === 0 && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>
          Enable OBS, Streamlabs or Discord in Integrations to use slider tiles.
        </span>
      )}
      {provider === 'discord' ? (
        <select
          value={
            inputName === 'output' ? 'output' :
            inputName === 'sensitivity' ? 'sensitivity' :
            'input'
          }
          onChange={(e) => onChange({ inputName: e.target.value })}
          style={selectStyle}
        >
          <option value="input">Microphone input volume — tap to mute</option>
          <option value="output">Voice output volume — tap to deafen</option>
          <option value="sensitivity">Voice activation sensitivity — tap = pip when Discord's auto-threshold is on</option>
        </select>
      ) : usingOptionList ? (
        <select
          value={inputName}
          onChange={(e) => onChange({ inputName: e.target.value })}
          style={selectStyle}
        >
          <option value="">— pick a {providerLabel} audio input —</option>
          {inputs.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      ) : (
        <input
          value={inputName}
          onChange={(e) => onChange({ inputName: e.target.value })}
          placeholder={`${providerLabel} input name (e.g. Mic/Aux)`}
          style={inputStyle}
        />
      )}
      {!connected && (
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          {providerLabel} not connected — {provider === 'discord' ? 'connect Discord to drive this slider.' : 'type the input name manually, or connect it to pick from a list.'}
        </span>
      )}
    </div>
  );
}

type LongPressProps = {
  value: ButtonAction | undefined;
  onChange: (next: ButtonAction | undefined) => void;
  pages: { id: number; name: string }[];
  integrationStatus: IntegrationStatus;
};

function LongPressEditor({ value, onChange, pages, integrationStatus }: LongPressProps) {
  const [open, setOpen] = useState(value !== undefined);

  if (!open && value === undefined) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); onChange(defaultAction('hotkey')); }}
        style={{
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
        }}
        title="run a different action when the button is held (~500ms)"
      >
        <Hand size={12} /> add long-press action
      </button>
    );
  }

  return (
    <div
      style={{
        background: '#0a0a0a',
        border: '1px solid #1f2937',
        borderRadius: 8,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af', letterSpacing: 0.3 }}>
        <Hand size={12} /> LONG-PRESS ACTION · fires after ~500ms hold
        <button
          type="button"
          onClick={() => { setOpen(false); onChange(undefined); }}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 0,
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 11,
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          remove
        </button>
      </div>
      <ActionEditor
        action={value ?? defaultAction('hotkey')}
        onChange={onChange}
        pages={pages}
        integrationStatus={integrationStatus}
      />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  background: '#0a0a0a',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 6,
  fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  alignSelf: 'flex-start',
  paddingRight: 28,
};

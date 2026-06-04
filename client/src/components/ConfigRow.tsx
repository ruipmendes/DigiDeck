import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Sliders, Hand } from 'lucide-react';
import type { Tile, Page, TileKind, Layout, ButtonAction, SliderProvider } from '../lib/types';
import { defaultTile, defaultAction } from '../lib/types';
import { ActionEditor } from './ActionEditor';
import { IconPicker } from './IconPicker';
import { ImagePicker } from './ImagePicker';
import { ColorPicker } from './ColorPicker';
import * as api from '../lib/api';

export type IntegrationStatus = { obs: boolean; twitch: boolean; streamlabs: boolean };

type Props = {
  button: Tile;
  pages: Page[];
  currentPageId: number;
  layout: Layout;
  integrationStatus: IntegrationStatus;
  onChange: (patch: Partial<Tile>) => void;
  onDelete: () => void;
  onMove: (toPageId: number) => void;
};

export function ConfigRow({ button, pages, currentPageId, layout, integrationStatus, onChange, onDelete, onMove }: Props) {
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
    replacement.label = button.label;
    replacement.icon = button.icon;
    onChange(replacement);
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr auto auto',
        alignItems: 'start',
        gap: 12,
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 10,
        padding: 12,
      }}
    >
      <button
        {...attributes}
        {...listeners}
        style={{ background: 'transparent', border: 0, color: '#6b7280', cursor: 'grab', padding: 4, alignSelf: 'center' }}
        aria-label="drag to reorder"
      >
        <GripVertical size={18} />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <IconPicker value={button.icon} onChange={(icon) => onChange({ icon })} />
        <ImagePicker
          value={button.image}
          onChange={(image) => onChange({ image })}
          referencedElsewhere={
            button.image
              ? api.imageReferenceCount(layout, button.image, { tileId: button.id }) > 0
              : false
          }
        />
        <ColorPicker
          value={button.accentColor}
          onChange={(accentColor) => onChange({ accentColor })}
          label="accent"
        />
        <div style={{ fontSize: 10, color: '#6b7280' }}>id: {button.id}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={button.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Label"
            style={{ ...inputStyle, flex: 1 }}
          />
          <select
            value={button.kind}
            onChange={(e) => changeKind(e.target.value as TileKind)}
            title="tile kind"
            style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, maxWidth: 100 }}
          >
            <option value="button">Button</option>
            <option value="slider">Slider</option>
          </select>
        </div>
        {button.kind === 'slider' ? (
          <SliderEditor
            inputName={button.inputName}
            provider={button.provider ?? 'obs'}
            integrationStatus={integrationStatus}
            onChange={(patch) => onChange(patch)}
          />
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

      {pages.length > 1 ? (
        <select
          value={currentPageId}
          onChange={(e) => {
            const to = Number(e.target.value);
            if (to !== currentPageId) onMove(to);
          }}
          title="move to page"
          style={{
            ...inputStyle,
            alignSelf: 'center',
            padding: '6px 8px',
            fontSize: 12,
            maxWidth: 140,
          }}
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
        onClick={onDelete}
        style={{ background: 'transparent', border: 0, color: '#9ca3af', cursor: 'pointer', padding: 4, alignSelf: 'center' }}
        aria-label="delete tile"
        title="delete"
      >
        <Trash2 size={18} />
      </button>
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
  const providerLabel = provider === 'streamlabs' ? 'Streamlabs Desktop' : 'OBS Studio';

  // Build the provider option list: include configured integrations, plus the
  // currently-selected provider even if its integration is disabled, so users
  // don't lose context when toggling the integration off.
  type ProviderOpt = { value: SliderProvider; label: string };
  const providerOpts: ProviderOpt[] = [];
  if (integrationStatus.obs || provider === 'obs') providerOpts.push({ value: 'obs', label: 'OBS Studio' });
  if (integrationStatus.streamlabs || provider === 'streamlabs') providerOpts.push({ value: 'streamlabs', label: 'Streamlabs Desktop' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9ca3af' }}>
        <Sliders size={12} /> {providerLabel} audio mixer slider — drag-to-set-volume + tap-to-mute
      </div>
      {providerOpts.length > 0 && (
        <select
          value={provider}
          onChange={(e) => onChange({ provider: e.target.value as SliderProvider, inputName: '' })}
          title="audio source provider"
          style={selectStyle}
        >
          {providerOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {providerOpts.length === 0 && (
        <span style={{ fontSize: 11, color: '#f59e0b' }}>
          Enable OBS or Streamlabs in Integrations to use slider tiles.
        </span>
      )}
      {usingOptionList ? (
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
          {providerLabel} not connected — type the input name manually, or connect it to pick from a list.
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

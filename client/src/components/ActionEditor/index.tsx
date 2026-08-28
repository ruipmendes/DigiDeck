/**
 * Editor for a button's action (or ordered sequence of actions).
 *
 * Composition:
 *   - Top-level `ActionEditor` handles the single-step vs. multi-step-sequence
 *     switch. Each step renders through `ActionStepEditor`.
 *   - `ActionStepEditor` composes the Stream-Deck-style `ActionPicker` (choose
 *     what this step does) with a `Body` that renders the params UI for that
 *     specific action.
 *   - `Body` is a slim switch that dispatches to per-integration components
 *     (ObsBody, StreamlabsBody, TwitchBody, DiscordBody) or renders the small
 *     built-ins (hotkey, text, launch, url, etc.) inline.
 *
 * The heavy integration-specific UI lives in sibling files under this folder
 * so touching Twitch doesn't force a re-review of Discord and vice-versa.
 */
import { ArrowUp, ArrowDown, X, Plus } from 'lucide-react';
import type { Action, ButtonAction, IntegrationStatus, MicOp, SpotifyOp } from '../../lib/types';
import { defaultAction } from '../../lib/types';
import { HotkeyInput } from '../HotkeyInput';
import { ActionPicker } from '../ActionPicker';
import {
  inputStyle, selectStyle, addStepBtnStyle, stepIconBtn, BrowseFileButton,
} from './shared';
import { ObsBody } from './ObsBody';
import { StreamlabsBody } from './StreamlabsBody';
import { TwitchBody } from './TwitchBody';
import { DiscordBody } from './DiscordBody';
import { AppAudioBody } from './AppAudioBody';
import { KickBody } from './KickBody';
import { HueBody } from './HueBody';
import { HomeAssistantBody } from './HomeAssistantBody';
import { OpenRgbBody } from './OpenRgbBody';
import { NanoleafBody } from './NanoleafBody';

export type { IntegrationStatus };

type PageRef = { id: number; name: string };

type Props = {
  action: ButtonAction;
  onChange: (a: ButtonAction) => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

export function ActionEditor({ action, onChange, pages, integrationStatus }: Props) {
  const steps: Action[] = Array.isArray(action) ? action : [action];

  function commit(next: Action[]) {
    if (next.length === 0) return;            // shouldn't happen — guard
    if (next.length === 1) onChange(next[0]); // collapse back to single object
    else onChange(next);
  }

  function updateStep(i: number, a: Action) {
    const next = [...steps];
    next[i] = a;
    commit(next);
  }

  function removeStep(i: number) {
    commit(steps.filter((_, idx) => idx !== i));
  }

  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  }

  function addStep() {
    commit([...steps, defaultAction('hotkey')]);
  }

  if (steps.length === 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ActionStepEditor
          action={steps[0]}
          onChange={(a) => updateStep(0, a)}
          pages={pages}
          integrationStatus={integrationStatus}
        />
        <button onClick={addStep} style={addStepBtnStyle} type="button">
          <Plus size={12} /> add step
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: '#9ca3af', letterSpacing: 0.3 }}>
        {steps.length}-STEP SEQUENCE · runs in order, stops on first failure
      </div>
      {steps.map((step, i) => (
        <StepCard
          key={i}
          index={i}
          total={steps.length}
          step={step}
          onChange={(a) => updateStep(i, a)}
          onRemove={() => removeStep(i)}
          onMoveUp={() => moveStep(i, -1)}
          onMoveDown={() => moveStep(i, 1)}
          pages={pages}
          integrationStatus={integrationStatus}
        />
      ))}
      <button onClick={addStep} style={addStepBtnStyle} type="button">
        <Plus size={12} /> add step
      </button>
    </div>
  );
}

type StepCardProps = {
  index: number;
  total: number;
  step: Action;
  onChange: (a: Action) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

function StepCard({ index, total, step, onChange, onRemove, onMoveUp, onMoveDown, pages, integrationStatus }: StepCardProps) {
  return (
    <div
      style={{
        background: '#0a0a0a',
        border: '1px solid #1f2937',
        borderRadius: 8,
        padding: 8,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 8,
        alignItems: 'start',
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: '#6b7280',
          fontWeight: 600,
          alignSelf: 'center',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {index + 1}
      </div>
      <ActionStepEditor action={step} onChange={onChange} pages={pages} integrationStatus={integrationStatus} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="move up"
          title="move up"
          style={stepIconBtn(index === 0)}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="move down"
          title="move down"
          style={stepIconBtn(index === total - 1)}
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="remove step"
          title="remove step"
          style={stepIconBtn(false)}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

const MIC_OPS: { value: MicOp; label: string }[] = [
  { value: 'toggle-mute', label: 'Toggle mic mute' },
  { value: 'mute',        label: 'Mute mic' },
  { value: 'unmute',      label: 'Unmute mic' },
];

const SPOTIFY_OPS: { value: SpotifyOp; label: string }[] = [
  { value: 'toggle-play', label: 'Play / Pause (toggle)' },
  { value: 'play',        label: 'Play' },
  { value: 'pause',       label: 'Pause' },
  { value: 'next',        label: 'Next track' },
  { value: 'previous',    label: 'Previous track' },
];

type StepEditorProps = {
  action: Action;
  onChange: (a: Action) => void;
  pages?: PageRef[];
  integrationStatus?: IntegrationStatus;
};

function ActionStepEditor({ action, onChange, pages, integrationStatus }: StepEditorProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ActionPicker
        current={action}
        onPick={(next) => onChange(next)}
        integrationStatus={integrationStatus}
      />
      <Body action={action} onChange={onChange} pages={pages} />
    </div>
  );
}

function Body({ action, onChange, pages }: StepEditorProps) {
  switch (action.type) {
    case 'hotkey':
      return (
        <HotkeyInput
          value={action.keys}
          onChange={(keys) => onChange({ type: 'hotkey', keys })}
        />
      );
    case 'text':
      return (
        <input
          value={action.text}
          onChange={(e) => onChange({ type: 'text', text: e.target.value })}
          placeholder="text to type at cursor"
          style={inputStyle}
        />
      );
    case 'launch':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={action.path}
              onChange={(e) => onChange({ ...action, path: e.target.value })}
              placeholder="path or binary (e.g. notepad.exe)"
              style={{ ...inputStyle, flex: 1 }}
            />
            <BrowseFileButton
              onPicked={(p) => onChange({ ...action, path: p })}
            />
          </div>
          <input
            value={action.args?.join(', ') ?? ''}
            onChange={(e) => onChange({
              ...action,
              args: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
            })}
            placeholder="args (comma-separated, optional)"
            style={inputStyle}
          />
        </div>
      );
    case 'url':
      return (
        <input
          value={action.url}
          onChange={(e) => onChange({ type: 'url', url: e.target.value })}
          placeholder="https://… or steam://… or file path"
          style={inputStyle}
        />
      );
    case 'script':
      return (
        <textarea
          value={action.script}
          onChange={(e) => onChange({ type: 'script', script: e.target.value })}
          placeholder="PowerShell command(s)"
          rows={3}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
        />
      );
    case 'volume': {
      const mode: 'up' | 'down' | 'mute' =
        action.mute ? 'mute' : (action.delta ?? 0) >= 0 ? 'up' : 'down';
      const amount = Math.abs(action.delta ?? 2) || 2;
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as 'up' | 'down' | 'mute';
              if (m === 'mute') onChange({ type: 'volume', mute: true });
              else onChange({ type: 'volume', delta: m === 'up' ? amount : -amount });
            }}
            style={selectStyle}
          >
            <option value="up">Volume up</option>
            <option value="down">Volume down</option>
            <option value="mute">Mute toggle</option>
          </select>
          {mode !== 'mute' && (
            <>
              <label style={{ fontSize: 12, color: '#9ca3af' }}>steps:</label>
              <input
                type="number"
                value={amount}
                min={1}
                max={20}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                  onChange({ type: 'volume', delta: mode === 'up' ? n : -n });
                }}
                style={{ ...inputStyle, width: 70 }}
              />
            </>
          )}
        </div>
      );
    }
    case 'mic':
      return (
        <select
          value={action.op}
          onChange={(e) => onChange({ type: 'mic', op: e.target.value as MicOp })}
          style={selectStyle}
        >
          {MIC_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'app-audio':  return <AppAudioBody action={action} onChange={onChange} />;
    case 'obs':        return <ObsBody action={action} onChange={onChange} />;
    case 'streamlabs': return <StreamlabsBody action={action} onChange={onChange} />;
    case 'twitch':     return <TwitchBody action={action} onChange={onChange} />;
    case 'discord':    return <DiscordBody action={action} onChange={onChange} />;
    case 'spotify':
      return (
        <select
          value={action.op}
          onChange={(e) => onChange({ type: 'spotify', op: e.target.value as SpotifyOp })}
          style={selectStyle}
        >
          {SPOTIFY_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'twitch-streamer':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            value={action.login}
            onChange={(e) => onChange({ type: 'twitch-streamer', login: e.target.value.trim().toLowerCase() })}
            placeholder="streamer login (e.g. skullbizarre)"
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Tap on the phone opens twitch.tv/{action.login || '<login>'}. Thumbnail + live state require Twitch connected.
          </span>
        </div>
      );
    case 'kick':       return <KickBody action={action} onChange={onChange} />;
    case 'hue':        return <HueBody action={action} onChange={onChange} />;
    case 'homeassistant': return <HomeAssistantBody action={action} onChange={onChange} />;
    case 'openrgb':    return <OpenRgbBody action={action} onChange={onChange} />;
    case 'nanoleaf':   return <NanoleafBody action={action} onChange={onChange} />;
    case 'kick-streamer':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            value={action.slug}
            onChange={(e) => onChange({ ...action, type: 'kick-streamer', slug: e.target.value.trim().toLowerCase() })}
            placeholder="streamer slug (e.g. adin)"
            spellCheck={false}
            autoCapitalize="none"
            style={inputStyle}
          />
          <input
            value={action.avatarUrl ?? ''}
            onChange={(e) => onChange({ ...action, avatarUrl: e.target.value.trim() || undefined })}
            placeholder="avatar URL (optional — paste from kick.com)"
            spellCheck={false}
            style={inputStyle}
          />
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Kick's API doesn't expose other users' avatars. On kick.com/{action.slug || '<slug>'} right-click their profile picture → <em>Copy image address</em>, then paste it above. Live state auto-refreshes; a stream preview is used if no avatar URL is set.
          </span>
        </div>
      );
    case 'wait':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            min={0}
            step={50}
            value={action.ms}
            onChange={(e) => onChange({ type: 'wait', ms: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: 100 }}
          />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>ms (pause between steps)</span>
        </div>
      );
    case 'goto-page': {
      const opts = pages ?? [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {opts.length > 0 ? (
            <select
              value={action.pageId}
              onChange={(e) => onChange({ type: 'goto-page', pageId: Number(e.target.value) })}
              style={selectStyle}
            >
              {opts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <input
              type="number"
              value={action.pageId}
              onChange={(e) => onChange({ type: 'goto-page', pageId: Number(e.target.value) || 0 })}
              placeholder="page id"
              style={inputStyle}
            />
          )}
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            Tap on the phone navigates to that page. Pair with the layout's <em>Folders</em> navigation mode for a back-stack with a Back tile at the top.
          </span>
        </div>
      );
    }
  }
}

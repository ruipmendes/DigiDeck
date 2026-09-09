import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Voicemod integration — real-time voice changer + soundboard, via the
 * documented Control API WebSocket on `ws://localhost:59129/v1/`.
 *
 * Voicemod is huge on Twitch — voice-changer tags, meme clips, VTuber
 * transformations. Elgato's Stream Deck has an official Voicemod plugin
 * already; this makes Digi Deck the first PWA-based deck with it.
 *
 * The API is well-shaped:
 *   - Every client message is `{ action, id (uuid), payload }`.
 *   - Every server response echoes the `id` as `actionID`; server-pushed
 *     events have `actionID: null`. That's the demux rule.
 *   - `registerClient` with a `clientKey` (user obtains from Voicemod's form)
 *     is the first frame — everything else waits until we see status 200.
 *   - Voice + soundboard lists come both on request AND as push updates when
 *     the user edits them in the Voicemod app — treat both as authoritative,
 *     one code path.
 *
 * Live state comes from these events:
 *   - `voiceChangerEnabledEvent` / `voiceChangerDisabledEvent` — tile-active
 *     for the voice-changer toggle.
 *   - `voiceChangedEvent` — currentVoiceID; drives per-voice tile lighting.
 *   - `toggleMuteMic` — mic mute state (Voicemod-owned, distinct from the
 *     Windows Core Audio one exposed by the `mic` action).
 */

export type PublicVoicemodConfig = {
  enabled: boolean;
  host: string;
  port: number;
  hasClientKey: boolean;
};

export function publicVoicemodConfig(cfg: VoicemodConfig): PublicVoicemodConfig {
  return {
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    hasClientKey: !!cfg.clientKey,
  };
}

export function validateVoicemodConfig(input: unknown, existing: VoicemodConfig): VoicemodConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Voicemod config');
  const o = input as Record<string, unknown>;
  const port = typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : existing.port;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' && o.host.trim() ? o.host.trim() : existing.host,
    port,
    // Empty string keeps existing; explicit null clears (used by disconnect).
    clientKey: typeof o.clientKey === 'string' && o.clientKey.length > 0
      ? o.clientKey
      : o.clientKey === null
        ? ''
        : existing.clientKey,
  };
}

export const VOICEMOD_MANIFEST: IntegrationManifest = {
  name: 'voicemod',
  displayName: 'Voicemod',
  actionTypes: ['voicemod'],
  hasOAuth: false,
};

export type VoicemodConfig = {
  enabled: boolean;
  host: string;
  port: number;
  clientKey: string;
};

export const DEFAULT_VOICEMOD_CONFIG: VoicemodConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 59129,
  clientKey: '',
};

export type VoicemodState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type VoicemodVoice = {
  id: string;
  friendlyName: string;
  enabled?: boolean;
  favorited?: boolean;
  isCustom?: boolean;
};

export type VoicemodSound = {
  /** Voicemod's `FileName` — the value playMeme's payload takes. Kept as-is
   *  (capital F) since that's how it appears in the API responses. */
  fileName: string;
  name: string;
  /** Soundboard the sound belongs to — used for grouping in the editor. */
  soundboard: string;
};

export type VoicemodStatus = {
  state: VoicemodState;
  error?: string;
  host?: string;
  port?: number;
  voiceChangerEnabled?: boolean;
  micMuted?: boolean;
  currentVoiceId?: string;
  voices?: VoicemodVoice[];
  sounds?: VoicemodSound[];
};

export type VoicemodOp =
  | 'voice-changer-toggle'
  | 'select-voice'
  | 'mic-mute-toggle'
  | 'play-sound';

export type VoicemodActionParams = {
  voiceId?: string;
  soundFileName?: string;
};

const RECONNECT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

class VoicemodClient implements IntegrationLifecycle {
  readonly manifest = VOICEMOD_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.voicemod); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
  }
  publicConfig(): PublicVoicemodConfig { return publicVoicemodConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): VoicemodStatus {
    let state: VoicemodState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.clientKey) state = 'needs-auth';
    else if (!this.cfg.host || !this.cfg.port) state = 'not-configured';
    else if (this.err) state = 'error';
    else if (this.authorized) state = 'connected';
    else if (this.ws) state = 'connecting';
    else state = 'disconnected';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      host: this.cfg.host || undefined,
      port: this.cfg.port || undefined,
      voiceChangerEnabled: this.voiceChangerEnabled,
      micMuted: this.micMuted,
      currentVoiceId: this.currentVoiceId,
      voices: this.voices,
      sounds: this.sounds,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateVoicemodConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Voicemod integration not attached');
    this.serverConfig.integrations.voicemod = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled) await this.restart();
    else await this.stop();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.clientKey || !this.cfg.host || !this.cfg.port) return;
    if (this.ws) return;
    this.err = undefined;
    this.emitChange();
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopReconnect();
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.authorized = false;
    this.voiceChangerEnabled = undefined;
    this.micMuted = undefined;
    this.currentVoiceId = undefined;
    this.voices = undefined;
    this.sounds = undefined;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Voicemod integration stopped'));
    }
    this.pending.clear();
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: VoicemodOp, params: VoicemodActionParams | undefined): Promise<void> {
    if (!this.authorized) throw new Error('Voicemod not connected — start the Voicemod app and check the client key.');
    switch (op) {
      case 'voice-changer-toggle':
        await this.rpc('toggleVoiceChanger', {});
        return;
      case 'select-voice': {
        const voiceId = params?.voiceId?.trim();
        if (!voiceId) throw new Error('Voicemod: voiceId required');
        // Note the capitalization — Voicemod's payload key is voiceID (both
        // capital I and D). Everything else in the API uses camelCase, so this
        // is easy to get wrong; the API silently no-ops on mismatched keys.
        //
        // Fire-and-forget: Voicemod doesn't reliably send a direct response
        // for loadVoice (it pushes voiceChangedEvent instead). Awaiting the
        // rpc would hit the 5s timeout every time. The event will land in
        // handleMessage → absorbCurrentVoice on success; on failure (unknown
        // id, Pro-locked voice on a free account), no event = no state change,
        // and the user sees the tile stays lit on the old voice.
        this.fireAndForget('loadVoice', { voiceID: voiceId });
        return;
      }
      case 'mic-mute-toggle':
        await this.rpc('toggleMuteMic', {});
        return;
      case 'play-sound': {
        const fileName = params?.soundFileName?.trim();
        if (!fileName) throw new Error('Voicemod: soundFileName required');
        // playMeme + IsKeyDown:true starts the sound. The docs say IsKeyDown:false
        // releases it — but for `PlayStop`-mode sounds (the default `Type`
        // for most memes), sending release stops playback immediately. So we
        // send only the press: PlayStop sounds finish on their own natural
        // length or on a second press (which Voicemod treats as toggle-off);
        // PlayRestart sounds re-trigger from the top on repeat presses.
        this.fireAndForget('playMeme', { FileName: fileName, IsKeyDown: true });
        return;
      }
      default:
        throw new Error(`unknown Voicemod op: ${op as string}`);
    }
  }

  // ─── internal ──────────────────────────────────────────────

  private cfg: VoicemodConfig = { ...DEFAULT_VOICEMOD_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private onChangeCb: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private authorized = false;
  private err: string | undefined;
  private voiceChangerEnabled: boolean | undefined;
  private micMuted: boolean | undefined;
  private currentVoiceId: string | undefined;
  private voices: VoicemodVoice[] | undefined;
  private sounds: VoicemodSound[] | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, Pending>();

  private setConfig(cfg: VoicemodConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  private emitChange(): void { this.onChangeCb?.(); }

  private connect(): void {
    this.stopReconnect();
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${this.cfg.host}:${this.cfg.port}/v1/`);
    } catch (err) {
      this.err = (err as Error).message;
      this.emitChange();
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.on('open', () => {
      // First frame must be registerClient. Anything else pre-auth silently
      // gets ignored (and our request queue would build up meaningless entries).
      void this.rpc('registerClient', { clientKey: this.cfg.clientKey })
        .then(() => {
          this.authorized = true;
          this.err = undefined;
          console.log('[voicemod] authorized');
          this.emitChange();
          // Prime the caches on connect. Further updates arrive as push
          // events with the same actionType, so absorbSounds/absorbVoices
          // handle both the initial reply and later updates uniformly.
          //
          // NOT calling `getMemes` even though it's documented — on 3.x it
          // returns a flatter shape (`listOfMemes`) that overwrites the
          // richer 36-board catalog from getAllSoundboard with a subset.
          // getAllSoundboard has everything we need.
          void this.rpc('getVoices', {})
            .catch((err) => console.warn(`[voicemod] getVoices failed: ${(err as Error).message}`));
          void this.rpc('getAllSoundboard', {})
            .catch((err) => console.warn(`[voicemod] getAllSoundboard failed: ${(err as Error).message}`));
          void this.rpc('getMuteMicStatus', {}).catch(() => { /* older builds may not expose */ });
        })
        .catch((err) => {
          this.err = `Voicemod auth failed: ${(err as Error).message}`;
          this.emitChange();
          try { ws.close(); } catch { /* ignore */ }
        });
    });
    ws.on('message', (raw) => this.handleMessage(raw.toString()));
    ws.on('close', () => {
      this.ws = null;
      this.authorized = false;
      this.voiceChangerEnabled = undefined;
      this.micMuted = undefined;
      this.currentVoiceId = undefined;
      this.voices = undefined;
      this.sounds = undefined;
      this.emitChange();
      if (this.cfg.enabled) this.scheduleReconnect();
    });
    ws.on('error', (err) => {
      // Log softly — the close handler runs after and drives the reconnect;
      // an ECONNREFUSED here is the normal "Voicemod app isn't running yet" state.
      console.warn(`[voicemod] socket error: ${err.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg.enabled) this.connect();
    }, RECONNECT_MS);
  }
  private stopReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  /** Send an action without awaiting the response — for calls that Voicemod
   *  doesn't reliably reply to synchronously (loadVoice being the notable
   *  case). State changes still arrive through the push event stream. */
  private fireAndForget(action: string, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error('Voicemod socket not open');
    }
    const id = randomUUID();
    try {
      this.ws.send(JSON.stringify({ action, id, payload }));
    } catch (err) {
      console.warn(`[voicemod] fire-and-forget ${action} send failed: ${(err as Error).message}`);
    }
  }

  private async rpc<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) throw new Error('Voicemod socket not open');
    const id = randomUUID();
    const frame = JSON.stringify({ action, id, payload });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Voicemod ${action} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws!.send(frame);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private handleMessage(text: string): void {
    let msg: RawMessage;
    try { msg = JSON.parse(text) as RawMessage; }
    catch { console.warn(`[voicemod] bad JSON: ${text.slice(0, 200)}`); return; }


    // Voicemod 3.x puts response data in `actionObject`; some older paths
    // (registerClient specifically) still use `payload`. We prefer
    // actionObject and fall back to payload so both shapes work.
    const data = (msg.actionObject ?? msg.payload) as Record<string, unknown> | null | undefined;

    // Response to a pending request — actionID echoes our request's id.
    if (typeof msg.actionID === 'string' && msg.actionID) {
      const p = this.pending.get(msg.actionID);
      if (p) {
        this.pending.delete(msg.actionID);
        clearTimeout(p.timer);
        // registerClient's status lives in payload.status even on 3.x.
        const status = msg.payload?.status;
        if (status && typeof status === 'object') {
          const code = (status as { code?: number }).code;
          const desc = (status as { description?: string }).description;
          if (typeof code === 'number' && code !== 200) {
            p.reject(new Error(desc ?? `Voicemod error (code ${code})`));
          } else {
            p.resolve(data);
          }
        } else {
          p.resolve(data);
        }
      }
    }

    // Cache updates — both responses to getVoices/getMemes AND the
    // server-pushed refresh events use the same actionType, so treating
    // them uniformly means the client's dropdowns always reflect what the
    // user sees inside Voicemod without any special-case wiring.
    const actionType = msg.actionType ?? '';
    switch (actionType) {
      case 'getVoices':
      case 'voiceListChangedEvent':
        this.absorbVoices(data);
        break;
      case 'getAllSoundboard':
      case 'getMemes':
      case 'soundboardListChangedEvent':
      case 'memesListChangedEvent':
        this.absorbSounds(data);
        break;
      case 'voiceChangerEnabledEvent':
      case 'voiceChangerDisabledEvent':
      case 'toggleVoiceChanger':
        this.absorbVoiceChangerState(actionType, data);
        break;
      case 'voiceChangedEvent':
      case 'loadVoice':
        this.absorbCurrentVoice(data);
        break;
      case 'toggleMuteMic':
      case 'muteMicStatusChangedEvent':
      case 'getMuteMicStatus':
        this.absorbMuteState(data);
        break;
    }
  }

  // ─── State absorbers ──────────────────────────────────────

  private absorbVoices(payload: unknown): void {
    const list = pickArray(payload, ['voices', 'result']);
    if (!list) return;
    const voices: VoicemodVoice[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const id = pickString(o, ['id', 'voiceID', 'voiceId']);
      const name = pickString(o, ['friendlyName', 'name', 'title']);
      if (!id || !name) continue;
      voices.push({
        id, friendlyName: name,
        enabled: pickBoolean(o, ['enabled']),
        favorited: pickBoolean(o, ['favorited', 'favorite']),
        isCustom: pickBoolean(o, ['isCustom']),
      });
    }
    // Favorites first, then A-Z. Matches the Voicemod app's own ordering.
    voices.sort((a, b) => {
      const f = (a.favorited ? 0 : 1) - (b.favorited ? 0 : 1);
      if (f !== 0) return f;
      return a.friendlyName.localeCompare(b.friendlyName);
    });
    this.voices = voices;
    this.emitChange();
  }

  private absorbSounds(payload: unknown): void {
    // The shape is nested: soundboards -> each has a sounds array. Some
    // versions wrap in { soundboards: [...] }, some return a bare array.
    // Newer builds also use { soundboardListInfo: { listOfSoundboards: [...] } }.
    let boards: unknown[] = [];
    if (Array.isArray(payload)) boards = payload;
    else if (payload && typeof payload === 'object') {
      const o = payload as Record<string, unknown>;
      if (Array.isArray(o.soundboards)) boards = o.soundboards;
      else if (Array.isArray(o.result)) boards = o.result;
      else if (Array.isArray((o.soundboardListInfo as { listOfSoundboards?: unknown[] } | undefined)?.listOfSoundboards)) {
        boards = (o.soundboardListInfo as { listOfSoundboards: unknown[] }).listOfSoundboards;
      }
      else if (Array.isArray((o.actionObject as { soundboards?: unknown[] } | undefined)?.soundboards)) {
        boards = (o.actionObject as { soundboards: unknown[] }).soundboards;
      }
    }
    const sounds: VoicemodSound[] = [];
    for (const rawBoard of boards) {
      if (!rawBoard || typeof rawBoard !== 'object') continue;
      const bo = rawBoard as Record<string, unknown>;
      const boardName = pickString(bo, ['name', 'title']) ?? 'Soundboard';
      const soundList = pickArray(bo, ['sounds', 'listOfSounds']) ?? [];
      for (const raw of soundList) {
        if (!raw || typeof raw !== 'object') continue;
        const o = raw as Record<string, unknown>;
        // The exact key playMeme accepts has drifted across Voicemod versions:
        // older docs say `FileName`, some builds send `fileName`, newer ones
        // key by `id`. We try FileName first (matches the historic doc), then
        // fall back to id; whatever we pick is what we send back on trigger.
        const fileName = pickString(o, ['FileName', 'fileName', 'id']);
        const name = pickString(o, ['name', 'title', 'FileName']) ?? fileName ?? 'sound';
        if (!fileName) continue;
        sounds.push({ fileName, name, soundboard: boardName });
      }
    }
    sounds.sort((a, b) => {
      const bc = a.soundboard.localeCompare(b.soundboard);
      if (bc !== 0) return bc;
      return a.name.localeCompare(b.name);
    });
    this.sounds = sounds;
    this.emitChange();
  }

  private absorbVoiceChangerState(actionType: string, payload: unknown): void {
    // Two shapes to accept: dedicated Enabled/Disabled event pair, or the
    // toggleVoiceChanger response with a `value` boolean.
    let value: boolean | undefined;
    if (actionType === 'voiceChangerEnabledEvent') value = true;
    else if (actionType === 'voiceChangerDisabledEvent') value = false;
    else if (payload && typeof payload === 'object') {
      value = pickBoolean(payload as Record<string, unknown>, ['value', 'enabled']);
    }
    if (value !== undefined && this.voiceChangerEnabled !== value) {
      this.voiceChangerEnabled = value;
      this.emitChange();
    }
  }

  private absorbCurrentVoice(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const voiceId = pickString(payload as Record<string, unknown>, ['voiceID', 'voiceId', 'id']);
    if (voiceId && this.currentVoiceId !== voiceId) {
      this.currentVoiceId = voiceId;
      this.emitChange();
    }
  }

  private absorbMuteState(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const value = pickBoolean(payload as Record<string, unknown>, ['value', 'muted', 'isMuted']);
    if (value !== undefined && this.micMuted !== value) {
      this.micMuted = value;
      this.emitChange();
    }
  }
}

// ─── Raw message + shape helpers ────────────────────────────────

type RawMessage = {
  actionType?: string;
  actionID?: string | null;
  /** Older doc says data lives in `payload`; Voicemod 3.x moved it to
   *  `actionObject`. Some actions still populate both. Callers should read
   *  actionObject first, falling back to payload. */
  actionObject?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
};

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
function pickBoolean(o: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'boolean') return v;
    // Voicemod sometimes reports flags as 0/1 numbers or "true"/"false" strings.
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string' && (v === 'true' || v === 'false')) return v === 'true';
  }
  return undefined;
}
function pickArray(payload: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  for (const k of keys) {
    if (Array.isArray(o[k])) return o[k] as unknown[];
  }
  return null;
}

let _instance: VoicemodClient | null = null;
export function getVoicemod(): VoicemodClient {
  if (!_instance) {
    _instance = new VoicemodClient();
    registerIntegration(_instance);
  }
  return _instance;
}

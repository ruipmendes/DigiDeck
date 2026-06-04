// Streamlabs Desktop integration.
//
// Streamlabs Desktop exposes a JSON-RPC 2.0 API over SockJS-WebSocket at
//   http://<host>:<port>/api   (default port 59650)
// — see https://streamlabs.github.io/streamlabs-desktop-api-docs/docs/
//
// Connection flow:
//   1. Open WebSocket to ws://host:port/api/<serverId>/<sessionId>/websocket
//   2. Wait for SockJS open frame ("o")
//   3. Send JSON-RPC TcpServerService.auth with the user's API token
//   4. Refresh snapshot (scenes, active scene, audio sources, recording/streaming state)
//   5. Subscribe to change events to keep the snapshot fresh
//
// SockJS framing (only the WebSocket transport, which is enough for us):
//   Server → us:  "o"            open
//                 "h"            heartbeat (ignore)
//                 "c[code,...]"  close
//                 'a[json,...]'  data envelope: array of stringified JSON messages
//   Us → server:  '["<json>"]'   array of stringified messages
//
// The OBS integration is completely separate from this file. Neither imports the other.

import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

export type StreamlabsConfig = {
  enabled: boolean;
  host: string;
  port: number;
  token: string;
};

export const DEFAULT_STREAMLABS_CONFIG: StreamlabsConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 59650,
  token: '',
};

export type StreamlabsState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type StreamlabsStatus = {
  state: StreamlabsState;
  error?: string;
  scenes: string[];
  inputs: string[];
  /** sceneName → array of source (scene-item) names visible in the config picker. */
  sceneItems: Record<string, string[]>;
  /** Keys are `"<sceneName>::<sourceName>"`; value is whether that scene item is currently visible. */
  sourceStates: Record<string, boolean>;
  currentScene?: string;
  recording: boolean;
  streaming: boolean;
  virtualCam: boolean;
  replayBuffer: boolean;
  mutedInputs: string[];
  /** Audio input name → current fader deflection (0..1). */
  inputVolumes: Record<string, number>;
  retryStopped: boolean;
};

export type StreamlabsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam'
  | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene'
  | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source';

export type StreamlabsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

const RETRY_INTERVAL_MS = 5_000;
const RETRY_BUDGET_MS = 5 * 60 * 1000;
const RPC_TIMEOUT_MS = 8_000;

type SlobsSceneItem = {
  sceneItemId?: string;
  resourceId?: string;
  /** Slobs sometimes nests visibility under different keys depending on the build. */
  name?: string;
  sourceName?: string;
  visible?: boolean;
  /** Folders/groups have a 'sceneNodeType' === 'folder'; items have 'item'. */
  sceneNodeType?: string;
};
type SlobsScene = { id: string; name: string; nodes?: SlobsSceneItem[] };
type SlobsAudioSource = {
  sourceId?: string;
  resourceId?: string;
  name: string;
  muted: boolean;
  /** Slobs returns fader info inline on AudioSource models. */
  fader?: { db?: number; deflection?: number; mul?: number };
};
type RpcResolver = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class StreamlabsClient {
  private cfg: StreamlabsConfig = { ...DEFAULT_STREAMLABS_CONFIG };
  private state: StreamlabsState = 'disabled';
  private err: string | undefined;
  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, RpcResolver>();
  private authedResolve: (() => void) | null = null;

  // Snapshot
  private scenes: SlobsScene[] = [];
  private currentSceneName: string | undefined;
  private sceneIdByName = new Map<string, string>();
  /** `"<sceneName>::<sourceName>"` → SceneItem resource id (e.g. `SceneItem["abc"]`). */
  private sceneItemResourceByKey = new Map<string, string>();
  /** sceneName → ordered list of source names visible in the config picker. */
  private sceneItemsByName = new Map<string, string[]>();
  /** `"<sceneName>::<sourceName>"` → currently-visible flag. */
  private sourceStatesByKey = new Map<string, boolean>();
  private audioSources: SlobsAudioSource[] = [];
  private mutedSet = new Set<string>();
  private audioIdByName = new Map<string, string>();
  private inputVolumesByName = new Map<string, number>();
  private recording = false;
  private streaming = false;
  private virtualCam = false;
  private replayBuffer = false;

  // Retry / lifecycle
  private retryTimer: NodeJS.Timeout | null = null;
  private firstFailureAt: number | null = null;
  private retryStopped = false;
  private explicitStop = false;
  private onChangeCb: (() => void) | null = null;

  setConfig(cfg: StreamlabsConfig): void {
    this.cfg = { ...cfg };
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private emitChange(): void {
    this.onChangeCb?.();
  }

  status(): StreamlabsStatus {
    return {
      state: this.state,
      error: this.err,
      scenes: this.scenes.map((s) => s.name),
      inputs: this.audioSources.map((s) => s.name),
      sceneItems: Object.fromEntries(this.sceneItemsByName),
      sourceStates: Object.fromEntries(this.sourceStatesByKey),
      currentScene: this.currentSceneName,
      recording: this.recording,
      streaming: this.streaming,
      virtualCam: this.virtualCam,
      replayBuffer: this.replayBuffer,
      mutedInputs: [...this.mutedSet],
      inputVolumes: Object.fromEntries(this.inputVolumesByName),
      retryStopped: this.retryStopped,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    this.explicitStop = false;
    if (!this.cfg.enabled) {
      this.state = 'disabled';
      this.err = undefined;
      this.emitChange();
      return;
    }
    if (this.state === 'connecting' || this.state === 'connected') return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.state = 'connecting';
    this.err = undefined;
    this.emitChange();

    try {
      await this.connectAndAuth();
      this.state = 'connected';
      this.firstFailureAt = null;
      this.retryStopped = false;
      console.log(`[streamlabs] connected to ${this.cfg.host}:${this.cfg.port}`);
      await this.refreshSnapshot().catch((e) => console.warn('[streamlabs] snapshot failed:', (e as Error).message));
      this.subscribeToEvents();
      this.emitChange();
    } catch (err) {
      this.err = (err as Error).message;
      this.state = 'error';
      this.emitChange();
      this.scheduleRetry();
    }
  }

  async stop(): Promise<void> {
    this.explicitStop = true;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.firstFailureAt = null;
    this.retryStopped = false;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('connection closed')); });
    this.pending.clear();
    this.resetSnapshot();
    this.state = 'disabled';
    this.err = undefined;
    this.emitChange();
  }

  private resetSnapshot(): void {
    this.scenes = [];
    this.audioSources = [];
    this.sceneIdByName.clear();
    this.audioIdByName.clear();
    this.inputVolumesByName.clear();
    this.sceneItemResourceByKey.clear();
    this.sceneItemsByName.clear();
    this.sourceStatesByKey.clear();
    this.mutedSet.clear();
    this.currentSceneName = undefined;
    this.recording = false;
    this.streaming = false;
    this.virtualCam = false;
    this.replayBuffer = false;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Force a snapshot refresh; useful right after a press is suspected to have changed state. */
  refresh(): void {
    if (this.state !== 'connected') return;
    void this.refreshSnapshot().then(() => this.emitChange()).catch(() => undefined);
  }

  private scheduleRetry(): void {
    if (this.explicitStop) return;
    if (!this.cfg.enabled) return;
    if (this.firstFailureAt === null) this.firstFailureAt = Date.now();
    if (Date.now() - this.firstFailureAt > RETRY_BUDGET_MS) {
      this.retryStopped = true;
      this.emitChange();
      console.warn('[streamlabs] retry budget exhausted; stopping auto-reconnect');
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.start(); }, RETRY_INTERVAL_MS);
  }

  // ─── SockJS-on-WebSocket framing ────────────────────────────────

  private connectAndAuth(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const serverId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const sessionId = randomBytes(4).toString('hex');
      const url = `ws://${this.cfg.host}:${this.cfg.port}/api/${serverId}/${sessionId}/websocket`;

      const ws = new WebSocket(url, { handshakeTimeout: 5_000 });
      this.ws = ws;

      let settled = false;
      this.authedResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(msg));
      };
      const failTimer = setTimeout(() => fail('connect/auth timeout'), 8_000);

      ws.on('open', () => { /* wait for SockJS 'o' frame */ });
      ws.on('message', (raw) => this.handleFrame(raw.toString(), fail));
      ws.on('error', (err) => fail((err as Error).message));
      ws.on('close', () => {
        clearTimeout(failTimer);
        this.handleClose();
        fail('socket closed before auth completed');
      });
    });
  }

  private handleFrame(frame: string, failConnect?: (msg: string) => void): void {
    if (frame === 'o') {
      // Open — send auth immediately.
      this.callMethod('TcpServerService', 'auth', [this.cfg.token])
        .then(() => {
          if (this.authedResolve) {
            const r = this.authedResolve;
            this.authedResolve = null;
            r();
          }
        })
        .catch((err) => {
          if (failConnect) failConnect(`auth failed: ${(err as Error).message}`);
        });
      return;
    }
    if (frame === 'h') return; // heartbeat
    if (frame.startsWith('c[')) {
      try {
        const [, reason] = JSON.parse(frame.slice(1)) as [number, string];
        if (failConnect) failConnect(`server closed: ${reason ?? 'unknown'}`);
      } catch {
        if (failConnect) failConnect('server closed');
      }
      return;
    }
    if (frame.startsWith('a[')) {
      let messages: string[];
      try {
        messages = JSON.parse(frame.slice(1)) as string[];
      } catch { return; }
      for (const m of messages) {
        try { this.handleMessage(JSON.parse(m)); } catch { /* ignore malformed */ }
      }
      return;
    }
    // Unknown frame; ignore.
  }

  private handleClose(): void {
    if (this.explicitStop) return;
    const wasConnected = this.state === 'connected';
    if (wasConnected) {
      console.warn('[streamlabs] connection closed');
      this.state = 'disconnected';
      this.resetSnapshot();
      this.emitChange();
    }
    this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(new Error('connection closed')); });
    this.pending.clear();
    this.ws = null;
    this.scheduleRetry();
  }

  // ─── JSON-RPC ───────────────────────────────────────────────────

  private callMethod(resource: string, method: string, args: unknown[] = []): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) {
      return Promise.reject(new Error('not connected'));
    }
    const id = this.nextRequestId++;
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params: { resource, args },
    };
    const wire = JSON.stringify([JSON.stringify(payload)]);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${resource}.${method}`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(wire);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;

    // Event frames are pushed by the server after a subscribe.
    if (m._type === 'EVENT') {
      this.handleEvent(m);
      return;
    }

    // Response to a previous call.
    if (typeof m.id === 'number') {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) {
        const err = m.error as { message?: string; code?: number };
        p.reject(new Error(err.message ?? `RPC error ${err.code ?? '?'}`));
      } else {
        p.resolve(m.result);
      }
    }
  }

  private handleEvent(envelope: Record<string, unknown>): void {
    const data = envelope.data;
    const resource = envelope.resourceId as string | undefined;

    // Scene switched — Streamlabs sends the new active scene as the event payload.
    if (resource === 'ScenesService.sceneSwitched' && data && typeof data === 'object') {
      const newScene = (data as { name?: string }).name;
      if (typeof newScene === 'string') {
        this.currentSceneName = newScene;
        this.emitChange();
      }
      return;
    }
    // Streaming/recording status — keep our flags fresh on every change.
    if (resource === 'StreamingService.streamingStatusChange') {
      // Streamlabs sends 'live' | 'offline' | 'starting' | 'ending' | 'reconnecting'.
      const status = typeof data === 'string' ? data : (data as { status?: string })?.status;
      this.streaming = status === 'live' || status === 'starting' || status === 'reconnecting';
      this.emitChange();
      return;
    }
    if (resource === 'StreamingService.recordingStatusChange') {
      const status = typeof data === 'string' ? data : (data as { status?: string })?.status;
      this.recording = status === 'recording' || status === 'starting';
      this.emitChange();
      return;
    }
    if (resource === 'StreamingService.replayBufferStatusChange') {
      const status = typeof data === 'string' ? data : (data as { status?: string })?.status;
      this.replayBuffer = status === 'running' || status === 'starting' || status === 'saving';
      this.emitChange();
      return;
    }
    // Audio source mute/unmute. Refresh the whole audio snapshot — it's cheap.
    if (typeof resource === 'string' && resource.startsWith('AudioService')) {
      void this.refreshAudio().then(() => this.emitChange()).catch(() => undefined);
      return;
    }
  }

  // ─── Snapshot + subscriptions ───────────────────────────────────

  private async refreshSnapshot(): Promise<void> {
    await Promise.all([
      this.refreshScenes(),
      this.refreshActiveScene(),
      this.refreshStreamingStatus(),
      this.refreshAudio(),
      this.refreshVirtualCam(),
    ]);
  }

  private async refreshScenes(): Promise<void> {
    const scenes = await this.callMethod('ScenesService', 'getScenes') as SlobsScene[] | undefined;
    if (!Array.isArray(scenes)) return;
    this.scenes = scenes;
    this.sceneIdByName = new Map(scenes.map((s) => [s.name, s.id]));

    // Pull scene items per scene so the source-visibility picker has data.
    this.sceneItemResourceByKey.clear();
    this.sceneItemsByName.clear();
    this.sourceStatesByKey.clear();
    for (const scene of scenes) {
      try {
        const nodes = (Array.isArray(scene.nodes) && scene.nodes.length > 0)
          ? scene.nodes
          : (await this.callMethod(`Scene["${scene.id}"]`, 'getNodes').catch(() => [])) as SlobsSceneItem[];
        const names: string[] = [];
        for (const node of nodes) {
          // Skip folders (groups); only actual scene items have visibility.
          if (node.sceneNodeType && node.sceneNodeType !== 'item') continue;
          const sourceName = node.sourceName ?? node.name;
          if (!sourceName) continue;
          const id = node.sceneItemId ?? node.resourceId;
          if (!id) continue;
          const key = `${scene.name}::${sourceName}`;
          const resourceId = node.resourceId ?? `SceneItem["${id}"]`;
          this.sceneItemResourceByKey.set(key, resourceId);
          if (typeof node.visible === 'boolean') {
            this.sourceStatesByKey.set(key, node.visible);
          }
          names.push(sourceName);
        }
        this.sceneItemsByName.set(scene.name, names);
      } catch {
        // skip this scene; next refresh will retry
      }
    }
  }

  private async refreshVirtualCam(): Promise<void> {
    try {
      // VirtualWebcamService.getStatus() typically returns 'running' | 'offline'.
      const status = await this.callMethod('VirtualWebcamService', 'getStatus') as string | { status?: string } | undefined;
      const s = typeof status === 'string' ? status : status?.status;
      this.virtualCam = s === 'running';
    } catch {
      // Old Streamlabs builds may not expose this; leave virtualCam unchanged.
    }
  }

  private async refreshActiveScene(): Promise<void> {
    const active = await this.callMethod('ScenesService', 'activeScene') as { name?: string } | undefined;
    if (active && typeof active.name === 'string') {
      this.currentSceneName = active.name;
    }
  }

  private async refreshStreamingStatus(): Promise<void> {
    // StreamingService exposes a `getModel` returning { streamingStatus, recordingStatus, replayBufferStatus }.
    try {
      const model = await this.callMethod('StreamingService', 'getModel') as
        { streamingStatus?: string; recordingStatus?: string; replayBufferStatus?: string } | undefined;
      if (model) {
        const s = model.streamingStatus;
        const r = model.recordingStatus;
        const rb = model.replayBufferStatus;
        this.streaming = s === 'live' || s === 'starting' || s === 'reconnecting';
        this.recording = r === 'recording' || r === 'starting';
        this.replayBuffer = rb === 'running' || rb === 'starting' || rb === 'saving';
      }
    } catch {
      // Some versions don't expose getModel; fall back to assuming off and
      // let events update us when state changes.
    }
  }

  private async refreshAudio(): Promise<void> {
    const sources = await this.callMethod('AudioService', 'getSources') as SlobsAudioSource[] | undefined;
    if (!Array.isArray(sources)) return;
    this.audioSources = sources;
    this.audioIdByName = new Map(
      sources
        .map((s) => [s.name, s.sourceId ?? s.resourceId ?? ''] as [string, string])
        .filter(([, id]) => id.length > 0),
    );
    this.mutedSet = new Set(sources.filter((s) => s.muted).map((s) => s.name));
    this.inputVolumesByName = new Map(
      sources
        .map((s) => [s.name, clamp01(s.fader?.deflection ?? 1)] as [string, number]),
    );
  }

  private subscribeToEvents(): void {
    const subscribe = (resource: string, method: string) =>
      this.callMethod(resource, method).catch((err) => {
        console.warn(`[streamlabs] subscribe ${resource}.${method} failed: ${(err as Error).message}`);
      });
    void subscribe('ScenesService', 'sceneSwitched');
    void subscribe('StreamingService', 'streamingStatusChange');
    void subscribe('StreamingService', 'recordingStatusChange');
    void subscribe('StreamingService', 'replayBufferStatusChange');
  }

  // ─── Action dispatch ────────────────────────────────────────────

  /**
   * Set an audio source's fader to a 0..1 deflection.
   * The slider tile uses the same 0..1 range; clamp is defensive.
   */
  async setInputVolume(inputName: string, value: number): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error(`Streamlabs not connected (state: ${this.state})`);
    }
    const id = this.audioIdByName.get(inputName.trim());
    if (!id) throw new Error(`Streamlabs audio source "${inputName}" not found`);
    const v = clamp01(value);
    // Optimistically update + broadcast so the phone's slider doesn't snap back
    // to the previous broadcast value while the RPC is in flight. (Streamlabs
    // doesn't reliably emit volume-change events, so without this the next
    // broadcast wouldn't fire until refreshAudio runs again.)
    const previous = this.inputVolumesByName.get(inputName);
    this.inputVolumesByName.set(inputName, v);
    this.emitChange();
    try {
      await this.callMethod(`AudioSource["${id}"]`, 'setDeflection', [v]);
    } catch (err) {
      // RPC failed — revert the optimistic update and re-broadcast so the
      // phone slider snaps back to the actual Streamlabs value.
      if (previous !== undefined) {
        this.inputVolumesByName.set(inputName, previous);
      } else {
        this.inputVolumesByName.delete(inputName);
      }
      this.emitChange();
      throw err;
    }
  }

  async execute(op: StreamlabsOp, params?: StreamlabsActionParams): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error(`Streamlabs not connected (state: ${this.state})`);
    }
    switch (op) {
      case 'toggle-record': await this.callMethod('StreamingService', 'toggleRecording'); break;
      case 'start-record':  await this.tryRecord(true); break;
      case 'stop-record':   await this.tryRecord(false); break;
      case 'toggle-stream': await this.callMethod('StreamingService', 'toggleStreaming'); break;
      case 'start-stream':  await this.tryStream(true); break;
      case 'stop-stream':   await this.tryStream(false); break;
      case 'toggle-virtual-cam':
        await this.callMethod('VirtualWebcamService', this.virtualCam ? 'stop' : 'start');
        break;
      case 'toggle-replay-buffer':
        await this.callMethod('StreamingService', 'toggleReplayBuffer');
        break;
      case 'save-replay-buffer':
        await this.callMethod('StreamingService', 'saveReplay');
        break;
      case 'show-source':
      case 'hide-source':
      case 'toggle-source': {
        const scene = params?.sceneName?.trim();
        const source = params?.sourceName?.trim();
        if (!scene || !source) throw new Error(`${op}: sceneName and sourceName both required`);
        const key = `${scene}::${source}`;
        const resource = this.sceneItemResourceByKey.get(key);
        if (!resource) throw new Error(`${op}: scene item "${source}" not found in scene "${scene}"`);
        const current = this.sourceStatesByKey.get(key);
        const next = op === 'show-source' ? true
          : op === 'hide-source' ? false
          : !(current ?? false);
        await this.callMethod(resource, 'setVisibility', [next]);
        // Optimistic local update so the indicator flips immediately.
        this.sourceStatesByKey.set(key, next);
        break;
      }
      case 'set-scene': {
        const name = params?.sceneName?.trim();
        if (!name) throw new Error('set-scene: sceneName required');
        const id = this.sceneIdByName.get(name);
        if (!id) throw new Error(`set-scene: scene "${name}" not found`);
        await this.callMethod('ScenesService', 'makeSceneActive', [id]);
        break;
      }
      case 'toggle-mute': {
        const name = params?.inputName?.trim();
        if (!name) throw new Error('toggle-mute: inputName required');
        const id = this.audioIdByName.get(name);
        if (!id) throw new Error(`toggle-mute: audio source "${name}" not found`);
        const wantMuted = !this.mutedSet.has(name);
        await this.callMethod(`AudioSource["${id}"]`, 'setMuted', [wantMuted]);
        break;
      }
    }
    // Refresh shortly after so the live indicator updates even if no event fires.
    setTimeout(() => this.refresh(), 200);
  }

  /** start/stop record have variants depending on Streamlabs version — try the specific one then toggle. */
  private async tryRecord(start: boolean): Promise<void> {
    try {
      await this.callMethod('StreamingService', start ? 'startRecording' : 'stopRecording');
    } catch {
      // Fallback: toggle if we're not already in the desired state.
      if (this.recording !== start) {
        await this.callMethod('StreamingService', 'toggleRecording');
      }
    }
  }

  private async tryStream(start: boolean): Promise<void> {
    try {
      await this.callMethod('StreamingService', start ? 'startStreaming' : 'stopStreaming');
    } catch {
      if (this.streaming !== start) {
        await this.callMethod('StreamingService', 'toggleStreaming');
      }
    }
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

let _instance: StreamlabsClient | null = null;
export function getStreamlabs(): StreamlabsClient {
  if (!_instance) _instance = new StreamlabsClient();
  return _instance;
}

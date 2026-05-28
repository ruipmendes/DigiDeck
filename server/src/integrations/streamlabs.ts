// Streamlabs Desktop integration.
//
// Streamlabs Desktop exposes a JSON-RPC 2.0 API over sockjs WebSocket — see
//   https://streamlabs.github.io/streamlabs-desktop-api-docs/docs/
// (Settings → Remote Control → "show details" reveals the host/port/token.)
//
// This file is currently scaffolding: the public surface is complete and parallel
// to obs.ts so the rest of the codebase can wire to it, but the actual protocol
// implementation is stubbed. Operations throw "not yet implemented" until the
// JSON-RPC layer below is fleshed out (slobs-client npm package OR a hand-rolled
// sockjs wrapper — pick one when the protocol work starts).
//
// The OBS integration is fully isolated from this file. Neither imports the other.

export type StreamlabsConfig = {
  enabled: boolean;
  host: string;
  /** Default Streamlabs Desktop remote-control port is 59650. */
  port: number;
  /** API token from Streamlabs → Settings → Remote Control → "show details". */
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
  /** Audio sources, by display name. */
  inputs: string[];
  currentScene?: string;
  recording: boolean;
  streaming: boolean;
  mutedInputs: string[];
  /** True once the auto-retry budget is exhausted; UI should surface a manual retry. */
  retryStopped: boolean;
};

// Ops chosen to mirror OBS where Streamlabs Desktop has parity.
// Replay buffer / virtual cam / per-scene source visibility intentionally omitted
// for v1 — they're either unsupported or unreliable on Streamlabs.
export type StreamlabsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'set-scene'
  | 'toggle-mute';

export type StreamlabsActionParams = { sceneName?: string; inputName?: string };

class StreamlabsClient {
  private cfg: StreamlabsConfig = { ...DEFAULT_STREAMLABS_CONFIG };
  private state: StreamlabsState = 'disabled';
  private err: string | undefined;
  private scenes: string[] = [];
  private inputs: string[] = [];
  private currentScene: string | undefined;
  private recording = false;
  private streaming = false;
  private mutedInputs = new Set<string>();
  private retryStopped = false;
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
      scenes: [...this.scenes],
      inputs: [...this.inputs],
      currentScene: this.currentScene,
      recording: this.recording,
      streaming: this.streaming,
      mutedInputs: [...this.mutedInputs],
      retryStopped: this.retryStopped,
    };
  }

  // ─── Connection lifecycle (stubbed) ─────────────────────────────
  //
  // When implementing for real:
  // 1. Open a sockjs/WS connection to ws://host:port/api/websocket
  // 2. Send TcpServerService.auth({ token }) as the first JSON-RPC request
  // 3. On success, subscribe to scene/streaming/recording change events
  // 4. Refresh the initial snapshot (scenes, current scene, recording state, etc.)
  // 5. Update state/snapshot fields and call emitChange()

  async start(): Promise<void> {
    if (!this.cfg.enabled) {
      this.state = 'disabled';
      this.err = undefined;
      this.emitChange();
      return;
    }
    this.state = 'error';
    this.err = 'Streamlabs integration is scaffolded but not yet implemented';
    this.emitChange();
  }

  async stop(): Promise<void> {
    this.state = 'disabled';
    this.err = undefined;
    this.scenes = [];
    this.inputs = [];
    this.currentScene = undefined;
    this.recording = false;
    this.streaming = false;
    this.mutedInputs.clear();
    this.retryStopped = false;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Force a snapshot refresh — useful right after a press is suspected to have changed state. */
  refresh(): void {
    // No-op until the real connection is wired up.
  }

  // ─── Action dispatch (stubbed) ──────────────────────────────────
  //
  // When implementing for real, map each op to the Streamlabs service:
  //   StreamingService.toggleRecording / startRecording / stopRecording
  //   StreamingService.toggleStreaming / startStreaming / stopStreaming
  //   ScenesService.makeSceneActive({ id })          (set-scene)
  //   AudioService.getSource({ sourceId }).setMuted(...)   (toggle-mute)
  // Scene + input name → id resolution happens via SourcesService / ScenesService.

  async execute(op: StreamlabsOp, params?: StreamlabsActionParams): Promise<void> {
    void op; void params;
    throw new Error('Streamlabs integration is scaffolded but not yet implemented');
  }
}

let _instance: StreamlabsClient | null = null;
export function getStreamlabs(): StreamlabsClient {
  if (!_instance) _instance = new StreamlabsClient();
  return _instance;
}

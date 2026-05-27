import OBSWebSocket from 'obs-websocket-js';

export type ObsConfig = {
  enabled: boolean;
  host: string;
  port: number;
  password: string;
};

export const DEFAULT_OBS_CONFIG: ObsConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 4455,
  password: '',
};

export type ObsState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ObsStatus = {
  state: ObsState;
  error?: string;
  scenes: string[];
  inputs: string[];
  sceneItems: Record<string, string[]>;
  currentScene?: string;
  recording: boolean;
  streaming: boolean;
  virtualCam: boolean;
  mutedInputs: string[];
  /** Per-input volume multiplier (0..1 typically; can be higher for overboost). */
  inputVolumes: Record<string, number>;
  /** Keys are `"<sceneName>::<sourceName>"`. Value is whether that scene item is currently visible. */
  sourceStates: Record<string, boolean>;
  /** True once the auto-retry budget (5 min) is exhausted. UI should surface a manual retry. */
  retryStopped: boolean;
};

const RETRY_INTERVAL_MS = 5000;
const RETRY_BUDGET_MS = 5 * 60 * 1000;

export type ObsOp =
  | 'toggle-record' | 'start-record' | 'stop-record'
  | 'toggle-stream' | 'start-stream' | 'stop-stream'
  | 'toggle-virtual-cam' | 'toggle-replay-buffer' | 'save-replay-buffer'
  | 'set-scene' | 'toggle-mute'
  | 'toggle-source' | 'show-source' | 'hide-source';

export type ObsActionParams = { sceneName?: string; inputName?: string; sourceName?: string };

class ObsClient {
  private obs = new OBSWebSocket();
  private state: ObsState = 'disabled';
  private err: string | undefined;
  private cfg: ObsConfig = { ...DEFAULT_OBS_CONFIG };
  private scenes: string[] = [];
  private inputs: string[] = [];
  private sceneItems: Record<string, string[]> = {};
  private currentScene: string | undefined;
  private recording = false;
  private streaming = false;
  private virtualCam = false;
  private mutedInputs = new Set<string>();
  private inputVolumes = new Map<string, number>();
  /** "<sceneName>::<sourceName>" → enabled */
  private sourceStates = new Map<string, boolean>();
  /** "<sceneName>::<sceneItemId>" → sourceName; populated during snapshot so events can resolve names */
  private sceneItemIdToSource = new Map<string, string>();
  private retryTimer: NodeJS.Timeout | null = null;
  private firstFailureAt: number | null = null;
  private retryStopped = false;
  private onChangeCb: (() => void) | null = null;

  constructor() {
    this.obs.on('ConnectionClosed', () => {
      if (this.state === 'connecting' || this.state === 'disconnected' || this.state === 'disabled') return;
      console.warn('[obs] connection closed');
      this.state = 'disconnected';
      this.scenes = [];
      this.inputs = [];
      this.sceneItems = {};
      this.currentScene = undefined;
      this.recording = false;
      this.streaming = false;
      this.virtualCam = false;
      this.mutedInputs.clear();
      this.scheduleRetry();
      this.emitChange();
    });
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      this.currentScene = data.sceneName;
      this.emitChange();
    });
    this.obs.on('SceneListChanged', () => { void this.refreshSnapshot(); });
    this.obs.on('InputCreated', () => { void this.refreshSnapshot(); });
    this.obs.on('InputRemoved', () => { void this.refreshSnapshot(); });
    this.obs.on('InputNameChanged', () => { void this.refreshSnapshot(); });
    this.obs.on('SceneItemCreated', () => { void this.refreshSnapshot(); });
    this.obs.on('SceneItemRemoved', () => { void this.refreshSnapshot(); });
    this.obs.on('SceneItemListReindexed', () => { void this.refreshSnapshot(); });

    this.obs.on('RecordStateChanged', (data) => {
      this.recording = !!data.outputActive;
      this.emitChange();
    });
    this.obs.on('StreamStateChanged', (data) => {
      this.streaming = !!data.outputActive;
      this.emitChange();
    });
    this.obs.on('VirtualcamStateChanged', (data) => {
      this.virtualCam = !!data.outputActive;
      this.emitChange();
    });
    this.obs.on('InputMuteStateChanged', (data) => {
      if (data.inputMuted) this.mutedInputs.add(data.inputName);
      else this.mutedInputs.delete(data.inputName);
      this.emitChange();
    });
    this.obs.on('InputVolumeChanged', (data) => {
      const mul = (data as { inputVolumeMul?: number }).inputVolumeMul;
      if (typeof mul === 'number') {
        this.inputVolumes.set(data.inputName, mul);
        this.emitChange();
      }
    });
    this.obs.on('SceneItemEnableStateChanged', (data) => {
      const idKey = `${data.sceneName}::${data.sceneItemId}`;
      const sourceName = this.sceneItemIdToSource.get(idKey);
      if (!sourceName) return; // unknown item — will be picked up by next snapshot
      const stateKey = `${data.sceneName}::${sourceName}`;
      this.sourceStates.set(stateKey, !!data.sceneItemEnabled);
      this.emitChange();
    });
  }

  setConfig(cfg: ObsConfig): void {
    this.cfg = { ...cfg };
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private emitChange(): void {
    this.onChangeCb?.();
  }

  status(): ObsStatus {
    return {
      state: this.state,
      error: this.err,
      scenes: [...this.scenes],
      inputs: [...this.inputs],
      sceneItems: { ...this.sceneItems },
      currentScene: this.currentScene,
      recording: this.recording,
      streaming: this.streaming,
      virtualCam: this.virtualCam,
      mutedInputs: [...this.mutedInputs],
      inputVolumes: Object.fromEntries(this.inputVolumes),
      sourceStates: Object.fromEntries(this.sourceStates),
      retryStopped: this.retryStopped,
    };
  }

  async start(): Promise<void> {
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
      await this.obs.connect(
        `ws://${this.cfg.host}:${this.cfg.port}`,
        this.cfg.password || undefined,
      );
      this.state = 'connected';
      this.firstFailureAt = null;
      this.retryStopped = false;
      console.log(`[obs] connected to ${this.cfg.host}:${this.cfg.port}`);
      await this.refreshSnapshot();
    } catch (err) {
      this.err = (err as Error).message;
      this.state = 'error';
      console.warn(`[obs] connect failed: ${this.err}`);
      this.scheduleRetry();
      this.emitChange();
    }
  }

  async stop(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    try { await this.obs.disconnect(); } catch { /* ignore */ }
    this.state = 'disabled';
    this.scenes = [];
    this.inputs = [];
    this.sceneItems = {};
    this.currentScene = undefined;
    this.recording = false;
    this.streaming = false;
    this.virtualCam = false;
    this.mutedInputs.clear();
    this.inputVolumes.clear();
    this.sourceStates.clear();
    this.sceneItemIdToSource.clear();
    // Manual retry path goes through restart() which calls stop() then start();
    // resetting these here means a manual retry gets a fresh 5-minute budget.
    this.firstFailureAt = null;
    this.retryStopped = false;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Set the volume multiplier (0..1; OBS accepts higher for overboost, we clamp for safety). */
  async setInputVolume(inputName: string, mul: number): Promise<void> {
    if (this.state !== 'connected') throw new Error(`OBS not connected (state: ${this.state})`);
    const clamped = Math.max(0, Math.min(1, mul));
    await this.obs.call('SetInputVolume', { inputName, inputVolumeMul: clamped });
    // Optimistic local update — InputVolumeChanged arrives shortly anyway.
    this.inputVolumes.set(inputName, clamped);
  }

  async execute(op: ObsOp, params: ObsActionParams = {}): Promise<void> {
    if (this.state !== 'connected') throw new Error(`OBS not connected (state: ${this.state})`);
    switch (op) {
      case 'start-record':         await this.obs.call('StartRecord'); break;
      case 'stop-record':          await this.obs.call('StopRecord'); break;
      case 'toggle-record':        await this.obs.call('ToggleRecord'); break;
      case 'start-stream':         await this.obs.call('StartStream'); break;
      case 'stop-stream':          await this.obs.call('StopStream'); break;
      case 'toggle-stream':        await this.obs.call('ToggleStream'); break;
      case 'toggle-virtual-cam':   await this.obs.call('ToggleVirtualCam'); break;
      case 'toggle-replay-buffer': await this.obs.call('ToggleReplayBuffer'); break;
      case 'save-replay-buffer':   await this.obs.call('SaveReplayBuffer'); break;
      case 'set-scene': {
        if (!params.sceneName) throw new Error('set-scene requires sceneName');
        await this.obs.call('SetCurrentProgramScene', { sceneName: params.sceneName });
        break;
      }
      case 'toggle-mute': {
        if (!params.inputName) throw new Error('toggle-mute requires inputName');
        await this.obs.call('ToggleInputMute', { inputName: params.inputName });
        break;
      }
      case 'toggle-source': {
        if (!params.sceneName || !params.sourceName) {
          throw new Error('toggle-source requires sceneName and sourceName');
        }
        const { sceneItemId } = await this.obs.call('GetSceneItemId', {
          sceneName: params.sceneName,
          sourceName: params.sourceName,
        });
        const { sceneItemEnabled } = await this.obs.call('GetSceneItemEnabled', {
          sceneName: params.sceneName,
          sceneItemId,
        });
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: params.sceneName,
          sceneItemId,
          sceneItemEnabled: !sceneItemEnabled,
        });
        break;
      }
      case 'show-source':
      case 'hide-source': {
        if (!params.sceneName || !params.sourceName) {
          throw new Error(`${op} requires sceneName and sourceName`);
        }
        await this.setSourceVisibility(params.sceneName, params.sourceName, op === 'show-source');
        break;
      }
    }
  }

  private async setSourceVisibility(sceneName: string, sourceName: string, enabled: boolean): Promise<void> {
    const { sceneItemId } = await this.obs.call('GetSceneItemId', { sceneName, sourceName });
    await this.obs.call('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
  }

  private async refreshSnapshot(): Promise<void> {
    if (this.state !== 'connected') return;
    try {
      const sceneList = await this.obs.call('GetSceneList');
      this.currentScene = sceneList.currentProgramSceneName as string;
      this.scenes = (sceneList.scenes as Array<{ sceneName: string }>).map((s) => s.sceneName);
      const inputList = await this.obs.call('GetInputList');
      this.inputs = (inputList.inputs as Array<{ inputName: string }>).map((i) => i.inputName);

      const sceneItems: Record<string, string[]> = {};
      this.sceneItemIdToSource.clear();
      this.sourceStates.clear();
      for (const sceneName of this.scenes) {
        try {
          const items = await this.obs.call('GetSceneItemList', { sceneName });
          const arr = items.sceneItems as Array<{ sourceName: string; sceneItemId: number; sceneItemEnabled: boolean }>;
          sceneItems[sceneName] = arr.map((i) => i.sourceName);
          for (const item of arr) {
            this.sceneItemIdToSource.set(`${sceneName}::${item.sceneItemId}`, item.sourceName);
            this.sourceStates.set(`${sceneName}::${item.sourceName}`, !!item.sceneItemEnabled);
          }
        } catch {
          // some scenes (e.g. groups) may not be queryable — skip silently
        }
      }
      this.sceneItems = sceneItems;

      try {
        const rec = await this.obs.call('GetRecordStatus');
        this.recording = !!rec.outputActive;
      } catch { /* ignore */ }
      try {
        const stream = await this.obs.call('GetStreamStatus');
        this.streaming = !!stream.outputActive;
      } catch { /* ignore */ }
      try {
        const vcam = await this.obs.call('GetVirtualCamStatus');
        this.virtualCam = !!vcam.outputActive;
      } catch { /* virtual cam not available */ }

      this.mutedInputs.clear();
      this.inputVolumes.clear();
      for (const inputName of this.inputs) {
        try {
          const { inputMuted } = await this.obs.call('GetInputMute', { inputName });
          if (inputMuted) this.mutedInputs.add(inputName);
          const vol = await this.obs.call('GetInputVolume', { inputName });
          const mul = (vol as { inputVolumeMul?: number }).inputVolumeMul;
          if (typeof mul === 'number') this.inputVolumes.set(inputName, mul);
        } catch {
          // non-audio input — skip
        }
      }
    } catch (err) {
      console.warn('[obs] snapshot failed:', (err as Error).message);
    } finally {
      this.emitChange();
    }
  }

  private scheduleRetry(): void {
    if (!this.cfg.enabled) return;
    if (this.retryTimer) return;
    if (this.retryStopped) return;

    const now = Date.now();
    if (this.firstFailureAt === null) {
      this.firstFailureAt = now;
    } else if (now - this.firstFailureAt > RETRY_BUDGET_MS) {
      console.warn('[obs] retry budget exceeded (5 min) — pausing auto-reconnect; manual retry required');
      this.retryStopped = true;
      this.emitChange();
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, RETRY_INTERVAL_MS);
  }
}

let _instance: ObsClient | null = null;
export function getObs(): ObsClient {
  if (!_instance) _instance = new ObsClient();
  return _instance;
}

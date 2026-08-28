import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Nanoleaf integration — light panels, Shapes, Elements, Lines, Canvas.
 *
 * Uses Nanoleaf's official Open API, which is a plain-HTTP REST server the
 * controller exposes on port 16021 to anything on the LAN. Auth is a
 * token embedded directly in the URL path (`/api/v1/<token>/…`) — the token
 * is granted by holding the power button on the controller for 5–7 seconds
 * (entering pairing mode) and POSTing to `/api/v1/new` while it's in that
 * state. Same UX as our Hue integration; different transport shape.
 *
 * MVP scope:
 *   - power-on / power-off / power-toggle
 *   - effect-select (activate a saved effect by name — the primary use case;
 *     users build the actual color / motion combos in the Nanoleaf app)
 *   - identify (brief pulse — useful for verifying the right controller)
 * Slider provider `'nanoleaf'` drives brightness 0..100; tap toggles power.
 *
 * Live state polls `GET /api/v1/<token>/` every 5 s. Nanoleaf also supports
 * an SSE event stream (`/api/v1/<token>/events`) that would give instant
 * updates from Nanoleaf-app / physical-remote / rhythm changes, but that's
 * follow-up scope.
 */

export type PublicNanoleafConfig = {
  enabled: boolean;
  host: string;
  hasAuthToken: boolean;
};

export function publicNanoleafConfig(cfg: NanoleafConfig): PublicNanoleafConfig {
  return {
    enabled: cfg.enabled,
    host: cfg.host,
    hasAuthToken: !!cfg.authToken,
  };
}

export function validateNanoleafConfig(input: unknown, existing: NanoleafConfig): NanoleafConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Nanoleaf config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' ? o.host.trim() : existing.host,
    // Auth token is managed by the pairing flow — never accept it from user PUTs.
    authToken: existing.authToken,
  };
}

export const NANOLEAF_MANIFEST: IntegrationManifest = {
  name: 'nanoleaf',
  displayName: 'Nanoleaf',
  actionTypes: ['nanoleaf'],
  hasOAuth: false,
  // The button-hold + POST-to-/new dance is the same "interactive step at the
  // target hardware" pattern as Hue — model it as IPC auth so the auto-router
  // exposes POST /connect for the pairing flow.
  hasIpcAuth: true,
};

export type NanoleafConfig = {
  enabled: boolean;
  host: string;
  authToken: string;
};

export const DEFAULT_NANOLEAF_CONFIG: NanoleafConfig = {
  enabled: false,
  host: '',
  authToken: '',
};

export type NanoleafState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type NanoleafStatus = {
  state: NanoleafState;
  error?: string;
  host?: string;
  /** Friendly name from the controller (e.g. "Sam's Nanoleaf"). */
  name?: string;
  /** Current on/off state — drives tile-active state for `power-toggle`. */
  isOn?: boolean;
  /** Current brightness 0..100 — drives the slider position. */
  brightness?: number;
  /** Currently-selected effect. */
  currentEffect?: string;
  /** All named effects the user has saved on this controller. */
  effects?: string[];
  /** How many panels are connected — useful for the setup panel. */
  panelCount?: number;
  firmwareVersion?: string;
};

export type NanoleafOp =
  | 'power-on' | 'power-off' | 'power-toggle'
  | 'effect-select'
  | 'identify';

export type NanoleafActionParams = {
  effectName?: string;
};

const PORT = 16021;
const POLL_INTERVAL_MS = 5_000;

class NanoleafClient implements IntegrationLifecycle {
  readonly manifest = NANOLEAF_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.nanoleaf); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.nanoleaf = cfg;
      await save();
    });
  }
  publicConfig(): PublicNanoleafConfig { return publicNanoleafConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): NanoleafStatus {
    let state: NanoleafState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.host) state = 'not-configured';
    else if (!this.cfg.authToken) state = 'needs-auth';
    else state = this.err ? 'error' : this.pollTimer ? 'connected' : 'connecting';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      host: this.cfg.host || undefined,
      name: this.name,
      isOn: this.isOn,
      brightness: this.brightness,
      currentEffect: this.currentEffect,
      effects: this.effects,
      panelCount: this.panelCount,
      firmwareVersion: this.firmwareVersion,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateNanoleafConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Nanoleaf integration not attached');
    this.serverConfig.integrations.nanoleaf = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled && validated.host && validated.authToken) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  /** POST /api/v1/new — controller must be in pairing mode (power button held
   *  5–7 seconds until the LED flashes). On 401/403, tell the user how to
   *  enter that state; anything else surfaces as-is. */
  async connectInteractive(): Promise<CallbackOutcome> {
    if (!this.cfg.host) throw new Error('Set the Nanoleaf controller IP first.');
    let res: Response;
    try {
      res = await fetch(`http://${this.cfg.host}:${PORT}/api/v1/new`, {
        method: 'POST',
        signal: AbortSignal.timeout(6_000),
      });
    } catch (err) {
      throw new Error(`Cannot reach Nanoleaf at ${this.cfg.host}: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Hold the power button on the Nanoleaf controller for 5–7 s until the LED flashes, then try again within 30 s.');
    }
    if (!res.ok) {
      throw new Error(`Nanoleaf pairing failed: HTTP ${res.status}`);
    }
    const data = await res.json() as { auth_token?: string };
    if (!data.auth_token) throw new Error('Nanoleaf pairing succeeded but no token was returned.');
    this.cfg.authToken = data.auth_token;
    await this.persistCfg();
    this.emitChange();
    await this.start();
    return { successMessage: this.name ? `Linked to Nanoleaf "${this.name}".` : 'Linked to Nanoleaf controller.' };
  }

  async disconnectIntegration(): Promise<void> {
    // Best-effort revoke on the controller so the token becomes invalid there
    // too. Ignore failures — the local wipe still happens.
    if (this.cfg.host && this.cfg.authToken) {
      try {
        await fetch(`http://${this.cfg.host}:${PORT}/api/v1/${this.cfg.authToken}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(3_000),
        });
      } catch { /* nonfatal */ }
    }
    await this.stop();
    this.cfg.authToken = '';
    this.name = undefined;
    this.isOn = undefined;
    this.brightness = undefined;
    this.currentEffect = undefined;
    this.effects = undefined;
    this.panelCount = undefined;
    this.firmwareVersion = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.host || !this.cfg.authToken) return;
    if (this.pollTimer) return;
    this.err = undefined;
    try {
      await this.refresh();
    } catch (err) {
      this.err = friendlyError(err as Error);
      console.warn(`[nanoleaf] initial refresh failed: ${this.err}`);
      this.emitChange();
      return;
    }
    this.pollTimer = setInterval(() => { void this.pollState(); }, POLL_INTERVAL_MS);
    this.emitChange();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: NanoleafOp, params: NanoleafActionParams | undefined): Promise<void> {
    if (!this.cfg.authToken) throw new Error('Nanoleaf not linked');
    switch (op) {
      case 'power-on':     return this.putState({ on: { value: true } }, true);
      case 'power-off':    return this.putState({ on: { value: false } }, false);
      case 'power-toggle': return this.putState({ on: { value: !this.isOn } }, !this.isOn);
      case 'effect-select': {
        const name = params?.effectName?.trim();
        if (!name) throw new Error('Nanoleaf effect-select: effectName required');
        await this.apiPut('/effects', { select: name });
        // Optimistic local update so the tile / picker reflects the switch
        // before the next poll lands.
        this.currentEffect = name;
        this.isOn = true;
        this.emitChange();
        return;
      }
      case 'identify':
        // Identify is a firmware-driven pulse; no state changes.
        return this.apiPut('/identify', {});
      default:
        throw new Error(`unknown Nanoleaf op: ${op as string}`);
    }
  }

  /** Set brightness 0..1 — used by the slider tile. Wraps power on/off since
   *  Nanoleaf treats brightness=0 as still-on-but-black; a slider tap to 0
   *  should behave like "off" in the user's mental model. */
  async setBrightness(value: number): Promise<void> {
    if (!this.cfg.authToken) throw new Error('Nanoleaf not linked');
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    if (pct === 0) {
      await this.apiPut('/state', { on: { value: false } });
      this.isOn = false;
      this.brightness = 0;
    } else {
      // Set brightness AND flip on in one payload — cheaper than two round trips.
      await this.apiPut('/state', { on: { value: true }, brightness: { value: pct } });
      this.isOn = true;
      this.brightness = pct;
    }
    this.emitChange();
  }

  async togglePower(): Promise<void> { await this.execute('power-toggle', undefined); }

  // ─── internal ───────────────────────────────────────────────

  private cfg: NanoleafConfig = { ...DEFAULT_NANOLEAF_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: NanoleafConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private err: string | undefined;
  private name: string | undefined;
  private firmwareVersion: string | undefined;
  private isOn: boolean | undefined;
  private brightness: number | undefined;
  private currentEffect: string | undefined;
  private effects: string[] | undefined;
  private panelCount: number | undefined;

  setConfig(cfg: NanoleafConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: NanoleafConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }
  private async persistCfg(): Promise<void> { if (this.saveCb) await this.saveCb({ ...this.cfg }); }

  private async putState(state: Record<string, unknown>, nextIsOn: boolean | undefined): Promise<void> {
    await this.apiPut('/state', state);
    if (nextIsOn !== undefined) {
      this.isOn = nextIsOn;
      this.emitChange();
    }
  }

  private async refresh(): Promise<void> {
    const data = await this.apiGet<NanoleafRootResponse>('');
    this.name = data.name;
    this.firmwareVersion = data.firmwareVersion;
    this.isOn = data.state?.on?.value;
    this.brightness = data.state?.brightness?.value;
    this.currentEffect = data.effects?.select;
    this.effects = data.effects?.effectsList;
    this.panelCount = data.panelLayout?.layout?.numPanels;
    this.err = undefined;
    this.emitChange();
  }

  private async pollState(): Promise<void> {
    try {
      // /state is lighter than the full root. But the effect selection is
      // under /effects, so we poll both — still just two small requests.
      const [state, effects] = await Promise.all([
        this.apiGet<NanoleafStateResponse>('/state'),
        this.apiGet<NanoleafEffectsResponse>('/effects'),
      ]);
      const nextIsOn = state.on?.value;
      const nextBrightness = state.brightness?.value;
      const nextEffect = effects.select;
      const nextEffects = effects.effectsList;
      const changed =
        nextIsOn !== this.isOn ||
        nextBrightness !== this.brightness ||
        nextEffect !== this.currentEffect ||
        !sameArray(nextEffects, this.effects);
      if (changed) {
        this.isOn = nextIsOn;
        this.brightness = nextBrightness;
        this.currentEffect = nextEffect;
        this.effects = nextEffects;
        this.emitChange();
      }
      this.err = undefined;
    } catch (err) {
      this.err = friendlyError(err as Error);
      console.warn(`[nanoleaf] poll failed: ${this.err}`);
      this.emitChange();
    }
  }

  private async apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`http://${this.cfg.host}:${PORT}/api/v1/${this.cfg.authToken}${path}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('unauthorized (bad or revoked token)');
    if (!res.ok) throw new Error(`Nanoleaf GET ${path}: HTTP ${res.status}`);
    return await res.json() as T;
  }

  private async apiPut(path: string, body: unknown): Promise<void> {
    const res = await fetch(`http://${this.cfg.host}:${PORT}/api/v1/${this.cfg.authToken}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6_000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('unauthorized (bad or revoked token)');
    // Nanoleaf usually replies 204 on success, sometimes 200. 4xx/5xx = fail.
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Nanoleaf PUT ${path}: HTTP ${res.status} ${await res.text()}`);
    }
  }
}

// ─── Raw response shapes (partial) ──────────────────────────────

type NanoleafRootResponse = {
  name?: string;
  firmwareVersion?: string;
  state?: NanoleafStateResponse;
  effects?: NanoleafEffectsResponse;
  panelLayout?: { layout?: { numPanels?: number } };
};

type NanoleafStateResponse = {
  on?: { value?: boolean };
  brightness?: { value?: number };
};

type NanoleafEffectsResponse = {
  select?: string;
  effectsList?: string[];
};

function sameArray(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function friendlyError(err: Error): string {
  const msg = err.message ?? String(err);
  if (msg.includes('unauthorized')) return 'Token no longer valid — press the controller\'s power button (5–7 s) and click "Re-link" to pair again.';
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('EAI_AGAIN')) {
    return 'Cannot reach Nanoleaf — check the controller IP and make sure it\'s on the same network as this PC.';
  }
  if (msg.includes('AbortError') || msg.includes('timed out')) return 'Nanoleaf did not respond in time.';
  return msg;
}

let _instance: NanoleafClient | null = null;
export function getNanoleaf(): NanoleafClient {
  if (!_instance) {
    _instance = new NanoleafClient();
    registerIntegration(_instance);
  }
  return _instance;
}

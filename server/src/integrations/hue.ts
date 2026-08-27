import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Philips Hue integration — smart lighting control via the Hue Bridge's
 * local HTTPS CLIP v2 API.
 *
 * Setup flow (deliberately unlike our OAuth integrations — no browser round-
 * trip, no client secret to register):
 *   1. Auto-discovery via https://discovery.meethue.com — a Philips-hosted
 *      lookup that returns bridges whose "internalipaddress" matches your
 *      public IP. Zero-config if the bridge is already registered with
 *      Philips. Manual IP entry is available as a fallback.
 *   2. User presses the physical link button on the bridge.
 *   3. Digi Deck POSTs to https://<bridge>/api with `{devicetype}` and gets
 *      back an application-key. That key becomes the `hue-application-key`
 *      header on every subsequent CLIP v2 call.
 *
 * We treat that dance as "IPC auth" — same lifecycle contract as Discord's
 * pipe-based flow (no browser callback, needs an interactive step in the
 * target hardware). `connectInteractive()` fires the POST; success requires
 * the button pressed within the previous 30 s.
 *
 * The bridge uses a self-signed certificate. Since it's a LAN device with
 * a fixed IP, cert verification would need users to trust the bridge's CA
 * — impractical. We use a `HttpsAgent` with `rejectUnauthorized: false`
 * scoped to Hue calls only, so this bypass never touches other traffic.
 *
 * Polling: every 5 s while connected we refresh lights + grouped_lights so
 * "room is on" / "light is on" tile state reflects reality even when
 * changes happen via the Hue app / a physical switch / a motion sensor.
 */

export type PublicHueConfig = {
  enabled: boolean;
  bridgeIp: string;
  bridgeId: string;
  hasApplicationKey: boolean;
};

export function publicHueConfig(cfg: HueConfig): PublicHueConfig {
  return {
    enabled: cfg.enabled,
    bridgeIp: cfg.bridgeIp,
    bridgeId: cfg.bridgeId,
    hasApplicationKey: !!cfg.applicationKey,
  };
}

export function validateHueConfig(input: unknown, existing: HueConfig): HueConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Hue config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    bridgeIp: typeof o.bridgeIp === 'string' ? o.bridgeIp.trim() : existing.bridgeIp,
    // Application key + bridge id come from the link-button flow, not user input.
    applicationKey: existing.applicationKey,
    bridgeId: existing.bridgeId,
  };
}

export const HUE_MANIFEST: IntegrationManifest = {
  name: 'hue',
  displayName: 'Philips Hue',
  actionTypes: ['hue'],
  hasOAuth: false,
  // The link-button POST is the equivalent of Discord's IPC auth — a user
  // interaction in the target hardware, no browser callback.
  hasIpcAuth: true,
};

export type HueConfig = {
  enabled: boolean;
  bridgeIp: string;
  applicationKey: string;
  bridgeId: string;
};

export const DEFAULT_HUE_CONFIG: HueConfig = {
  enabled: false,
  bridgeIp: '',
  applicationKey: '',
  bridgeId: '',
};

export type HueState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type HueLight = {
  id: string;
  name: string;
  on: boolean;
  brightness?: number; // 0..100
};

export type HueRoom = {
  id: string;
  name: string;
  /** grouped_light resource id — used for on/off/brightness. */
  groupedLightId: string;
  on: boolean;
  brightness?: number;
};

export type HueScene = {
  id: string;
  name: string;
  /** Room / zone this scene applies to — helps users pick from a long list. */
  groupName?: string;
};

export type HueStatus = {
  state: HueState;
  error?: string;
  bridgeIp?: string;
  bridgeName?: string;
  lights?: HueLight[];
  rooms?: HueRoom[];
  scenes?: HueScene[];
};

export type HueOp =
  | 'scene-on'
  | 'light-on' | 'light-off' | 'light-toggle'
  | 'room-on' | 'room-off' | 'room-toggle';

export type HueActionParams = {
  lightId?: string;
  roomId?: string;
  sceneId?: string;
};

// ─── Cert bypass ────────────────────────────────────────────────
// Hue bridges ship with a self-signed certificate signed for their bridge id,
// not their IP. Since we can't trust a per-user CA out of the box, we bypass
// verification with a scoped agent — never touches other integrations' traffic.
const hueAgent = new HttpsAgent({ rejectUnauthorized: false, keepAlive: true });

const POLL_INTERVAL_MS = 5_000;

class HueClient implements IntegrationLifecycle {
  readonly manifest = HUE_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.hue); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.hue = cfg;
      await save();
    });
  }
  publicConfig(): PublicHueConfig { return publicHueConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): HueStatus {
    let state: HueState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.bridgeIp) state = 'not-configured';
    else if (!this.cfg.applicationKey) state = 'needs-auth';
    else state = this.err ? 'error' : this.pollTimer ? 'connected' : 'connecting';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      bridgeIp: this.cfg.bridgeIp || undefined,
      bridgeName: this.bridgeName,
      lights: this.lights,
      rooms: this.rooms,
      scenes: this.scenes,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateHueConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Hue integration not attached');
    this.serverConfig.integrations.hue = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled && validated.applicationKey && validated.bridgeIp) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  /** Discover Hue bridges on the LAN via Philips's cloud lookup. Uses the
   *  public IP → bridge mapping so a) works from any subnet and b) doesn't
   *  need mDNS/SSDP. Falls back gracefully when offline. */
  async discoverBridges(): Promise<Array<{ id: string; ip: string; port?: number }>> {
    try {
      const res = await fetch('https://discovery.meethue.com/', { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const list = await res.json() as Array<{ id?: string; internalipaddress?: string; port?: number }>;
      return list
        .filter((b) => b.id && b.internalipaddress)
        .map((b) => ({ id: b.id!, ip: b.internalipaddress!, port: b.port }));
    } catch {
      return [];
    }
  }

  /** Perform the link-button POST. The user must have pressed the physical
   *  button within the previous 30 s; otherwise the bridge returns
   *  `[{"error":{"type":101,"description":"link button not pressed"}}]`. */
  async connectInteractive(): Promise<CallbackOutcome> {
    if (!this.cfg.bridgeIp) throw new Error('Set the bridge IP first (or run discovery).');
    const res = await hueFetch(this.cfg.bridgeIp, '/api', {
      method: 'POST',
      body: JSON.stringify({ devicetype: 'digi-deck#server', generateclientkey: true }),
    });
    if (res.status !== 200) throw new Error(`Hue link failed: HTTP ${res.status}`);
    const parsed = safeJson(res.body) as Array<{ success?: { username?: string }; error?: { description?: string; type?: number } }> | null;
    const err = parsed?.find((p) => p.error);
    if (err?.error) {
      const desc = err.error.description ?? '';
      if (err.error.type === 101 || /link button/i.test(desc)) {
        throw new Error('Press the round button on the bridge, then try again within 30 s.');
      }
      throw new Error(`Hue link failed: ${desc || 'unknown error'}`);
    }
    const key = parsed?.find((p) => p.success?.username)?.success?.username;
    if (!key) throw new Error('Hue link succeeded but no application key returned.');

    // Fetch the bridge's own metadata to grab its stable id + name.
    this.cfg.applicationKey = key;
    try {
      const meta = await this.clipGet<{ data?: Array<{ id?: string; product_name?: string }> }>('/clip/v2/resource/bridge');
      const b = meta?.data?.[0];
      if (b?.id) this.cfg.bridgeId = b.id;
      this.bridgeName = b?.product_name ?? undefined;
    } catch { /* nonfatal — key still works */ }
    await this.persistCfg();
    this.emitChange();
    await this.start();
    return { successMessage: `Linked to Hue bridge ${this.bridgeName ?? this.cfg.bridgeIp}.` };
  }

  async disconnectIntegration(): Promise<void> {
    await this.stop();
    this.cfg.applicationKey = '';
    this.cfg.bridgeId = '';
    this.bridgeName = undefined;
    this.lights = undefined;
    this.rooms = undefined;
    this.scenes = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.bridgeIp || !this.cfg.applicationKey) return;
    if (this.pollTimer) return;
    this.err = undefined;
    // Snapshot lights + rooms + scenes once so the UI has content immediately;
    // then poll lights/rooms only on the interval (scenes rarely change).
    try {
      await this.refreshAll();
    } catch (err) {
      this.err = (err as Error).message;
      console.warn(`[hue] initial refresh failed: ${this.err}`);
    }
    this.pollTimer = setInterval(() => { void this.pollLightState(); }, POLL_INTERVAL_MS);
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

  async execute(op: HueOp, params: HueActionParams | undefined): Promise<void> {
    if (!this.cfg.applicationKey) throw new Error('Hue not linked to a bridge');
    switch (op) {
      case 'scene-on': {
        const id = requireId(params?.sceneId, 'sceneId');
        await this.clipPut(`/clip/v2/resource/scene/${id}`, { recall: { action: 'active' } });
        return;
      }
      case 'light-on':
      case 'light-off':
      case 'light-toggle': {
        const id = requireId(params?.lightId, 'lightId');
        let target: boolean;
        if (op === 'light-toggle') target = !(this.lights?.find((l) => l.id === id)?.on ?? false);
        else target = op === 'light-on';
        await this.clipPut(`/clip/v2/resource/light/${id}`, { on: { on: target } });
        // Optimistic update so the tile flips before the next poll lands.
        const light = this.lights?.find((l) => l.id === id);
        if (light) { light.on = target; this.emitChange(); }
        return;
      }
      case 'room-on':
      case 'room-off':
      case 'room-toggle': {
        const roomId = requireId(params?.roomId, 'roomId');
        const room = this.rooms?.find((r) => r.id === roomId);
        if (!room) throw new Error(`Hue room not found: ${roomId}`);
        let target: boolean;
        if (op === 'room-toggle') target = !room.on;
        else target = op === 'room-on';
        await this.clipPut(`/clip/v2/resource/grouped_light/${room.groupedLightId}`, { on: { on: target } });
        room.on = target;
        this.emitChange();
        return;
      }
      default:
        throw new Error(`unknown Hue op: ${op as string}`);
    }
  }

  /** Set a light's or room's brightness 0..1 — used by the slider tile. */
  async setBrightness(target: string, value: number): Promise<void> {
    if (!this.cfg.applicationKey) throw new Error('Hue not linked to a bridge');
    const percent = Math.max(0, Math.min(100, value * 100));
    // Slider inputName encodes both the target type and id: "light:<id>" or "room:<id>".
    const [kind, id] = target.split(':');
    if (kind === 'light') {
      await this.clipPut(`/clip/v2/resource/light/${id}`, {
        on: { on: percent > 0 },
        dimming: { brightness: percent },
      });
      const light = this.lights?.find((l) => l.id === id);
      if (light) { light.on = percent > 0; light.brightness = percent; this.emitChange(); }
    } else if (kind === 'room') {
      const room = this.rooms?.find((r) => r.id === id);
      if (!room) throw new Error(`Hue room not found: ${id}`);
      await this.clipPut(`/clip/v2/resource/grouped_light/${room.groupedLightId}`, {
        on: { on: percent > 0 },
        dimming: { brightness: percent },
      });
      room.on = percent > 0;
      room.brightness = percent;
      this.emitChange();
    } else {
      throw new Error(`Hue slider inputName must be "light:<id>" or "room:<id>"`);
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: HueConfig = { ...DEFAULT_HUE_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: HueConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private err: string | undefined;
  private bridgeName: string | undefined;
  private lights: HueLight[] | undefined;
  private rooms: HueRoom[] | undefined;
  private scenes: HueScene[] | undefined;

  setConfig(cfg: HueConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: HueConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }
  private async persistCfg(): Promise<void> { if (this.saveCb) await this.saveCb({ ...this.cfg }); }

  private async refreshAll(): Promise<void> {
    const [lightsRes, roomsRes, groupsRes, scenesRes] = await Promise.all([
      this.clipGet<{ data?: HueLightRaw[] }>('/clip/v2/resource/light'),
      this.clipGet<{ data?: HueRoomRaw[] }>('/clip/v2/resource/room'),
      this.clipGet<{ data?: HueGroupedLightRaw[] }>('/clip/v2/resource/grouped_light'),
      this.clipGet<{ data?: HueSceneRaw[] }>('/clip/v2/resource/scene'),
    ]);
    this.lights = (lightsRes.data ?? []).map((l) => ({
      id: l.id,
      name: l.metadata?.name ?? l.id,
      on: !!l.on?.on,
      brightness: l.dimming?.brightness,
    })).sort((a, b) => a.name.localeCompare(b.name));

    // Rooms reference grouped_light via `services` — we resolve that so a
    // single tile press can drive the whole room's on/off + brightness.
    const groups = new Map(groupsRes.data?.map((g) => [g.id, g]) ?? []);
    this.rooms = (roomsRes.data ?? []).map((r) => {
      const grpService = r.services?.find((s) => s.rtype === 'grouped_light');
      const groupedLightId = grpService?.rid ?? '';
      const grp = groups.get(groupedLightId);
      return {
        id: r.id,
        name: r.metadata?.name ?? r.id,
        groupedLightId,
        on: !!grp?.on?.on,
        brightness: grp?.dimming?.brightness,
      };
    }).filter((r) => r.groupedLightId).sort((a, b) => a.name.localeCompare(b.name));

    // Attach the room name to each scene so users can distinguish "Bright" in
    // living room vs "Bright" in kitchen when picking one.
    const roomNames = new Map<string, string>();
    (roomsRes.data ?? []).forEach((r) => { roomNames.set(r.id, r.metadata?.name ?? r.id); });
    this.scenes = (scenesRes.data ?? []).map((s) => ({
      id: s.id,
      name: s.metadata?.name ?? s.id,
      groupName: s.group ? roomNames.get(s.group.rid) : undefined,
    })).sort((a, b) => {
      const g = (a.groupName ?? '').localeCompare(b.groupName ?? '');
      return g !== 0 ? g : a.name.localeCompare(b.name);
    });
    this.err = undefined;
    this.emitChange();
  }

  private async pollLightState(): Promise<void> {
    try {
      const [lightsRes, groupsRes] = await Promise.all([
        this.clipGet<{ data?: HueLightRaw[] }>('/clip/v2/resource/light'),
        this.clipGet<{ data?: HueGroupedLightRaw[] }>('/clip/v2/resource/grouped_light'),
      ]);
      const nextLights = (lightsRes.data ?? []).map((l) => ({
        id: l.id,
        name: l.metadata?.name ?? l.id,
        on: !!l.on?.on,
        brightness: l.dimming?.brightness,
      })).sort((a, b) => a.name.localeCompare(b.name));

      const groups = new Map(groupsRes.data?.map((g) => [g.id, g]) ?? []);
      const nextRooms = (this.rooms ?? []).map((r) => {
        const g = groups.get(r.groupedLightId);
        return { ...r, on: !!g?.on?.on, brightness: g?.dimming?.brightness };
      });

      const changed =
        !this.lights ||
        this.lights.length !== nextLights.length ||
        nextLights.some((l, i) => l.on !== this.lights![i].on || l.brightness !== this.lights![i].brightness) ||
        nextRooms.some((r, i) => r.on !== (this.rooms?.[i]?.on ?? false) || r.brightness !== this.rooms?.[i]?.brightness);

      if (changed) {
        this.lights = nextLights;
        this.rooms = nextRooms;
        this.emitChange();
      }
      this.err = undefined;
    } catch (err) {
      this.err = (err as Error).message;
      console.warn(`[hue] poll failed: ${this.err}`);
      this.emitChange();
    }
  }

  private async clipGet<T>(path: string): Promise<T> {
    const res = await hueFetch(this.cfg.bridgeIp, path, {
      headers: { 'hue-application-key': this.cfg.applicationKey },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Hue GET ${path}: HTTP ${res.status} ${res.body.slice(0, 100)}`);
    }
    return safeJson(res.body) as T;
  }

  private async clipPut(path: string, body: unknown): Promise<void> {
    const res = await hueFetch(this.cfg.bridgeIp, path, {
      method: 'PUT',
      headers: {
        'hue-application-key': this.cfg.applicationKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Hue PUT ${path}: HTTP ${res.status} ${res.body.slice(0, 200)}`);
    }
  }
}

// ─── Raw CLIP v2 response shapes (partial — only what we consume) ───

type HueLightRaw = {
  id: string;
  metadata?: { name?: string };
  on?: { on?: boolean };
  dimming?: { brightness?: number };
};

type HueRoomRaw = {
  id: string;
  metadata?: { name?: string };
  services?: Array<{ rid: string; rtype: string }>;
};

type HueGroupedLightRaw = {
  id: string;
  on?: { on?: boolean };
  dimming?: { brightness?: number };
};

type HueSceneRaw = {
  id: string;
  metadata?: { name?: string };
  group?: { rid: string; rtype: string };
};

// ─── Helpers ────────────────────────────────────────────────────

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function requireId(id: string | undefined, name: string): string {
  if (!id || !id.trim()) throw new Error(`Hue: ${name} required`);
  return id.trim();
}

/** Node-native HTTPS request with the Hue-scoped agent (rejectUnauthorized:
 *  false). Returns a fetch-shaped {status, body} tuple. */
async function hueFetch(
  bridgeIp: string,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: bridgeIp,
      path,
      method: init.method ?? 'GET',
      headers: {
        'User-Agent': 'digi-deck',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      agent: hueAgent,
      // Bridge is on LAN — 8 s covers even sluggish v1 bridges.
      timeout: 8000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Hue request timed out (bridge unreachable?)')); });
    if (init.body) req.write(init.body);
    req.end();
  });
}

let _instance: HueClient | null = null;
export function getHue(): HueClient {
  if (!_instance) {
    _instance = new HueClient();
    registerIntegration(_instance);
  }
  return _instance;
}

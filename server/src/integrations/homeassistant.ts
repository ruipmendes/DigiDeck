import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Home Assistant integration — REST API + long-lived access token.
 *
 * Home Assistant is a self-hosted smart-home hub that bridges to *everything*
 * (Zigbee, Z-Wave, Matter, Tapo, LIFX, Hue, Sonos, cameras, sensors, custom
 * automations, …). By integrating with HA we expose that whole graph through
 * Digi Deck without writing per-brand adapters — one integration, dozens of
 * device brands.
 *
 * Setup is deliberately manual (no discovery, no OAuth):
 *   1. User points Digi Deck at their HA URL (e.g. http://homeassistant.local:8123).
 *   2. User creates a Long-Lived Access Token in HA (Profile → Security →
 *      Long-Lived Access Tokens) and pastes it in Digi Deck.
 *   3. Digi Deck verifies via GET /api/ and enumerates entities.
 *
 * Entity model: HA groups everything into "entities" keyed by
 * `<domain>.<name>` (e.g. `light.living_room`, `scene.movie_night`,
 * `media_player.kitchen_sonos`). We surface the domains most useful for a
 * Stream-Deck-style deck — lights, switches, scenes, scripts, automations,
 * media players, climate, covers — and expose per-domain ops (`light-toggle`,
 * `scene-activate`, `script-run`, etc.) that resolve to the corresponding
 * `POST /api/services/<domain>/<service>` call.
 *
 * Live state polls `/api/states` every 5 s. Simple polling instead of the
 * WebSocket API keeps the code paths uniform with the rest of the
 * integrations; HA is usually on-LAN so the round-trip cost is negligible.
 */

export type PublicHomeAssistantConfig = {
  enabled: boolean;
  baseUrl: string;
  hasToken: boolean;
};

export function publicHomeAssistantConfig(cfg: HomeAssistantConfig): PublicHomeAssistantConfig {
  return {
    enabled: cfg.enabled,
    baseUrl: cfg.baseUrl,
    hasToken: !!cfg.token,
  };
}

export function validateHomeAssistantConfig(input: unknown, existing: HomeAssistantConfig): HomeAssistantConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Home Assistant config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl.trim().replace(/\/$/, '') : existing.baseUrl,
    // The token stays server-side. Empty string means "keep existing"; explicit
    // null means "clear" (used by the disconnect flow).
    token: typeof o.token === 'string' && o.token.length > 0
      ? o.token
      : o.token === null
        ? ''
        : existing.token,
  };
}

export const HOMEASSISTANT_MANIFEST: IntegrationManifest = {
  name: 'homeassistant',
  displayName: 'Home Assistant',
  actionTypes: ['homeassistant'],
  hasOAuth: false,
};

export type HomeAssistantConfig = {
  enabled: boolean;
  baseUrl: string;
  token: string;
};

export const DEFAULT_HOMEASSISTANT_CONFIG: HomeAssistantConfig = {
  enabled: false,
  baseUrl: '',
  token: '',
};

export type HomeAssistantState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

/** Cut-down entity shape — only the fields the phone / editor needs, so
 *  massive HA setups (200+ entities) don't blow the state broadcast. */
export type HomeAssistantEntity = {
  id: string;
  name: string;
  domain: string;
  state: string;
  /** True for entities in an "on" / active-ish state — drives tile-active lights. */
  on: boolean;
  /** Brightness (0..100) for lights, volume (0..100) for media players. */
  level?: number;
};

export type HomeAssistantStatus = {
  state: HomeAssistantState;
  error?: string;
  baseUrl?: string;
  version?: string;
  entities?: HomeAssistantEntity[];
};

export type HomeAssistantOp =
  | 'light-on' | 'light-off' | 'light-toggle'
  | 'switch-on' | 'switch-off' | 'switch-toggle'
  | 'scene-activate'
  | 'script-run'
  | 'automation-trigger'
  | 'media-play' | 'media-pause' | 'media-play-pause' | 'media-next' | 'media-previous'
  | 'cover-open' | 'cover-close' | 'cover-toggle'
  | 'service-call';

export type HomeAssistantActionParams = {
  /** Target entity id (`light.living_room`, etc.). Required for most ops. */
  entityId?: string;
  /** For 'service-call' only: the `domain.service` pair (e.g. `climate.set_temperature`). */
  service?: string;
  /** For 'service-call' only: raw JSON payload merged into the request. */
  serviceData?: Record<string, unknown>;
};

/** Domains we surface in the picker / entity list. Everything else is still
 *  accessible via 'service-call' but we don't clutter the UI with them. */
const SURFACED_DOMAINS = new Set([
  'light', 'switch', 'scene', 'script', 'automation',
  'media_player', 'cover', 'climate', 'input_boolean',
  'fan', 'lock', 'vacuum',
]);

const POLL_INTERVAL_MS = 5_000;

class HomeAssistantClient implements IntegrationLifecycle {
  readonly manifest = HOMEASSISTANT_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.homeassistant); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.homeassistant = cfg;
      await save();
    });
  }
  publicConfig(): PublicHomeAssistantConfig { return publicHomeAssistantConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): HomeAssistantStatus {
    let state: HomeAssistantState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.baseUrl) state = 'not-configured';
    else if (!this.cfg.token) state = 'needs-auth';
    else state = this.err ? 'error' : this.pollTimer ? 'connected' : 'connecting';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      baseUrl: this.cfg.baseUrl || undefined,
      version: this.version,
      entities: this.entities,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateHomeAssistantConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Home Assistant integration not attached');
    this.serverConfig.integrations.homeassistant = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled && validated.baseUrl && validated.token) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  async disconnectIntegration(): Promise<void> {
    await this.stop();
    this.cfg.token = '';
    this.entities = undefined;
    this.version = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.baseUrl || !this.cfg.token) return;
    if (this.pollTimer) return;
    this.err = undefined;
    try {
      const meta = await this.apiGet<{ message?: string; version?: string }>('/api/');
      // /api/ returns a fixed hello — a version isn't in every version of HA,
      // so we fall back to the /api/config call when needed.
      if (meta.version) this.version = meta.version;
      else {
        try {
          const cfg = await this.apiGet<{ version?: string }>('/api/config');
          this.version = cfg.version;
        } catch { /* nonfatal */ }
      }
      await this.refreshEntities();
    } catch (err) {
      this.err = friendlyError(err as Error);
      console.warn(`[homeassistant] connect failed: ${this.err}`);
      this.emitChange();
      return;
    }
    this.pollTimer = setInterval(() => { void this.refreshEntities(); }, POLL_INTERVAL_MS);
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

  async execute(op: HomeAssistantOp, params: HomeAssistantActionParams | undefined): Promise<void> {
    if (!this.cfg.token) throw new Error('Home Assistant not authorized');
    const entityId = params?.entityId?.trim();
    switch (op) {
      case 'light-toggle': return this.callService('light', 'toggle', requireEntity(entityId, 'entityId'));
      case 'light-on':     return this.callService('light', 'turn_on',  requireEntity(entityId, 'entityId'));
      case 'light-off':    return this.callService('light', 'turn_off', requireEntity(entityId, 'entityId'));
      case 'switch-toggle': return this.callService('switch', 'toggle',   requireEntity(entityId, 'entityId'));
      case 'switch-on':     return this.callService('switch', 'turn_on',  requireEntity(entityId, 'entityId'));
      case 'switch-off':    return this.callService('switch', 'turn_off', requireEntity(entityId, 'entityId'));
      case 'scene-activate': return this.callService('scene', 'turn_on', requireEntity(entityId, 'entityId'));
      case 'script-run':      return this.callService('script', 'turn_on', requireEntity(entityId, 'entityId'));
      case 'automation-trigger': return this.callService('automation', 'trigger', requireEntity(entityId, 'entityId'));
      case 'media-play':       return this.callService('media_player', 'media_play',        requireEntity(entityId, 'entityId'));
      case 'media-pause':      return this.callService('media_player', 'media_pause',       requireEntity(entityId, 'entityId'));
      case 'media-play-pause': return this.callService('media_player', 'media_play_pause',  requireEntity(entityId, 'entityId'));
      case 'media-next':       return this.callService('media_player', 'media_next_track',  requireEntity(entityId, 'entityId'));
      case 'media-previous':   return this.callService('media_player', 'media_previous_track', requireEntity(entityId, 'entityId'));
      case 'cover-toggle': return this.callService('cover', 'toggle',      requireEntity(entityId, 'entityId'));
      case 'cover-open':   return this.callService('cover', 'open_cover',  requireEntity(entityId, 'entityId'));
      case 'cover-close':  return this.callService('cover', 'close_cover', requireEntity(entityId, 'entityId'));
      case 'service-call': {
        const svc = params?.service?.trim();
        if (!svc || !svc.includes('.')) throw new Error('Home Assistant service-call: service must be "<domain>.<service>"');
        const [domain, service] = svc.split('.', 2);
        const extras = params?.serviceData ?? {};
        return this.callService(domain, service, entityId, extras);
      }
      default: throw new Error(`unknown Home Assistant op: ${op as string}`);
    }
  }

  /** Slider protocol: inputName encodes `light:<entity_id>` for brightness or
   *  `media:<entity_id>` for media_player volume. Value is 0..1. */
  async setSliderValue(inputName: string, value: number): Promise<void> {
    if (!this.cfg.token) throw new Error('Home Assistant not authorized');
    const idx = inputName.indexOf(':');
    if (idx <= 0) throw new Error('Home Assistant slider inputName must be "light:<entity_id>" or "media:<entity_id>"');
    const kind = inputName.slice(0, idx);
    const entityId = inputName.slice(idx + 1);
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    if (kind === 'light') {
      await this.callService('light', 'turn_on', entityId, { brightness_pct: pct });
    } else if (kind === 'media') {
      await this.callService('media_player', 'volume_set', entityId, { volume_level: value });
    } else {
      throw new Error(`Home Assistant slider kind "${kind}" not supported (use "light" or "media")`);
    }
    // Optimistic local update so the tile reflects the change before the poll.
    const entity = this.entities?.find((e) => e.id === entityId);
    if (entity) { entity.level = pct; entity.on = pct > 0; this.emitChange(); }
  }

  /** Slider tap. Toggle the target's on/off state. */
  async toggleSlider(inputName: string): Promise<void> {
    const idx = inputName.indexOf(':');
    if (idx <= 0) return;
    const kind = inputName.slice(0, idx);
    const entityId = inputName.slice(idx + 1);
    if (kind === 'light') {
      await this.execute('light-toggle', { entityId });
    } else if (kind === 'media') {
      await this.execute('media-play-pause', { entityId });
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: HomeAssistantConfig = { ...DEFAULT_HOMEASSISTANT_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: HomeAssistantConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private err: string | undefined;
  private version: string | undefined;
  private entities: HomeAssistantEntity[] | undefined;

  setConfig(cfg: HomeAssistantConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: HomeAssistantConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }
  private async persistCfg(): Promise<void> { if (this.saveCb) await this.saveCb({ ...this.cfg }); }

  private async refreshEntities(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const list = await this.apiGet<HAStateRaw[]>('/api/states');
      const next: HomeAssistantEntity[] = [];
      for (const s of list) {
        const id = s.entity_id;
        if (typeof id !== 'string') continue;
        const dot = id.indexOf('.');
        if (dot <= 0) continue;
        const domain = id.slice(0, dot);
        if (!SURFACED_DOMAINS.has(domain)) continue;
        const state = typeof s.state === 'string' ? s.state : '';
        const attrs = (s.attributes ?? {}) as Record<string, unknown>;
        const friendlyName = typeof attrs.friendly_name === 'string' ? attrs.friendly_name : id;
        const on = isEntityOn(domain, state);
        let level: number | undefined;
        if (domain === 'light' && typeof attrs.brightness === 'number') {
          // HA reports brightness 0-255; we normalize to 0-100.
          level = Math.round((attrs.brightness / 255) * 100);
        } else if (domain === 'media_player' && typeof attrs.volume_level === 'number') {
          level = Math.round(attrs.volume_level * 100);
        }
        next.push({ id, name: friendlyName, domain, state, on, level });
      }
      next.sort((a, b) => {
        const d = a.domain.localeCompare(b.domain);
        return d !== 0 ? d : a.name.localeCompare(b.name);
      });
      if (!sameEntities(this.entities, next)) {
        this.entities = next;
        this.emitChange();
      }
      this.err = undefined;
    } catch (err) {
      this.err = friendlyError(err as Error);
      console.warn(`[homeassistant] poll failed: ${this.err}`);
      this.emitChange();
    } finally {
      this.polling = false;
    }
  }

  private async apiGet<T>(path: string): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.cfg.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) throw new Error('unauthorized (bad token?)');
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return await res.json() as T;
  }

  private async callService(
    domain: string,
    service: string,
    entityId: string | undefined,
    extras: Record<string, unknown> = {},
  ): Promise<void> {
    const body = {
      ...(entityId ? { entity_id: entityId } : {}),
      ...extras,
    };
    const res = await fetch(`${this.cfg.baseUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Home Assistant ${domain}.${service}: HTTP ${res.status} ${await res.text()}`);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

type HAStateRaw = {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
};

function isEntityOn(domain: string, state: string): boolean {
  // HA's "on" states vary by domain — media_player is playing, cover is open, etc.
  switch (domain) {
    case 'light': case 'switch': case 'input_boolean':
    case 'automation': case 'script': case 'fan': case 'lock':
      return state === 'on' || state === 'unlocked'; // lock inverts: unlocked = "active"
    case 'media_player':
      return state === 'playing' || state === 'on';
    case 'cover':
      return state === 'open';
    case 'climate':
      return state !== 'off' && state !== 'unavailable';
    case 'scene':
      // Scenes don't hold on/off state — activating one changes downstream
      // entities. Keep tiles neutral.
      return false;
    case 'vacuum':
      return state === 'cleaning' || state === 'returning';
    default:
      return state === 'on';
  }
}

function sameEntities(a: HomeAssistantEntity[] | undefined, b: HomeAssistantEntity[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id) return false;
    if (a[i].on !== b[i].on) return false;
    if (a[i].level !== b[i].level) return false;
    if (a[i].name !== b[i].name) return false;
  }
  return true;
}

function requireEntity(id: string | undefined, name: string): string {
  if (!id) throw new Error(`Home Assistant: ${name} required`);
  return id;
}

function friendlyError(err: Error): string {
  const msg = err.message ?? String(err);
  if (msg.includes('unauthorized')) return 'Invalid token — regenerate one in HA → Profile → Security → Long-Lived Access Tokens.';
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('EAI_AGAIN')) {
    return 'Cannot reach Home Assistant — check the URL and make sure your PC is on the same network as your HA instance.';
  }
  if (msg.includes('AbortError') || msg.includes('timed out')) return 'Home Assistant did not respond in time.';
  return msg;
}

let _instance: HomeAssistantClient | null = null;
export function getHomeAssistant(): HomeAssistantClient {
  if (!_instance) {
    _instance = new HomeAssistantClient();
    registerIntegration(_instance);
  }
  return _instance;
}

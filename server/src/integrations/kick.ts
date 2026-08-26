import { createHash, randomBytes } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

export type PublicKickConfig = {
  enabled: boolean; clientId: string; hasSecret: boolean; hasRefreshToken: boolean; slug: string;
};

export function publicKickConfig(cfg: KickConfig): PublicKickConfig {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
    slug: cfg.slug,
  };
}

export function validateKickConfig(input: unknown, existing: KickConfig): KickConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Kick config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    // Managed by OAuth flow, not this endpoint.
    refreshToken: existing.refreshToken,
    slug: existing.slug,
    broadcasterUserId: existing.broadcasterUserId,
  };
}

export const KICK_MANIFEST: IntegrationManifest = {
  name: 'kick',
  displayName: 'Kick',
  actionTypes: ['kick', 'kick-streamer'],
  hasOAuth: true,
};

export type KickConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** The authenticated user's channel slug (used to open the channel URL, etc.). */
  slug: string;
  /** Broadcaster (channel) user id — required for chat send. */
  broadcasterUserId: number;
};

export const DEFAULT_KICK_CONFIG: KickConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  slug: '',
  broadcasterUserId: 0,
};

export type KickState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type KickStatus = {
  state: KickState;
  error?: string;
  slug?: string;
  channel?: string;
};

export type KickOp =
  | 'chat'
  | 'delete-message'
  | 'ban-user'
  | 'unban-user'
  | 'update-title'
  | 'update-category'
  | 'run-ad';

export type KickActionParams = {
  /** For 'chat'. Baked-in text or prompt-provided. */
  text?: string;
  /** For 'delete-message'. Raw Kick message id (usually pasted at press time). */
  messageId?: string;
  /** For 'ban-user' / 'unban-user'. Kick username (slug); resolved to numeric
   *  user_id server-side via GET /public/v1/channels?slug=…. */
  target?: string;
  /** For 'ban-user'. Timeout duration in minutes (1–10080). Omit to permaban. */
  banDuration?: number;
  /** For 'ban-user'. Optional public reason (max 100 chars). */
  banReason?: string;
  /** For 'update-title'. New stream title. */
  title?: string;
  /** For 'update-category'. Category *name* — resolved to numeric category_id
   *  server-side via GET /public/v2/categories?name=…. */
  category?: string;
  /** For 'run-ad'. Ad break duration in seconds (7–300). */
  adLength?: number;
};

/** Runtime prompt shown on the phone before executing the action. Field names
 *  map to `KickActionParams` keys — the merged value lands in `params[field]`. */
export type KickPromptField = 'text' | 'messageId' | 'target' | 'title' | 'category' | 'banReason';
export type KickPrompt = { field: KickPromptField; label: string; placeholder?: string };

const AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize';
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API_BASE = 'https://api.kick.com/public/v1';
const REDIRECT_URI = 'http://localhost:8765/api/integrations/kick/callback';
const SCOPES = [
  'user:read',
  'channel:read',
  'channel:write',
  'chat:write',
  'moderation:ban',
  'moderation:chat_message:manage',
  'ads:read',
  'ads:write',
];

type PendingAuth = { verifier: string; expires: number };

class KickClient implements IntegrationLifecycle {
  readonly manifest = KICK_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.kick); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.kick = cfg;
      await save();
    });
  }
  publicConfig(): PublicKickConfig { return publicKickConfig(this.cfg); }
  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateKickConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Kick integration not attached');
    this.serverConfig.integrations.kick = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled && validated.refreshToken) {
      await this.restart();
    } else {
      await this.stop();
    }
  }
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;

  private cfg: KickConfig = { ...DEFAULT_KICK_CONFIG };
  private err: string | undefined;
  private internal: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  private accessToken: string | null = null;
  private accessTokenExpires = 0;
  private pending = new Map<string, PendingAuth>();
  private saveCb?: (cfg: KickConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;

  setConfig(cfg: KickConfig): void {
    this.cfg = { ...cfg };
    this.emitChange();
  }

  setSaveCallback(cb: (cfg: KickConfig) => Promise<void>): void {
    this.saveCb = cb;
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private emitChange(): void {
    this.onChangeCb?.();
  }

  status(): KickStatus {
    let state: KickState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.clientId || !this.cfg.clientSecret) state = 'not-configured';
    else if (!this.cfg.refreshToken) state = 'needs-auth';
    else {
      state = this.internal === 'idle' ? 'connected' : this.internal;
    }
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      slug: this.cfg.slug || undefined,
      channel: this.cfg.slug ? `kick.com/${this.cfg.slug}` : undefined,
    };
  }

  buildAuthorizeUrl(): string {
    if (!this.cfg.clientId || !this.cfg.clientSecret) {
      throw new Error('Kick Client ID and Secret required');
    }
    // Reap expired states
    for (const [s, p] of this.pending.entries()) {
      if (p.expires < Date.now()) this.pending.delete(s);
    }
    const state = randomBytes(16).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<CallbackOutcome> {
    const pending = this.pending.get(state);
    if (!pending || pending.expires < Date.now()) throw new Error('invalid or expired OAuth state');
    this.pending.delete(state);

    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

    this.accessToken = data.access_token;
    this.accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    this.cfg.refreshToken = data.refresh_token;

    const me = await this.fetchSelf();
    this.cfg.slug = me.slug;
    this.cfg.broadcasterUserId = me.userId;
    this.internal = 'connected';
    this.err = undefined;
    await this.persistCfg();
    this.emitChange();
    const s = this.cfg.slug;
    return { successMessage: s ? `Logged in as ${s}.` : 'Authorization complete.' };
  }

  async disconnectIntegration(): Promise<void> {
    this.cfg.refreshToken = '';
    this.cfg.slug = '';
    this.cfg.broadcasterUserId = 0;
    this.accessToken = null;
    this.accessTokenExpires = 0;
    this.internal = 'idle';
    this.err = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.clientId || !this.cfg.clientSecret || !this.cfg.refreshToken) {
      this.internal = 'idle';
      this.emitChange();
      return;
    }
    if (this.internal === 'connecting' || this.internal === 'connected') return;

    this.internal = 'connecting';
    this.err = undefined;
    this.emitChange();
    try {
      await this.ensureAccessToken();
      if (!this.cfg.slug || !this.cfg.broadcasterUserId) {
        const me = await this.fetchSelf();
        this.cfg.slug = me.slug;
        this.cfg.broadcasterUserId = me.userId;
        await this.persistCfg();
      }
      this.internal = 'connected';
      this.emitChange();
    } catch (err) {
      this.err = (err as Error).message;
      this.internal = 'error';
      console.warn(`[kick] connect failed: ${this.err}`);
      this.emitChange();
    }
  }

  async stop(): Promise<void> {
    this.internal = 'idle';
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isReady(): boolean {
    return !!(this.cfg.enabled && this.cfg.clientId && this.cfg.clientSecret && this.cfg.refreshToken);
  }

  /** Authenticated GET against /public/v1/… — used by the streamer poller. */
  async apiGet<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
    if (!this.isReady()) throw new Error('Kick not authorized');
    await this.ensureAccessToken();
    if (!this.accessToken) throw new Error('Kick access token missing');

    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        const items = Array.isArray(v) ? v : [v];
        for (const item of items) url.searchParams.append(k, item);
      }
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Kick GET ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async execute(op: KickOp, params: KickActionParams = {}): Promise<void> {
    if (!this.cfg.broadcasterUserId) throw new Error('Kick: not authorized');
    await this.ensureAccessToken();
    if (!this.accessToken) throw new Error('Kick access token missing');

    switch (op) {
      case 'chat': return this.doChat(params);
      case 'delete-message': return this.doDeleteMessage(params);
      case 'ban-user': return this.doBanUser(params);
      case 'unban-user': return this.doUnbanUser(params);
      case 'update-title': return this.doUpdateChannel({ stream_title: requireField(params.title, 'title') });
      case 'update-category': return this.doUpdateCategory(params);
      case 'run-ad': return this.doRunAd(params);
      default: throw new Error(`unknown Kick op: ${op as string}`);
    }
  }

  private async doChat(params: KickActionParams): Promise<void> {
    const text = params.text?.trim();
    if (!text) throw new Error('Kick chat: text required');
    const safe = text.replace(/[\r\n]+/g, ' ').slice(0, 500);
    await this.apiFetch('POST', '/chat', {
      broadcaster_user_id: this.cfg.broadcasterUserId,
      content: safe,
      type: 'user',
    });
  }

  private async doDeleteMessage(params: KickActionParams): Promise<void> {
    const id = params.messageId?.trim();
    if (!id) throw new Error('Kick delete-message: messageId required');
    await this.apiFetch('DELETE', `/chat/${encodeURIComponent(id)}`);
  }

  private async doBanUser(params: KickActionParams): Promise<void> {
    const target = params.target?.trim();
    if (!target) throw new Error('Kick ban-user: target required');
    const userId = await this.resolveUserId(target);
    const body: Record<string, unknown> = {
      broadcaster_user_id: this.cfg.broadcasterUserId,
      user_id: userId,
    };
    if (typeof params.banDuration === 'number' && params.banDuration > 0) {
      const clamped = Math.max(1, Math.min(10080, Math.round(params.banDuration)));
      body.duration = clamped;
    }
    if (params.banReason) body.reason = params.banReason.slice(0, 100);
    await this.apiFetch('POST', '/moderation/bans', body);
  }

  private async doUnbanUser(params: KickActionParams): Promise<void> {
    const target = params.target?.trim();
    if (!target) throw new Error('Kick unban-user: target required');
    const userId = await this.resolveUserId(target);
    await this.apiFetch('DELETE', '/moderation/bans', {
      broadcaster_user_id: this.cfg.broadcasterUserId,
      user_id: userId,
    });
  }

  private async doUpdateChannel(body: Record<string, unknown>): Promise<void> {
    await this.apiFetch('PATCH', '/channels', body);
  }

  private async doUpdateCategory(params: KickActionParams): Promise<void> {
    const name = params.category?.trim();
    if (!name) throw new Error('Kick update-category: category name required');
    const categoryId = await this.resolveCategoryId(name);
    await this.doUpdateChannel({ category_id: categoryId });
  }

  private async doRunAd(params: KickActionParams): Promise<void> {
    const seconds = Math.max(7, Math.min(300, Math.round(params.adLength ?? 60)));
    // ad-break requires a client-generated UUID id — Kick uses it for
    // dedup so retries with the same value don't fire twice.
    const id = randomUuid();
    await this.apiFetch('POST', '/ads/ad-break', {
      break_duration_seconds: seconds,
      id,
    });
  }

  /** Resolve a Kick username/slug to its numeric broadcaster_user_id via
   *  GET /public/v1/channels?slug=…. Cached briefly so repeated actions on
   *  the same target don't hammer the API. Accepts a raw numeric string too
   *  (advanced users pasting a known user_id). */
  private async resolveUserId(target: string): Promise<number> {
    // Direct numeric — skip the lookup.
    if (/^\d+$/.test(target)) return Number.parseInt(target, 10);
    const slug = target.toLowerCase().replace(/^@/, '');
    const cached = this.userIdCache.get(slug);
    if (cached && Date.now() < cached.expires) return cached.id;
    const data = await this.apiGet<{ data?: Array<{ broadcaster_user_id?: number; slug?: string }> }>(
      '/channels',
      { slug },
    );
    const first = data.data?.[0];
    const id = first?.broadcaster_user_id;
    if (!id || typeof id !== 'number') {
      throw new Error(`Kick: no channel found for "${target}"`);
    }
    this.userIdCache.set(slug, { id, expires: Date.now() + 5 * 60 * 1000 });
    return id;
  }

  /** Resolve a category *name* to its numeric id via
   *  GET /public/v2/categories?name=…. Accepts a raw numeric string.
   *  Kick shipped v2 categories as a separate versioned base; `apiGet` is
   *  v1-only, so we hit the URL directly here. */
  private async resolveCategoryId(name: string): Promise<number> {
    if (/^\d+$/.test(name)) return Number.parseInt(name, 10);
    const trimmed = name.trim();
    const cached = this.categoryIdCache.get(trimmed.toLowerCase());
    if (cached && Date.now() < cached.expires) return cached.id;
    if (!this.accessToken) throw new Error('Kick access token missing');
    const url = new URL('https://api.kick.com/public/v2/categories');
    url.searchParams.set('name', trimmed);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!res.ok) throw new Error(`Kick GET /v2/categories: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data?: Array<{ id?: number; name?: string }> };
    const first = data.data?.[0];
    const id = first?.id;
    if (!id || typeof id !== 'number') {
      throw new Error(`Kick: no category found matching "${name}"`);
    }
    this.categoryIdCache.set(trimmed.toLowerCase(), { id, expires: Date.now() + 60 * 60 * 1000 });
    return id;
  }

  /** Shared helper for POST/PATCH/DELETE with an optional JSON body. GET
   *  keeps its own path (apiGet) since it also handles query params. */
  private async apiFetch(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<void> {
    if (!this.accessToken) throw new Error('Kick access token missing');
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Kick ${method} ${path}: ${res.status} ${txt}`);
    }
  }

  private userIdCache = new Map<string, { id: number; expires: number }>();
  private categoryIdCache = new Map<string, { id: number; expires: number }>();

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.accessTokenExpires) return;
    await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.cfg.refreshToken) throw new Error('no refresh token');
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.cfg.refreshToken,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 400 || res.status === 401) {
        this.cfg.refreshToken = '';
        await this.persistCfg();
      }
      throw new Error(`refresh failed: ${res.status} ${txt}`);
    }
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    this.accessToken = data.access_token;
    this.accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    if (data.refresh_token && data.refresh_token !== this.cfg.refreshToken) {
      this.cfg.refreshToken = data.refresh_token;
      await this.persistCfg();
    }
  }

  private async fetchSelf(): Promise<{ userId: number; slug: string }> {
    if (!this.accessToken) throw new Error('no access token');
    // /public/v1/users (no query) returns the authenticated user.
    const res = await fetch(`${API_BASE}/users`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Kick /users fetch failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { data?: Array<{ user_id?: number; name?: string; username?: string; slug?: string }> };
    const first = data.data?.[0];
    if (!first) throw new Error('no Kick user returned');
    const userId = typeof first.user_id === 'number' ? first.user_id : 0;
    const slug = (first.slug ?? first.username ?? first.name ?? '').toString().toLowerCase();
    if (!userId || !slug) throw new Error('Kick user response missing id/slug');
    return { userId, slug };
  }

  private async persistCfg(): Promise<void> {
    if (this.saveCb) await this.saveCb({ ...this.cfg });
  }
}

function requireField<T>(v: T | undefined, name: string): T {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    throw new Error(`Kick: ${name} required`);
  }
  return v;
}

/** RFC 4122 v4 UUID from crypto — used as the client-generated ad-break id. */
function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let _instance: KickClient | null = null;
export function getKick(): KickClient {
  if (!_instance) {
    _instance = new KickClient();
    registerIntegration(_instance);
  }
  return _instance;
}

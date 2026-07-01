import { createHash, randomBytes } from 'node:crypto';

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

export type KickOp = 'chat';
export type KickActionParams = { text?: string };

const AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize';
const TOKEN_URL = 'https://id.kick.com/oauth/token';
const API_BASE = 'https://api.kick.com/public/v1';
const REDIRECT_URI = 'http://localhost:8765/api/integrations/kick/callback';
const SCOPES = ['user:read', 'channel:read', 'chat:write'];

type PendingAuth = { verifier: string; expires: number };

class KickClient {
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

  async handleCallback(code: string, state: string): Promise<void> {
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
    if (op !== 'chat') throw new Error(`unknown Kick op: ${op}`);
    const text = params.text?.trim();
    if (!text) throw new Error('Kick chat: text required');
    if (!this.cfg.broadcasterUserId) throw new Error('Kick: not authorized');
    const safe = text.replace(/[\r\n]+/g, ' ').slice(0, 500);

    await this.ensureAccessToken();
    if (!this.accessToken) throw new Error('Kick access token missing');

    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_user_id: this.cfg.broadcasterUserId,
        content: safe,
        type: 'user',
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Kick chat failed: ${res.status} ${txt}`);
    }
  }

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

let _instance: KickClient | null = null;
export function getKick(): KickClient {
  if (!_instance) _instance = new KickClient();
  return _instance;
}

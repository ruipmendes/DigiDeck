import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

export type PublicTwitchConfig = {
  enabled: boolean; clientId: string; hasSecret: boolean; hasRefreshToken: boolean; username: string;
};

export function publicTwitchConfig(cfg: TwitchConfig): PublicTwitchConfig {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
    username: cfg.username,
  };
}

export function validateTwitchConfig(input: unknown, existing: TwitchConfig): TwitchConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Twitch config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    // If clientSecret omitted/empty, keep existing — UI never echoes the secret back.
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    // Refresh token, username, and broadcaster id are managed by the OAuth flow.
    refreshToken: existing.refreshToken,
    username: existing.username,
    broadcasterUserId: existing.broadcasterUserId,
  };
}

export const TWITCH_MANIFEST: IntegrationManifest = {
  name: 'twitch',
  displayName: 'Twitch',
  actionTypes: ['twitch', 'twitch-streamer'],
  hasOAuth: true,
};

export type TwitchConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  username: string;
  broadcasterUserId: string;
};

export const DEFAULT_TWITCH_CONFIG: TwitchConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  username: '',
  broadcasterUserId: '',
};

export type TwitchState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type TwitchStatus = {
  state: TwitchState;
  error?: string;
  username?: string;
  channel?: string;
};

export type TwitchOp =
  | 'chat'
  | 'chat-announcement'
  | 'run-ad'
  | 'snooze-ad'
  | 'create-clip'
  | 'stream-marker'
  | 'clear-chat'
  | 'toggle-shield-mode'
  | 'toggle-emote-only'
  | 'toggle-sub-only'
  | 'toggle-follower-only'
  | 'toggle-slow-mode'
  | 'start-raid'
  | 'cancel-raid'
  | 'shoutout'
  | 'update-title'
  | 'update-category'
  | 'create-poll'
  | 'create-prediction';

/** Announcement highlight color. `primary` uses the broadcaster's channel color. */
export type TwitchAnnouncementColor = 'primary' | 'blue' | 'green' | 'orange' | 'purple';

export type TwitchActionParams = {
  /** Message body for `chat` / `chat-announcement`; description for `stream-marker`. */
  text?: string;
  /** Highlight color for `chat-announcement`. */
  color?: TwitchAnnouncementColor;
  /** Length in seconds for `run-ad`. Twitch accepts 30/60/90/120/150/180. */
  adLength?: number;
  /** Minutes for `toggle-follower-only`, seconds for `toggle-slow-mode`. */
  duration?: number;
  /** Target streamer login for `start-raid` / `shoutout`. */
  target?: string;
  /** New stream title for `update-title`. */
  title?: string;
  /** New game/category name for `update-category` — resolved to id server-side. */
  gameName?: string;
  /** Poll options for `create-poll` — 2 to 5 entries, each ≤25 chars. */
  choices?: string[];
  /** Prediction outcomes for `create-prediction` — 2 to 10 entries, each ≤25 chars. */
  outcomes?: string[];
};

/** Runtime prompt shown on the phone before executing the action. Field names
 *  map to `TwitchActionParams` keys — the merged value lands in `params[field]`. */
export type TwitchPromptField = 'target' | 'title' | 'gameName';
export type TwitchPrompt = { field: TwitchPromptField; label: string; placeholder?: string };

const REDIRECT_URI = 'http://localhost:8765/api/integrations/twitch/callback';
const SCOPES = [
  'chat:edit',
  'chat:read',
  'channel:edit:commercial',
  'channel:manage:ads',
  'clips:edit',
  'channel:manage:broadcast',
  'moderator:manage:announcements',
  'moderator:manage:shield_mode',
  'moderator:manage:chat_settings',
  'moderator:manage:chat_messages',
  'channel:manage:raids',
  'moderator:manage:shoutouts',
  'channel:manage:polls',
  'channel:manage:predictions',
];
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

class TwitchClient implements IntegrationLifecycle {
  readonly manifest = TWITCH_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.twitch); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.twitch = cfg;
      await save();
    });
  }
  publicConfig(): PublicTwitchConfig { return publicTwitchConfig(this.cfg); }
  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateTwitchConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Twitch integration not attached');
    this.serverConfig.integrations.twitch = validated;
    await this.saveFn();
    this.setConfig(validated);
    // OAuth quirk: only restart when we have credentials + a refresh token; otherwise
    // stop (a config with no auth yet would just spin in retries).
    if (validated.enabled && validated.refreshToken) {
      await this.restart();
    } else {
      await this.stop();
    }
  }
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;

  private cfg: TwitchConfig = { ...DEFAULT_TWITCH_CONFIG };
  private err: string | undefined;
  private internal: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' = 'idle';
  private accessToken: string | null = null;
  private accessTokenExpires = 0;
  private ws: WebSocket | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private pendingStates = new Map<string, number>();
  private saveCb?: (cfg: TwitchConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;

  setConfig(cfg: TwitchConfig): void {
    this.cfg = { ...cfg };
    this.emitChange();
  }

  setSaveCallback(cb: (cfg: TwitchConfig) => Promise<void>): void {
    this.saveCb = cb;
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private emitChange(): void {
    this.onChangeCb?.();
  }

  status(): TwitchStatus {
    let state: TwitchState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.clientId || !this.cfg.clientSecret) state = 'not-configured';
    else if (!this.cfg.refreshToken) state = 'needs-auth';
    else {
      state = this.internal === 'idle' ? 'disconnected' : this.internal;
    }
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      username: this.cfg.username || undefined,
      channel: this.cfg.username ? `#${this.cfg.username}` : undefined,
    };
  }

  buildAuthorizeUrl(): string {
    if (!this.cfg.clientId || !this.cfg.clientSecret) throw new Error('Twitch Client ID and Secret required');
    // Reap expired states
    for (const [s, exp] of this.pendingStates.entries()) {
      if (exp < Date.now()) this.pendingStates.delete(s);
    }
    const state = randomBytes(16).toString('base64url');
    this.pendingStates.set(state, Date.now() + 10 * 60 * 1000);
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      state,
      force_verify: 'true',
    });
    return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<CallbackOutcome> {
    const exp = this.pendingStates.get(state);
    if (!exp || exp < Date.now()) throw new Error('invalid or expired OAuth state');
    this.pendingStates.delete(state);

    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    });
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };

    this.accessToken = data.access_token;
    this.accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    this.cfg.refreshToken = data.refresh_token;

    const self = await this.fetchSelf();
    this.cfg.username = self.login;
    this.cfg.broadcasterUserId = self.id;
    await this.persistCfg();
    this.emitChange();

    // Best-effort IRC connect; surface errors but don't throw
    await this.start();
    const u = this.cfg.username;
    return { successMessage: u ? `Logged in as @${u}.` : 'Authorization complete.' };
  }

  async disconnectIntegration(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.cfg.refreshToken = '';
    this.cfg.username = '';
    this.cfg.broadcasterUserId = '';
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
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }

    this.internal = 'connecting';
    this.err = undefined;
    this.emitChange();
    try {
      await this.ensureAccessToken();
      if (!this.cfg.username || !this.cfg.broadcasterUserId) {
        const self = await this.fetchSelf();
        this.cfg.username = self.login;
        this.cfg.broadcasterUserId = self.id;
        await this.persistCfg();
      }
      await this.connectIrc();
      this.emitChange();
    } catch (err) {
      this.err = (err as Error).message;
      this.internal = 'error';
      console.warn(`[twitch] connect failed: ${this.err}`);
      this.scheduleRetry();
      this.emitChange();
    }
  }

  async stop(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.internal = 'idle';
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** True when we have credentials and a refresh token — enough for Helix calls. IRC state is separate. */
  isReady(): boolean {
    return !!(this.cfg.enabled && this.cfg.clientId && this.cfg.clientSecret && this.cfg.refreshToken);
  }

  /** Authenticated GET to the Helix API. Caller passes the path (e.g. `/users`) and a flat params map. */
  async helixGet<T>(path: string, params?: Record<string, string | string[]>): Promise<T> {
    if (!this.isReady()) throw new Error('Twitch not authorized');
    await this.ensureAccessToken();
    if (!this.accessToken) throw new Error('Twitch access token missing');

    const url = new URL(`https://api.twitch.tv/helix${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        const items = Array.isArray(v) ? v : [v];
        for (const item of items) url.searchParams.append(k, item);
      }
    }
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.cfg.clientId,
      },
    });
    if (!res.ok) throw new Error(`Helix GET ${path}: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  /** Authenticated non-GET call to Helix. Returns parsed JSON, or undefined for 204s. */
  async helixWrite<T = unknown>(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    params?: Record<string, string>,
    body?: unknown,
  ): Promise<T | undefined> {
    if (!this.isReady()) throw new Error('Twitch not authorized');
    await this.ensureAccessToken();
    if (!this.accessToken) throw new Error('Twitch access token missing');

    const url = new URL(`https://api.twitch.tv/helix${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      'Client-Id': this.cfg.clientId,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json() as { message?: string };
        if (j.message) detail = ` ${j.message}`;
      } catch { detail = ` ${await res.text()}`; }
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Twitch: insufficient permission (${res.status}${detail}) — click Disconnect then Connect on the Twitch panel to grant new scopes`);
      }
      throw new Error(`Twitch ${method} ${path}: ${res.status}${detail}`);
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : undefined;
  }

  async execute(op: TwitchOp, params: TwitchActionParams = {}): Promise<void> {
    if (op === 'chat') return this.execChat(params);
    if (!this.cfg.broadcasterUserId) throw new Error('Twitch: not authorized (reconnect Twitch)');
    const bid = this.cfg.broadcasterUserId;
    switch (op) {
      case 'chat-announcement':    return this.execAnnouncement(bid, params);
      case 'run-ad':               return this.execRunAd(bid, params);
      case 'snooze-ad':            return this.execSnoozeAd(bid);
      case 'create-clip':          return this.execCreateClip(bid);
      case 'stream-marker':        return this.execStreamMarker(bid, params);
      case 'clear-chat':           return this.execClearChat(bid);
      case 'toggle-shield-mode':   return this.execToggleShield(bid);
      case 'toggle-emote-only':    return this.execToggleBoolSetting(bid, 'emote_mode');
      case 'toggle-sub-only':      return this.execToggleBoolSetting(bid, 'subscriber_mode');
      case 'toggle-follower-only': return this.execToggleFollowerOnly(bid, params);
      case 'toggle-slow-mode':     return this.execToggleSlowMode(bid, params);
      case 'start-raid':           return this.execStartRaid(bid, params);
      case 'cancel-raid':          return this.execCancelRaid(bid);
      case 'shoutout':             return this.execShoutout(bid, params);
      case 'update-title':         return this.execUpdateTitle(bid, params);
      case 'update-category':      return this.execUpdateCategory(bid, params);
      case 'create-poll':          return this.execCreatePoll(bid, params);
      case 'create-prediction':    return this.execCreatePrediction(bid, params);
    }
    throw new Error(`unknown Twitch op: ${op as string}`);
  }

  /** Resolve a Twitch login (e.g. `ninja`) to its numeric user id. Throws when the user doesn't exist. */
  private async resolveLogin(login: string): Promise<string> {
    const clean = login.trim().toLowerCase().replace(/^@/, '');
    if (!clean) throw new Error('Twitch: target streamer login required');
    const data = await this.helixGet<{ data: Array<{ id: string; login: string }> }>(
      '/users', { login: clean });
    const hit = data.data?.[0];
    if (!hit) throw new Error(`Twitch: streamer "${clean}" not found`);
    return hit.id;
  }

  /** Resolve a game/category name (e.g. `Elden Ring`) to its numeric game id. */
  private async resolveGameName(name: string): Promise<string> {
    const clean = name.trim();
    if (!clean) throw new Error('Twitch: game/category name required');
    const data = await this.helixGet<{ data: Array<{ id: string; name: string }> }>(
      '/games', { name: clean });
    const hit = data.data?.[0];
    if (!hit) throw new Error(`Twitch: category "${clean}" not found`);
    return hit.id;
  }

  private async execStartRaid(bid: string, params: TwitchActionParams): Promise<void> {
    const targetId = await this.resolveLogin(params.target ?? '');
    await this.helixWrite(
      'POST', '/raids',
      { from_broadcaster_id: bid, to_broadcaster_id: targetId },
    );
  }

  private async execCancelRaid(bid: string): Promise<void> {
    await this.helixWrite('DELETE', '/raids', { broadcaster_id: bid });
  }

  private async execShoutout(bid: string, params: TwitchActionParams): Promise<void> {
    const targetId = await this.resolveLogin(params.target ?? '');
    await this.helixWrite(
      'POST', '/chat/shoutouts',
      { from_broadcaster_id: bid, to_broadcaster_id: targetId, moderator_id: bid },
    );
  }

  private async execUpdateTitle(bid: string, params: TwitchActionParams): Promise<void> {
    const title = params.title?.trim();
    if (!title) throw new Error('Twitch: title required');
    await this.helixWrite(
      'PATCH', '/channels',
      { broadcaster_id: bid },
      { title: title.slice(0, 140) },
    );
  }

  private async execUpdateCategory(bid: string, params: TwitchActionParams): Promise<void> {
    const gameId = await this.resolveGameName(params.gameName ?? '');
    await this.helixWrite(
      'PATCH', '/channels',
      { broadcaster_id: bid },
      { game_id: gameId },
    );
  }

  private async execCreatePoll(bid: string, params: TwitchActionParams): Promise<void> {
    const title = params.title?.trim();
    if (!title) throw new Error('Poll: title required');
    const choices = (params.choices ?? []).map((c) => c.trim()).filter(Boolean);
    if (choices.length < 2 || choices.length > 5) {
      throw new Error('Poll: 2 to 5 choices required');
    }
    // Twitch: 60 chars title, 25 chars per choice, duration 15–1800 s.
    const duration = Math.max(15, Math.min(1800, Math.floor(params.duration ?? 60)));
    await this.helixWrite(
      'POST', '/polls',
      undefined,
      {
        broadcaster_id: bid,
        title: title.slice(0, 60),
        choices: choices.map((c) => ({ title: c.slice(0, 25) })),
        duration,
      },
    );
  }

  private async execCreatePrediction(bid: string, params: TwitchActionParams): Promise<void> {
    const title = params.title?.trim();
    if (!title) throw new Error('Prediction: title required');
    const outcomes = (params.outcomes ?? []).map((o) => o.trim()).filter(Boolean);
    if (outcomes.length < 2 || outcomes.length > 10) {
      throw new Error('Prediction: 2 to 10 outcomes required');
    }
    // Twitch: 45 chars title, 25 chars per outcome, prediction_window 1–1800 s.
    const predictionWindow = Math.max(1, Math.min(1800, Math.floor(params.duration ?? 120)));
    await this.helixWrite(
      'POST', '/predictions',
      undefined,
      {
        broadcaster_id: bid,
        title: title.slice(0, 45),
        outcomes: outcomes.map((o) => ({ title: o.slice(0, 25) })),
        prediction_window: predictionWindow,
      },
    );
  }

  private async execChat(params: TwitchActionParams): Promise<void> {
    const text = params.text?.trim();
    if (!text) throw new Error('Twitch chat: text required');
    if (!this.cfg.username) throw new Error('Twitch: not authorized');
    const safe = text.replace(/[\r\n]+/g, ' ').slice(0, 500);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.start();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Twitch IRC not connected (${this.internal})`);
    }
    this.ws.send(`PRIVMSG #${this.cfg.username} :${safe}\r\n`);
  }

  private async execAnnouncement(bid: string, params: TwitchActionParams): Promise<void> {
    const text = params.text?.trim();
    if (!text) throw new Error('Twitch announcement: text required');
    const color: TwitchAnnouncementColor = params.color ?? 'primary';
    await this.helixWrite(
      'POST', '/chat/announcements',
      { broadcaster_id: bid, moderator_id: bid },
      { message: text.slice(0, 500), color },
    );
  }

  private async execRunAd(bid: string, params: TwitchActionParams): Promise<void> {
    const length = params.adLength ?? 30;
    if (![30, 60, 90, 120, 150, 180].includes(length)) {
      throw new Error('Twitch ad length must be 30/60/90/120/150/180 seconds');
    }
    await this.helixWrite(
      'POST', '/channels/commercial',
      undefined,
      { broadcaster_id: bid, length },
    );
  }

  private async execSnoozeAd(bid: string): Promise<void> {
    await this.helixWrite('POST', '/channels/ads/schedule/snooze', { broadcaster_id: bid });
  }

  private async execCreateClip(bid: string): Promise<void> {
    await this.helixWrite('POST', '/clips', { broadcaster_id: bid });
  }

  private async execStreamMarker(bid: string, params: TwitchActionParams): Promise<void> {
    const description = params.text?.trim();
    await this.helixWrite(
      'POST', '/streams/markers',
      undefined,
      { user_id: bid, ...(description ? { description: description.slice(0, 140) } : {}) },
    );
  }

  private async execClearChat(bid: string): Promise<void> {
    await this.helixWrite(
      'DELETE', '/moderation/chat',
      { broadcaster_id: bid, moderator_id: bid },
    );
  }

  private async execToggleShield(bid: string): Promise<void> {
    const cur = await this.helixGet<{ data: Array<{ is_active: boolean }> }>(
      '/moderation/shield_mode',
      { broadcaster_id: bid, moderator_id: bid },
    );
    const active = !!cur.data?.[0]?.is_active;
    await this.helixWrite(
      'PUT', '/moderation/shield_mode',
      { broadcaster_id: bid, moderator_id: bid },
      { is_active: !active },
    );
  }

  private async execToggleBoolSetting(bid: string, field: 'emote_mode' | 'subscriber_mode'): Promise<void> {
    const cur = await this.helixGet<{ data: Array<Record<string, unknown>> }>(
      '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
    );
    const active = !!cur.data?.[0]?.[field];
    await this.helixWrite(
      'PATCH', '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
      { [field]: !active },
    );
  }

  private async execToggleFollowerOnly(bid: string, params: TwitchActionParams): Promise<void> {
    const cur = await this.helixGet<{ data: Array<{ follower_mode: boolean }> }>(
      '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
    );
    const active = !!cur.data?.[0]?.follower_mode;
    // Twitch's follower_mode_duration is 0–129600 minutes; default to 10 min.
    const minutes = Math.max(0, Math.min(129600, Math.floor(params.duration ?? 10)));
    const body = active
      ? { follower_mode: false }
      : { follower_mode: true, follower_mode_duration: minutes };
    await this.helixWrite(
      'PATCH', '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
      body,
    );
  }

  private async execToggleSlowMode(bid: string, params: TwitchActionParams): Promise<void> {
    const cur = await this.helixGet<{ data: Array<{ slow_mode: boolean }> }>(
      '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
    );
    const active = !!cur.data?.[0]?.slow_mode;
    // Twitch's slow_mode_wait_time is 3–120 seconds; default to 30.
    const seconds = Math.max(3, Math.min(120, Math.floor(params.duration ?? 30)));
    const body = active
      ? { slow_mode: false }
      : { slow_mode: true, slow_mode_wait_time: seconds };
    await this.helixWrite(
      'PATCH', '/chat/settings',
      { broadcaster_id: bid, moderator_id: bid },
      body,
    );
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
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
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

  private async fetchSelf(): Promise<{ login: string; id: string }> {
    if (!this.accessToken) throw new Error('no access token');
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.cfg.clientId,
      },
    });
    if (!res.ok) throw new Error(`Helix users fetch failed: ${res.status}`);
    const data = await res.json() as { data: Array<{ login: string; id: string }> };
    if (!data.data?.length) throw new Error('no Twitch user returned');
    return { login: data.data[0].login, id: data.data[0].id };
  }

  private connectIrc(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.accessToken || !this.cfg.username) {
        reject(new Error('missing token or username'));
        return;
      }
      const ws = new WebSocket(IRC_URL);
      let opened = false;
      let authConfirmed = false;
      const timeout = setTimeout(() => {
        if (!opened) {
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error('IRC connect timeout'));
        }
      }, 10000);

      ws.on('open', () => {
        opened = true;
        clearTimeout(timeout);
        ws.send(`PASS oauth:${this.accessToken}\r\n`);
        ws.send(`NICK ${this.cfg.username}\r\n`);
        ws.send(`JOIN #${this.cfg.username}\r\n`);
      });

      ws.on('message', (data: Buffer) => {
        const msg = data.toString();
        if (msg.startsWith('PING')) {
          ws.send('PONG' + msg.substring(4));
          return;
        }
        if (authConfirmed) return;
        if (msg.includes(' 001 ')) {
          authConfirmed = true;
          this.ws = ws;
          this.internal = 'connected';
          console.log(`[twitch] connected as ${this.cfg.username}`);
          resolve();
        } else if (msg.includes('Login authentication failed') || msg.includes('Improperly formatted auth')) {
          this.err = 'authentication failed';
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error('authentication failed'));
        }
      });

      ws.on('close', () => {
        if (this.ws === ws) {
          this.ws = null;
          if (authConfirmed) {
            console.warn('[twitch] IRC disconnected');
            this.internal = 'disconnected';
            this.scheduleRetry();
          }
        }
      });

      ws.on('error', (err: Error) => {
        if (!opened) {
          clearTimeout(timeout);
          reject(err);
        } else {
          this.err = err.message;
        }
      });
    });
  }

  private scheduleRetry(): void {
    if (!this.cfg.enabled || !this.cfg.refreshToken) return;
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, 5000);
  }

  private async persistCfg(): Promise<void> {
    if (this.saveCb) await this.saveCb({ ...this.cfg });
  }
}

let _instance: TwitchClient | null = null;
export function getTwitch(): TwitchClient {
  if (!_instance) {
    _instance = new TwitchClient();
    registerIntegration(_instance);
  }
  return _instance;
}

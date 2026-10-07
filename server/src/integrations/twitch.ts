import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

import type { AlertEventConfig, AlertEventType } from '../alerts.js';
import { ALL_ALERT_EVENT_TYPES, getAlerts } from '../alerts.js';

/** Per-event notification config lives under `TwitchConfig.notifications.events`.
 *  Phase 1 surfaces raid / subscribe / cheer / follow / stream-online / -offline
 *  — all driven off Twitch EventSub subscriptions on the user's OAuth session.
 *  Only the Twitch-sourced event types are legal keys here; other sources
 *  (Kick, OBS, …) would get their own `notifications.events` block under
 *  their respective configs when phase 2 integrations are added. */
export type TwitchNotificationEventType = Extract<AlertEventType, `twitch.${string}`>;

export const TWITCH_NOTIFICATION_EVENT_TYPES: readonly TwitchNotificationEventType[] =
  ALL_ALERT_EVENT_TYPES.filter((t): t is TwitchNotificationEventType => t.startsWith('twitch.'));

export type TwitchNotificationsConfig = {
  /** Master kill — when false, no EventSub subscription is opened and no
   *  alert fires regardless of per-event config. */
  enabled: boolean;
  events: Partial<Record<TwitchNotificationEventType, AlertEventConfig>>;
};

export const DEFAULT_TWITCH_NOTIFICATIONS: TwitchNotificationsConfig = {
  enabled: false,
  events: {},
};

export type PublicTwitchConfig = {
  enabled: boolean; clientId: string; hasSecret: boolean; hasRefreshToken: boolean; username: string;
  notifications: TwitchNotificationsConfig;
};

export function publicTwitchConfig(cfg: TwitchConfig): PublicTwitchConfig {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
    username: cfg.username,
    notifications: cfg.notifications,
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
    notifications: validateNotificationsSubconfig(o.notifications, existing.notifications),
  };
}

function validateNotificationsSubconfig(input: unknown, existing: TwitchNotificationsConfig): TwitchNotificationsConfig {
  if (!input || typeof input !== 'object') return { ...existing };
  const o = input as Record<string, unknown>;
  const events: TwitchNotificationsConfig['events'] = {};
  const rawEvents = (o.events && typeof o.events === 'object') ? o.events as Record<string, unknown> : {};
  for (const type of TWITCH_NOTIFICATION_EVENT_TYPES) {
    const raw = rawEvents[type];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const push = r.push !== undefined ? !!r.push : undefined;
    const toast = r.toast !== undefined ? !!r.toast : undefined;
    const cooldownMs = typeof r.cooldownMs === 'number' && r.cooldownMs >= 0
      ? Math.floor(r.cooldownMs) : undefined;
    const minAmount = typeof r.minAmount === 'number' && r.minAmount >= 0
      ? Math.floor(r.minAmount) : undefined;
    // Keep the entry only if it carries at least one meaningful field — avoids
    // persisting {} stubs on every save.
    if (push === undefined && toast === undefined && cooldownMs === undefined && minAmount === undefined) continue;
    events[type] = { push, toast, cooldownMs, minAmount };
  }
  return { enabled: !!o.enabled, events };
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
  notifications: TwitchNotificationsConfig;
};

export const DEFAULT_TWITCH_CONFIG: TwitchConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  username: '',
  broadcasterUserId: '',
  notifications: { ...DEFAULT_TWITCH_NOTIFICATIONS },
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
  | 'delete-message'
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
  /** IRC message id (UUID) to delete for `delete-message`. Typically pasted
   *  at press time via a prompt, since chat clients surface it on hover. */
  messageId?: string;
};

/** Runtime prompt shown on the phone before executing the action. Field names
 *  map to `TwitchActionParams` keys — the merged value lands in `params[field]`. */
export type TwitchPromptField = 'target' | 'title' | 'gameName' | 'messageId';
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
  // Notification scopes (EventSub reads).
  'moderator:read:followers',
  'channel:read:subscriptions',
  'bits:read',
];
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const EVENTSUB_RECONNECT_MIN_MS = 2_000;
const EVENTSUB_RECONNECT_MAX_MS = 60_000;

/** EventSub subscription spec per supported Twitch notification event. The
 *  `type` + `version` are Twitch's enum values; `conditionFor` builds the
 *  per-session condition object (nearly all are keyed on broadcaster_user_id,
 *  but channel.follow v2 also needs moderator_user_id, and raid is keyed on
 *  the TO-broadcaster). */
type EventSubSpec = {
  type: string;
  version: string;
  conditionFor: (bid: string) => Record<string, string>;
};
const EVENTSUB_SPECS: Record<TwitchNotificationEventType, EventSubSpec> = {
  'twitch.follow': {
    type: 'channel.follow', version: '2',
    conditionFor: (bid) => ({ broadcaster_user_id: bid, moderator_user_id: bid }),
  },
  'twitch.subscribe': {
    type: 'channel.subscribe', version: '1',
    conditionFor: (bid) => ({ broadcaster_user_id: bid }),
  },
  'twitch.cheer': {
    type: 'channel.cheer', version: '1',
    conditionFor: (bid) => ({ broadcaster_user_id: bid }),
  },
  'twitch.raid': {
    type: 'channel.raid', version: '1',
    conditionFor: (bid) => ({ to_broadcaster_user_id: bid }),
  },
  'twitch.stream-online': {
    type: 'stream.online', version: '1',
    conditionFor: (bid) => ({ broadcaster_user_id: bid }),
  },
  'twitch.stream-offline': {
    type: 'stream.offline', version: '1',
    conditionFor: (bid) => ({ broadcaster_user_id: bid }),
  },
};

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
    const prev = this.cfg;
    const validated = validateTwitchConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Twitch integration not attached');
    this.serverConfig.integrations.twitch = validated;
    await this.saveFn();
    this.setConfig(validated);
    // OAuth quirk: only restart when we have credentials + a refresh token; otherwise
    // stop (a config with no auth yet would just spin in retries).
    if (validated.enabled && validated.refreshToken) {
      // Avoid a full IRC reconnect when only notifications settings changed —
      // common case is the user flipping a per-event toggle in the UI.
      const connectionChanged =
        prev.enabled !== validated.enabled
        || prev.clientId !== validated.clientId
        || prev.clientSecret !== validated.clientSecret
        || prev.refreshToken !== validated.refreshToken;
      if (connectionChanged || this.internal !== 'connected') {
        await this.restart();
      } else {
        await this.refreshEventSub();
      }
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

  // ─── EventSub (notifications) ──────────────────────────────────
  private eventsubWs: WebSocket | null = null;
  private eventsubSessionId: string | null = null;
  private eventsubReconnectTimer: NodeJS.Timeout | null = null;
  private eventsubReconnectDelayMs = 0;
  /** Track which types we've subscribed to in the current session so a
   *  config edit mid-session can diff and only (un)subscribe deltas. */
  private eventsubActiveTypes = new Set<TwitchNotificationEventType>();

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
      // EventSub (notifications) is a separate WS — only opened when the user
      // has flipped notifications on. Failure here is non-fatal (we still have
      // chat), so just log and let the backoff loop take over.
      if (this.cfg.notifications.enabled) {
        this.openEventSub();
      }
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
    this.closeEventSub();
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

  /** Reconcile EventSub (dis)connection to current notifications config. The
   *  config update path calls this directly so toggling notifications on/off
   *  from the UI doesn't require a full chat reconnect. */
  async refreshEventSub(): Promise<void> {
    if (!this.isReady() || !this.cfg.broadcasterUserId) return;
    if (this.cfg.notifications.enabled) {
      if (!this.eventsubWs) this.openEventSub();
      else void this.syncEventSubSubscriptions();
    } else {
      this.closeEventSub();
    }
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
      case 'delete-message':       return this.execDeleteMessage(bid, params);
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

  private async execDeleteMessage(bid: string, params: TwitchActionParams): Promise<void> {
    const id = params.messageId?.trim();
    if (!id) throw new Error('Twitch delete-message: messageId required');
    await this.helixWrite(
      'DELETE', '/moderation/chat/messages',
      { broadcaster_id: bid, moderator_id: bid, message_id: id },
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

  // ─── EventSub (notifications) implementation ───────────────────

  private openEventSub(): void {
    if (this.eventsubWs) return;
    if (!this.cfg.notifications.enabled) return;
    const configuredTypes = TWITCH_NOTIFICATION_EVENT_TYPES.filter((t) => {
      const cfg = this.cfg.notifications.events[t];
      return cfg?.push || cfg?.toast;
    });
    if (configuredTypes.length === 0) {
      // Nothing to subscribe to — stay dormant until the user flips a toggle.
      return;
    }
    const ws = new WebSocket(EVENTSUB_URL);
    this.eventsubWs = ws;
    this.eventsubSessionId = null;
    this.eventsubActiveTypes.clear();

    ws.on('message', (data: Buffer) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()) as Record<string, unknown>; }
      catch { return; }
      const metadata = (msg.metadata ?? {}) as Record<string, unknown>;
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      const msgType = metadata.message_type as string | undefined;
      if (msgType === 'session_welcome') {
        const session = (payload.session ?? {}) as Record<string, unknown>;
        this.eventsubSessionId = (session.id as string) ?? null;
        this.eventsubReconnectDelayMs = 0;
        console.log(`[twitch] EventSub welcome: session ${this.eventsubSessionId?.slice(0, 8)}…`);
        void this.syncEventSubSubscriptions();
        return;
      }
      if (msgType === 'session_keepalive') return;
      if (msgType === 'session_reconnect') {
        // Twitch migrated the session; the payload has a new URL to connect to.
        const session = (payload.session ?? {}) as Record<string, unknown>;
        const nextUrl = session.reconnect_url as string | undefined;
        if (nextUrl) this.openEventSubAt(nextUrl);
        return;
      }
      if (msgType === 'notification') {
        this.handleEventSubNotification(payload);
        return;
      }
      // revocation / unknown — just log for diagnosis.
      if (msgType === 'revocation') {
        console.warn('[twitch] EventSub subscription revoked:', JSON.stringify(payload));
      }
    });

    ws.on('close', () => {
      if (this.eventsubWs !== ws) return; // we migrated, this one's stale
      this.eventsubWs = null;
      this.eventsubSessionId = null;
      this.eventsubActiveTypes.clear();
      if (!this.cfg.notifications.enabled) return; // intentional close
      this.scheduleEventSubReconnect();
    });

    ws.on('error', (err) => {
      console.warn('[twitch] EventSub error:', (err as Error).message);
    });
  }

  /** Switch EventSub to the URL Twitch handed us in a `session_reconnect`. */
  private openEventSubAt(url: string): void {
    // Close the old socket after the new one is confirmed welcome, per Twitch
    // docs; but a lazy swap works fine for us too since we re-subscribe on
    // the new session anyway.
    const prev = this.eventsubWs;
    const ws = new WebSocket(url);
    this.eventsubWs = ws;
    this.eventsubSessionId = null;
    this.eventsubActiveTypes.clear();
    ws.on('open', () => {
      if (prev) { try { prev.close(); } catch { /* ignore */ } }
    });
    ws.on('message', (data) => { // reuse same handler as fresh connect
      this.eventsubWs = ws; // ensure handler closures use the current socket
      // Delegate to a tiny inline re-dispatch — identical semantics.
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(data.toString()) as Record<string, unknown>; } catch { return; }
      const metadata = (msg.metadata ?? {}) as Record<string, unknown>;
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      const msgType = metadata.message_type as string | undefined;
      if (msgType === 'session_welcome') {
        const session = (payload.session ?? {}) as Record<string, unknown>;
        this.eventsubSessionId = (session.id as string) ?? null;
        this.eventsubReconnectDelayMs = 0;
        void this.syncEventSubSubscriptions();
      } else if (msgType === 'notification') {
        this.handleEventSubNotification(payload);
      }
    });
    ws.on('close', () => {
      if (this.eventsubWs !== ws) return;
      this.eventsubWs = null;
      this.eventsubSessionId = null;
      this.eventsubActiveTypes.clear();
      if (!this.cfg.notifications.enabled) return;
      this.scheduleEventSubReconnect();
    });
  }

  private closeEventSub(): void {
    if (this.eventsubReconnectTimer) { clearTimeout(this.eventsubReconnectTimer); this.eventsubReconnectTimer = null; }
    if (this.eventsubWs) {
      try { this.eventsubWs.close(); } catch { /* ignore */ }
      this.eventsubWs = null;
    }
    this.eventsubSessionId = null;
    this.eventsubActiveTypes.clear();
    this.eventsubReconnectDelayMs = 0;
  }

  private scheduleEventSubReconnect(): void {
    if (this.eventsubReconnectTimer) return;
    this.eventsubReconnectDelayMs = this.eventsubReconnectDelayMs === 0
      ? EVENTSUB_RECONNECT_MIN_MS
      : Math.min(EVENTSUB_RECONNECT_MAX_MS, this.eventsubReconnectDelayMs * 2);
    this.eventsubReconnectTimer = setTimeout(() => {
      this.eventsubReconnectTimer = null;
      if (!this.cfg.notifications.enabled) return;
      this.openEventSub();
    }, this.eventsubReconnectDelayMs);
  }

  /** Diff current subscriptions against desired-set and (un)subscribe deltas
   *  via Helix. Called on session_welcome and whenever notifications config
   *  changes. */
  private async syncEventSubSubscriptions(): Promise<void> {
    if (!this.eventsubSessionId || !this.cfg.broadcasterUserId) return;
    const desired = new Set<TwitchNotificationEventType>();
    for (const t of TWITCH_NOTIFICATION_EVENT_TYPES) {
      const cfg = this.cfg.notifications.events[t];
      if (cfg?.push || cfg?.toast) desired.add(t);
    }
    // Add missing subscriptions. (We don't DELETE revoked ones here — the
    // session restarts if desired set changes materially; stale subs on the
    // old session are torn down when the socket closes.)
    for (const t of desired) {
      if (this.eventsubActiveTypes.has(t)) continue;
      const spec = EVENTSUB_SPECS[t];
      try {
        await this.helixWrite('POST', '/eventsub/subscriptions', undefined, {
          type: spec.type,
          version: spec.version,
          condition: spec.conditionFor(this.cfg.broadcasterUserId),
          transport: { method: 'websocket', session_id: this.eventsubSessionId },
        });
        this.eventsubActiveTypes.add(t);
      } catch (err) {
        console.warn(`[twitch] EventSub subscribe ${spec.type} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Map a Twitch EventSub notification into our generic AlertEvent shape and
   *  push it to the dispatcher with the matching per-event config applied. */
  private handleEventSubNotification(payload: Record<string, unknown>): void {
    const subscription = (payload.subscription ?? {}) as Record<string, unknown>;
    const event = (payload.event ?? {}) as Record<string, unknown>;
    const subType = subscription.type as string | undefined;
    const alerts = getAlerts();
    const mapped = mapEventSubEvent(subType, event);
    if (!mapped) return;
    const cfg = this.cfg.notifications.events[mapped.type];
    alerts.fire(mapped, cfg);
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

import type { AlertEvent } from '../alerts.js';

/** Map a Twitch EventSub notification payload into our generic AlertEvent
 *  shape (type + title + body + amount). Returns undefined for unknown
 *  subscription types or malformed events; the caller silently drops those. */
function mapEventSubEvent(
  subType: string | undefined,
  event: Record<string, unknown>,
): AlertEvent | undefined {
  if (!subType) return undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  switch (subType) {
    case 'channel.follow': {
      const name = str(event.user_name) ?? str(event.user_login) ?? 'someone';
      return { type: 'twitch.follow', title: `${name} followed` };
    }
    case 'channel.subscribe': {
      const name = str(event.user_name) ?? str(event.user_login) ?? 'someone';
      const tierStr = str(event.tier);
      const tier = tierStr ? Math.floor(Number(tierStr) / 1000) || 1 : 1;
      const isGift = event.is_gift === true;
      const title = isGift ? `${name} got a gift sub` : `${name} subscribed`;
      return { type: 'twitch.subscribe', title, body: `Tier ${tier}`, amount: tier };
    }
    case 'channel.cheer': {
      const name = str(event.user_name) ?? (event.is_anonymous ? 'Anonymous' : 'someone');
      const bits = num(event.bits) ?? 0;
      return { type: 'twitch.cheer', title: `${name} cheered ${bits} bits`, amount: bits };
    }
    case 'channel.raid': {
      const name = str(event.from_broadcaster_user_name) ?? 'a raider';
      const viewers = num(event.viewers) ?? 0;
      return { type: 'twitch.raid', title: `${name} raided with ${viewers} viewers`, amount: viewers };
    }
    case 'stream.online':
      return { type: 'twitch.stream-online', title: 'Stream started' };
    case 'stream.offline':
      return { type: 'twitch.stream-offline', title: 'Stream ended' };
    default:
      return undefined;
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

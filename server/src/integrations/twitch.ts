import { WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

export type TwitchConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  username: string;
};

export const DEFAULT_TWITCH_CONFIG: TwitchConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  refreshToken: '',
  username: '',
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

export type TwitchOp = 'chat';
export type TwitchActionParams = { text?: string };

const REDIRECT_URI = 'http://localhost:8765/api/integrations/twitch/callback';
const SCOPES = ['chat:edit', 'chat:read'];
const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

class TwitchClient {
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

  async handleCallback(code: string, state: string): Promise<void> {
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

    this.cfg.username = await this.fetchUsername();
    await this.persistCfg();
    this.emitChange();

    // Best-effort IRC connect; surface errors but don't throw
    await this.start();
  }

  async disconnectIntegration(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.cfg.refreshToken = '';
    this.cfg.username = '';
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
      if (!this.cfg.username) {
        this.cfg.username = await this.fetchUsername();
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

  async execute(op: TwitchOp, params: TwitchActionParams = {}): Promise<void> {
    if (op !== 'chat') throw new Error(`unknown Twitch op: ${op}`);
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

  private async fetchUsername(): Promise<string> {
    if (!this.accessToken) throw new Error('no access token');
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Client-Id': this.cfg.clientId,
      },
    });
    if (!res.ok) throw new Error(`Helix users fetch failed: ${res.status}`);
    const data = await res.json() as { data: Array<{ login: string }> };
    if (!data.data?.length) throw new Error('no Twitch user returned');
    return data.data[0].login;
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
  if (!_instance) _instance = new TwitchClient();
  return _instance;
}

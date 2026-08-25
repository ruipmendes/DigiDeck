/**
 * Spotify integration — playback control + "now playing" live state.
 *
 * OAuth is PKCE (Authorization Code with proof key) — Spotify's recommended
 * flow for public clients. No client secret needed; the user pastes a Client
 * ID after registering their own Spotify Developer app. Same pattern as Twitch
 * / Discord: users control their own app and its rate-limit budget.
 *
 * Live state comes from polling `/me/player` every 5 seconds while enabled.
 * That returns the currently-playing track, current device, is_playing, plus
 * album art. Spotify's Web API doesn't push events; polling is the standard
 * approach every Stream Deck plugin uses too.
 *
 * A common source of confusion: `/me/player` returns 204 No Content when
 * nothing is actively playing on any of the user's devices. That's a Spotify
 * quirk — start playback in any Spotify client first and this integration
 * lights up.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

export type PublicSpotifyConfig = {
  enabled: boolean;
  clientId: string;
  hasRefreshToken: boolean;
  username: string;
  /** True when the linked Spotify account has Premium — playback control ops
   *  (play / pause / next / previous / volume) require it. */
  isPremium: boolean;
};

export function publicSpotifyConfig(cfg: SpotifyConfig): PublicSpotifyConfig {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasRefreshToken: !!cfg.refreshToken,
    username: cfg.username,
    isPremium: cfg.product === 'premium',
  };
}

export function validateSpotifyConfig(input: unknown, existing: SpotifyConfig): SpotifyConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Spotify config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    // Refresh token, username and product are managed by the OAuth flow.
    refreshToken: existing.refreshToken,
    username: existing.username,
    product: existing.product,
  };
}

export const SPOTIFY_MANIFEST: IntegrationManifest = {
  name: 'spotify',
  displayName: 'Spotify',
  actionTypes: ['spotify'],
  hasOAuth: true,
};

export type SpotifyConfig = {
  enabled: boolean;
  clientId: string;
  refreshToken: string;
  username: string;
  /** Spotify's account tier — 'premium' unlocks playback control, 'free' / 'open'
   *  gates it. Persisted so tile-availability decisions survive restarts. */
  product: string;
};

export const DEFAULT_SPOTIFY_CONFIG: SpotifyConfig = {
  enabled: false,
  clientId: '',
  refreshToken: '',
  username: '',
  product: '',
};

export type SpotifyState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type SpotifyStatus = {
  state: SpotifyState;
  error?: string;
  username?: string;
  /** Mirrors PublicSpotifyConfig.isPremium — polled snapshot so the phone can
   *  dim playback tiles for free accounts without hitting `/api/…/config`. */
  isPremium?: boolean;
  /** True while playback is running on some device. */
  isPlaying?: boolean;
  /** Current track title. */
  track?: string;
  /** Comma-joined artist names. */
  artist?: string;
  /** Album name. */
  album?: string;
  /** Album cover data URL / image URL. */
  coverUrl?: string;
  /** Device name currently playing (or last-active). */
  deviceName?: string;
  /** Volume percent (0-100) of the active device. */
  volumePercent?: number;
};

export type SpotifyOp =
  | 'toggle-play'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous';

const REDIRECT_URI = 'http://127.0.0.1:8765/api/integrations/spotify/callback';
const SCOPES = ['user-modify-playback-state', 'user-read-playback-state'];
const API_BASE = 'https://api.spotify.com/v1';
const AUTH_BASE = 'https://accounts.spotify.com';
const POLL_INTERVAL_MS = 5000;

type PendingAuth = { verifier: string; state: string; expiresAt: number };

class SpotifyClient implements IntegrationLifecycle {
  readonly manifest = SPOTIFY_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.spotify); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.spotify = cfg;
      await save();
    });
  }
  publicConfig(): PublicSpotifyConfig { return publicSpotifyConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): SpotifyStatus {
    let state: SpotifyState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.clientId) state = 'not-configured';
    else if (!this.cfg.refreshToken) state = 'needs-auth';
    else state = this.err ? 'error' : this.linked ? 'connected' : 'connecting';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      username: this.cfg.username || undefined,
      isPremium: this.cfg.product === 'premium',
      isPlaying: this.nowPlaying?.isPlaying,
      track: this.nowPlaying?.track,
      artist: this.nowPlaying?.artist,
      album: this.nowPlaying?.album,
      coverUrl: this.nowPlaying?.coverUrl,
      deviceName: this.nowPlaying?.deviceName,
      volumePercent: this.nowPlaying?.volumePercent,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateSpotifyConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Spotify integration not attached');
    this.serverConfig.integrations.spotify = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled && validated.refreshToken) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  buildAuthorizeUrl(): string {
    if (!this.cfg.clientId) throw new Error('Spotify Client ID required');
    // Reap expired PKCE states.
    for (const [k, v] of this.pendingAuth.entries()) if (v.expiresAt < Date.now()) this.pendingAuth.delete(k);
    // PKCE: generate a random verifier + SHA256 challenge. The verifier stays
    // on the server; only the challenge goes to Spotify.
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    this.pendingAuth.set(state, { verifier, state, expiresAt: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES.join(' '),
      state,
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  async handleCallback(code: string, state: string): Promise<CallbackOutcome> {
    const pending = this.pendingAuth.get(state);
    if (!pending || pending.expiresAt < Date.now()) throw new Error('invalid or expired OAuth state');
    this.pendingAuth.delete(state);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: this.cfg.clientId,
      code_verifier: pending.verifier,
    });
    const res = await fetch(`${AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Spotify token exchange failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    this.cfg.refreshToken = data.refresh_token;

    // Fetch user profile: display name for the panel + product tier so we can
    // gate playback-control tiles for free accounts before they hit a 403.
    // /me can also 403 (app-owner Premium restriction) — log it once, don't
    // fail the callback: the user IS authorized, we just can't read anything.
    try {
      const me = await this.spotifyGet<{ display_name?: string; id?: string; product?: string }>('/me');
      this.cfg.username = me.display_name || me.id || '';
      this.cfg.product = me.product ?? '';
    } catch (e) {
      console.warn(`[spotify] /me fetch failed: ${(e as Error).message}`);
    }
    await this.persistCfg();
    this.emitChange();
    await this.start();
    const u = this.cfg.username;
    return { successMessage: u ? `Logged in as ${u}.` : 'Authorization complete.' };
  }

  async disconnectIntegration(): Promise<void> {
    await this.stop();
    this.cfg.refreshToken = '';
    this.cfg.username = '';
    this.cfg.product = '';
    this.nowPlaying = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.clientId || !this.cfg.refreshToken) return;
    if (this.linked) return;
    this.err = undefined;
    this.linked = true;
    this.emitChange();
    // Spotify's Web API player endpoints (including read-only /me/player) are
    // paywalled at the app-owner level — a free-tier developer sees 403 on
    // every request. Skip the poll entirely for non-premium users so we don't
    // spam the log with expected 403s. Users can re-check via the panel after
    // upgrading. If we don't yet know the tier (fresh install, refresh only
    // completed a token exchange), poll once — the first response tells us.
    if (this.cfg.product === 'premium' || this.cfg.product === '') {
      void this.pollNowPlaying();
      this.pollTimer = setInterval(() => { void this.pollNowPlaying(); }, POLL_INTERVAL_MS);
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.linked = false;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Re-fetch `/me` to pick up a Premium upgrade without a full reconnect.
   *  Called from the panel's "Recheck" button — cheap, one HTTPS request. */
  async recheckSubscription(): Promise<void> {
    if (!this.cfg.refreshToken) throw new Error('Spotify not authorized');
    await this.ensureAccessToken();
    const me = await this.spotifyGet<{ display_name?: string; id?: string; product?: string }>('/me');
    const nextProduct = me.product ?? '';
    const upgraded = this.cfg.product !== 'premium' && nextProduct === 'premium';
    this.cfg.username = me.display_name || me.id || this.cfg.username;
    this.cfg.product = nextProduct;
    await this.persistCfg();
    this.emitChange();
    // If they just went premium, kick the poll into life without a restart.
    if (upgraded && !this.pollTimer) {
      void this.pollNowPlaying();
      this.pollTimer = setInterval(() => { void this.pollNowPlaying(); }, POLL_INTERVAL_MS);
    }
  }

  async execute(op: SpotifyOp): Promise<void> {
    if (!this.cfg.refreshToken) throw new Error('Spotify not authorized');
    // Every op we ship is a playback-control op; Spotify's Web API gates all
    // of these behind Premium. Short-circuit with a clearer message than the
    // generic 403 the API would otherwise return.
    if (this.cfg.product && this.cfg.product !== 'premium') {
      throw new Error('Spotify playback control requires a Premium account.');
    }
    await this.ensureAccessToken();
    switch (op) {
      case 'play':        await this.spotifyPlayerAction('PUT', '/me/player/play'); return;
      case 'pause':       await this.spotifyPlayerAction('PUT', '/me/player/pause'); return;
      case 'next':        await this.spotifyPlayerAction('POST', '/me/player/next'); return;
      case 'previous':    await this.spotifyPlayerAction('POST', '/me/player/previous'); return;
      case 'toggle-play': {
        // Use the cached is_playing to decide the direction. If we're not sure,
        // fetch once so we don't accidentally pause a paused player (Spotify
        // returns 403 for those and we'd surface a scary error).
        let playing = this.nowPlaying?.isPlaying;
        if (playing === undefined) {
          const st = await this.spotifyGet<{ is_playing?: boolean } | null>('/me/player');
          playing = !!st?.is_playing;
        }
        await this.spotifyPlayerAction('PUT', playing ? '/me/player/pause' : '/me/player/play');
        return;
      }
      default: throw new Error(`unknown Spotify op: ${op as string}`);
    }
  }

  /** Set player volume 0..100 — used by the slider tile. */
  async setPlayerVolume(percent: number): Promise<void> {
    if (!this.cfg.refreshToken) throw new Error('Spotify not authorized');
    if (this.cfg.product && this.cfg.product !== 'premium') {
      throw new Error('Spotify playback control requires a Premium account.');
    }
    await this.ensureAccessToken();
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    await this.spotifyPlayerAction('PUT', `/me/player/volume?volume_percent=${clamped}`);
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: SpotifyConfig = { ...DEFAULT_SPOTIFY_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: SpotifyConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private accessToken: string | null = null;
  private accessTokenExpires = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  /** "Connected" = token exchange succeeded and we've decided how to run.
   *  Separate from `pollTimer` because for free-tier accounts we skip polling
   *  entirely (Spotify 403s every player-endpoint call at the app-owner level)
   *  but the integration is still linked — labelling those users "connecting"
   *  forever would be wrong. */
  private linked = false;
  private pendingAuth = new Map<string, PendingAuth>();
  private err: string | undefined;
  private nowPlaying: {
    isPlaying: boolean;
    track: string;
    artist: string;
    album: string;
    coverUrl?: string;
    deviceName?: string;
    volumePercent?: number;
  } | undefined;

  setConfig(cfg: SpotifyConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: SpotifyConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }
  private async persistCfg(): Promise<void> { if (this.saveCb) await this.saveCb({ ...this.cfg }); }

  private async ensureAccessToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.accessTokenExpires) return;
    if (!this.cfg.refreshToken) throw new Error('no refresh token');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.cfg.refreshToken,
      client_id: this.cfg.clientId,
    });
    const res = await fetch(`${AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 400 || res.status === 401) {
        // Refresh token got invalidated (revoked / expired). Wipe so the UI
        // asks the user to reconnect instead of retrying forever.
        this.cfg.refreshToken = '';
        await this.persistCfg();
      }
      throw new Error(`Spotify refresh failed: ${res.status} ${txt}`);
    }
    const data = await res.json() as { access_token: string; expires_in: number; refresh_token?: string };
    this.accessToken = data.access_token;
    this.accessTokenExpires = Date.now() + (data.expires_in - 60) * 1000;
    // Spotify occasionally rotates the refresh token — persist when it does.
    if (data.refresh_token && data.refresh_token !== this.cfg.refreshToken) {
      this.cfg.refreshToken = data.refresh_token;
      await this.persistCfg();
    }
  }

  private async spotifyGet<T>(path: string): Promise<T> {
    await this.ensureAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 204) return null as T; // no content is valid for /me/player when idle
    if (!res.ok) throw new Error(`Spotify GET ${path}: ${res.status} ${await res.text()}`);
    return await res.json() as T;
  }

  /** Player-endpoint helper — the /me/player family returns 204 on success
   *  and needs an active device. 404 = no active device (surface a friendly hint). */
  private async spotifyPlayerAction(method: 'PUT' | 'POST' | 'DELETE', path: string): Promise<void> {
    await this.ensureAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (res.status === 204 || res.status === 202) return;
    if (res.status === 404) {
      throw new Error('Spotify: no active device — start playback in any Spotify app (desktop / phone / web) once and try again.');
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json() as { error?: { message?: string } }; if (j.error?.message) msg += ` ${j.error.message}`; }
      catch { msg += ` ${await res.text()}`; }
      throw new Error(`Spotify ${method} ${path}: ${msg}`);
    }
  }

  private async pollNowPlaying(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.refreshToken) return;
    try {
      const st = await this.spotifyGet<null | {
        is_playing?: boolean;
        item?: { name?: string; album?: { name?: string; images?: Array<{ url?: string }> }; artists?: Array<{ name?: string }> };
        device?: { name?: string; volume_percent?: number };
      }>('/me/player');
      if (!st) {
        // Nothing playing anywhere.
        if (this.nowPlaying !== undefined) {
          this.nowPlaying = undefined;
          this.emitChange();
        }
        this.err = undefined;
        return;
      }
      const next = {
        isPlaying: !!st.is_playing,
        track: st.item?.name ?? '',
        artist: (st.item?.artists ?? []).map((a) => a.name).filter(Boolean).join(', '),
        album: st.item?.album?.name ?? '',
        coverUrl: st.item?.album?.images?.[0]?.url,
        deviceName: st.device?.name,
        volumePercent: st.device?.volume_percent,
      };
      const prev = this.nowPlaying;
      const same = prev && prev.isPlaying === next.isPlaying && prev.track === next.track
        && prev.artist === next.artist && prev.album === next.album
        && prev.coverUrl === next.coverUrl && prev.deviceName === next.deviceName
        && prev.volumePercent === next.volumePercent;
      if (!same) {
        this.nowPlaying = next;
        this.emitChange();
      }
      this.err = undefined;
    } catch (err) {
      const message = (err as Error).message;
      // A 403 means Spotify's paywall got us — usually the app-owner Premium
      // requirement (also affects /me/player, not just playback). Once we see
      // one there's no point retrying every 5s; stop polling silently. The
      // panel's "Recheck" button re-starts things after an upgrade.
      if (message.includes(': 403')) {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        this.err = undefined; // don't surface — this is the "expected" free-tier state
        this.emitChange();
        return;
      }
      this.err = message;
      console.warn(`[spotify] poll failed: ${message}`);
      this.emitChange();
    }
  }
}

let _instance: SpotifyClient | null = null;
export function getSpotify(): SpotifyClient {
  if (!_instance) {
    _instance = new SpotifyClient();
    registerIntegration(_instance);
  }
  return _instance;
}

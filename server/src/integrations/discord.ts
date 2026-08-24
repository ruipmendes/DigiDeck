import net from 'node:net';
import { randomBytes } from 'node:crypto';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type CallbackOutcome, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

export type PublicDiscordConfig = {
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  hasAccessToken: boolean;
  username: string;
  /** User's home / primary Discord guild — used to scope the channel picker to
   *  "just my server". Empty string when not set: falls back to the guild of
   *  whatever voice channel the user is currently in. */
  primaryGuildId: string;
  /** True when a bot token is on file. The token itself is never echoed back
   *  to the client — only its presence. Bot auth is what powers pull-user /
   *  move-user; user OAuth alone can't PATCH other guild members. */
  hasBotToken: boolean;
};

export function publicDiscordConfig(cfg: DiscordConfig): PublicDiscordConfig {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasAccessToken: !!cfg.accessToken,
    username: cfg.username,
    primaryGuildId: cfg.primaryGuildId,
    hasBotToken: !!cfg.botToken,
  };
}

export function validateDiscordConfig(input: unknown, existing: DiscordConfig): DiscordConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Discord config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    // UI never echoes the secret back — treat empty as "keep existing".
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    // Managed by the interactive-auth flow, not this endpoint.
    accessToken: existing.accessToken,
    refreshToken: existing.refreshToken,
    username: existing.username,
    // User-facing config: an empty string clears the setting, otherwise trim.
    primaryGuildId: typeof o.primaryGuildId === 'string' ? o.primaryGuildId.trim() : existing.primaryGuildId,
    // Bot token — same "empty keeps existing" convention as clientSecret so
    // the UI can safely echo the config back without exposing the token. An
    // explicit `null` (not undefined, not "") clears the token — needed for
    // the panel's "Clear bot token" button to actually take effect.
    botToken: o.botToken === null
      ? ''
      : typeof o.botToken === 'string' && o.botToken.trim().length > 0
        ? o.botToken.trim()
        : existing.botToken,
  };
}

export const DISCORD_MANIFEST: IntegrationManifest = {
  name: 'discord',
  displayName: 'Discord',
  actionTypes: ['discord'],
  hasOAuth: false,
  hasIpcAuth: true,
};

export type DiscordConfig = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  username: string;
  primaryGuildId: string;
  /** Bot token from Developer Portal → Bot → Reset Token. Optional. Only used
   *  to POST /guilds/{id}/members/{id} (pull-user / move-user) which user OAuth
   *  can't do. Blank string when not set. */
  botToken: string;
};

export const DEFAULT_DISCORD_CONFIG: DiscordConfig = {
  enabled: false,
  clientId: '',
  clientSecret: '',
  accessToken: '',
  refreshToken: '',
  username: '',
  primaryGuildId: '',
  botToken: '',
};

export type DiscordState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type DiscordStatus = {
  state: DiscordState;
  error?: string;
  username?: string;
  /** Current self-mute (client-side mute). Undefined until first sync. */
  mute?: boolean;
  /** Current self-deafen. */
  deaf?: boolean;
  /** Mic input volume (0–100). Discord's native range. Undefined until first sync. */
  inputVolume?: number;
  /** Output volume (0–200; 100 = normal). Undefined until first sync. */
  outputVolume?: number;
  /** Voice-input mode: push-to-talk vs voice-activity detection. */
  voiceMode?: 'PUSH_TO_TALK' | 'VOICE_ACTIVITY';
  /** Voice-activation threshold in dB (roughly -100 = most sensitive, 0 = least). */
  voiceThreshold?: number;
  /** True while Discord is auto-adjusting the threshold — sensitivity slider ignored until we override. */
  voiceAutoThreshold?: boolean;
  /** Noise suppression / Krisp on or off. */
  noiseSuppression?: boolean;
  /** Automatic gain control. */
  automaticGainControl?: boolean;
  /** Echo cancellation. */
  echoCancellation?: boolean;
  /** ID of the voice channel we're currently in, or null if not in one. */
  currentVoiceChannelId?: string | null;
  /** Human-facing name of the current voice channel. */
  currentVoiceChannelName?: string | null;
  /** Guild that the current voice channel belongs to — used to scope the
   *  channel picker to "just this server" by default. */
  currentVoiceGuildId?: string | null;
  /** Map from voice channel id → guild icon CDN URL. Populated on connect
   *  (via REST `/users/@me/guilds` for icons + RPC `GET_GUILDS`/`GET_CHANNELS`
   *  for the channel→guild mapping). Consumed by button-state computation
   *  so `join-channel` tiles can render the target server's icon. */
  channelIcons?: Record<string, string>;
  /** Live roster of the voice channel we're currently in. Excludes ourselves.
   *  Populated on channel-join via GET_CHANNEL, kept fresh by VOICE_STATE_*
   *  event subscriptions. Consumed by discord-voice-panel tiles. */
  channelMembers?: Array<DiscordChannelMember>;
};

export type DiscordChannelMember = {
  id: string;
  name: string;
  /** Server-side mute (applied by a moderator, affects everyone). */
  serverMute: boolean;
  /** User's own mute state (self-mute). */
  selfMute: boolean;
  /** Server-side deafen. */
  serverDeaf: boolean;
  /** User's own deafen state. */
  selfDeaf: boolean;
  /** Our client-side per-user volume (0-200). Tracked locally — Discord doesn't
   *  expose reads for this. Starts at 100 (Discord default) until we adjust. */
  ourVolume: number;
  /** Our client-side per-user mute for this user. Tracked the same way. */
  ourMute: boolean;
  /** True while Discord is emitting SPEAKING_START for this user without a
   *  matching SPEAKING_STOP yet. Drives the "who's talking" pulse in the
   *  voice-panel tile. */
  speaking: boolean;
};

export type DiscordOp =
  | 'toggle-mute' | 'mute' | 'unmute'
  | 'toggle-deafen' | 'deafen' | 'undeafen'
  | 'toggle-ptt'
  | 'toggle-noise-suppression'
  | 'toggle-auto-gain'
  | 'toggle-echo-cancellation'
  | 'join-channel'
  | 'leave-channel'
  | 'set-user-volume'
  | 'mute-user'
  | 'unmute-user'
  | 'pull-user'
  | 'move-user'
  | 'kick-user';

export type DiscordActionParams = {
  /** Discord channel id (18–19 digit snowflake) — target for `join-channel`. */
  channelId?: string;
  /** Discord user id — target for `set-user-volume` / `mute-user` / `unmute-user`. */
  userId?: string;
  /** Volume for `set-user-volume`, 0–200 (100 = normal). Default 100. */
  volume?: number;
};

/** Prompt-at-press descriptor for Discord actions. Same shape as Twitch's. */
export type DiscordPromptField = 'channelId' | 'userId';
export type DiscordChoicesSource =
  | 'discord-voice-channels'
  /** Members of the voice channel the user is currently in. */
  | 'discord-channel-members'
  /** Members in any voice channel of the user's primary/current guild — used
   *  by pull-user / move-user to pick someone in another VC of the same server. */
  | 'discord-guild-voice-members';
export type DiscordPrompt = {
  field: DiscordPromptField;
  label: string;
  placeholder?: string;
  /** When set, the phone fetches a dropdown of choices at press-time from this
   *  source rather than rendering a free-text input. */
  choicesSource?: DiscordChoicesSource;
};

// Discord IPC framing — 8-byte header (opcode LE, length LE) + UTF-8 JSON payload.
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

// Any redirect_uri works for IPC-based OAuth as long as it's registered on the
// app. This one is a well-known placeholder no browser round-trip uses.
const REDIRECT_URI = 'http://127.0.0.1';
const TOKEN_ENDPOINT = 'https://discord.com/api/oauth2/token';
const PIPE_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// `guilds.members.write` was requested for pull-user / move-user, but per
// Discord's docs that scope authorises PUT /guilds/{id}/members/{id} (add
// self to a guild), not PATCH (move another member). PATCH requires Bot auth
// with Move Members. Requesting the scope also seems to trigger an OAuth2
// Error 5000 on the authorize dialog for some app configurations. Removed
// until we have a working plan; pull-user / move-user now throw with a
// clear "bot-only" message at execute time.
const RPC_SCOPES = ['rpc', 'guilds'];
const DISCORD_API_BASE = 'https://discord.com/api/v10';

type RpcRequest = { cmd: string; args?: unknown; evt?: string };
type RpcResponse = { cmd: string; args?: unknown; data?: unknown; evt?: string; nonce?: string };

class DiscordClient implements IntegrationLifecycle {
  readonly manifest = DISCORD_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.discord); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.discord = cfg;
      await save();
    });
  }
  publicConfig(): PublicDiscordConfig { return publicDiscordConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): DiscordStatus {
    let state: DiscordState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.clientId || !this.cfg.clientSecret) state = 'not-configured';
    else if (!this.cfg.accessToken) state = 'needs-auth';
    else state = this.internal === 'idle' ? 'disconnected' : this.internal;
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      username: this.cfg.username || undefined,
      mute: this.voiceSettings?.mute,
      deaf: this.voiceSettings?.deaf,
      inputVolume: this.voiceSettings?.inputVolume,
      outputVolume: this.voiceSettings?.outputVolume,
      voiceMode: this.voiceSettings?.mode,
      voiceThreshold: this.voiceSettings?.threshold,
      voiceAutoThreshold: this.voiceSettings?.autoThreshold,
      noiseSuppression: this.voiceSettings?.noiseSuppression,
      automaticGainControl: this.voiceSettings?.automaticGainControl,
      echoCancellation: this.voiceSettings?.echoCancellation,
      currentVoiceChannelId: this.currentVoiceChannelId,
      currentVoiceChannelName: this.currentVoiceChannelName,
      currentVoiceGuildId: this.currentVoiceGuildId,
      channelIcons: this.buildChannelIconsMap(),
      channelMembers: this.currentVoiceChannelId ? Array.from(this.channelMembers.values()) : undefined,
    };
  }

  private buildChannelIconsMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [channelId, guildId] of this.channelToGuild) {
      const icon = this.guildIcons.get(guildId);
      if (icon) out[channelId] = icon;
    }
    return out;
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateDiscordConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Discord integration not attached');
    this.serverConfig.integrations.discord = validated;
    await this.saveFn();
    this.setConfig(validated);
    // Only restart when we're fully authorized; otherwise stop so start()'s
    // guard doesn't schedule pointless retries.
    if (validated.enabled && validated.accessToken) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  async connectInteractive(): Promise<CallbackOutcome> {
    if (!this.cfg.clientId || !this.cfg.clientSecret) {
      throw new Error('Discord Client ID and Secret required');
    }
    await this.ensurePipe();
    // AUTHORIZE pops the "Authorize this application?" dialog inside the
    // Discord client. Long timeout because the user has to physically click.
    const authRes = await this.rpcRequest({
      cmd: 'AUTHORIZE',
      args: { client_id: this.cfg.clientId, scopes: RPC_SCOPES },
    }, 120_000);
    const code = (authRes.data as { code?: string })?.code;
    if (!code) throw new Error('Discord authorize returned no code');

    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
    const tok = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    this.cfg.accessToken = tok.access_token;
    this.cfg.refreshToken = tok.refresh_token;

    const authcRes = await this.rpcRequest({
      cmd: 'AUTHENTICATE',
      args: { access_token: this.cfg.accessToken },
    });
    const user = (authcRes.data as { user?: { id?: string; username?: string } })?.user;
    this.cfg.username = user?.username ?? '';
    this.cachedSelfUserId = user?.id ?? null;
    await this.persistCfg();

    await this.subscribeAndSyncVoice();
    this.internal = 'connected';
    this.err = undefined;
    // Same cache-prime as start() so first-connect users get icons without
    // opening the picker.
    void this.getVoiceChannels().catch((err) => { console.warn(`[discord] cache prime failed: ${(err as Error).message}`); });
    this.emitChange();
    return { successMessage: this.cfg.username ? `Logged in as ${this.cfg.username}.` : 'Authorization complete.' };
  }

  async disconnectIntegration(): Promise<void> {
    this.closePipe();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.cfg.accessToken = '';
    this.cfg.refreshToken = '';
    this.cfg.username = '';
    this.voiceSettings = undefined;
    this.currentVoiceChannelId = null;
    this.currentVoiceChannelName = null;
    this.currentVoiceGuildId = null;
    this.cachedSelfUserId = null;
    this.guildIcons.clear();
    this.channelToGuild.clear();
    this.channelMembers.clear();
    this.subscribedChannelId = null;
    this.internal = 'idle';
    this.err = undefined;
    await this.persistCfg();
    this.emitChange();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.clientId || !this.cfg.clientSecret || !this.cfg.accessToken) {
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
      await this.ensurePipe();
      // Try the stored access token; if it's stale, refresh once and retry.
      let authcRes: RpcResponse;
      try {
        authcRes = await this.rpcRequest({ cmd: 'AUTHENTICATE', args: { access_token: this.cfg.accessToken } });
      } catch (err) {
        console.warn(`[discord] AUTHENTICATE failed (${(err as Error).message}), refreshing token`);
        await this.refreshAccessToken();
        authcRes = await this.rpcRequest({ cmd: 'AUTHENTICATE', args: { access_token: this.cfg.accessToken } });
      }
      this.cachedSelfUserId = ((authcRes.data as { user?: { id?: string } })?.user?.id) ?? null;
      await this.subscribeAndSyncVoice();
      this.internal = 'connected';
      console.log(`[discord] connected${this.cfg.username ? ` as ${this.cfg.username}` : ''}`);
      // Warm the guild-icon + channel-to-guild caches so join-channel tiles get
      // their server-icon thumbnails without waiting for the user to open the
      // picker. Best-effort; failure just leaves tiles thumbnail-less.
      void this.getVoiceChannels().catch((err) => { console.warn(`[discord] cache prime failed: ${(err as Error).message}`); });
      this.emitChange();
    } catch (err) {
      this.err = (err as Error).message;
      this.internal = 'error';
      console.warn(`[discord] connect failed: ${this.err}`);
      this.closePipe();
      this.scheduleRetry();
      this.emitChange();
    }
  }

  async stop(): Promise<void> {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.closePipe();
    this.channelMembers.clear();
    this.subscribedChannelId = null;
    this.internal = 'idle';
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: DiscordOp, params: DiscordActionParams = {}): Promise<void> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    const current = this.voiceSettings;
    switch (op) {
      case 'toggle-mute':   return this.setVoice({ mute: !current?.mute });
      case 'mute':          return this.setVoice({ mute: true });
      case 'unmute':        return this.setVoice({ mute: false });
      case 'toggle-deafen': return this.setVoice({ deaf: !current?.deaf });
      case 'deafen':        return this.setVoice({ deaf: true });
      case 'undeafen':      return this.setVoice({ deaf: false });
      case 'toggle-ptt': {
        const next = current?.mode === 'PUSH_TO_TALK' ? 'VOICE_ACTIVITY' : 'PUSH_TO_TALK';
        return this.setVoice({ mode: { type: next } });
      }
      case 'toggle-noise-suppression': return this.setVoice({ noise_suppression: !current?.noiseSuppression });
      case 'toggle-auto-gain':         return this.setVoice({ automatic_gain_control: !current?.automaticGainControl });
      case 'toggle-echo-cancellation': return this.setVoice({ echo_cancellation: !current?.echoCancellation });
      case 'join-channel': {
        const cid = params.channelId?.trim();
        if (!cid) {
          throw new Error(`Discord: channelId required (received params: ${JSON.stringify(params)})`);
        }
        // `force: true` — switch even if we're currently in another voice channel.
        // Without it Discord returns "user is already in a voice channel".
        await this.rpcRequest({ cmd: 'SELECT_VOICE_CHANNEL', args: { channel_id: cid, force: true } });
        return;
      }
      case 'leave-channel':
        // Same `force: true` — Discord refuses the disconnect while we're in a
        // channel otherwise. `channel_id: null` is the "disconnect" signal.
        await this.rpcRequest({ cmd: 'SELECT_VOICE_CHANNEL', args: { channel_id: null, force: true } });
        return;
      case 'set-user-volume': {
        const userId = params.userId?.trim();
        if (!userId) throw new Error('Discord: userId required');
        const volume = Math.max(0, Math.min(200, Math.round(params.volume ?? 100)));
        await this.setChannelMemberVolume(userId, volume);
        return;
      }
      case 'mute-user': {
        const userId = params.userId?.trim();
        if (!userId) throw new Error('Discord: userId required');
        await this.setChannelMemberMute(userId, true);
        return;
      }
      case 'unmute-user': {
        const userId = params.userId?.trim();
        if (!userId) throw new Error('Discord: userId required');
        await this.setChannelMemberMute(userId, false);
        return;
      }
      case 'pull-user': {
        const userId = params.userId?.trim();
        if (!userId) throw new Error(`Discord: userId required (received params: ${JSON.stringify(params)})`);
        if (!this.currentVoiceGuildId || !this.currentVoiceChannelId) {
          throw new Error('Discord: pull-user needs you to be in a voice channel — that\'s where the target gets pulled to');
        }
        await this.botMoveMember(this.currentVoiceGuildId, userId, this.currentVoiceChannelId);
        return;
      }
      case 'move-user': {
        const userId = params.userId?.trim();
        const channelId = params.channelId?.trim();
        if (!userId) throw new Error(`Discord: userId required (received params: ${JSON.stringify(params)})`);
        if (!channelId) throw new Error(`Discord: channelId required for move-user (received params: ${JSON.stringify(params)})`);
        // The REST endpoint needs the destination channel's guild. We cached
        // channel→guild for every channel the picker has ever surfaced; fall
        // back to the primary/current guild if the cache is cold (raw-ID paste).
        const guildId = this.channelToGuild.get(channelId) || this.cfg.primaryGuildId || this.currentVoiceGuildId;
        if (!guildId) {
          throw new Error('Discord: could not determine target guild — set a Primary server on the Discord panel or pick the channel from the picker to populate the cache');
        }
        await this.botMoveMember(guildId, userId, channelId);
        return;
      }
      case 'kick-user': {
        // "Kick from voice" = PATCH member.channel_id = null. Same bot flow
        // as move-user; user drops out of whatever voice channel they're in.
        // Not a guild kick — they stay a member, they just get disconnected.
        const userId = params.userId?.trim();
        if (!userId) throw new Error(`Discord: userId required (received params: ${JSON.stringify(params)})`);
        const guildId = this.cfg.primaryGuildId || this.currentVoiceGuildId;
        if (!guildId) {
          throw new Error('Discord: kick-user needs a guild context — set a Primary server on the Discord panel or join a voice channel first.');
        }
        await this.botMoveMember(guildId, userId, null);
        return;
      }
      default: throw new Error(`unknown Discord op: ${op as string}`);
    }
  }

  /** Set the per-user volume for `userId` (0-200) and cache it locally so the
   *  voice-panel tile reflects the change without needing to poll. */
  async setChannelMemberVolume(userId: string, volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    await this.rpcRequest({ cmd: 'SET_USER_VOICE_SETTINGS', args: { user_id: userId, volume: clamped } });
    const m = this.channelMembers.get(userId);
    if (m) {
      this.channelMembers.set(userId, { ...m, ourVolume: clamped });
      this.emitChange();
    }
  }

  /** Set our client-side per-user mute for `userId` and cache locally. */
  async setChannelMemberMute(userId: string, mute: boolean): Promise<void> {
    await this.rpcRequest({ cmd: 'SET_USER_VOICE_SETTINGS', args: { user_id: userId, mute } });
    const m = this.channelMembers.get(userId);
    if (m) {
      this.channelMembers.set(userId, { ...m, ourMute: mute });
      this.emitChange();
    }
  }

  /** Move a guild member to a specific voice channel. Uses Bot auth — user
   *  OAuth genuinely can't PATCH other members regardless of scope. Errors are
   *  translated to actionable messages (missing token / bot not in guild /
   *  missing permission) so the phone toast tells the user how to fix it. */
  private async botMoveMember(guildId: string, userId: string, channelId: string | null): Promise<void> {
    if (!this.cfg.botToken) {
      throw new Error('Discord: pull-user / move-user need a Bot token. Discord Developer Portal → your app → Bot → Reset Token, then paste it in the Discord panel. The bot must also be added to your server with Move Members permission.');
    }
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${userId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${this.cfg.botToken}`,
        'Content-Type': 'application/json',
        // Some corporate proxies reject fetch requests without a UA.
        'User-Agent': 'DigiDeck (https://github.com/ruipmendes/DigiDeck, 0.2.0)',
      },
      body: JSON.stringify({ channel_id: channelId }),
    });
    if (res.ok) return;
    let detail = '';
    try {
      const j = await res.json() as { message?: string; code?: number };
      if (j.message) detail = ` ${j.message}`;
      if (j.code) detail += ` (code ${j.code})`;
    } catch { detail = ` ${await res.text()}`; }
    if (res.status === 401) {
      throw new Error(`Discord: bot token rejected (${res.status}${detail}) — regenerate the token in Developer Portal → Bot → Reset Token and paste the fresh one.`);
    }
    if (res.status === 403) {
      throw new Error(`Discord: bot lacks permission (${res.status}${detail}) — confirm the bot is added to that server with Move Members permission. Discord role hierarchy also applies: bot can only move members whose highest role is below the bot's highest role.`);
    }
    if (res.status === 404) {
      throw new Error(`Discord: not found (${res.status}${detail}) — either the bot isn't in that guild, or the target user isn't a member of it.`);
    }
    throw new Error(`Discord PATCH member: ${res.status}${detail}`);
  }

  /** Flat list of every guild the authorized user is in. Used to populate the
   *  "primary server" picker in the Discord panel. Requires the `guilds` scope. */
  async getGuilds(): Promise<Array<{ id: string; name: string }>> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    let res: RpcResponse;
    try {
      res = await this.rpcRequest({ cmd: 'GET_GUILDS' });
    } catch (err) {
      throw new Error(`Discord: cannot list guilds (${(err as Error).message}) — reconnect to grant the "guilds" scope`);
    }
    return (res.data as { guilds?: Array<{ id: string; name: string }> })?.guilds ?? [];
  }

  /** All voice channels the authorized user can see, flattened across guilds.
   *  Requires the `guilds` OAuth scope — throws with a helpful message if it's
   *  missing so the panel can prompt for a re-connect. */
  async getVoiceChannels(): Promise<Array<{ id: string; channelName: string; guildId: string; guildName: string }>> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    let guildsRes: RpcResponse;
    try {
      guildsRes = await this.rpcRequest({ cmd: 'GET_GUILDS' });
    } catch (err) {
      throw new Error(`Discord: cannot list guilds (${(err as Error).message}) — reconnect to grant the new "guilds" scope`);
    }
    const guilds = (guildsRes.data as { guilds?: Array<{ id: string; name: string }> })?.guilds ?? [];
    const out: Array<{ id: string; channelName: string; guildId: string; guildName: string }> = [];
    for (const g of guilds) {
      try {
        const chRes = await this.rpcRequest({ cmd: 'GET_CHANNELS', args: { guild_id: g.id } });
        const channels = (chRes.data as { channels?: Array<{ id: string; name: string; type: number }> })?.channels ?? [];
        for (const c of channels) {
          // Discord channel types: 2 = voice, 13 = stage voice. Both accept SELECT_VOICE_CHANNEL.
          if (c.type === 2 || c.type === 13) {
            this.channelToGuild.set(c.id, g.id);
            out.push({ id: c.id, channelName: c.name, guildId: g.id, guildName: g.name });
          }
        }
      } catch { /* skip guilds we couldn't list — permissions or transient error */ }
    }
    // Kick off an icon refresh in the background so the tile thumbnails come
    // online shortly after the picker is opened. Best-effort — silence errors.
    void this.refreshGuildIcons().catch(() => { /* icons stay empty */ });
    return out;
  }

  /** Fetch each accessible guild's icon hash via REST and cache CDN URLs. Uses
   *  the OAuth bearer token — first Discord REST call the integration makes.
   *  Guilds without an icon (icon_hash === null) are simply omitted. */
  async refreshGuildIcons(): Promise<void> {
    if (!this.cfg.accessToken) return;
    const res = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${this.cfg.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Discord guilds REST failed: ${res.status}`);
    }
    const guilds = await res.json() as Array<{ id: string; icon: string | null }>;
    for (const g of guilds) {
      if (g.icon) {
        this.guildIcons.set(g.id, `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=128`);
      }
    }
    this.emitChange();
  }

  /** Users currently voice-connected anywhere in the primary-or-current guild,
   *  minus ourselves. Each entry names the channel they're in so pickers can
   *  disambiguate "Bob (in Lobby)" from "Alice (in Gaming)". Used by pull-user
   *  and move-user to select someone in another VC of the same server. */
  async getGuildVoiceMembers(): Promise<Array<{ id: string; name: string; channelName: string }>> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    const guildId = this.cfg.primaryGuildId || this.currentVoiceGuildId;
    if (!guildId) {
      throw new Error('Discord: set a Primary server or join a voice channel first — needed to know which guild to search');
    }
    const chRes = await this.rpcRequest({ cmd: 'GET_CHANNELS', args: { guild_id: guildId } });
    const channels = (chRes.data as { channels?: Array<{ id: string; name: string; type: number }> })?.channels ?? [];
    const voiceChannels = channels.filter((c) => c.type === 2 || c.type === 13);
    const out: Array<{ id: string; name: string; channelName: string }> = [];
    const selfId = this.cachedSelfUserId;
    for (const c of voiceChannels) {
      try {
        const cRes = await this.rpcRequest({ cmd: 'GET_CHANNEL', args: { channel_id: c.id } });
        const states = (cRes.data as { voice_states?: Array<{ user?: { id?: string; username?: string }; nick?: string | null }> })?.voice_states ?? [];
        for (const s of states) {
          const uid = s.user?.id;
          if (!uid || uid === selfId) continue;
          out.push({
            id: uid,
            name: s.nick || s.user?.username || uid,
            channelName: c.name,
          });
        }
      } catch { /* skip channels we couldn't read */ }
    }
    return out;
  }

  /** Users currently in the voice channel this account is in. Empty when we're
   *  not in a channel. Excludes ourselves. */
  async getChannelMembers(): Promise<Array<{ id: string; name: string }>> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    const cid = this.currentVoiceChannelId;
    if (!cid) throw new Error('Discord: not currently in a voice channel');
    const res = await this.rpcRequest({ cmd: 'GET_CHANNEL', args: { channel_id: cid } });
    const states = (res.data as { voice_states?: Array<{ user?: { id?: string; username?: string }; nick?: string | null }> })?.voice_states ?? [];
    const selfId = (await this.getSelfUserId()) ?? null;
    return states
      .filter((s) => s.user?.id && s.user.id !== selfId)
      .map((s) => ({ id: s.user!.id!, name: s.nick || s.user!.username || s.user!.id! }));
  }

  private cachedSelfUserId: string | null = null;
  private async getSelfUserId(): Promise<string | null> {
    // Populated during AUTHENTICATE on both start() and connectInteractive().
    // Returns null pre-auth — callers filter accordingly.
    return this.cachedSelfUserId;
  }

  private async setVoice(args: Record<string, unknown>): Promise<void> {
    await this.rpcRequest({ cmd: 'SET_VOICE_SETTINGS', args });
    // VOICE_SETTINGS_UPDATE echoes the new state back and updates our cache.
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: DiscordConfig = { ...DEFAULT_DISCORD_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: DiscordConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private err: string | undefined;
  private internal: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' = 'idle';
  private pipe: net.Socket | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private pending = new Map<string, { resolve: (v: RpcResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private voiceSettings: {
    mute: boolean;
    deaf: boolean;
    inputVolume: number;
    outputVolume: number;
    mode: 'PUSH_TO_TALK' | 'VOICE_ACTIVITY';
    threshold: number;
    autoThreshold: boolean;
    noiseSuppression: boolean;
    automaticGainControl: boolean;
    echoCancellation: boolean;
  } | undefined;
  private currentVoiceChannelId: string | null = null;
  private currentVoiceChannelName: string | null = null;
  private currentVoiceGuildId: string | null = null;
  /** guildId → CDN icon URL (guilds without an icon aren't added). */
  private guildIcons = new Map<string, string>();
  /** channelId → guildId. Populated during getVoiceChannels() (which walks all guilds). */
  private channelToGuild = new Map<string, string>();
  /** Live roster of the current voice channel, keyed by user id. Excludes self.
   *  Populated on channel-join, kept fresh by VOICE_STATE_* events + our own
   *  writes to per-user voice settings. */
  private channelMembers = new Map<string, DiscordChannelMember>();
  /** Which channel id our current VOICE_STATE_* subscription is scoped to.
   *  Null when we haven't subscribed. Used to unsubscribe on channel change. */
  private subscribedChannelId: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private readyResolver: (() => void) | null = null;

  setConfig(cfg: DiscordConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: DiscordConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }
  private async persistCfg(): Promise<void> { if (this.saveCb) await this.saveCb({ ...this.cfg }); }

  private scheduleRetry(): void {
    if (!this.cfg.enabled || !this.cfg.accessToken) return;
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, 5000);
  }

  private pipePath(i: number): string {
    return process.platform === 'win32'
      ? `\\\\.\\pipe\\discord-ipc-${i}`
      : `/tmp/discord-ipc-${i}`;
  }

  private async ensurePipe(): Promise<void> {
    if (this.pipe && !this.pipe.destroyed) return;
    let lastErr: Error | null = null;
    for (const i of PIPE_INDEXES) {
      try {
        this.pipe = await this.openPipe(this.pipePath(i));
        break;
      } catch (e) {
        lastErr = e as Error;
      }
    }
    if (!this.pipe) {
      throw new Error(`Discord IPC pipe not found — is Discord running? (${lastErr?.message ?? 'no pipe tried'})`);
    }
    this.attachPipeHandlers();
    await this.handshake();
  }

  private openPipe(path: string): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(path);
      const onError = (e: Error) => { s.removeAllListeners(); reject(e); };
      const onConnect = () => { s.removeAllListeners('error'); s.removeAllListeners('connect'); resolve(s); };
      s.once('error', onError);
      s.once('connect', onConnect);
    });
  }

  private attachPipeHandlers(): void {
    if (!this.pipe) return;
    this.buf = Buffer.alloc(0);
    this.pipe.on('data', (d: Buffer) => this.onPipeData(d));
    this.pipe.on('close', () => {
      if (this.pipe) console.warn('[discord] pipe closed');
      this.pipe = null;
      for (const [nonce, p] of this.pending.entries()) {
        clearTimeout(p.timer);
        p.reject(new Error('Discord pipe closed'));
        this.pending.delete(nonce);
      }
      if (this.internal === 'connected') {
        this.internal = 'disconnected';
        this.scheduleRetry();
        this.emitChange();
      }
    });
    this.pipe.on('error', (err) => {
      console.warn(`[discord] pipe error: ${err.message}`);
    });
  }

  private closePipe(): void {
    if (!this.pipe) return;
    try { this.pipe.destroy(); } catch { /* ignore */ }
    this.pipe = null;
    for (const [nonce, p] of this.pending.entries()) {
      clearTimeout(p.timer);
      p.reject(new Error('Discord pipe closed'));
      this.pending.delete(nonce);
    }
  }

  private async handshake(): Promise<void> {
    const payload = JSON.stringify({ v: 1, client_id: this.cfg.clientId });
    this.sendFrame(OP_HANDSHAKE, payload);
    await this.awaitReady();
  }

  private awaitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolver = null;
        reject(new Error('Discord handshake timeout'));
      }, 10_000);
      this.readyResolver = () => { clearTimeout(timer); resolve(); };
    });
  }

  private onPipeData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(4);
      if (this.buf.length < 8 + len) break;
      const payload = this.buf.slice(8, 8 + len).toString('utf8');
      this.buf = this.buf.slice(8 + len);
      this.handleFrame(op, payload);
    }
  }

  private handleFrame(op: number, payload: string): void {
    if (op === OP_PING) {
      this.sendFrame(OP_PONG, payload);
      return;
    }
    if (op === OP_CLOSE) {
      console.warn(`[discord] server close: ${payload}`);
      return;
    }
    if (op !== OP_FRAME) return;
    let msg: RpcResponse;
    try {
      msg = JSON.parse(payload) as RpcResponse;
    } catch {
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.readyResolver?.();
      this.readyResolver = null;
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'VOICE_SETTINGS_UPDATE') {
      this.updateVoiceSettings(msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'VOICE_STATE_CREATE') {
      this.applyVoiceStateEvent('create', msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'VOICE_STATE_UPDATE') {
      this.applyVoiceStateEvent('update', msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'VOICE_STATE_DELETE') {
      this.applyVoiceStateEvent('delete', msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'SPEAKING_START') {
      this.applySpeakingEvent(true, msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'SPEAKING_STOP') {
      this.applySpeakingEvent(false, msg.data);
      return;
    }
    if (msg.cmd === 'DISPATCH' && msg.evt === 'VOICE_CHANNEL_SELECT') {
      // Event payload: { channel_id, guild_id }. Look up the name via GET_CHANNEL
      // for a friendly label — best effort, don't fail the event handling.
      const d = msg.data as { channel_id?: string | null; guild_id?: string | null } | undefined;
      if (!d || !d.channel_id) {
        this.updateSelectedChannel(null);
      } else {
        this.currentVoiceChannelId = d.channel_id;
        this.currentVoiceChannelName = null;
        this.currentVoiceGuildId = typeof d.guild_id === 'string' ? d.guild_id : this.currentVoiceGuildId;
        this.emitChange();
        void this.rpcRequest({ cmd: 'GET_CHANNEL', args: { channel_id: d.channel_id } })
          .then((r) => this.updateSelectedChannel(r.data))
          .catch(() => { /* keep the id-only display */ });
      }
      return;
    }
    if (msg.nonce) {
      const p = this.pending.get(msg.nonce);
      if (!p) return;
      this.pending.delete(msg.nonce);
      clearTimeout(p.timer);
      if (msg.evt === 'ERROR') {
        const errData = msg.data as { message?: string; code?: number } | undefined;
        p.reject(new Error(`Discord ${msg.cmd}: ${errData?.message ?? 'unknown error'}${errData?.code ? ` (${errData.code})` : ''}`));
      } else {
        p.resolve(msg);
      }
    }
  }

  private sendFrame(op: number, payload: string): void {
    if (!this.pipe) throw new Error('Discord pipe not open');
    const body = Buffer.from(payload, 'utf8');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(op, 0);
    header.writeUInt32LE(body.length, 4);
    this.pipe.write(Buffer.concat([header, body]));
  }

  private rpcRequest(req: RpcRequest, timeoutMs = 10_000): Promise<RpcResponse> {
    const nonce = randomBytes(8).toString('hex');
    const payload = JSON.stringify({ ...req, nonce });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord ${req.cmd} timeout`));
      }, timeoutMs);
      this.pending.set(nonce, { resolve, reject, timer });
      try {
        this.sendFrame(OP_FRAME, payload);
      } catch (e) {
        this.pending.delete(nonce);
        clearTimeout(timer);
        reject(e as Error);
      }
    });
  }

  private async subscribeAndSyncVoice(): Promise<void> {
    await this.rpcRequest({ cmd: 'SUBSCRIBE', evt: 'VOICE_SETTINGS_UPDATE' });
    await this.rpcRequest({ cmd: 'SUBSCRIBE', evt: 'VOICE_CHANNEL_SELECT' });
    const [settings, channel] = await Promise.all([
      this.rpcRequest({ cmd: 'GET_VOICE_SETTINGS' }),
      this.rpcRequest({ cmd: 'GET_SELECTED_VOICE_CHANNEL' }),
    ]);
    this.updateVoiceSettings(settings.data);
    this.updateSelectedChannel(channel.data);
  }

  private updateSelectedChannel(data: unknown): void {
    if (data === null || data === undefined) {
      this.currentVoiceChannelId = null;
      this.currentVoiceChannelName = null;
      this.currentVoiceGuildId = null;
    } else if (typeof data === 'object') {
      const d = data as { id?: string | null; name?: string | null; guild_id?: string | null; voice_states?: unknown };
      this.currentVoiceChannelId = typeof d.id === 'string' ? d.id : null;
      this.currentVoiceChannelName = typeof d.name === 'string' ? d.name : null;
      if (typeof d.guild_id === 'string') this.currentVoiceGuildId = d.guild_id;
      // GET_CHANNEL responses embed the current voice_states — seed the roster
      // when we get one so voice-panel tiles have data immediately.
      if (Array.isArray(d.voice_states)) {
        this.seedChannelMembers(d.voice_states);
      }
    }
    void this.syncVoiceStateSubscription();
    this.emitChange();
  }

  /** Bring the VOICE_STATE_* subscription in line with `currentVoiceChannelId`.
   *  Idempotent — safe to call from any hydration point. */
  private async syncVoiceStateSubscription(): Promise<void> {
    if (this.internal !== 'connected' && this.internal !== 'connecting') return;
    const cid = this.currentVoiceChannelId;
    if (this.subscribedChannelId === cid) return;
    // Unsubscribe the previous channel.
    if (this.subscribedChannelId) {
      const prev = this.subscribedChannelId;
      this.subscribedChannelId = null;
      // Silent failure — Discord may have already cleaned up the sub if the pipe blinked.
      for (const evt of ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP']) {
        void this.rpcRequest({ cmd: 'UNSUBSCRIBE', evt, args: { channel_id: prev } }).catch(() => {});
      }
    }
    // Clear the local roster whenever the channel changes; it'll be reseeded
    // by the fresh GET_CHANNEL below (or stay empty if we left voice entirely).
    this.channelMembers.clear();
    if (!cid) return;
    this.subscribedChannelId = cid;
    for (const evt of ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP']) {
      void this.rpcRequest({ cmd: 'SUBSCRIBE', evt, args: { channel_id: cid } }).catch(() => {});
    }
    // Get fresh voice_states — VOICE_STATE_CREATE only fires for future joins.
    void this.rpcRequest({ cmd: 'GET_CHANNEL', args: { channel_id: cid } })
      .then((r) => {
        const d = r.data as { voice_states?: unknown };
        if (Array.isArray(d?.voice_states)) {
          this.seedChannelMembers(d.voice_states);
          this.emitChange();
        }
      })
      .catch(() => { /* stale is fine — events will fill it in */ });
  }

  private seedChannelMembers(voiceStates: unknown[]): void {
    this.channelMembers.clear();
    for (const s of voiceStates) {
      if (!s || typeof s !== 'object') continue;
      const state = s as {
        user?: { id?: string; username?: string };
        nick?: string | null;
        mute?: boolean;
        deaf?: boolean;
        self_mute?: boolean;
        self_deaf?: boolean;
      };
      const uid = state.user?.id;
      if (!uid || uid === this.cachedSelfUserId) continue;
      this.channelMembers.set(uid, {
        id: uid,
        name: state.nick || state.user?.username || uid,
        serverMute: !!state.mute,
        selfMute: !!state.self_mute,
        serverDeaf: !!state.deaf,
        selfDeaf: !!state.self_deaf,
        ourVolume: 100,
        ourMute: false,
        speaking: false,
      });
    }
  }

  /** Apply a single VOICE_STATE_CREATE / UPDATE / DELETE event to the roster. */
  private applyVoiceStateEvent(evt: 'create' | 'update' | 'delete', data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as {
      user?: { id?: string; username?: string };
      nick?: string | null;
      mute?: boolean;
      deaf?: boolean;
      self_mute?: boolean;
      self_deaf?: boolean;
    };
    const uid = d.user?.id;
    if (!uid || uid === this.cachedSelfUserId) return;
    if (evt === 'delete') {
      this.channelMembers.delete(uid);
    } else {
      const prev = this.channelMembers.get(uid);
      this.channelMembers.set(uid, {
        id: uid,
        name: d.nick || d.user?.username || prev?.name || uid,
        serverMute: !!d.mute,
        selfMute: !!d.self_mute,
        serverDeaf: !!d.deaf,
        selfDeaf: !!d.self_deaf,
        // Our per-user volume/mute persist across voice-state events — they're
        // a client-side setting Discord doesn't echo back.
        ourVolume: prev?.ourVolume ?? 100,
        ourMute: prev?.ourMute ?? false,
        // Same for speaking — voice-state events don't include it; it lives in
        // its own SPEAKING_START/STOP stream, so preserve whatever we last saw.
        speaking: prev?.speaking ?? false,
      });
    }
    this.emitChange();
  }

  /** Apply a Discord SPEAKING_START / SPEAKING_STOP event to the roster.
   *  Fired per user_id + channel_id — we only care about the current channel. */
  private applySpeakingEvent(active: boolean, data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as { user_id?: string };
    const uid = d.user_id;
    if (!uid || uid === this.cachedSelfUserId) return;
    const m = this.channelMembers.get(uid);
    if (!m || m.speaking === active) return;
    this.channelMembers.set(uid, { ...m, speaking: active });
    this.emitChange();
  }

  /** Merge a Discord voice-settings payload into our cache. GET responses
   *  carry the full record; UPDATE events sometimes carry a partial (only the
   *  fields that changed), so we merge rather than replace. */
  private updateVoiceSettings(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as {
      mute?: boolean; deaf?: boolean;
      input?: { volume?: number };
      output?: { volume?: number };
      mode?: { type?: string; auto_threshold?: boolean; threshold?: number };
      noise_suppression?: boolean;
      automatic_gain_control?: boolean;
      echo_cancellation?: boolean;
    };
    const prev = this.voiceSettings ?? {
      mute: false, deaf: false,
      inputVolume: 100, outputVolume: 100,
      mode: 'VOICE_ACTIVITY' as const,
      threshold: -60, autoThreshold: true,
      noiseSuppression: false,
      automaticGainControl: false,
      echoCancellation: false,
    };
    const nextMode = d.mode?.type === 'PUSH_TO_TALK' ? 'PUSH_TO_TALK'
      : d.mode?.type === 'VOICE_ACTIVITY' ? 'VOICE_ACTIVITY'
      : prev.mode;
    this.voiceSettings = {
      mute: d.mute ?? prev.mute,
      deaf: d.deaf ?? prev.deaf,
      inputVolume: typeof d.input?.volume === 'number' ? d.input.volume : prev.inputVolume,
      outputVolume: typeof d.output?.volume === 'number' ? d.output.volume : prev.outputVolume,
      mode: nextMode,
      threshold: typeof d.mode?.threshold === 'number' ? d.mode.threshold : prev.threshold,
      autoThreshold: typeof d.mode?.auto_threshold === 'boolean' ? d.mode.auto_threshold : prev.autoThreshold,
      noiseSuppression: d.noise_suppression ?? prev.noiseSuppression,
      automaticGainControl: d.automatic_gain_control ?? prev.automaticGainControl,
      echoCancellation: d.echo_cancellation ?? prev.echoCancellation,
    };
    this.emitChange();
  }

  /** Slider setter. `channel` is 'input' (mic volume), 'output' (voice audio out),
   *  or 'sensitivity' (voice-activity threshold). Values are 0..1 on the slider
   *  protocol; we map to Discord's native range per channel:
   *   - input  → volume 0..100
   *   - output → volume 0..200 (Discord natively boosts to 200 % — slider 0.5
   *              corresponds to the 100 % "normal" mark you see in Discord's UI)
   *   - sensitivity → threshold -100..0 dB, with 1.0 = most sensitive
   *                   (threshold -100) and 0.0 = least sensitive (0 dB).
   *                   Also flips `auto_threshold` off so the manual value takes effect. */
  async setSliderVolume(channel: 'input' | 'output' | 'sensitivity', value: number): Promise<void> {
    if (this.internal !== 'connected') await this.start();
    if (this.internal !== 'connected') throw new Error(`Discord not connected (${this.internal})`);
    const clamped = Math.max(0, Math.min(1, value));
    if (channel === 'sensitivity') {
      const threshold = -100 * clamped;
      await this.rpcRequest({
        cmd: 'SET_VOICE_SETTINGS',
        args: { mode: { auto_threshold: false, threshold } },
      });
      return;
    }
    const scale = channel === 'output' ? 200 : 100;
    const volume = Math.round(clamped * scale);
    const args = channel === 'input' ? { input: { volume } } : { output: { volume } };
    await this.rpcRequest({ cmd: 'SET_VOICE_SETTINGS', args });
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.cfg.refreshToken) throw new Error('no refresh token');
    const body = new URLSearchParams({
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: this.cfg.refreshToken,
    });
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 400 || res.status === 401) {
        this.cfg.accessToken = '';
        this.cfg.refreshToken = '';
        await this.persistCfg();
      }
      throw new Error(`Discord refresh failed: ${res.status} ${txt}`);
    }
    const tok = await res.json() as { access_token: string; refresh_token?: string };
    this.cfg.accessToken = tok.access_token;
    if (tok.refresh_token) this.cfg.refreshToken = tok.refresh_token;
    await this.persistCfg();
  }
}

let _instance: DiscordClient | null = null;
export function getDiscord(): DiscordClient {
  if (!_instance) {
    _instance = new DiscordClient();
    registerIntegration(_instance);
  }
  return _instance;
}

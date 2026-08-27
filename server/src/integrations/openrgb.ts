import { createConnection, type Socket } from 'node:net';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * OpenRGB integration — triggers RGB profiles across the entire PC lighting
 * ecosystem through the OpenRGB SDK's TCP server.
 *
 * Why this covers so much: OpenRGB is a community project that reverse-
 * engineered ~500 RGB devices — Asus Aura, MSI Mystic Light, Gigabyte RGB
 * Fusion, Corsair iCUE, Razer Chroma, HyperX, Cooler Master, Thermaltake,
 * and so on. Users run OpenRGB on their PC, enable "SDK Server" in its
 * Settings, and every RGB device it can drive becomes controllable through
 * the one protocol we speak here.
 *
 * MVP scope is deliberately narrow: **load-profile**. Users compose the
 * complex per-device color / effect combinations in OpenRGB's UI (which is
 * far more capable than anything we could build inline), save each combo
 * as a named profile, and Digi Deck tiles fire the profile. Per-device set-
 * color / effect cycling is a follow-up — the profile path already covers
 * the "chill / gaming / streaming" preset use case people actually want.
 *
 * Protocol reference (from OpenRGB's docs):
 *   https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Documentation/OpenRGBSDKDocumentation.md
 *
 * Packet framing (16-byte header + payload):
 *   - 4 bytes: "ORGB" magic
 *   - 4 bytes: device_index (u32 LE)
 *   - 4 bytes: packet_id    (u32 LE)
 *   - 4 bytes: data_size    (u32 LE)
 *   - N bytes: payload
 */

export type PublicOpenRgbConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export function publicOpenRgbConfig(cfg: OpenRgbConfig): PublicOpenRgbConfig {
  return {
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
  };
}

export function validateOpenRgbConfig(input: unknown, existing: OpenRgbConfig): OpenRgbConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid OpenRGB config');
  const o = input as Record<string, unknown>;
  const port = typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : existing.port;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' && o.host.trim() ? o.host.trim() : existing.host,
    port,
  };
}

export const OPENRGB_MANIFEST: IntegrationManifest = {
  name: 'openrgb',
  displayName: 'OpenRGB',
  actionTypes: ['openrgb'],
  hasOAuth: false,
};

export type OpenRgbConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export const DEFAULT_OPENRGB_CONFIG: OpenRgbConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 6742,
};

export type OpenRgbState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type OpenRgbStatus = {
  state: OpenRgbState;
  error?: string;
  host?: string;
  port?: number;
  /** Number of RGB controllers OpenRGB has discovered. */
  deviceCount?: number;
  /** Named profiles the user has saved in OpenRGB — the primary tile target. */
  profiles?: string[];
};

export type OpenRgbOp = 'load-profile';

export type OpenRgbActionParams = {
  /** For `load-profile`: the profile's name as it appears in OpenRGB. */
  profileName?: string;
};

// Packet IDs from OpenRGB's SDK. Not exhaustive — we only need these three.
const PACKET_REQUEST_CONTROLLER_COUNT = 0;
const PACKET_SET_CLIENT_NAME = 50;
const PACKET_REQUEST_PROFILE_LIST = 150;
const PACKET_REQUEST_LOAD_PROFILE = 152;

const MAGIC = Buffer.from('ORGB', 'ascii');
const HEADER_SIZE = 16;
const RECONNECT_MS = 5_000;
const PROFILE_POLL_MS = 10_000;
const CLIENT_NAME = 'digi-deck';

class OpenRgbClient implements IntegrationLifecycle {
  readonly manifest = OPENRGB_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.openrgb); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
    this.setSaveCallback(async (cfg) => {
      config.integrations.openrgb = cfg;
      await save();
    });
  }
  publicConfig(): PublicOpenRgbConfig { return publicOpenRgbConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): OpenRgbStatus {
    let state: OpenRgbState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.host || !this.cfg.port) state = 'not-configured';
    else if (this.err) state = 'error';
    else if (this.socket && this.connected) state = 'connected';
    else if (this.socket) state = 'connecting';
    else state = 'disconnected';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      host: this.cfg.host || undefined,
      port: this.cfg.port || undefined,
      deviceCount: this.deviceCount,
      profiles: this.profiles,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateOpenRgbConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('OpenRGB integration not attached');
    this.serverConfig.integrations.openrgb = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled) {
      await this.restart();
    } else {
      await this.stop();
    }
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.host || !this.cfg.port) return;
    if (this.socket) return;
    this.err = undefined;
    this.emitChange();
    this.connectAndHandshake();
  }

  async stop(): Promise<void> {
    this.stopReconnect();
    this.stopProfilePoll();
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
      this.connected = false;
    }
    this.deviceCount = undefined;
    this.profiles = undefined;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: OpenRgbOp, params: OpenRgbActionParams | undefined): Promise<void> {
    if (!this.socket || !this.connected) throw new Error('OpenRGB not connected — is the OpenRGB SDK server running?');
    switch (op) {
      case 'load-profile': {
        const name = params?.profileName?.trim();
        if (!name) throw new Error('OpenRGB load-profile: profileName required');
        // Payload: null-terminated UTF-8 profile name.
        const nameBuf = Buffer.from(name, 'utf8');
        const payload = Buffer.concat([nameBuf, Buffer.from([0])]);
        this.sendPacket(0, PACKET_REQUEST_LOAD_PROFILE, payload);
        // Refresh the profile list opportunistically — no response comes back
        // for load-profile, so this doubles as a "did the server survive it".
        setTimeout(() => { this.requestProfileList(); }, 200);
        return;
      }
      default:
        throw new Error(`unknown OpenRGB op: ${op as string}`);
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: OpenRgbConfig = { ...DEFAULT_OPENRGB_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private saveCb?: (cfg: OpenRgbConfig) => Promise<void>;
  private onChangeCb: (() => void) | null = null;
  private socket: Socket | null = null;
  private connected = false;
  private err: string | undefined;
  private deviceCount: number | undefined;
  private profiles: string[] | undefined;
  private buffer = Buffer.alloc(0);
  private reconnectTimer: NodeJS.Timeout | null = null;
  private profilePollTimer: NodeJS.Timeout | null = null;

  setConfig(cfg: OpenRgbConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  setSaveCallback(cb: (cfg: OpenRgbConfig) => Promise<void>): void { this.saveCb = cb; }
  private emitChange(): void { this.onChangeCb?.(); }

  private connectAndHandshake(): void {
    this.stopReconnect();
    const sock = createConnection({ host: this.cfg.host, port: this.cfg.port }, () => {
      // Announce ourselves — some OpenRGB releases show connected clients in
      // the SDK panel; a friendly name helps users debug "who's connected".
      const nameBuf = Buffer.from(CLIENT_NAME, 'utf8');
      const payload = Buffer.concat([nameBuf, Buffer.from([0])]);
      this.sendPacket(0, PACKET_SET_CLIENT_NAME, payload);
      // Immediately ask for device count + profile list. The responses arrive
      // asynchronously and drive our state.
      this.sendPacket(0, PACKET_REQUEST_CONTROLLER_COUNT, Buffer.alloc(0));
      this.requestProfileList();
      this.connected = true;
      this.err = undefined;
      this.emitChange();
      this.startProfilePoll();
    });
    this.socket = sock;
    sock.setKeepAlive(true, 30_000);
    sock.on('data', (chunk) => this.handleData(chunk));
    sock.on('error', (err) => {
      this.err = friendlyConnectError(err);
      console.warn(`[openrgb] socket error: ${err.message}`);
      this.emitChange();
    });
    sock.on('close', () => {
      this.socket = null;
      this.connected = false;
      this.stopProfilePoll();
      this.buffer = Buffer.alloc(0);
      this.emitChange();
      // Reconnect while enabled — user will typically start OpenRGB after
      // Digi Deck is already running, so retrying is worth it.
      if (this.cfg.enabled) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg.enabled) this.connectAndHandshake();
    }, RECONNECT_MS);
  }
  private stopReconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private startProfilePoll(): void {
    if (this.profilePollTimer) return;
    this.profilePollTimer = setInterval(() => this.requestProfileList(), PROFILE_POLL_MS);
  }
  private stopProfilePoll(): void {
    if (this.profilePollTimer) { clearInterval(this.profilePollTimer); this.profilePollTimer = null; }
  }

  private requestProfileList(): void {
    if (!this.socket || !this.connected) return;
    this.sendPacket(0, PACKET_REQUEST_PROFILE_LIST, Buffer.alloc(0));
  }

  private sendPacket(deviceIndex: number, packetId: number, payload: Buffer): void {
    if (!this.socket) return;
    const header = Buffer.alloc(HEADER_SIZE);
    MAGIC.copy(header, 0);
    header.writeUInt32LE(deviceIndex, 4);
    header.writeUInt32LE(packetId, 8);
    header.writeUInt32LE(payload.length, 12);
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (err) {
      this.err = (err as Error).message;
      this.emitChange();
    }
  }

  /** Chunk-safe frame parser — SDK packets arrive as arbitrary TCP chunks, so
   *  we accumulate into a buffer and pull complete frames off the front. */
  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= HEADER_SIZE) {
      if (!this.buffer.subarray(0, 4).equals(MAGIC)) {
        // Desync — resync by dropping bytes until we find the magic. Shouldn't
        // happen with a well-behaved server, but a crashed server can leave
        // partial garbage on the wire.
        const idx = this.buffer.indexOf(MAGIC);
        if (idx < 0) { this.buffer = Buffer.alloc(0); return; }
        this.buffer = this.buffer.subarray(idx);
        continue;
      }
      const packetId = this.buffer.readUInt32LE(8);
      const dataSize = this.buffer.readUInt32LE(12);
      if (this.buffer.length < HEADER_SIZE + dataSize) return; // wait for more
      const payload = this.buffer.subarray(HEADER_SIZE, HEADER_SIZE + dataSize);
      this.dispatchPacket(packetId, payload);
      this.buffer = this.buffer.subarray(HEADER_SIZE + dataSize);
    }
  }

  private dispatchPacket(packetId: number, payload: Buffer): void {
    switch (packetId) {
      case PACKET_REQUEST_CONTROLLER_COUNT: {
        if (payload.length < 4) return;
        const count = payload.readUInt32LE(0);
        if (count !== this.deviceCount) {
          this.deviceCount = count;
          this.emitChange();
        }
        return;
      }
      case PACKET_REQUEST_PROFILE_LIST: {
        const profiles = parseProfileList(payload);
        if (!sameArray(profiles, this.profiles)) {
          this.profiles = profiles;
          this.emitChange();
        }
        return;
      }
    }
  }
}

// ─── Payload parsing ────────────────────────────────────────────

/** REQUEST_PROFILE_LIST response layout (modern OpenRGB):
 *    u32 total_size  (of the *entire* payload — INCLUDES its own 4 bytes)
 *    u16 num_profiles
 *    for each profile:
 *      u16 name_length (bytes INCLUDING the null terminator)
 *      utf-8 bytes ending with \0
 *
 *  Older OpenRGB versions omitted the leading total_size field. We sniff by
 *  checking whether the first u32 equals the total payload length. If it
 *  does, we're on the modern format; otherwise assume raw (u16 count →
 *  entries). If the modern parse yields nothing but the raw parse does, fall
 *  back to raw — belt-and-suspenders for future protocol drift. */
function parseProfileList(payload: Buffer): string[] {
  if (payload.length < 2) return [];
  const parsed = tryParseProfileList(payload, /*hasHeader*/ null);
  if (parsed.length > 0) return parsed;
  // No profiles found via auto-detect — try the other framing explicitly.
  const forced = tryParseProfileList(payload, /*hasHeader*/ false);
  if (forced.length > 0) return forced;
  return [];
}

function tryParseProfileList(payload: Buffer, hasHeader: boolean | null): string[] {
  let offset = 0;
  if (hasHeader === null) {
    // Auto-detect: modern framing puts a u32 whose value equals payload.length.
    if (payload.length >= 6) {
      const maybeTotal = payload.readUInt32LE(0);
      if (maybeTotal === payload.length) offset = 4;
    }
  } else if (hasHeader) {
    offset = 4;
  }
  if (payload.length < offset + 2) return [];
  const num = payload.readUInt16LE(offset);
  offset += 2;
  // Absurd count → almost certainly a framing mismatch; give up on this attempt.
  if (num > 1024) return [];
  const out: string[] = [];
  for (let i = 0; i < num; i++) {
    if (payload.length < offset + 2) return [];
    const nameLen = payload.readUInt16LE(offset);
    offset += 2;
    if (nameLen === 0 || nameLen > 512) return [];
    if (payload.length < offset + nameLen) return [];
    // nameLen includes the trailing null — strip it.
    const trimTo = payload[offset + nameLen - 1] === 0 ? nameLen - 1 : nameLen;
    const name = payload.subarray(offset, offset + trimTo).toString('utf8');
    out.push(name);
    offset += nameLen;
  }
  return out;
}

function sameArray(a: string[], b: string[] | undefined): boolean {
  if (!b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function friendlyConnectError(err: Error): string {
  const msg = err.message ?? String(err);
  if (msg.includes('ECONNREFUSED')) return 'Connection refused — is OpenRGB running with SDK Server enabled?';
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) return 'Cannot resolve host — check the OpenRGB host in Digi Deck config.';
  return msg;
}

let _instance: OpenRgbClient | null = null;
export function getOpenRgb(): OpenRgbClient {
  if (!_instance) {
    _instance = new OpenRgbClient();
    registerIntegration(_instance);
  }
  return _instance;
}

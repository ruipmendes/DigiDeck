import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Mix It Up integration — REST v2 developer API on http://localhost:8911.
 *
 * Mix It Up is a widely-used Windows streamer bot (Twitch / YouTube / Trovo /
 * Kick) with a chat-command graph, timers, currency, counters, event hooks,
 * and overlays. Its Developer API lets external tools trigger any command by
 * UUID, toggle timers/commands, send chat, mutate counters, and read state.
 *
 * By integrating with Mix It Up, Digi Deck becomes a physical control surface
 * for whatever complex action-chains the user has already built inside MIU —
 * no need to re-implement anything MIU already does well (currency, event
 * reactions, overlays, TTS, sound alerts). The wedge is r/mixitup and the MIU
 * Discord: neither Touch Portal nor Stream Deck ship a PWA-based competitor
 * with a first-party MIU integration.
 *
 * Setup:
 *   1. User opens Mix It Up → Services → Developer API → Connect.
 *   2. User enters the same port (default 8911) in Digi Deck's config panel.
 *   3. Digi Deck verifies via GET /api/v2/status/version and enumerates
 *      commands + counters for the editor dropdowns.
 *
 * There is no auth — the API only listens on 127.0.0.1 so exposure is limited
 * to whatever else is running as the local user. Same threat model MIU itself
 * takes; we don't add another lock on top.
 *
 * Live state polls `/status/version` every 10 s (connectivity heartbeat) and
 * `/commands` + `/counters` every 30 s (heavier — command sets can be large
 * so we don't refresh on every tick).
 */

export type PublicMixItUpConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export function publicMixItUpConfig(cfg: MixItUpConfig): PublicMixItUpConfig {
  return {
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
  };
}

export function validateMixItUpConfig(input: unknown, existing: MixItUpConfig): MixItUpConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Mix It Up config');
  const o = input as Record<string, unknown>;
  const port = typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : existing.port;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' && o.host.trim() ? o.host.trim() : existing.host,
    port,
  };
}

export const MIXITUP_MANIFEST: IntegrationManifest = {
  name: 'mixitup',
  displayName: 'Mix It Up',
  actionTypes: ['mixitup'],
  hasOAuth: false,
};

export type MixItUpConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export const DEFAULT_MIXITUP_CONFIG: MixItUpConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 8911,
};

export type MixItUpState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Cut-down command shape — enough for the editor dropdown and the tile-active
 *  state, without carrying MIU's full command graph over the wire. */
export type MixItUpCommand = {
  id: string;
  name: string;
  /** MIU's command type enum ("Chat", "Timer", "Event", "PreMade", …).
   *  We keep the string as-is so the editor can group by type. */
  type?: string;
  /** Optional group name from MIU's command organiser. Undefined = ungrouped. */
  group?: string;
  /** Whether the command is currently enabled. Drives the tile-active state
   *  for enable/disable/toggle-command tiles. */
  enabled?: boolean;
};

export type MixItUpCounter = {
  name: string;
  amount: number;
};

export type MixItUpStatus = {
  state: MixItUpState;
  error?: string;
  host?: string;
  port?: number;
  version?: string;
  commands?: MixItUpCommand[];
  counters?: MixItUpCounter[];
};

export type MixItUpOp =
  | 'run-command'
  | 'enable-command' | 'disable-command' | 'toggle-command'
  | 'chat-message' | 'chat-clear'
  | 'counter-set' | 'counter-update' | 'counter-reset';

export type MixItUpActionParams = {
  /** Command UUID — required for run-command / enable-command / disable-command / toggle-command. */
  commandId?: string;
  /** Optional argument string appended to the run-command call (mimics chat args). */
  arguments?: string;
  /** Bypass MIU's cooldowns / costs / role gates when firing run-command. */
  ignoreRequirements?: boolean;
  /** Chat message text — used by chat-message. Falls back to Action.text when unset
   *  so the existing prompt-at-press plumbing still works. */
  text?: string;
  /** Which platform to route the chat message through. Undefined = all connected platforms. */
  platform?: 'Twitch' | 'YouTube' | 'Trovo' | 'Kick';
  /** Counter name — required for counter-set / counter-update / counter-reset. */
  counterName?: string;
  /** Counter delta or absolute value depending on op. */
  counterValue?: number;
};

const VERSION_POLL_MS = 10_000;
const CATALOG_POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

class MixItUpClient implements IntegrationLifecycle {
  readonly manifest = MIXITUP_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.mixitup); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
  }
  publicConfig(): PublicMixItUpConfig { return publicMixItUpConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): MixItUpStatus {
    let state: MixItUpState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (!this.cfg.host || !this.cfg.port) state = 'not-configured';
    else if (this.err) state = 'error';
    else if (this.connected) state = 'connected';
    else state = 'disconnected';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      host: this.cfg.host || undefined,
      port: this.cfg.port || undefined,
      version: this.version,
      commands: this.commands,
      counters: this.counters,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateMixItUpConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Mix It Up integration not attached');
    this.serverConfig.integrations.mixitup = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled) await this.restart();
    else await this.stop();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.host || !this.cfg.port) return;
    if (this.versionTimer) return;
    await this.probeOnce();
    this.versionTimer = setInterval(() => { void this.probeOnce(); }, VERSION_POLL_MS);
    this.catalogTimer = setInterval(() => { void this.refreshCatalog(); }, CATALOG_POLL_MS);
  }

  async stop(): Promise<void> {
    if (this.versionTimer) { clearInterval(this.versionTimer); this.versionTimer = null; }
    if (this.catalogTimer) { clearInterval(this.catalogTimer); this.catalogTimer = null; }
    this.connected = false;
    this.version = undefined;
    this.commands = undefined;
    this.counters = undefined;
    this.err = undefined;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: MixItUpOp, params: MixItUpActionParams | undefined): Promise<void> {
    if (!this.connected) throw new Error('Mix It Up not connected — enable the Developer API on the Services page and click Connect.');
    switch (op) {
      case 'run-command': {
        const id = requireCommandId(params);
        // Body is optional; MIU accepts an empty POST. We only include a body
        // when there's actually something to send so we don't confuse the API.
        const body: Record<string, unknown> = {};
        if (params?.arguments && params.arguments.trim()) body.Arguments = params.arguments.trim();
        if (params?.ignoreRequirements) body.IgnoreRequirements = true;
        await this.request('POST', `/commands/${encodeURIComponent(id)}`, Object.keys(body).length ? body : undefined);
        return;
      }
      case 'enable-command':
        await this.request('PATCH', `/commands/${encodeURIComponent(requireCommandId(params))}/state/1`);
        this.optimisticSetEnabled(params!.commandId!, true);
        return;
      case 'disable-command':
        await this.request('PATCH', `/commands/${encodeURIComponent(requireCommandId(params))}/state/0`);
        this.optimisticSetEnabled(params!.commandId!, false);
        return;
      case 'toggle-command':
        await this.request('PATCH', `/commands/${encodeURIComponent(requireCommandId(params))}/state/2`);
        // Server flips it — we'll pick up the new state on the next catalog poll,
        // so avoid a wrong-guess optimistic flip here.
        return;
      case 'chat-message': {
        const text = (params?.text ?? '').trim();
        if (!text) throw new Error('Mix It Up chat-message requires text');
        const body: Record<string, unknown> = { Message: text };
        if (params?.platform) body.Platform = params.platform;
        await this.request('POST', '/chat/message', body);
        return;
      }
      case 'chat-clear':
        await this.request('POST', '/chat/clear');
        return;
      case 'counter-set': {
        const name = requireCounterName(params);
        const value = requireCounterValue(params);
        await this.request('POST', `/counters/${encodeURIComponent(name)}/set`, { Amount: value });
        return;
      }
      case 'counter-update': {
        const name = requireCounterName(params);
        const value = requireCounterValue(params);
        await this.request('POST', `/counters/${encodeURIComponent(name)}/update`, { Amount: value });
        return;
      }
      case 'counter-reset':
        await this.request('POST', `/counters/${encodeURIComponent(requireCounterName(params))}/reset`);
        return;
      default:
        throw new Error(`unknown Mix It Up op: ${op as string}`);
    }
  }

  // ─── internal ───────────────────────────────────────────────

  private cfg: MixItUpConfig = { ...DEFAULT_MIXITUP_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private onChangeCb: (() => void) | null = null;
  private connected = false;
  private err: string | undefined;
  private version: string | undefined;
  private commands: MixItUpCommand[] | undefined;
  private counters: MixItUpCounter[] | undefined;
  private versionTimer: NodeJS.Timeout | null = null;
  private catalogTimer: NodeJS.Timeout | null = null;

  setConfig(cfg: MixItUpConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  private emitChange(): void { this.onChangeCb?.(); }

  private baseUrl(): string {
    return `http://${this.cfg.host}:${this.cfg.port}/api/v2`;
  }

  private async probeOnce(): Promise<void> {
    try {
      const v = await this.request<unknown>('GET', '/status/version');
      const nextVersion = extractVersionString(v);
      const wasConnected = this.connected;
      this.connected = true;
      this.err = undefined;
      if (nextVersion && nextVersion !== this.version) this.version = nextVersion;
      // On the first successful probe, kick off a catalog refresh immediately
      // so the editor dropdowns populate without waiting a full 30 s.
      if (!wasConnected) {
        void this.refreshCatalog();
      }
      this.emitChange();
    } catch (err) {
      const wasConnected = this.connected;
      this.connected = false;
      this.err = friendlyError(err as Error);
      if (wasConnected) {
        this.commands = undefined;
        this.counters = undefined;
      }
      this.emitChange();
    }
  }

  private async refreshCatalog(): Promise<void> {
    if (!this.connected) return;
    // Commands: page one, sized generously. MIU returns commands paginated;
    // huge decks may need more than one page but 500 covers the long tail.
    try {
      const raw = await this.request<unknown>('GET', '/commands?skip=0&pageSize=500');
      this.commands = normalizeCommands(raw);
    } catch (err) {
      console.warn(`[mixitup] refresh commands failed: ${(err as Error).message}`);
    }
    try {
      const raw = await this.request<unknown>('GET', '/counters');
      this.counters = normalizeCounters(raw);
    } catch (err) {
      console.warn(`[mixitup] refresh counters failed: ${(err as Error).message}`);
    }
    this.emitChange();
  }

  private optimisticSetEnabled(commandId: string, enabled: boolean): void {
    const c = this.commands?.find((x) => x.id === commandId);
    if (c && c.enabled !== enabled) {
      c.enabled = enabled;
      this.emitChange();
    }
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // MIU returns ProblemDetails on error; surface `detail` when present.
        let msg = `${method} ${path} → ${res.status}`;
        try {
          const problem = await res.json() as { detail?: string; title?: string };
          if (problem.detail) msg = problem.detail;
          else if (problem.title) msg = problem.title;
        } catch { /* body wasn't JSON */ }
        throw new Error(msg);
      }
      // Some endpoints return 204 No Content — don't try to JSON-parse those.
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) return undefined as T;
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function requireCommandId(params: MixItUpActionParams | undefined): string {
  const id = params?.commandId?.trim();
  if (!id) throw new Error('Mix It Up: commandId required');
  return id;
}
function requireCounterName(params: MixItUpActionParams | undefined): string {
  const name = params?.counterName?.trim();
  if (!name) throw new Error('Mix It Up: counterName required');
  return name;
}
function requireCounterValue(params: MixItUpActionParams | undefined): number {
  const v = params?.counterValue;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Mix It Up: counterValue required');
  return v;
}

function extractVersionString(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.version === 'string') return o.version;
    if (typeof o.Version === 'string') return o.Version;
    if (typeof o.value === 'string') return o.value;
  }
  return undefined;
}

/** MIU's commands endpoint has shipped a couple of envelope shapes across
 *  versions — the newer one wraps in `{ Results: [...], Total: N }`, older
 *  clients returned a bare array. Sniff for both. */
function normalizeCommands(raw: unknown): MixItUpCommand[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.Results)) list = o.Results;
    else if (Array.isArray(o.results)) list = o.results;
    else if (Array.isArray(o.commands)) list = o.commands;
  }
  const out: MixItUpCommand[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = pickString(o, ['ID', 'Id', 'id']);
    const name = pickString(o, ['Name', 'name']);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      type: pickString(o, ['Type', 'type']) ?? undefined,
      group: pickString(o, ['GroupName', 'groupName', 'Group', 'group']) ?? undefined,
      enabled: pickBoolean(o, ['IsEnabled', 'Enabled', 'enabled']),
    });
  }
  // Sort: enabled first, then by group, then by name — makes the editor dropdown
  // scannable when a MIU setup has hundreds of commands.
  out.sort((a, b) => {
    const ge = (a.enabled ? 0 : 1) - (b.enabled ? 0 : 1);
    if (ge !== 0) return ge;
    const gc = (a.group ?? '').localeCompare(b.group ?? '');
    if (gc !== 0) return gc;
    return a.name.localeCompare(b.name);
  });
  return out;
}

function normalizeCounters(raw: unknown): MixItUpCounter[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.Results)) list = o.Results;
    else if (Array.isArray(o.counters)) list = o.counters;
  }
  const out: MixItUpCounter[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = pickString(o, ['Name', 'name']);
    const amount = pickNumber(o, ['Amount', 'amount', 'Value', 'value']);
    if (!name) continue;
    out.push({ name, amount: amount ?? 0 });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
function pickBoolean(o: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'boolean') return v;
  }
  return undefined;
}
function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function friendlyError(err: Error): string {
  const msg = err.message ?? String(err);
  if (msg.includes('ECONNREFUSED')) return 'Connection refused — is Mix It Up running with the Developer API enabled?';
  if (msg.includes('AbortError') || msg.includes('aborted')) return 'Mix It Up did not respond in time.';
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) return 'Cannot resolve host — check the Mix It Up host in Digi Deck config.';
  return msg;
}

let _instance: MixItUpClient | null = null;
export function getMixItUp(): MixItUpClient {
  if (!_instance) {
    _instance = new MixItUpClient();
    registerIntegration(_instance);
  }
  return _instance;
}

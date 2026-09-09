import koffi from 'koffi';
import { existsSync } from 'node:fs';
import type { IntegrationsConfig, ServerConfig } from '../config.js';
import { registerIntegration, type IntegrationLifecycle, type IntegrationManifest } from './base.js';

/**
 * Voicemeeter integration — Windows software mixer control via VBVMR C API.
 *
 * Alternative to Elgato Wave Link (which has no accessible IPC on 3.x — see
 * [[digi-deck-wavelink-no-ipc]]). Voicemeeter's Remote API is documented,
 * stable since 2015, and covers the same "two independent mixes" workflow:
 * every input strip has independent routing to A1/A2/A3 (physical outs) and
 * B1/B2/B3 (virtual outs, where OBS captures). So a streamer can send Discord
 * to A1 (headphones) + B1 (stream) but keep the game only on A1, giving them
 * separate stream and monitor mixes from the same source.
 *
 * Transport: `VoicemeeterRemote64.dll` (loaded via koffi FFI) at the standard
 * install path. `VBVMR_Login()` opens the session — succeeds even when
 * Voicemeeter isn't running, so we then poll `GetVoicemeeterType()` until it
 * returns a real type to know when the app is up.
 *
 * Edition detection matters — Voicemeeter Standard (2 hw + 1 vio strips,
 * A/B buses), Banana (3 hw + 2 vio, A1/A2/A3 + B1/B2), Potato (5 hw + 3 vio,
 * A1..A5 + B1..B3). We probe the type on connect and shape the strip / bus /
 * route enumeration accordingly.
 *
 * Parameter model: everything is a named param — `Strip[i].Gain` (dB float),
 * `Strip[i].Mute` (0/1), `Strip[i].A1` (0/1 route toggle), `Bus[i].Gain`,
 * etc. `VBVMR_IsParametersDirty()` returns non-zero when any param changed
 * (from Voicemeeter's own UI, a keybind, another remote, us) — cheap to poll
 * at ~10 Hz, then we re-read the current state.
 */

export type PublicVoicemeeterConfig = {
  enabled: boolean;
};

export function publicVoicemeeterConfig(cfg: VoicemeeterConfig): PublicVoicemeeterConfig {
  return { enabled: cfg.enabled };
}

export function validateVoicemeeterConfig(input: unknown, existing: VoicemeeterConfig): VoicemeeterConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Voicemeeter config');
  const o = input as Record<string, unknown>;
  return { enabled: !!o.enabled };
}

export const VOICEMEETER_MANIFEST: IntegrationManifest = {
  name: 'voicemeeter',
  displayName: 'Voicemeeter',
  actionTypes: ['voicemeeter'],
  hasOAuth: false,
};

export type VoicemeeterConfig = {
  enabled: boolean;
};

export const DEFAULT_VOICEMEETER_CONFIG: VoicemeeterConfig = {
  enabled: false,
};

export type VoicemeeterState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

/** Editions differ in strip / bus counts and available routes. */
export type VoicemeeterEdition = 'standard' | 'banana' | 'potato';

export type VoicemeeterRoute = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B1' | 'B2' | 'B3';

/** Cut-down strip shape sent to the client — enough to drive tile state +
 *  editor dropdowns without carrying every raw parameter. */
export type VoicemeeterStrip = {
  index: number;
  label: string;
  /** Gain in dB (-60..12). */
  gain: number;
  mute: boolean;
  solo: boolean;
  /** True for hardware inputs (mic, line-in). False for virtual inputs (VAIO / AUX). */
  physical: boolean;
  /** Route flags — undefined for routes not available in this edition. */
  routes: Partial<Record<VoicemeeterRoute, boolean>>;
};

export type VoicemeeterBus = {
  index: number;
  label: string;
  gain: number;
  mute: boolean;
  /** A/B/A1/A2/... — human-facing bus label ("A1", "B2"). */
  kind: VoicemeeterRoute;
};

export type VoicemeeterStatus = {
  state: VoicemeeterState;
  error?: string;
  edition?: VoicemeeterEdition;
  version?: string;
  strips?: VoicemeeterStrip[];
  buses?: VoicemeeterBus[];
};

export type VoicemeeterOp =
  | 'strip-mute-toggle' | 'strip-mute' | 'strip-unmute'
  | 'strip-solo-toggle'
  | 'strip-route-toggle' | 'strip-route-on' | 'strip-route-off'
  | 'bus-mute-toggle' | 'bus-mute' | 'bus-unmute'
  | 'restart-audio-engine';

export type VoicemeeterActionParams = {
  /** 0-based strip index, or 0-based bus index depending on op. */
  index?: number;
  /** Which route the op targets — for strip-route-*. */
  route?: VoicemeeterRoute;
};

// Edition specs — physical strip counts, bus counts, available routes.
// These match Voicemeeter's own layout: physical strips come first, then
// virtual (SW / VAIO / VAIO3). Buses A come first, then B.
const EDITION_SPECS: Record<VoicemeeterEdition, {
  strips: number;
  physicalStrips: number;
  buses: number;
  busKinds: VoicemeeterRoute[];
  routes: VoicemeeterRoute[];
}> = {
  standard: {
    strips: 3, physicalStrips: 2, buses: 2,
    busKinds: ['A1', 'B1'],
    routes: ['A1', 'B1'],
  },
  banana: {
    strips: 5, physicalStrips: 3, buses: 5,
    busKinds: ['A1', 'A2', 'A3', 'B1', 'B2'],
    routes: ['A1', 'A2', 'A3', 'B1', 'B2'],
  },
  potato: {
    strips: 8, physicalStrips: 5, buses: 8,
    busKinds: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'],
    routes: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3'],
  },
};

const POLL_INTERVAL_MS = 100;
const CONNECT_POLL_MS = 2_000;

// Standard Voicemeeter install paths. If the DLL isn't at one of these,
// the integration reports "not installed" — a registry probe fallback is
// possible but overkill until someone reports a custom install.
const DLL_PATHS = [
  'C:\\Program Files (x86)\\VB\\Voicemeeter\\VoicemeeterRemote64.dll',
  'C:\\Program Files\\VB\\Voicemeeter\\VoicemeeterRemote64.dll',
];

// ─── DLL bindings ───────────────────────────────────────────────

type VbvmrLib = {
  Login: () => number;
  Logout: () => number;
  RunVoicemeeter: (type: number) => number;
  GetVoicemeeterType: (out: number[]) => number;
  GetVoicemeeterVersion: (out: number[]) => number;
  IsParametersDirty: () => number;
  GetParameterFloat: (name: string, out: number[]) => number;
  GetParameterStringA: (name: string, out: Buffer) => number;
  SetParameterFloat: (name: string, value: number) => number;
  SetParameterStringA: (name: string, value: string) => number;
};

let _lib: VbvmrLib | null = null;
let _libError: string | null = null;

function loadLib(): { lib: VbvmrLib | null; error: string | null } {
  if (_lib) return { lib: _lib, error: null };
  if (_libError) return { lib: null, error: _libError };

  const dllPath = DLL_PATHS.find(existsSync);
  if (!dllPath) {
    _libError = 'VoicemeeterRemote64.dll not found — install Voicemeeter (Standard, Banana or Potato) from vb-audio.com.';
    return { lib: null, error: _libError };
  }

  try {
    const dll = koffi.load(dllPath);
    // Note the `_Out_` markers on pointer params — koffi allocates a native
    // slot and pipes the value back through the JS array we pass in ([0])
    // on return. Cleaner than manual Buffer.alloc + readFloatLE bookkeeping.
    _lib = {
      Login: dll.func('long VBVMR_Login()'),
      Logout: dll.func('long VBVMR_Logout()'),
      RunVoicemeeter: dll.func('long VBVMR_RunVoicemeeter(long)'),
      GetVoicemeeterType: dll.func('long VBVMR_GetVoicemeeterType(_Out_ long *)'),
      GetVoicemeeterVersion: dll.func('long VBVMR_GetVoicemeeterVersion(_Out_ long *)'),
      IsParametersDirty: dll.func('long VBVMR_IsParametersDirty()'),
      GetParameterFloat: dll.func('long VBVMR_GetParameterFloat(str, _Out_ float *)'),
      GetParameterStringA: dll.func('long VBVMR_GetParameterStringA(str, _Out_ char *)'),
      SetParameterFloat: dll.func('long VBVMR_SetParameterFloat(str, float)'),
      SetParameterStringA: dll.func('long VBVMR_SetParameterStringA(str, str)'),
    };
    return { lib: _lib, error: null };
  } catch (err) {
    _libError = `failed to load Voicemeeter DLL: ${(err as Error).message}`;
    return { lib: null, error: _libError };
  }
}

// ─── Helpers on top of the raw API ──────────────────────────────

function editionFromType(type: number): VoicemeeterEdition | null {
  switch (type) {
    case 1: return 'standard';
    case 2: return 'banana';
    case 3: return 'potato';
    default: return null;
  }
}

/** Decode Voicemeeter's packed version int (major.minor.patch.build). */
function decodeVersion(v: number): string {
  const major = (v >> 24) & 0xff;
  const minor = (v >> 16) & 0xff;
  const patch = (v >> 8) & 0xff;
  const build = v & 0xff;
  return `${major}.${minor}.${patch}.${build}`;
}

function readParamFloat(lib: VbvmrLib, name: string): number | undefined {
  const out = [0];
  const rc = lib.GetParameterFloat(name, out);
  if (rc !== 0) return undefined;
  return out[0];
}

function readParamString(lib: VbvmrLib, name: string): string | undefined {
  const buf = Buffer.alloc(512);
  const rc = lib.GetParameterStringA(name, buf);
  if (rc !== 0) return undefined;
  const end = buf.indexOf(0);
  return buf.toString('utf8', 0, end < 0 ? buf.length : end);
}

// ─── Client ─────────────────────────────────────────────────────

class VoicemeeterClient implements IntegrationLifecycle {
  readonly manifest = VOICEMEETER_MANIFEST;
  isEnabled(): boolean { return this.cfg.enabled; }
  applyConfig(all: IntegrationsConfig): void { this.setConfig(all.voicemeeter); }
  attach(config: ServerConfig, save: () => Promise<void>): void {
    this.serverConfig = config;
    this.saveFn = save;
  }
  publicConfig(): PublicVoicemeeterConfig { return publicVoicemeeterConfig(this.cfg); }
  onChange(cb: () => void): void { this.onChangeCb = cb; }

  status(): VoicemeeterStatus {
    let state: VoicemeeterState;
    if (!this.cfg.enabled) state = 'disabled';
    else if (this.err) state = 'error';
    else if (this.connected) state = 'connected';
    else if (this.loggedIn) state = 'connecting';
    else state = 'disconnected';
    return {
      state,
      error: state === 'error' ? this.err : undefined,
      edition: this.edition,
      version: this.version,
      strips: this.strips,
      buses: this.buses,
    };
  }

  async applyConfigUpdate(input: unknown): Promise<void> {
    const validated = validateVoicemeeterConfig(input, this.cfg);
    if (!this.serverConfig || !this.saveFn) throw new Error('Voicemeeter integration not attached');
    this.serverConfig.integrations.voicemeeter = validated;
    await this.saveFn();
    this.setConfig(validated);
    if (validated.enabled) await this.restart();
    else await this.stop();
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.loggedIn) return;
    const { lib, error } = loadLib();
    if (!lib) {
      this.err = error ?? 'unknown DLL load failure';
      this.emitChange();
      return;
    }
    const rc = lib.Login();
    // rc = 0 (OK) or 1 (already logged in) both mean success.
    if (rc < 0) {
      this.err = `VBVMR_Login failed (rc=${rc})`;
      this.emitChange();
      return;
    }
    this.loggedIn = true;
    this.err = undefined;
    this.emitChange();

    // Wait for Voicemeeter's own app to be running — Login succeeds even
    // when it isn't. This poll flips connected=true the moment the type
    // read succeeds.
    this.connectTimer = setInterval(() => this.tryConnect(), CONNECT_POLL_MS);
    this.tryConnect();
  }

  async stop(): Promise<void> {
    if (this.connectTimer) { clearInterval(this.connectTimer); this.connectTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.loggedIn) {
      const { lib } = loadLib();
      try { lib?.Logout(); } catch { /* best effort */ }
    }
    this.loggedIn = false;
    this.connected = false;
    this.edition = undefined;
    this.version = undefined;
    this.strips = undefined;
    this.buses = undefined;
    this.err = undefined;
    this.emitChange();
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async execute(op: VoicemeeterOp, params: VoicemeeterActionParams | undefined): Promise<void> {
    if (!this.connected) throw new Error('Voicemeeter not connected — open the Voicemeeter app first.');
    const { lib } = loadLib();
    if (!lib) throw new Error('Voicemeeter DLL not loaded');
    switch (op) {
      case 'strip-mute-toggle': {
        const idx = requireStripIndex(params, this.edition);
        const cur = readParamFloat(lib, `Strip[${idx}].Mute`) ?? 0;
        this.setParam(`Strip[${idx}].Mute`, cur > 0.5 ? 0 : 1);
        return;
      }
      case 'strip-mute': {
        const idx = requireStripIndex(params, this.edition);
        this.setParam(`Strip[${idx}].Mute`, 1);
        return;
      }
      case 'strip-unmute': {
        const idx = requireStripIndex(params, this.edition);
        this.setParam(`Strip[${idx}].Mute`, 0);
        return;
      }
      case 'strip-solo-toggle': {
        const idx = requireStripIndex(params, this.edition);
        const cur = readParamFloat(lib, `Strip[${idx}].Solo`) ?? 0;
        this.setParam(`Strip[${idx}].Solo`, cur > 0.5 ? 0 : 1);
        return;
      }
      case 'strip-route-toggle': {
        const idx = requireStripIndex(params, this.edition);
        const route = requireRoute(params, this.edition);
        const cur = readParamFloat(lib, `Strip[${idx}].${route}`) ?? 0;
        this.setParam(`Strip[${idx}].${route}`, cur > 0.5 ? 0 : 1);
        return;
      }
      case 'strip-route-on': {
        const idx = requireStripIndex(params, this.edition);
        const route = requireRoute(params, this.edition);
        this.setParam(`Strip[${idx}].${route}`, 1);
        return;
      }
      case 'strip-route-off': {
        const idx = requireStripIndex(params, this.edition);
        const route = requireRoute(params, this.edition);
        this.setParam(`Strip[${idx}].${route}`, 0);
        return;
      }
      case 'bus-mute-toggle': {
        const idx = requireBusIndex(params, this.edition);
        const cur = readParamFloat(lib, `Bus[${idx}].Mute`) ?? 0;
        this.setParam(`Bus[${idx}].Mute`, cur > 0.5 ? 0 : 1);
        return;
      }
      case 'bus-mute': {
        const idx = requireBusIndex(params, this.edition);
        this.setParam(`Bus[${idx}].Mute`, 1);
        return;
      }
      case 'bus-unmute': {
        const idx = requireBusIndex(params, this.edition);
        this.setParam(`Bus[${idx}].Mute`, 0);
        return;
      }
      case 'restart-audio-engine':
        this.setParam('Command.Restart', 1);
        return;
      default:
        throw new Error(`unknown Voicemeeter op: ${op as string}`);
    }
  }

  /** Slider drives a strip's or bus's gain. inputName encodes
   *  `strip:<idx>` or `bus:<idx>`. Value 0..1 → dB -60..+12 linear. */
  async setSliderValue(inputName: string, value: number): Promise<void> {
    if (!this.connected) throw new Error('Voicemeeter not connected');
    const { kind, index } = this.splitInputName(inputName);
    const db = value * 72 - 60;
    this.setParam(`${kind === 'strip' ? 'Strip' : 'Bus'}[${index}].Gain`, db);
  }

  /** Tap on a slider toggles the target's mute. */
  async toggleSliderMute(inputName: string): Promise<void> {
    if (!this.connected) throw new Error('Voicemeeter not connected');
    const { kind, index } = this.splitInputName(inputName);
    const { lib } = loadLib();
    if (!lib) throw new Error('Voicemeeter DLL not loaded');
    const cur = readParamFloat(lib, `${kind === 'strip' ? 'Strip' : 'Bus'}[${index}].Mute`) ?? 0;
    this.setParam(`${kind === 'strip' ? 'Strip' : 'Bus'}[${index}].Mute`, cur > 0.5 ? 0 : 1);
  }

  // ─── internals ────────────────────────────────────────────

  private cfg: VoicemeeterConfig = { ...DEFAULT_VOICEMEETER_CONFIG };
  private serverConfig: ServerConfig | undefined;
  private saveFn: (() => Promise<void>) | undefined;
  private onChangeCb: (() => void) | null = null;
  private loggedIn = false;
  private connected = false;
  private edition: VoicemeeterEdition | undefined;
  private version: string | undefined;
  private strips: VoicemeeterStrip[] | undefined;
  private buses: VoicemeeterBus[] | undefined;
  private err: string | undefined;
  private connectTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  private setConfig(cfg: VoicemeeterConfig): void { this.cfg = { ...cfg }; this.emitChange(); }
  private emitChange(): void { this.onChangeCb?.(); }

  private tryConnect(): void {
    const { lib } = loadLib();
    if (!lib) return;
    const typeOut = [0];
    const rc = lib.GetVoicemeeterType(typeOut);
    if (rc !== 0) return; // Voicemeeter isn't running yet
    const edition = editionFromType(typeOut[0]);
    if (!edition) return;
    this.edition = edition;
    // Version read is best-effort — a missing version doesn't stop us.
    const verOut = [0];
    if (lib.GetVoicemeeterVersion(verOut) === 0) this.version = decodeVersion(verOut[0]);
    this.connected = true;
    if (this.connectTimer) { clearInterval(this.connectTimer); this.connectTimer = null; }
    // First read + start the dirty-poll loop. IsParametersDirty is cheap so
    // 100 ms cadence catches nearly-live updates without measurable overhead.
    this.refreshAll();
    this.pollTimer = setInterval(() => this.pollDirty(), POLL_INTERVAL_MS);
    this.emitChange();
  }

  private pollDirty(): void {
    const { lib } = loadLib();
    if (!lib) return;
    // First call after Login always returns 1 (initialization signal) —
    // subsequent calls return >0 only when something actually changed.
    if (lib.IsParametersDirty() <= 0) return;
    this.refreshAll();
  }

  private refreshAll(): void {
    const { lib } = loadLib();
    if (!lib || !this.edition) return;
    const spec = EDITION_SPECS[this.edition];
    const strips: VoicemeeterStrip[] = [];
    for (let i = 0; i < spec.strips; i++) {
      const label = readParamString(lib, `Strip[${i}].Label`) ?? `Strip ${i + 1}`;
      const gain = readParamFloat(lib, `Strip[${i}].Gain`) ?? 0;
      const mute = (readParamFloat(lib, `Strip[${i}].Mute`) ?? 0) > 0.5;
      const solo = (readParamFloat(lib, `Strip[${i}].Solo`) ?? 0) > 0.5;
      const routes: Partial<Record<VoicemeeterRoute, boolean>> = {};
      for (const r of spec.routes) {
        routes[r] = (readParamFloat(lib, `Strip[${i}].${r}`) ?? 0) > 0.5;
      }
      strips.push({
        index: i,
        label: label.trim() || `Strip ${i + 1}`,
        gain, mute, solo,
        physical: i < spec.physicalStrips,
        routes,
      });
    }
    const buses: VoicemeeterBus[] = [];
    for (let i = 0; i < spec.buses; i++) {
      const label = readParamString(lib, `Bus[${i}].Label`) ?? `Bus ${spec.busKinds[i]}`;
      const gain = readParamFloat(lib, `Bus[${i}].Gain`) ?? 0;
      const mute = (readParamFloat(lib, `Bus[${i}].Mute`) ?? 0) > 0.5;
      buses.push({
        index: i,
        label: label.trim() || `Bus ${spec.busKinds[i]}`,
        gain, mute,
        kind: spec.busKinds[i],
      });
    }
    this.strips = strips;
    this.buses = buses;
    this.emitChange();
  }

  private setParam(name: string, value: number): void {
    const { lib } = loadLib();
    if (!lib) return;
    const rc = lib.SetParameterFloat(name, value);
    if (rc !== 0) {
      console.warn(`[voicemeeter] set ${name}=${value} failed (rc=${rc})`);
    }
    // Optimistically bump the local cache — the next dirty-poll will confirm.
    this.applyOptimistic(name, value);
  }

  /** Update the local strip/bus cache to reflect a parameter we just wrote
   *  so the UI doesn't have to wait a poll tick for the change to appear.
   *  Anything we don't recognise stays stale until the next full refresh. */
  private applyOptimistic(name: string, value: number): void {
    const m = /^(Strip|Bus)\[(\d+)\]\.(.+)$/.exec(name);
    if (!m) return;
    const kind = m[1];
    const idx = Number(m[2]);
    const field = m[3];
    if (kind === 'Strip') {
      const strip = this.strips?.find((s) => s.index === idx);
      if (!strip) return;
      if (field === 'Gain') strip.gain = value;
      else if (field === 'Mute') strip.mute = value > 0.5;
      else if (field === 'Solo') strip.solo = value > 0.5;
      else if (['A1','A2','A3','A4','A5','B1','B2','B3'].includes(field)) {
        strip.routes[field as VoicemeeterRoute] = value > 0.5;
      }
    } else if (kind === 'Bus') {
      const bus = this.buses?.find((b) => b.index === idx);
      if (!bus) return;
      if (field === 'Gain') bus.gain = value;
      else if (field === 'Mute') bus.mute = value > 0.5;
    }
    this.emitChange();
  }

  private splitInputName(inputName: string): { kind: 'strip' | 'bus'; index: number } {
    const idx = inputName.indexOf(':');
    if (idx <= 0) throw new Error('Voicemeeter slider inputName must be "strip:<idx>" or "bus:<idx>"');
    const kind = inputName.slice(0, idx);
    if (kind !== 'strip' && kind !== 'bus') {
      throw new Error(`Voicemeeter slider kind "${kind}" invalid (use "strip" or "bus")`);
    }
    const n = Number(inputName.slice(idx + 1));
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Voicemeeter slider index "${inputName.slice(idx + 1)}" must be a non-negative integer`);
    }
    return { kind, index: n };
  }
}

function requireStripIndex(params: VoicemeeterActionParams | undefined, edition: VoicemeeterEdition | undefined): number {
  const idx = params?.index;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) throw new Error('Voicemeeter: strip index required');
  const spec = edition ? EDITION_SPECS[edition] : null;
  if (spec && idx >= spec.strips) throw new Error(`Voicemeeter ${edition} has ${spec.strips} strips; got index ${idx}`);
  return idx;
}
function requireBusIndex(params: VoicemeeterActionParams | undefined, edition: VoicemeeterEdition | undefined): number {
  const idx = params?.index;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) throw new Error('Voicemeeter: bus index required');
  const spec = edition ? EDITION_SPECS[edition] : null;
  if (spec && idx >= spec.buses) throw new Error(`Voicemeeter ${edition} has ${spec.buses} buses; got index ${idx}`);
  return idx;
}
function requireRoute(params: VoicemeeterActionParams | undefined, edition: VoicemeeterEdition | undefined): VoicemeeterRoute {
  const route = params?.route;
  if (!route) throw new Error('Voicemeeter: route required (e.g. A1, B1)');
  const spec = edition ? EDITION_SPECS[edition] : null;
  if (spec && !(spec.routes as readonly string[]).includes(route)) {
    throw new Error(`Voicemeeter ${edition} has no route ${route}`);
  }
  return route;
}

let _instance: VoicemeeterClient | null = null;
export function getVoicemeeter(): VoicemeeterClient {
  if (!_instance) {
    _instance = new VoicemeeterClient();
    registerIntegration(_instance);
  }
  return _instance;
}

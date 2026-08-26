import { spawn } from 'node:child_process';

/**
 * Per-app audio control — mute / volume for a specific running program
 * (Discord, Spotify, Chrome, …) instead of the whole system mixer.
 *
 * Uses Windows Core Audio's IAudioSessionManager2 via a PowerShell shim with
 * inline C# — same shape as `mic.ts` but scoped to the default *render*
 * endpoint's session list. Session process ids come from
 * IAudioSessionControl2::GetProcessId(); process names come from
 * System.Diagnostics.Process.GetProcessById(pid).ProcessName.
 *
 * Actions match by app name (case-insensitive, "discord" also matches
 * "Discord.exe"). Multiple sessions for the same app (three Chrome tabs, two
 * VLC instances) all get the mute/volume applied — that matches user intent
 * for "mute Discord" and dodges the ambiguity of picking one session at random.
 *
 * Discovery: sessions are polled every 4 s while the app is running so the
 * editor's app-name dropdown reflects the live list. The poll is skipped
 * entirely until someone actually opens the picker to keep idle cost at zero.
 */

export type AppAudioOp = 'toggle-mute' | 'mute' | 'unmute' | 'set-volume';

export type AppAudioActionParams = {
  /** Case-insensitive process name — matches "Discord", "discord.exe", "DISCORD" equally. */
  appName?: string;
  /** For `set-volume`: 0..100 (percent). */
  volumePercent?: number;
};

export type AppAudioSession = {
  /** ProcessName from System.Diagnostics.Process, without the .exe suffix. */
  name: string;
  /** All process ids currently emitting audio under this name. */
  pids: number[];
  /** Scalar 0..1 — average across sessions when there are several. */
  volume: number;
  /** True if all sessions are muted. */
  muted: boolean;
};

const POLL_INTERVAL_MS = 4_000;

/**
 * PowerShell that defines a `[SessionCtl]` static class over
 * IAudioSessionManager2 and dispatches on the first line arg.
 *
 * Kept in a single Add-Type block so a fresh PS process boots the whole
 * surface with one JIT compile.
 */
const APP_AUDIO_TYPE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice2 {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams,
               [MarshalAs(UnmanagedType.IUnknown)] out object endpointVolume);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator2 {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice2 endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject2 { }

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 {
  int NotImpl1();
  int NotImpl2();
  int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator {
  int GetCount(out int sessionCount);
  int GetSession(int sessionCount, out IAudioSessionControl session);
}

[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl {
  int NotImpl1();
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName();
  int GetIconPath();
  int SetIconPath();
  int GetGroupingParam();
  int SetGroupingParam();
  int RegisterAudioSessionNotification();
  int UnregisterAudioSessionNotification();
}

[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 {
  // Inherited IAudioSessionControl methods first (COM vtable order)
  int NotImpl0();
  int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName();
  int GetIconPath();
  int SetIconPath();
  int GetGroupingParam();
  int SetGroupingParam();
  int RegisterAudioSessionNotification();
  int UnregisterAudioSessionNotification();
  // IAudioSessionControl2 additions
  int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
  int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string retVal);
  int GetProcessId(out uint retVal);
  int IsSystemSoundsSession();
  int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float fLevel, Guid pguidEventContext);
  int GetMasterVolume(out float pfLevel);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

public struct SessionInfo {
  public uint pid;
  public string name;
  public float volume;
  public bool mute;
}

public static class SessionCtl {
  static IAudioSessionManager2 Manager() {
    var enumerator = new MMDeviceEnumeratorComObject2() as IMMDeviceEnumerator2;
    IMMDevice2 dev = null;
    // dataFlow=0 (eRender), role=1 (eMultimedia)
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    Guid iid = typeof(IAudioSessionManager2).GUID;
    object o;
    // CLSCTX_ALL = 23
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioSessionManager2)o;
  }

  public static List<SessionInfo> List() {
    var result = new List<SessionInfo>();
    IAudioSessionEnumerator en;
    Marshal.ThrowExceptionForHR(Manager().GetSessionEnumerator(out en));
    int count;
    Marshal.ThrowExceptionForHR(en.GetCount(out count));
    for (int i = 0; i < count; i++) {
      IAudioSessionControl ctl;
      if (en.GetSession(i, out ctl) != 0 || ctl == null) continue;
      var ctl2 = ctl as IAudioSessionControl2;
      var vol = ctl as ISimpleAudioVolume;
      if (ctl2 == null || vol == null) continue;
      uint pid;
      if (ctl2.GetProcessId(out pid) != 0 || pid == 0) continue;
      string name;
      try {
        var p = System.Diagnostics.Process.GetProcessById((int)pid);
        name = p.ProcessName;
      } catch {
        continue; // process died between enumeration and lookup
      }
      float v; bool m;
      if (vol.GetMasterVolume(out v) != 0) v = 0f;
      if (vol.GetMute(out m) != 0) m = false;
      result.Add(new SessionInfo { pid = pid, name = name, volume = v, mute = m });
    }
    return result;
  }

  public static int SetVolumeByName(string appName, float level) {
    int applied = 0;
    IAudioSessionEnumerator en;
    Marshal.ThrowExceptionForHR(Manager().GetSessionEnumerator(out en));
    int count;
    Marshal.ThrowExceptionForHR(en.GetCount(out count));
    for (int i = 0; i < count; i++) {
      IAudioSessionControl ctl;
      if (en.GetSession(i, out ctl) != 0 || ctl == null) continue;
      var ctl2 = ctl as IAudioSessionControl2;
      var vol = ctl as ISimpleAudioVolume;
      if (ctl2 == null || vol == null) continue;
      uint pid;
      if (ctl2.GetProcessId(out pid) != 0 || pid == 0) continue;
      string name;
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
      catch { continue; }
      if (!string.Equals(name, appName, StringComparison.OrdinalIgnoreCase)) continue;
      if (vol.SetMasterVolume(level, Guid.Empty) == 0) applied++;
    }
    return applied;
  }

  public static int SetMuteByName(string appName, bool mute) {
    int applied = 0;
    IAudioSessionEnumerator en;
    Marshal.ThrowExceptionForHR(Manager().GetSessionEnumerator(out en));
    int count;
    Marshal.ThrowExceptionForHR(en.GetCount(out count));
    for (int i = 0; i < count; i++) {
      IAudioSessionControl ctl;
      if (en.GetSession(i, out ctl) != 0 || ctl == null) continue;
      var ctl2 = ctl as IAudioSessionControl2;
      var vol = ctl as ISimpleAudioVolume;
      if (ctl2 == null || vol == null) continue;
      uint pid;
      if (ctl2.GetProcessId(out pid) != 0 || pid == 0) continue;
      string name;
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
      catch { continue; }
      if (!string.Equals(name, appName, StringComparison.OrdinalIgnoreCase)) continue;
      if (vol.SetMute(mute, Guid.Empty) == 0) applied++;
    }
    return applied;
  }

  public static int ToggleMuteByName(string appName) {
    // Decide the target state from the FIRST matching session — otherwise a
    // per-session flip could split a two-instance app into "one muted, one not".
    bool? currentMute = null;
    IAudioSessionEnumerator en;
    Marshal.ThrowExceptionForHR(Manager().GetSessionEnumerator(out en));
    int count;
    Marshal.ThrowExceptionForHR(en.GetCount(out count));
    for (int i = 0; i < count && currentMute == null; i++) {
      IAudioSessionControl ctl;
      if (en.GetSession(i, out ctl) != 0 || ctl == null) continue;
      var ctl2 = ctl as IAudioSessionControl2;
      var vol = ctl as ISimpleAudioVolume;
      if (ctl2 == null || vol == null) continue;
      uint pid;
      if (ctl2.GetProcessId(out pid) != 0 || pid == 0) continue;
      string name;
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; }
      catch { continue; }
      if (!string.Equals(name, appName, StringComparison.OrdinalIgnoreCase)) continue;
      bool m; if (vol.GetMute(out m) == 0) currentMute = m;
    }
    if (currentMute == null) return 0;
    return SetMuteByName(appName, !currentMute.Value);
  }
}
'@
`;

class AppAudioController {
  private sessions: AppAudioSession[] = [];
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private onChangeCb: (() => void) | null = null;
  /** Refcount of clients (config UI, phone) that want the session list live.
   *  Zero → poll disabled; going 1 → immediate poll + start timer. */
  private subscribers = 0;

  getSessions(): AppAudioSession[] { return this.sessions; }

  onChange(cb: () => void): void { this.onChangeCb = cb; }

  /** Called when the app-audio picker opens on the config UI (or the phone
   *  needs live volume state for a slider tile). Multiple subscribes are fine —
   *  they all release together when subscriberCount drops to zero. */
  subscribe(): () => void {
    this.subscribers++;
    if (this.subscribers === 1) this.start();
    return () => {
      this.subscribers = Math.max(0, this.subscribers - 1);
      if (this.subscribers === 0) this.stop();
    };
  }

  /** Force an immediate refresh — useful right after an execute() call so the
   *  slider tile snaps to the new value without a poll delay. */
  refresh(): void { void this.poll(); }

  /** Await one fresh poll and return the resulting session list. Used by the
   *  session-list HTTP endpoint so the first caller (cold start) doesn't get
   *  an empty array before the initial poll completes. */
  async listNow(): Promise<AppAudioSession[]> {
    await this.poll();
    return this.sessions;
  }

  async execute(op: AppAudioOp, params: AppAudioActionParams | undefined): Promise<void> {
    const appName = (params?.appName ?? '').trim();
    if (!appName) throw new Error('app-audio: missing appName');

    let stmt: string;
    switch (op) {
      case 'toggle-mute':
        stmt = `[SessionCtl]::ToggleMuteByName('${escapePs(appName)}')`;
        break;
      case 'mute':
        stmt = `[SessionCtl]::SetMuteByName('${escapePs(appName)}', $true)`;
        break;
      case 'unmute':
        stmt = `[SessionCtl]::SetMuteByName('${escapePs(appName)}', $false)`;
        break;
      case 'set-volume': {
        const pct = clamp01Pct(params?.volumePercent);
        stmt = `[SessionCtl]::SetVolumeByName('${escapePs(appName)}', ${(pct / 100).toFixed(4)})`;
        break;
      }
      default:
        throw new Error(`app-audio: unknown op ${op as string}`);
    }
    const script = `${APP_AUDIO_TYPE_SCRIPT}\n$applied = ${stmt}\nWrite-Output $applied`;
    const out = (await runPs(script)).trim();
    const applied = Number.parseInt(out, 10) || 0;
    if (applied === 0) {
      throw new Error(`No running audio session named "${appName}". Start the app first (Digi Deck matches process names — e.g. "Discord", "Spotify").`);
    }
    // Fire an immediate poll so any slider tile driving the same app snaps to
    // the new value on its next state broadcast (~150 ms).
    this.refresh();
  }

  /** Set volume 0..1 — used by the slider protocol. */
  async setVolume(appName: string, value: number): Promise<void> {
    await this.execute('set-volume', { appName, volumePercent: value * 100 });
  }

  /** Toggle mute — used by the slider tile's tap gesture. */
  async toggleMute(appName: string): Promise<void> {
    await this.execute('toggle-mute', { appName });
  }

  private start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const script = `${APP_AUDIO_TYPE_SCRIPT}\n[SessionCtl]::List() | ConvertTo-Json -Compress`;
      const out = (await runPs(script)).trim();
      const parsed = parseSessionsJson(out);
      const merged = mergeByName(parsed);
      if (!sameSessions(merged, this.sessions)) {
        this.sessions = merged;
        this.emitChange();
      }
    } catch (err) {
      console.warn(`[app-audio] poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  private emitChange(): void { this.onChangeCb?.(); }
}

/** Multiple sessions with the same ProcessName (three Chrome tabs, two VLC
 *  windows) collapse to a single entry — same intent as SetVolumeByName /
 *  SetMuteByName, which apply to every matching session. */
function mergeByName(raw: Array<{ pid: number; name: string; volume: number; mute: boolean }>): AppAudioSession[] {
  const byName = new Map<string, { pids: number[]; volumes: number[]; mutes: boolean[] }>();
  for (const s of raw) {
    if (!s.name) continue;
    const entry = byName.get(s.name) ?? { pids: [], volumes: [], mutes: [] };
    entry.pids.push(s.pid);
    entry.volumes.push(Math.max(0, Math.min(1, s.volume)));
    entry.mutes.push(!!s.mute);
    byName.set(s.name, entry);
  }
  const out: AppAudioSession[] = [];
  for (const [name, e] of byName) {
    const volume = e.volumes.reduce((a, b) => a + b, 0) / e.volumes.length;
    const muted = e.mutes.every((m) => m);
    out.push({ name, pids: [...e.pids].sort((a, b) => a - b), volume, muted });
  }
  // Stable ordering — friendlier for the UI diff and the phone slider list.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function sameSessions(a: AppAudioSession[], b: AppAudioSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name) return false;
    if (a[i].muted !== b[i].muted) return false;
    if (Math.abs(a[i].volume - b[i].volume) > 0.005) return false;
    if (a[i].pids.length !== b[i].pids.length) return false;
    for (let j = 0; j < a[i].pids.length; j++) if (a[i].pids[j] !== b[i].pids[j]) return false;
  }
  return true;
}

/** `ConvertTo-Json` returns either an array or, for a single element, a single
 *  object. Normalize to always be an array. */
function parseSessionsJson(text: string): Array<{ pid: number; name: string; volume: number; mute: boolean }> {
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const out: Array<{ pid: number; name: string; volume: number; mute: boolean }> = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.pid !== 'number' || typeof o.name !== 'string') continue;
    out.push({
      pid: o.pid,
      name: o.name,
      volume: typeof o.volume === 'number' ? o.volume : 0,
      mute: !!o.mute,
    });
  }
  return out;
}

function clamp01Pct(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return 50;
  return Math.max(0, Math.min(100, v));
}

/** PowerShell single-quoted strings escape a single-quote by doubling it. No
 *  other characters need escaping — everything else is literal. */
function escapePs(s: string): string {
  return s.replace(/'/g, "''");
}

async function runPs(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`PowerShell failed (exit ${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

let _instance: AppAudioController | null = null;
export function getAppAudio(): AppAudioController {
  if (!_instance) _instance = new AppAudioController();
  return _instance;
}

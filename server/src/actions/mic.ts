import { spawn } from 'node:child_process';

export type MicOp = 'toggle-mute' | 'mute' | 'unmute';

/**
 * PowerShell + .NET COM definition for the Windows Core Audio API.
 * Defines `[Audio]::Mute` getter/setter against the default capture device.
 *
 * We compile this on every spawned PS process via Add-Type (~200–300 ms each).
 * Acceptable for now; could be optimized later with a long-lived host process.
 */
const AUDIO_TYPE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify();
  int UnregisterControlChangeNotify();
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel();
  int SetChannelVolumeLevelScalar();
  int GetChannelVolumeLevel();
  int GetChannelVolumeLevelScalar();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
  int GetVolumeStepInfo();
  int VolumeStepUp();
  int VolumeStepDown();
  int QueryHardwareSupport();
  int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, IntPtr activationParams,
               [MarshalAs(UnmanagedType.IUnknown)] out object endpointVolume);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public static class Audio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    // dataFlow=1 (eCapture), role=1 (eMultimedia)
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(1, 1, out dev));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    // CLSCTX_ALL = 23
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
  }
}
'@
`;

const POLL_INTERVAL_MS = 10_000;

class MicController {
  private muted: boolean | undefined;
  private available = true;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private onChangeCb: (() => void) | null = null;

  isMuted(): boolean | undefined { return this.muted; }
  isAvailable(): boolean { return this.available; }

  onChange(cb: () => void): void { this.onChangeCb = cb; }

  async execute(op: MicOp): Promise<void> {
    const setStmt =
      op === 'toggle-mute' ? '[Audio]::Mute = ![Audio]::Mute'
      : op === 'mute'      ? '[Audio]::Mute = $true'
      :                      '[Audio]::Mute = $false';
    // Set, then print the resulting state so we can cache it without an extra spawn.
    const script = `${AUDIO_TYPE_SCRIPT}\n${setStmt}\nif ([Audio]::Mute) { 'true' } else { 'false' }`;
    const result = (await runPs(script)).trim();
    const muted = result === 'true';
    this.available = true;
    if (muted !== this.muted) {
      this.muted = muted;
      this.emitChange();
    }
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Force an immediate refresh — useful right after an external change is suspected. */
  refresh(): void { void this.poll(); }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const script = `${AUDIO_TYPE_SCRIPT}\nif ([Audio]::Mute) { 'true' } else { 'false' }`;
      const result = (await runPs(script)).trim();
      const muted = result === 'true';
      const wasUnavailable = !this.available;
      this.available = true;
      if (muted !== this.muted || wasUnavailable) {
        this.muted = muted;
        this.emitChange();
      }
    } catch {
      // No capture device, or audio system error — surface as unavailable.
      if (this.available) {
        this.available = false;
        this.muted = undefined;
        this.emitChange();
      }
    } finally {
      this.polling = false;
    }
  }

  private emitChange(): void { this.onChangeCb?.(); }
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

let _instance: MicController | null = null;
export function getMic(): MicController {
  if (!_instance) _instance = new MicController();
  return _instance;
}

import * as os from 'node:os';
import { spawn } from 'node:child_process';

/**
 * System metrics — CPU %, RAM %, GPU %. Piped into LiveMeta so chart tiles
 * can trace them the same way they trace `obs.droppedFrames`.
 *
 * Sampling:
 *   - CPU: derived from `os.cpus()` cumulative jiffies. Node built-in, ~free.
 *   - RAM: `1 - freemem/totalmem`. Also free.
 *   - GPU: Windows perf counter `\GPU Engine(*)\Utilization Percentage` via
 *     PowerShell — MAX across engines matches Task Manager's headline number.
 *     Spawning a PS process is expensive (~200–500 ms), so we only poll GPU
 *     while a chart tile actually references it. CPU/RAM start whenever any
 *     `system.*` chart exists in the layout.
 *
 * Zero cost when no system.* chart tile is in the layout — a layout scanner
 * (`layoutUsesSystemMetrics`) in layout.ts flips the poll on and off from the
 * layout-change hook in index.ts.
 */

const CPU_RAM_INTERVAL_MS = 2000;
const GPU_INTERVAL_MS = 3000;

/** Change threshold — skip broadcasting when values move by less than this so
 *  idle systems don't spam the state broadcast every 2 s. Client-side chart
 *  ticker still samples at 1 Hz regardless, so a paused broadcast doesn't
 *  create gaps in the trace, just plateaus. */
const EMIT_THRESHOLD_PERCENT = 0.5;

export type SystemMetricsStatus = {
  cpuPercent?: number;
  ramPercent?: number;
  gpuPercent?: number;
};

class SystemMetricsSampler {
  private cpuPercent: number | undefined;
  private ramPercent: number | undefined;
  private gpuPercent: number | undefined;
  private prevCpus: os.CpuInfo[] = os.cpus();
  private cpuRamTimer: NodeJS.Timeout | null = null;
  private gpuTimer: NodeJS.Timeout | null = null;
  private gpuInFlight = false;
  private onChangeCb: (() => void) | null = null;
  private lastEmitted = { cpu: -999, ram: -999, gpu: -999 };
  /** What the current layout needs. Any true value triggers CPU/RAM polling
   *  (they run together — deriving one without the other is pointless). GPU
   *  polling only starts when gpu === true. */
  private needed: { cpu: boolean; ram: boolean; gpu: boolean } = { cpu: false, ram: false, gpu: false };

  status(): SystemMetricsStatus {
    return {
      cpuPercent: this.cpuPercent,
      ramPercent: this.ramPercent,
      gpuPercent: this.gpuPercent,
    };
  }

  onChange(cb: () => void): void { this.onChangeCb = cb; }

  /** Refcount alternative — called from the layout-change hook. Starts /
   *  stops timers based on what the current layout needs. Idempotent. */
  setNeeded(needed: { cpu: boolean; ram: boolean; gpu: boolean }): void {
    this.needed = { ...needed };
    const wantCpuRam = needed.cpu || needed.ram;
    if (wantCpuRam && !this.cpuRamTimer) {
      // Baseline the cpu jiffies right when we start so the first sample is
      // a real delta rather than "since Node boot".
      this.prevCpus = os.cpus();
      this.cpuRamTimer = setInterval(() => this.sampleCpuRam(), CPU_RAM_INTERVAL_MS);
      // Fire once immediately after a brief delay so we have a delta baseline.
      setTimeout(() => this.sampleCpuRam(), 500);
    } else if (!wantCpuRam && this.cpuRamTimer) {
      clearInterval(this.cpuRamTimer);
      this.cpuRamTimer = null;
      this.cpuPercent = undefined;
      this.ramPercent = undefined;
    }
    if (needed.gpu && !this.gpuTimer) {
      this.gpuTimer = setInterval(() => { void this.sampleGpu(); }, GPU_INTERVAL_MS);
      void this.sampleGpu();
    } else if (!needed.gpu && this.gpuTimer) {
      clearInterval(this.gpuTimer);
      this.gpuTimer = null;
      this.gpuPercent = undefined;
    }
  }

  private sampleCpuRam(): void {
    const cpus = os.cpus();
    let totalDelta = 0;
    let idleDelta = 0;
    for (let i = 0; i < cpus.length; i++) {
      const p = this.prevCpus[i]?.times;
      const c = cpus[i].times;
      if (!p) continue;
      const total = (c.user - p.user) + (c.nice - p.nice) + (c.sys - p.sys) + (c.idle - p.idle) + (c.irq - p.irq);
      const idle = c.idle - p.idle;
      totalDelta += total;
      idleDelta += idle;
    }
    this.prevCpus = cpus;
    if (this.needed.cpu) {
      this.cpuPercent = totalDelta === 0 ? 0 : Math.max(0, Math.min(100, 100 - (idleDelta / totalDelta) * 100));
    }
    if (this.needed.ram) {
      const totalRam = os.totalmem();
      const freeRam = os.freemem();
      this.ramPercent = totalRam === 0 ? 0 : Math.max(0, Math.min(100, (1 - freeRam / totalRam) * 100));
    }
    this.maybeEmit();
  }

  private async sampleGpu(): Promise<void> {
    if (this.gpuInFlight) return;
    this.gpuInFlight = true;
    try {
      const script = `
        $ErrorActionPreference = 'Stop'
        $g = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue
        if ($g -eq $null) { Write-Output 0 }
        else {
          $max = ($g.CounterSamples | Measure-Object -Property CookedValue -Maximum).Maximum
          if ($max -eq $null) { Write-Output 0 } else { Write-Output ('{0:F2}' -f $max) }
        }
      `;
      const raw = await runPs(script);
      const value = Number.parseFloat(raw.trim());
      if (Number.isFinite(value)) {
        this.gpuPercent = Math.max(0, Math.min(100, value));
        this.maybeEmit();
      }
    } catch (err) {
      console.warn(`[system-metrics] GPU poll failed: ${(err as Error).message}`);
    } finally {
      this.gpuInFlight = false;
    }
  }

  private maybeEmit(): void {
    const cpu = this.cpuPercent ?? this.lastEmitted.cpu;
    const ram = this.ramPercent ?? this.lastEmitted.ram;
    const gpu = this.gpuPercent ?? this.lastEmitted.gpu;
    if (
      Math.abs(cpu - this.lastEmitted.cpu) < EMIT_THRESHOLD_PERCENT &&
      Math.abs(ram - this.lastEmitted.ram) < EMIT_THRESHOLD_PERCENT &&
      Math.abs(gpu - this.lastEmitted.gpu) < EMIT_THRESHOLD_PERCENT
    ) {
      return;
    }
    this.lastEmitted = { cpu, ram, gpu };
    this.onChangeCb?.();
  }
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

let _instance: SystemMetricsSampler | null = null;
export function getSystemMetrics(): SystemMetricsSampler {
  if (!_instance) _instance = new SystemMetricsSampler();
  return _instance;
}

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractLibraryId, resolveSoundPath } from '../sounds.js';

/**
 * Sound action — plays a local audio file on the PC running Digi Deck.
 *
 * Audience is streamers with a soundboard workflow (memes / SFX / stinger
 * clips) — the audio must play through the PC's default output so it lands
 * in OBS / on the stream, not through the phone. Server-side playback; the
 * phone only sends the trigger.
 *
 * We use `System.Windows.Media.MediaPlayer` (WPF) hosted on an STA-mode
 * PowerShell process with a proper Dispatcher.Run() pump. History of tries:
 *
 *   - `WMPlayer.OCX` COM (ActiveX): needs a hosting form to complete
 *     initialization. In a headless PS, playState sat at 9 (Transitioning)
 *     forever and audio never started.
 *   - `mciSendString` from winmm.dll (MCI): reliable and simple — but uses
 *     the ancient WaveOut driver path, which on modern Windows has small
 *     buffers and audibly stutters even on short clips.
 *   - **WPF MediaPlayer**: routes through WASAPI (Windows Audio Session
 *     API), the low-latency stack every modern Windows media app uses.
 *     Buttery smooth playback, native volume, per-source volume mixing,
 *     supports every codec Windows has (MP3, WAV, WMA, AAC, FLAC via
 *     Windows Media Foundation).
 *
 *     The catch: MediaPlayer publishes MediaEnded / MediaFailed as WPF
 *     events, which require a Dispatcher pumping messages. Two things make
 *     that work here:
 *       1. `powershell.exe -Sta` — the runspace lives on a Single-Threaded
 *          Apartment (COM STA), the only mode WPF supports.
 *       2. `[Dispatcher]::Run()` — a real message loop that pumps until
 *          `InvokeShutdown()` is called from the MediaEnded handler.
 *
 * PowerShell stderr is piped back to Node so failed plays show up in the
 * server log; the `#< CLIXML` framing on stderr from PS's default CLIXML
 * output is filtered out so it doesn't look alarming.
 */

const MAX_CLIP_SECONDS = 300;

export type SoundActionOpts = {
  path: string;
  /** 0..1. Undefined = play at full volume. */
  volume?: number;
};

export async function execSound(opts: SoundActionOpts): Promise<void> {
  const rawPath = (opts.path ?? '').trim();
  if (!rawPath) throw new Error('sound action requires a file path');

  // `library:<id>` paths resolve against the user's sounds directory. Bare
  // absolute paths keep working — backward-compat for tiles that predate the
  // library UI and for streamers who want to point at files outside the
  // library (network shares, external drives).
  const libraryId = extractLibraryId(rawPath);
  let abs: string;
  if (libraryId !== null) {
    const resolved = await resolveSoundPath(libraryId);
    if (!resolved) throw new Error(`sound not in library: "${libraryId}"`);
    abs = resolved;
  } else {
    abs = resolvePath(rawPath);
    if (!existsSync(abs)) throw new Error(`sound file not found: ${abs}`);
  }

  const volume = clamp01(opts.volume ?? 1);
  const fileUri = pathToFileURL(abs).href;
  const script = buildScript(fileUri, volume);

  console.log(`[sound] playing ${abs} at ${Math.round(volume * 100)}%`);

  // Encode as UTF-16LE base64 so multi-line scripts and non-ASCII paths pass
  // through PowerShell's parser unchanged (same trick the tray dialog uses).
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  // `-Sta` puts the runspace on a Single-Threaded Apartment — the mode WPF
  // requires. Without this, PresentationCore's MediaPlayer throws (or
  // silently no-ops) because COM interop rejects MTA callers.
  //
  // NOT detached: keeps stdio pipes usable. Sound is short (<= 5 min hard
  // cap), and the server doesn't care if it outlives us. The tradeoff is
  // that if the server process dies mid-playback, the sound cuts — fine.
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Sta', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  child.stdout?.on('data', (buf: Buffer) => {
    const t = buf.toString().trim();
    if (t) console.log(`[sound stdout] ${t}`);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    const t = buf.toString().trim();
    // PowerShell's default output serialization begins error-stream chunks
    // with a `#< CLIXML` marker followed by XML. It's diagnostic noise, not
    // an actual error, so we drop it. Real error content in a CLIXML chunk
    // still surfaces via the exit code + our Write-Error explicit path.
    if (!t || t.startsWith('#< CLIXML') || t.startsWith('<Objs')) return;
    console.warn(`[sound stderr] ${t}`);
  });
  child.on('error', (err) => console.error(`sound "${abs}" failed to spawn:`, err.message));
  child.on('exit', (code) => {
    console.log(`[sound] powershell exited with code ${code}`);
  });
}

function buildScript(fileUri: string, volume: number): string {
  const uriLiteral = psString(fileUri);
  const volumeLiteral = volume.toFixed(4);
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName PresentationCore, WindowsBase",
    "$player = New-Object System.Windows.Media.MediaPlayer",
    `$player.Volume = ${volumeLiteral}`,
    // The MediaPlayer's Dispatcher is captured on construction. We use it
    // both to react to its events and to shut it down when playback ends.
    "$dispatcher = [System.Windows.Threading.Dispatcher]::CurrentDispatcher",
    // Small state bag so event handlers can flag completion / errors back to
    // the caller thread (they run on the dispatcher, so shared state is
    // safe without extra locking).
    "$state = @{ Opened = $false; Err = $null; LenMs = 0 }",
    "$player.add_MediaOpened({",
    "  $state.Opened = $true",
    "  if ($player.NaturalDuration.HasTimeSpan) {",
    "    $state.LenMs = [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds",
    "  }",
    "  Write-Output \"[sound] opened (duration = $($state.LenMs) ms)\"",
    "})",
    "$player.add_MediaEnded({",
    "  Write-Output \"[sound] ended\"",
    "  $dispatcher.InvokeShutdown()",
    "})",
    "$player.add_MediaFailed({",
    "  param($s, $e)",
    "  $state.Err = if ($e.ErrorException) { $e.ErrorException.Message } else { 'MediaFailed (no detail)' }",
    "  Write-Output \"[sound] failed: $($state.Err)\"",
    "  $dispatcher.InvokeShutdown()",
    "})",
    // Hard ceiling — a broken / streaming source could otherwise hold the
    // dispatcher forever. Fires on the dispatcher via a timer so the pump
    // can process the shutdown request cleanly.
    "$timer = New-Object System.Windows.Threading.DispatcherTimer",
    `$timer.Interval = [TimeSpan]::FromSeconds(${MAX_CLIP_SECONDS})`,
    "$timer.add_Tick({",
    "  Write-Output \"[sound] max-clip timeout hit\"",
    "  $dispatcher.InvokeShutdown()",
    "})",
    "$timer.Start()",
    `$player.Open([uri]::new(${uriLiteral}))`,
    "$player.Play()",
    "Write-Output \"[sound] play() called, entering dispatcher loop\"",
    // Blocking pump — returns only after InvokeShutdown() from an event.
    "[System.Windows.Threading.Dispatcher]::Run()",
    "Write-Output \"[sound] dispatcher exited\"",
    "$timer.Stop()",
    "$player.Close()",
    "if ($state.Err) { Write-Error $state.Err; exit 1 }",
  ].join('\n');
}

function psString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

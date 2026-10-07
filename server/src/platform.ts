import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Cross-platform helpers.
 *
 * Digi Deck grew up Windows-only and still runs richest there (tray icon,
 * native file dialog, Core-Audio mic / per-app audio, Voicemeeter FFI,
 * one-click cert trust). This module gives the rest of the codebase a
 * platform-aware home for the handful of things that *do* port cleanly —
 * per-user config dir, "open a URL in the default browser", and a friendly
 * error string for Windows-only actions to throw on other OSes.
 */

export const isWindows = process.platform === 'win32';
export const isMacOS = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/** User-visible OS label for log + error messages. */
export const osLabel = isWindows ? 'Windows' : isMacOS ? 'macOS' : isLinux ? 'Linux' : process.platform;

/** OS-appropriate per-user config directory. Digi Deck appends a `digi-deck`
 *  folder beneath this; see `digiDeckDataDir()`.
 *  - Windows: `%APPDATA%` (falls back to `%USERPROFILE%\AppData\Roaming`)
 *  - macOS:   `~/Library/Application Support`
 *  - Linux:   `$XDG_CONFIG_HOME` (falls back to `~/.config`) */
export function appDataDir(): string {
  if (isWindows) {
    return process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming');
  }
  if (isMacOS) {
    return join(process.env.HOME ?? '.', 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '.', '.config');
}

/** Shortcut: the Digi Deck per-user data directory (`<appData>/digi-deck`). */
export function digiDeckDataDir(): string {
  return join(appDataDir(), 'digi-deck');
}

/** Open a URL in the OS's default handler. Non-shell invocation — the url is
 *  passed as a single argv element so metacharacters can't break out.
 *  Callers are expected to have already validated the scheme. */
export function openExternal(url: string): void {
  let cmd: string;
  let args: string[];
  if (isWindows) {
    // rundll32 + the URL DLL's FileProtocolHandler entry point. This is what
    // Windows itself invokes on a URL double-click; unlike `cmd /c start`,
    // the URL isn't re-parsed by a shell.
    cmd = 'rundll32.exe';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (isMacOS) {
    cmd = 'open';
    args = [url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`openExternal("${url}") failed:`, err.message));
  child.unref();
}

/** Standard message for actions that only make sense on Windows (mic mute,
 *  per-app audio, Voicemeeter, etc.). Threaded into friendly errors. */
export function windowsOnlyError(featureName: string): Error {
  return new Error(
    `${featureName} is Windows-only — not available on ${osLabel}. ` +
    'Use a hotkey tile mapped to your OS\'s equivalent shortcut instead.',
  );
}

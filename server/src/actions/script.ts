import { spawn } from 'node:child_process';
import { isWindows } from '../platform.js';

export async function execScript(script: string): Promise<void> {
  // Hand the script to the OS's default interpreter — PowerShell on Windows,
  // the user's login shell (via sh) elsewhere. Users author per-OS scripts;
  // Digi Deck doesn't translate between them.
  const [cmd, args] = isWindows
    ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]] as const
    : ['sh', ['-c', script]] as const;
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error('script failed:', err.message));
  child.unref();
}

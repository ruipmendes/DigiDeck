import { spawn } from 'node:child_process';

export async function execScript(script: string): Promise<void> {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { detached: true, stdio: 'ignore' },
  );
  child.on('error', (err) => console.error('script failed:', err.message));
  child.unref();
}

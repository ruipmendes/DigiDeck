import { spawn } from 'node:child_process';

export async function execLaunch(path: string, args: string[] = [], cwd?: string): Promise<void> {
  const child = spawn(path, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    shell: false,
  });
  child.on('error', (err) => console.error(`launch "${path}" failed:`, err.message));
  child.unref();
}

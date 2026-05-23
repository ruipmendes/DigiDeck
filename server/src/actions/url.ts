import { spawn } from 'node:child_process';

export async function execUrl(url: string): Promise<void> {
  // `start` is a cmd builtin, must be invoked via cmd /c.
  // The empty quoted arg is the (ignored) window title that `start` requires.
  const child = spawn('cmd', ['/c', 'start', '', url], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => console.error(`url "${url}" failed:`, err.message));
  child.unref();
}

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// updates.ts lives at server/src/ in dev (tsx) and server/dist/ after a build.
// Two levels up reaches the repo root in both cases.
const REPO_ROOT = resolve(__dirname, '../..');
const VERSION_FILE = join(REPO_ROOT, '.digi-deck-version');

const GITHUB_OWNER = 'ruipmendes';
const GITHUB_REPO = 'DigiDeck';
const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

export type UpdateCheck =
  | { status: 'up-to-date'; localSha: string; remoteSha: string; repoUrl: string }
  | { status: 'update-available'; localSha: string | null; remoteSha: string; ahead: number | null; repoUrl: string }
  | { status: 'unknown-local'; remoteSha: string; repoUrl: string }
  | { status: 'error'; message: string; repoUrl: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const [localSha, remoteSha] = await Promise.all([
      getLocalSha().catch(() => null),
      getRemoteSha(),
    ]);

    if (!localSha) {
      return { status: 'unknown-local', remoteSha, repoUrl: REPO_URL };
    }
    if (localSha === remoteSha) {
      return { status: 'up-to-date', localSha, remoteSha, repoUrl: REPO_URL };
    }

    const ahead = await getAheadCount(localSha, remoteSha).catch(() => null);
    return { status: 'update-available', localSha, remoteSha, ahead, repoUrl: REPO_URL };
  } catch (err) {
    return { status: 'error', message: (err as Error).message, repoUrl: REPO_URL };
  }
}

async function getLocalSha(): Promise<string | null> {
  const fromGit = await readGitSha();
  if (fromGit) return fromGit;
  try {
    const stamp = (await fs.readFile(VERSION_FILE, 'utf8')).trim();
    return /^[a-f0-9]{7,40}$/i.test(stamp) ? stamp : null;
  } catch {
    return null;
  }
}

function readGitSha(): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, windowsHide: true });
    let out = '';
    p.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    p.on('error', () => resolve(null));
    p.on('exit', (code) => {
      if (code !== 0) return resolve(null);
      const sha = out.trim();
      resolve(/^[a-f0-9]{40}$/i.test(sha) ? sha : null);
    });
  });
}

async function getRemoteSha(): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/main`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'digi-deck-updater',
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const data = await res.json() as { sha?: string };
  if (typeof data.sha !== 'string') throw new Error('GitHub response missing sha');
  return data.sha;
}

async function getAheadCount(base: string, head: string): Promise<number> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/${base}...${head}`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'digi-deck-updater',
      },
    },
  );
  if (!res.ok) throw new Error(`compare ${res.status}`);
  const data = await res.json() as { ahead_by?: number };
  if (typeof data.ahead_by !== 'number') throw new Error('compare response missing ahead_by');
  return data.ahead_by;
}

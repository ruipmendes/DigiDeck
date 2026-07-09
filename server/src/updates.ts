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
const APPLY_GIT_SCRIPT = join(REPO_ROOT, 'apply-update.ps1');
const APPLY_ZIP_SCRIPT = join(REPO_ROOT, 'apply-update-zip.ps1');

async function hasGitClone(): Promise<boolean> {
  return fs.stat(join(REPO_ROOT, '.git')).then(() => true, () => false);
}

/**
 * Picks the right update script based on how this install was created:
 *   - git clone  -> apply-update.ps1 (pull + rebuild)
 *   - zip download -> apply-update-zip.ps1 (download main.zip + reinstall)
 */
export async function applyScriptPath(): Promise<string> {
  return (await hasGitClone()) ? APPLY_GIT_SCRIPT : APPLY_ZIP_SCRIPT;
}

/** True when an in-place Apply is available: the matching script exists on disk. */
export async function canApplyInPlace(): Promise<boolean> {
  const script = await applyScriptPath();
  return fs.stat(script).then(() => true, () => false);
}

const GITHUB_OWNER = 'ruipmendes';
const GITHUB_REPO = 'DigiDeck';
const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

export type UpdateCheck =
  | { status: 'up-to-date'; localSha: string; remoteSha: string; tag: string | null; url: string }
  | { status: 'update-available'; localSha: string | null; remoteSha: string; tag: string | null; ahead: number | null; url: string }
  | { status: 'unknown-local'; remoteSha: string; tag: string | null; url: string }
  | { status: 'dev-build'; localSha: string; remoteSha: string; tag: string | null; ahead: number; url: string }
  | { status: 'error'; message: string; url: string };

type RemoteVersion = { sha: string; tag: string | null; url: string };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const [localSha, remote] = await Promise.all([
      getLocalSha().catch(() => null),
      getRemoteVersion(),
    ]);

    if (!localSha) {
      return { status: 'unknown-local', remoteSha: remote.sha, tag: remote.tag, url: remote.url };
    }
    if (localSha === remote.sha) {
      return { status: 'up-to-date', localSha, remoteSha: remote.sha, tag: remote.tag, url: remote.url };
    }

    // Compare in both directions so a user on a dev build (ahead of the latest
    // release) isn't told "update available" — they're past it.
    const cmp = await compareCommits(remote.sha, localSha).catch(() => null);
    if (cmp && cmp.aheadBy > 0 && cmp.behindBy === 0) {
      // Local is strictly ahead of the latest release — i.e., running newer than release.
      return { status: 'dev-build', localSha, remoteSha: remote.sha, tag: remote.tag, ahead: cmp.aheadBy, url: remote.url };
    }
    // Local is behind (or diverged). Either way, surface as an available update.
    return {
      status: 'update-available',
      localSha,
      remoteSha: remote.sha,
      tag: remote.tag,
      ahead: cmp ? cmp.behindBy : null,
      url: remote.url,
    };
  } catch (err) {
    return { status: 'error', message: (err as Error).message, url: REPO_URL };
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

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'digi-deck-updater',
};

/**
 * Prefer the latest GitHub release as the "remote" version — users update on
 * tagged releases, not on every micro-commit. Falls back to the latest commit
 * on main if no releases exist yet.
 */
async function getRemoteVersion(): Promise<RemoteVersion> {
  const release = await fetchLatestRelease();
  if (release) return release;
  return fetchMainHead();
}

type LatestReleaseResponse = {
  tag_name?: string;
  html_url?: string;
  target_commitish?: string;
};

async function fetchLatestRelease(): Promise<RemoteVersion | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
    { headers: GITHUB_HEADERS },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub /releases/latest responded ${res.status}`);
  const data = await res.json() as LatestReleaseResponse;
  if (typeof data.tag_name !== 'string') return null;

  // target_commitish is usually a branch name ("main") for releases cut from a
  // branch; resolve it to a SHA via the tags endpoint to get a real commit ref.
  const sha = await resolveTagSha(data.tag_name);
  if (!sha) return null;
  return {
    sha,
    tag: data.tag_name,
    url: data.html_url ?? `${REPO_URL}/releases/tag/${encodeURIComponent(data.tag_name)}`,
  };
}

async function resolveTagSha(tag: string): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/tags/${encodeURIComponent(tag)}`,
    { headers: GITHUB_HEADERS },
  );
  if (!res.ok) return null;
  const data = await res.json() as { object?: { sha?: string; type?: string; url?: string } };
  const obj = data.object;
  if (!obj?.sha) return null;
  // Annotated tags require dereferencing one level via the tag object.
  if (obj.type === 'tag' && obj.url) {
    const r2 = await fetch(obj.url, { headers: GITHUB_HEADERS });
    if (!r2.ok) return null;
    const d2 = await r2.json() as { object?: { sha?: string } };
    return d2.object?.sha ?? obj.sha;
  }
  return obj.sha;
}

async function fetchMainHead(): Promise<RemoteVersion> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/main`,
    { headers: GITHUB_HEADERS },
  );
  if (!res.ok) throw new Error(`GitHub /commits/main responded ${res.status}`);
  const data = await res.json() as { sha?: string };
  if (typeof data.sha !== 'string') throw new Error('GitHub response missing sha');
  return { sha: data.sha, tag: null, url: REPO_URL };
}

async function compareCommits(base: string, head: string): Promise<{ aheadBy: number; behindBy: number }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/${base}...${head}`,
    { headers: GITHUB_HEADERS },
  );
  if (!res.ok) throw new Error(`compare ${res.status}`);
  const data = await res.json() as { ahead_by?: number; behind_by?: number };
  if (typeof data.ahead_by !== 'number' || typeof data.behind_by !== 'number') {
    throw new Error('compare response missing counts');
  }
  return { aheadBy: data.ahead_by, behindBy: data.behind_by };
}

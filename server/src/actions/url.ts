import { spawn } from 'node:child_process';

/** Deny-list of URL schemes that shouldn't be handed to the OS handler —
 *  `file:` opens arbitrary files, `javascript:` / `vbscript:` / `data:` can
 *  execute code through certain browsers, `jar:` / `about:` / `blob:` are
 *  either useless or attack-surface. Everything else (http, https, mailto,
 *  tel, ms-teams, steam://, discord://, obsidian://, spotify:, …) passes so
 *  legitimate custom-protocol tiles keep working. */
const DENIED_SCHEMES = /^(file|javascript|vbscript|data|jar|about|blob):/i;
const SCHEME_RE = /^[a-z][a-z0-9+.\-]*:/i;

export async function execUrl(url: string): Promise<void> {
  if (typeof url !== 'string' || !url) throw new Error('url action: empty url');
  const trimmed = url.trim();
  if (!SCHEME_RE.test(trimmed)) throw new Error('url action: missing scheme (e.g. https://)');
  if (DENIED_SCHEMES.test(trimmed)) throw new Error('url action: scheme not allowed');
  // Route through rundll32 + the URL DLL's FileProtocolHandler entry point.
  // This is what Windows itself invokes on a URL double-click; unlike
  // `cmd /c start`, the URL is not re-parsed by a shell, so metacharacters
  // in the query string can't break out into extra commands.
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', trimmed], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => console.error(`url "${trimmed}" failed:`, err.message));
  child.unref();
}

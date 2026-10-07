import { openExternal } from '../platform.js';

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
  openExternal(trimmed);
}

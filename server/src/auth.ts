import type { IncomingMessage } from 'node:http';
import { networkInterfaces } from 'node:os';
import { timingSafeEqual } from 'node:crypto';

/** Port the server listens on. Duplicated intentionally — auth.ts must not
 *  import from index.ts (would create a cycle). */
const PORT = 8765;
const PORT_STR = String(PORT);

export function isLocalhost(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '::1' || addr === '127.0.0.1' || addr === '::ffff:127.0.0.1';
}

export function extractToken(req: IncomingMessage): string | undefined {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const fromQuery = url.searchParams.get('token');
    if (fromQuery) return fromQuery;
  } catch {
    /* malformed URL — fall through */
  }
  const header = req.headers.authorization;
  if (header && /^bearer\s+/i.test(header)) {
    return header.replace(/^bearer\s+/i, '').trim();
  }
  return undefined;
}

/** Constant-time equality on two token strings. False for mismatched lengths.
 *  Only the leaking-length side-channel remains; token length is fixed at build time. */
export function timingSafeTokenEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function authorize(req: IncomingMessage, expectedToken: string): boolean {
  if (isLocalhost(req)) return true;
  return timingSafeTokenEqual(extractToken(req), expectedToken);
}

/**
 * Split a `Host` / URL host string into [hostname, port].
 * Handles IPv6-in-brackets (`[::1]:8765`) and plain forms.
 */
function splitHostPort(host: string): [string, string] {
  if (host.startsWith('[')) {
    const idx = host.indexOf(']');
    if (idx === -1) return [host, ''];
    return [host.slice(1, idx), host.slice(idx + 2)];
  }
  const idx = host.lastIndexOf(':');
  if (idx === -1) return [host, ''];
  return [host.slice(0, idx), host.slice(idx + 1)];
}

/** Every non-internal address bound to any network interface on this machine.
 *  Called per-request; iteration is a handful of items, ~microseconds. */
function localAddresses(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      out.add(ni.address);
    }
  }
  return out;
}

/**
 * True when the `Host` header identifies this server: matches `localhost`,
 * `127.0.0.1`, `::1`, or any address bound to a network interface. Port must
 * be our port (or absent, treated as our port).
 *
 * This is the DNS-rebinding defense: an attacker's domain (e.g. `evil.com`)
 * rebound to `127.0.0.1` gets past `isLocalhost` (source IP check), but the
 * browser still sends `Host: evil.com:8765` — which fails this check.
 */
export function isAllowedHost(host: string | undefined | null): boolean {
  if (!host) return false;
  const [hostname, port] = splitHostPort(host);
  if (port && port !== PORT_STR) return false;
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') return true;
  return localAddresses().has(hostname);
}

/**
 * True when `Origin` identifies this server (or is absent).
 *
 * Absent Origin is legitimate for:
 *  - Same-origin GETs (browsers omit Origin)
 *  - Non-browser clients (curl, our own tray, tests)
 *  - Top-level navigations (like Twitch/Kick OAuth callback redirects)
 *
 * A cross-origin browser fetch — including the CORS "simple request"
 * POST with `Content-Type: text/plain` — always sets Origin, so a
 * rejection here blocks that CSRF path.
 */
export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin || origin === 'null') return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return isAllowedHost(u.host);
  } catch {
    return false;
  }
}

/** Combined check used on every `/api/*` route: Host + Origin allowlisted. */
export function isRequestOriginTrusted(req: IncomingMessage): boolean {
  const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  return isAllowedHost(host) && isAllowedOrigin(origin);
}

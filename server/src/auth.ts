import type { IncomingMessage } from 'node:http';

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

export function authorize(req: IncomingMessage, expectedToken: string): boolean {
  if (isLocalhost(req)) return true;
  return extractToken(req) === expectedToken;
}

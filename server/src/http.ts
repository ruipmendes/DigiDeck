import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Layout } from './layout.js';
import { saveLayout, validateLayout } from './layout.js';
import { authorize, isLocalhost } from './auth.js';
import { saveConfig, type ServerConfig } from './config.js';
import { getObs, DEFAULT_OBS_CONFIG, type ObsConfig } from './integrations/obs.js';
import { getTwitch, type TwitchConfig } from './integrations/twitch.js';

type Ctx = {
  getLayout: () => Layout;
  getServerConfig: () => ServerConfig;
};

export async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  const pathname = (req.url ?? '/').split('?')[0];
  const token = () => ctx.getServerConfig().token;

  if (pathname === '/api/layout' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, ctx.getLayout());
    return;
  }
  if (pathname === '/api/layout' && req.method === 'PUT') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const layout = validateLayout(body);
      await saveLayout(layout);
      res.writeHead(204);
      res.end();
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/pairing' && req.method === 'GET') {
    if (!isLocalhost(req)) return unauthorized(res);
    json(res, 200, buildPairing(token()));
    return;
  }

  // ─── OBS ──────────────────────────────────────────────────────
  if (pathname === '/api/integrations/obs' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, { config: ctx.getServerConfig().integrations.obs, status: getObs().status() });
    return;
  }
  if (pathname === '/api/integrations/obs/config' && req.method === 'PUT') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const obsCfg = validateObsConfig(body);
      const cfg = ctx.getServerConfig();
      cfg.integrations.obs = obsCfg;
      await saveConfig(cfg);
      getObs().setConfig(obsCfg);
      await getObs().restart();
      json(res, 200, { config: cfg.integrations.obs, status: getObs().status() });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/obs/reconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getObs().restart();
    json(res, 200, { config: ctx.getServerConfig().integrations.obs, status: getObs().status() });
    return;
  }

  // ─── Twitch ───────────────────────────────────────────────────
  if (pathname === '/api/integrations/twitch' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, {
      config: publicTwitchConfig(ctx.getServerConfig().integrations.twitch),
      status: getTwitch().status(),
    });
    return;
  }
  if (pathname === '/api/integrations/twitch/config' && req.method === 'PUT') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const twitchCfg = validateTwitchConfig(body, ctx.getServerConfig().integrations.twitch);
      const cfg = ctx.getServerConfig();
      cfg.integrations.twitch = twitchCfg;
      await saveConfig(cfg);
      getTwitch().setConfig(twitchCfg);
      if (twitchCfg.enabled && twitchCfg.refreshToken) {
        await getTwitch().restart();
      } else {
        await getTwitch().stop();
      }
      json(res, 200, {
        config: publicTwitchConfig(cfg.integrations.twitch),
        status: getTwitch().status(),
      });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/twitch/authorize' && req.method === 'GET') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const url = getTwitch().buildAuthorizeUrl();
      json(res, 200, { url });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/twitch/callback' && req.method === 'GET') {
    // Hit by user's browser after Twitch OAuth redirect — must be from localhost.
    if (!isLocalhost(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthErr = url.searchParams.get('error');
    if (oauthErr) {
      htmlResponse(res, 200, callbackHtml('Authorization cancelled', oauthErr, false));
      return;
    }
    if (!code || !state) {
      htmlResponse(res, 400, callbackHtml('Bad request', 'Missing code or state.', false));
      return;
    }
    try {
      await getTwitch().handleCallback(code, state);
      const username = getTwitch().status().username;
      htmlResponse(res, 200, callbackHtml(
        'Connected to Twitch',
        username ? `Logged in as @${username}.` : 'Authorization complete.',
        true,
      ));
    } catch (err) {
      htmlResponse(res, 500, callbackHtml('Auth failed', (err as Error).message, false));
    }
    return;
  }
  if (pathname === '/api/integrations/twitch/disconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getTwitch().disconnectIntegration();
    json(res, 200, {
      config: publicTwitchConfig(ctx.getServerConfig().integrations.twitch),
      status: getTwitch().status(),
    });
    return;
  }
  if (pathname === '/api/integrations/twitch/reconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getTwitch().restart();
    json(res, 200, {
      config: publicTwitchConfig(ctx.getServerConfig().integrations.twitch),
      status: getTwitch().status(),
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function buildPairing(token: string) {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        urls.push(`http://${ni.address}:5173/?token=${encodeURIComponent(token)}`);
      }
    }
  }
  return { token, urls };
}

function validateObsConfig(input: unknown): ObsConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid OBS config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' && o.host.trim() ? o.host.trim() : DEFAULT_OBS_CONFIG.host,
    port: typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : DEFAULT_OBS_CONFIG.port,
    password: typeof o.password === 'string' ? o.password : '',
  };
}

function publicTwitchConfig(cfg: TwitchConfig): {
  enabled: boolean; clientId: string; hasSecret: boolean; hasRefreshToken: boolean; username: string;
} {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
    username: cfg.username,
  };
}

function validateTwitchConfig(input: unknown, existing: TwitchConfig): TwitchConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Twitch config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    // If clientSecret omitted/empty, keep existing — UI never echoes the secret back.
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    // Refresh token and username are managed by the OAuth flow, not by this endpoint.
    refreshToken: existing.refreshToken,
    username: existing.username,
  };
}

function callbackHtml(title: string, body: string, success: boolean): string {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '✓' : '✗';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;gap:1rem;text-align:center;padding:1rem}
h1{margin:0;color:${color};font-size:1.4rem}
p{margin:0;color:#9ca3af;max-width:420px;line-height:1.5}
.hint{font-size:13px;color:#6b7280}
</style></head><body>
<h1>${icon} ${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p class="hint">You can close this tab.</p>
<script>setTimeout(()=>{try{window.close()}catch(_){}},3000)</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

function htmlResponse(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { error: 'unauthorized' });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

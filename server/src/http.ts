import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Layout } from './layout.js';
import { saveLayout, validateLayout } from './layout.js';
import { authorize, isLocalhost } from './auth.js';
import { saveConfig, type ServerConfig } from './config.js';
import { getObs, DEFAULT_OBS_CONFIG, type ObsConfig } from './integrations/obs.js';
import { getStreamlabs, DEFAULT_STREAMLABS_CONFIG, type StreamlabsConfig } from './integrations/streamlabs.js';
import { getTwitch, type TwitchConfig } from './integrations/twitch.js';
import { getKick, type KickConfig } from './integrations/kick.js';
import {
  saveImage, imagePath, imageExists, deleteImage, imageMime, MAX_IMAGE_BYTES,
} from './images.js';
import { exportBundle, importBundle } from './layout-bundle.js';
import { browseForFile } from './system-dialog.js';
import {
  listTemplates, loadTemplate, materializeTemplate,
  startPreview, clearPreview, consumePreview, heartbeatPreview, previewInfo,
} from './templates.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, extname, sep as pathSep } from 'node:path';

// ─── Built client (single-process production mode) ────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// `http.ts` lives at server/src/ in dev (tsx) and server/dist/ in prod (tsc).
// Both are two levels above client/dist.
const CLIENT_DIST = resolvePath(__dirname, '../../client/dist');

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt':  'text/plain; charset=utf-8',
};

type Ctx = {
  getLayout: () => Layout;
  getServerConfig: () => ServerConfig;
  /** Called when the layout file has been updated — re-broadcasts and refreshes state. */
  onLayoutChanged: () => Promise<void>;
  /** Called when an integration's `enabled` flag may have changed — lets the tray refresh its menu. */
  onIntegrationsChanged: () => void;
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
  if (pathname === '/api/layout/export' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const bundle = await exportBundle(ctx.getLayout());
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="digi-deck-layout-${stamp}.json"`,
      });
      res.end(JSON.stringify(bundle));
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/layout/import' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const layout = await importBundle(body);
      await saveLayout(layout);
      json(res, 200, { layout });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ─── Templates ────────────────────────────────────────────────
  if (pathname === '/api/templates' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const items = await listTemplates();
      json(res, 200, { templates: items, preview: previewInfo() });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }
  if (pathname.startsWith('/api/templates/') && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    const name = pathname.slice('/api/templates/'.length);
    try {
      const bundle = await loadTemplate(name);
      json(res, 200, bundle);
    } catch (err) {
      json(res, 404, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/templates/preview' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const body = await readJsonBody(req) as { name?: string; title?: string; bundle?: unknown };
      if (!body || typeof body !== 'object') throw new Error('body must include {name, title, bundle}');
      const name = typeof body.name === 'string' ? body.name : 'preview';
      const title = typeof body.title === 'string' ? body.title : name;
      const layout = await materializeTemplate(body.bundle);
      startPreview(name, title, layout);
      await ctx.onLayoutChanged();
      json(res, 200, { preview: previewInfo() });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/templates/preview/heartbeat' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    const alive = heartbeatPreview();
    json(res, alive ? 200 : 410, { alive });
    return;
  }
  if (pathname === '/api/templates/preview' && req.method === 'DELETE') {
    if (!authorize(req, token())) return unauthorized(res);
    const had = clearPreview();
    if (had) await ctx.onLayoutChanged();
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === '/api/templates/apply' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    const layout = consumePreview();
    if (!layout) {
      json(res, 400, { error: 'no preview active' });
      return;
    }
    try {
      await saveLayout(layout);
      // File watcher will re-broadcast, but trigger immediately too for low latency.
      await ctx.onLayoutChanged();
      json(res, 200, { layout });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/pairing' && req.method === 'GET') {
    if (!isLocalhost(req)) return unauthorized(res);
    json(res, 200, buildPairing(token()));
    return;
  }

  // ─── System ────────────────────────────────────────────────
  // Pops a native Windows OpenFileDialog on the PC running the server and
  // returns the chosen path. Useful for the Launch action's path field so
  // users don't have to copy-paste app locations.
  if (pathname === '/api/system/browse-file' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const body = await readJsonBody(req).catch(() => ({})) as { title?: string; initialDir?: string; filter?: string };
      const path = await browseForFile(body);
      json(res, 200, { path });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }

  // ─── Images ───────────────────────────────────────────────────
  if (pathname === '/api/images' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const buf = await readBinaryBody(req, MAX_IMAGE_BYTES);
      const filename = await saveImage(buf);
      json(res, 200, { filename });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname.startsWith('/api/images/file/')) {
    if (!authorize(req, token())) return unauthorized(res);
    const filename = decodeURIComponent(pathname.slice('/api/images/file/'.length));
    const abs = imagePath(filename);
    if (!abs) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad filename');
      return;
    }
    if (req.method === 'DELETE') {
      try {
        const removed = await deleteImage(filename);
        if (!removed) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(204);
        res.end();
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return;
    }
    if (req.method === 'GET') {
      if (!(await imageExists(filename))) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const s = await stat(abs);
        res.writeHead(200, {
          'Content-Type': imageMime(filename),
          'Content-Length': String(s.size),
          // Content-addressed filename — safe to cache aggressively.
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        createReadStream(abs).pipe(res);
      } catch (err) {
        json(res, 500, { error: (err as Error).message });
      }
      return;
    }
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
      ctx.onIntegrationsChanged();
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

  // ─── Streamlabs Desktop ───────────────────────────────────────
  if (pathname === '/api/integrations/streamlabs' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, {
      config: publicStreamlabsConfig(ctx.getServerConfig().integrations.streamlabs),
      status: getStreamlabs().status(),
    });
    return;
  }
  if (pathname === '/api/integrations/streamlabs/config' && req.method === 'PUT') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const slCfg = validateStreamlabsConfig(body, ctx.getServerConfig().integrations.streamlabs);
      const cfg = ctx.getServerConfig();
      cfg.integrations.streamlabs = slCfg;
      await saveConfig(cfg);
      getStreamlabs().setConfig(slCfg);
      await getStreamlabs().restart();
      ctx.onIntegrationsChanged();
      json(res, 200, {
        config: publicStreamlabsConfig(cfg.integrations.streamlabs),
        status: getStreamlabs().status(),
      });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/streamlabs/reconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getStreamlabs().restart();
    json(res, 200, {
      config: publicStreamlabsConfig(ctx.getServerConfig().integrations.streamlabs),
      status: getStreamlabs().status(),
    });
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
      ctx.onIntegrationsChanged();
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

  // ─── Kick ─────────────────────────────────────────────────────
  if (pathname === '/api/integrations/kick' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, {
      config: publicKickConfig(ctx.getServerConfig().integrations.kick),
      status: getKick().status(),
    });
    return;
  }
  if (pathname === '/api/integrations/kick/config' && req.method === 'PUT') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      const kickCfg = validateKickConfig(body, ctx.getServerConfig().integrations.kick);
      const cfg = ctx.getServerConfig();
      cfg.integrations.kick = kickCfg;
      await saveConfig(cfg);
      getKick().setConfig(kickCfg);
      if (kickCfg.enabled && kickCfg.refreshToken) {
        await getKick().restart();
      } else {
        await getKick().stop();
      }
      ctx.onIntegrationsChanged();
      json(res, 200, {
        config: publicKickConfig(cfg.integrations.kick),
        status: getKick().status(),
      });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/kick/authorize' && req.method === 'GET') {
    if (!isLocalhost(req)) return unauthorized(res);
    try {
      const url = getKick().buildAuthorizeUrl();
      json(res, 200, { url });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/kick/callback' && req.method === 'GET') {
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
      await getKick().handleCallback(code, state);
      const slug = getKick().status().slug;
      htmlResponse(res, 200, callbackHtml(
        'Connected to Kick',
        slug ? `Logged in as ${slug}.` : 'Authorization complete.',
        true,
      ));
    } catch (err) {
      htmlResponse(res, 500, callbackHtml('Auth failed', (err as Error).message, false));
    }
    return;
  }
  if (pathname === '/api/integrations/kick/disconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getKick().disconnectIntegration();
    json(res, 200, {
      config: publicKickConfig(ctx.getServerConfig().integrations.kick),
      status: getKick().status(),
    });
    return;
  }
  if (pathname === '/api/integrations/kick/reconnect' && req.method === 'POST') {
    if (!isLocalhost(req)) return unauthorized(res);
    await getKick().restart();
    json(res, 200, {
      config: publicKickConfig(ctx.getServerConfig().integrations.kick),
      status: getKick().status(),
    });
    return;
  }

  // ─── Static client (built SPA) ──────────────────────────────
  // Any non-/api request falls through to the built client at client/dist/.
  // The SPA-routing fallback returns index.html for paths without an extension
  // so URLs like /config keep working without a hash-router.
  if (!pathname.startsWith('/api')) {
    if (await serveStaticOrSpa(res, pathname)) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

async function serveStaticOrSpa(res: ServerResponse, pathname: string): Promise<boolean> {
  const reqPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolvePath(CLIENT_DIST, '.' + reqPath);
  // Defense against path traversal.
  if (!filePath.startsWith(CLIENT_DIST)) return false;

  if (await sendFile(res, filePath)) return true;

  // SPA fallback: serve index.html for routes without a file extension
  // (e.g. /config). Requests for an explicit missing asset (foo.js) 404.
  if (extname(reqPath) === '' || reqPath.endsWith('.html')) {
    return sendFile(res, resolvePath(CLIENT_DIST, 'index.html'));
  }
  return false;
}

async function sendFile(res: ServerResponse, filePath: string): Promise<boolean> {
  let stats;
  try {
    stats = await stat(filePath);
    if (!stats.isFile()) return false;
  } catch {
    return false;
  }
  const ext = extname(filePath).toLowerCase();
  const mime = STATIC_MIME[ext] ?? 'application/octet-stream';
  // Vite emits hashed filenames under /assets/, so they're safe to cache forever.
  // Anything else gets a short max-age so file changes (e.g. favicon swap) propagate.
  const cache =
    ext === '.html' ? 'no-cache' :
    filePath.includes(`${pathSep}assets${pathSep}`) ? 'public, max-age=31536000, immutable' :
    'public, max-age=3600';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': String(stats.size),
    'Cache-Control': cache,
  });
  createReadStream(filePath).pipe(res);
  return true;
}

function buildPairing(token: string) {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        urls.push(`http://${ni.address}:8765/?token=${encodeURIComponent(token)}`);
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

type PublicStreamlabsConfig = { enabled: boolean; host: string; port: number; hasToken: boolean };

function publicStreamlabsConfig(cfg: StreamlabsConfig): PublicStreamlabsConfig {
  return {
    enabled: cfg.enabled,
    host: cfg.host,
    port: cfg.port,
    hasToken: !!cfg.token,
  };
}

function validateStreamlabsConfig(input: unknown, existing: StreamlabsConfig): StreamlabsConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Streamlabs config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    host: typeof o.host === 'string' && o.host.trim() ? o.host.trim() : DEFAULT_STREAMLABS_CONFIG.host,
    port: typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : DEFAULT_STREAMLABS_CONFIG.port,
    // If `token` is omitted or empty, keep the existing one — UI never echoes the token back.
    token: typeof o.token === 'string' && o.token.length > 0 ? o.token : existing.token,
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

function publicKickConfig(cfg: KickConfig): {
  enabled: boolean; clientId: string; hasSecret: boolean; hasRefreshToken: boolean; slug: string;
} {
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    hasSecret: !!cfg.clientSecret,
    hasRefreshToken: !!cfg.refreshToken,
    slug: cfg.slug,
  };
}

function validateKickConfig(input: unknown, existing: KickConfig): KickConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid Kick config');
  const o = input as Record<string, unknown>;
  return {
    enabled: !!o.enabled,
    clientId: typeof o.clientId === 'string' ? o.clientId.trim() : existing.clientId,
    clientSecret: typeof o.clientSecret === 'string' && o.clientSecret.length > 0
      ? o.clientSecret
      : existing.clientSecret,
    // Managed by OAuth flow, not this endpoint.
    refreshToken: existing.refreshToken,
    slug: existing.slug,
    broadcasterUserId: existing.broadcasterUserId,
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

async function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    total += b.length;
    if (total > maxBytes) throw new Error(`payload too large (max ${maxBytes} bytes)`);
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

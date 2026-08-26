import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Layout } from './layout.js';
import { saveLayout, validateLayout } from './layout.js';
import { authorize, authorizeLocalhost, isLocalhost, isAllowedHost, isAllowedOrigin } from './auth.js';
import { saveConfig, type ServerConfig } from './config.js';
import { findIntegration } from './integrations/base.js';
import { getDiscord } from './integrations/discord.js';
import { getSpotify } from './integrations/spotify.js';
import { getAppAudio } from './actions/appAudio.js';
import { listIconPacks, readIcon, ICON_PACKS_DIR, invalidateIconPacksCache } from './icon-packs.js';
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
  '.webmanifest': 'application/manifest+json',
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

  // Origin + Host allowlist for every /api/* route.
  // - Blocks CSRF (e.g. cross-origin text/plain POST to /api/layout/import that
  //   would otherwise skip preflight and be accepted as JSON).
  // - Blocks DNS rebinding (evil.com rebound to 127.0.0.1 fails the Host check).
  // Static assets are unaffected — <img> tags on other origins still load fine.
  if (pathname.startsWith('/api')) {
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host : undefined;
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!isAllowedHost(hostHeader)) {
      console.warn(`[auth] ${req.method} ${pathname} rejected: bad host ${hostHeader}`);
      forbidden(res, 'bad host');
      return;
    }
    if (!isAllowedOrigin(originHeader)) {
      console.warn(`[auth] ${req.method} ${pathname} rejected: bad origin ${originHeader}`);
      forbidden(res, 'bad origin');
      return;
    }
  }

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
    // Bootstrap-only: the config UI has no token yet the first time it opens.
    // Origin + Host allowlist (see top of handleRequest) blocks the rebinding
    // and cross-origin attack paths that used to make this dangerous.
    if (!isLocalhost(req)) return unauthorized(res);
    const scheme = ctx.getServerConfig().security.httpsEnabled ? 'https' : 'http';
    json(res, 200, buildPairing(token(), scheme));
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

  // ─── Icon packs ─────────────────────────────────────────────
  // Discovery is filesystem-based — users drop unzipped icon sets into
  // %APPDATA%/digi-deck/icon-packs/<pack>/. The `dir` field is returned so
  // the manage-packs UI can show the user where to drop new ones.
  if (pathname === '/api/icon-packs' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const packs = await listIconPacks();
      json(res, 200, { packs, dir: ICON_PACKS_DIR });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/icon-packs/refresh' && req.method === 'POST') {
    if (!authorize(req, token())) return unauthorized(res);
    invalidateIconPacksCache();
    const packs = await listIconPacks();
    json(res, 200, { packs, dir: ICON_PACKS_DIR });
    return;
  }
  // Serve an individual SVG. Path shape: /api/icon-packs/<pack>/<iconName>.svg
  // where iconName may contain forward slashes (subfolder prefixes).
  if (pathname.startsWith('/api/icon-packs/') && pathname.endsWith('.svg') && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    const rest = pathname.slice('/api/icon-packs/'.length, -'.svg'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx <= 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad path');
      return;
    }
    const pack = decodeURIComponent(rest.slice(0, slashIdx));
    const iconName = decodeURIComponent(rest.slice(slashIdx + 1));
    const buf = await readIcon(pack, iconName);
    if (!buf) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Length': String(buf.length),
      // SVGs are user-controlled but come from their own AppData folder — cache
      // aggressively, they only change when the user replaces the file.
      'Cache-Control': 'public, max-age=86400',
      // SVG can carry inline <script> — the `<img src>` context browsers use to
      // render tile icons blocks script execution, but set CSP as belt+braces.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(buf);
    return;
  }

  // ─── Discord-specific: choice lists for prompt-at-tap dropdowns ─
  // These sit *before* the generic auto-router so they win over the
  // fallthrough for /api/integrations/discord/... paths.
  if (pathname === '/api/integrations/discord/voice-channels' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const channels = await getDiscord().getVoiceChannels();
      json(res, 200, { channels });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/discord/channel-members' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const members = await getDiscord().getChannelMembers();
      json(res, 200, { members });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/discord/guild-voice-members' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const members = await getDiscord().getGuildVoiceMembers();
      json(res, 200, { members });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  if (pathname === '/api/integrations/discord/guilds' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const guilds = await getDiscord().getGuilds();
      json(res, 200, { guilds });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ─── App-audio: list live audio sessions ────────────────────
  // Poll subscription is refcount-managed — the config UI subscribes for the
  // duration of its own poll interval to keep the list fresh while it's open,
  // then releases. Sessions are also returned inline via GET so the picker
  // works without a subscription.
  if (pathname === '/api/app-audio/sessions' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    try {
      const sessions = await getAppAudio().listNow();
      json(res, 200, { sessions });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ─── Spotify-specific: re-check subscription tier ────────────
  // Sits above the auto-router so it wins over the fallthrough. Cheap
  // one-shot /me refetch — used by the panel's "Recheck" button after a
  // Premium upgrade.
  if (pathname === '/api/integrations/spotify/recheck' && req.method === 'POST') {
    if (!authorizeLocalhost(req, token())) return unauthorized(res);
    try {
      await getSpotify().recheckSubscription();
      json(res, 200, { config: getSpotify().publicConfig(), status: getSpotify().status() });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }

  // ─── Integrations (auto-generated from the registry) ─────────
  // Any /api/integrations/<name>/... path is dispatched to the integration
  // matching <name> in the registry. Adding a new integration = a manifest
  // + IntegrationLifecycle impl; no touching this file.
  if (pathname.startsWith('/api/integrations/')) {
    const rest = pathname.slice('/api/integrations/'.length);
    const slashIdx = rest.indexOf('/');
    const name = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const action = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);
    const integration = findIntegration(name);
    if (integration) {
      const handled = await routeIntegration(req, res, ctx, token, integration, action);
      if (handled) return;
    }
  }


  // ─── Security ─────────────────────────────────────────────────
  if (pathname === '/api/security' && req.method === 'GET') {
    if (!authorize(req, token())) return unauthorized(res);
    json(res, 200, { config: ctx.getServerConfig().security });
    return;
  }
  if (pathname === '/api/security/config' && req.method === 'PUT') {
    if (!authorizeLocalhost(req, token())) return unauthorized(res);
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') throw new Error('invalid security config');
      const o = body as Record<string, unknown>;
      const cfg = ctx.getServerConfig();
      // Only overwrite fields explicitly present in the request so a partial
      // update (e.g. toggling just httpsEnabled) doesn't clobber other flags.
      if (typeof o.allowShellActions === 'boolean') cfg.security.allowShellActions = o.allowShellActions;
      if (typeof o.httpsEnabled === 'boolean') cfg.security.httpsEnabled = o.httpsEnabled;
      await saveConfig(cfg);
      json(res, 200, { config: cfg.security });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return;
  }
  // One-click install of the .cer into the current user's Windows Root store.
  // Non-admin — writes to CurrentUser\Root which Chrome + Edge read.
  if (pathname === '/api/security/install-trust' && req.method === 'POST') {
    if (!authorizeLocalhost(req, token())) return unauthorized(res);
    try {
      const { installCertTrust } = await import('./https-cert.js');
      const result = await installCertTrust();
      json(res, 200, { installed: true, output: result.output });
    } catch (err) {
      console.error('[https] install trust failed:', (err as Error).message);
      json(res, 500, { error: (err as Error).message });
    }
    return;
  }

  // Downloadable public cert (DER-encoded .cer) so users can install trust
  // on their phones once HTTPS is enabled. NO auth: the cert is public info
  // — every TLS handshake serves it — so gating it just prevents phones from
  // fetching it on their own. Origin/Host allowlist at the top of
  // handleRequest still limits it to callers on this server's LAN.
  // Generates the cert on demand so it's downloadable even before the server
  // has been restarted into HTTPS mode.
  if (pathname === '/api/security/cert' && req.method === 'GET') {
    try {
      const { ensureCert } = await import('./https-cert.js');
      const cerPath = await ensureCert();
      const s = await stat(cerPath);
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Length': String(s.size),
        // `.crt` (not `.cer`) makes Android open the file with the CA-cert
        // install picker rather than the "VPN / app" picker that demands a
        // private key. Same DER-encoded content either way.
        'Content-Disposition': 'attachment; filename="digi-deck.crt"',
      });
      createReadStream(cerPath).pipe(res);
    } catch (err) {
      console.error('[https] cert download failed:', (err as Error).message);
      json(res, 500, { error: (err as Error).message });
    }
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

/**
 * Handles every /api/integrations/<name>/<action> route by dispatching to
 * methods on the integration lifecycle contract. Adding a new integration
 * inherits all six standard endpoints for free.
 *
 *   GET  /                → { config, status }         (authorize)
 *   PUT  /config          → validate + persist + apply (authorizeLocalhost)
 *   POST /reconnect       → restart() + { config, status } (authorizeLocalhost)
 *   GET  /authorize       → { url } (OAuth only, authorizeLocalhost)
 *   GET  /callback        → HTML page (OAuth only, isLocalhost)
 *   POST /disconnect      → clear tokens + { config, status } (OAuth only, authorizeLocalhost)
 *
 * Returns true when it produced a response for a known route; false when the
 * path matched an integration name but not a recognised action, so the outer
 * handler can 404.
 */
async function routeIntegration(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Ctx,
  token: () => string,
  integration: import('./integrations/base.js').IntegrationLifecycle,
  action: string,
): Promise<boolean> {
  const method = req.method;

  const respondConfigStatus = (status = 200) => {
    json(res, status, { config: integration.publicConfig(), status: integration.status() });
  };

  // GET /api/integrations/<name>
  if (action === '' && method === 'GET') {
    if (!authorize(req, token())) { unauthorized(res); return true; }
    respondConfigStatus();
    return true;
  }

  // PUT /api/integrations/<name>/config
  if (action === 'config' && method === 'PUT') {
    if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
    try {
      const body = await readJsonBody(req);
      await integration.applyConfigUpdate(body);
      ctx.onIntegrationsChanged();
      respondConfigStatus();
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return true;
  }

  // POST /api/integrations/<name>/reconnect
  if (action === 'reconnect' && method === 'POST') {
    if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
    await integration.restart();
    respondConfigStatus();
    return true;
  }

  // OAuth-only endpoints. Guard on the manifest so a non-OAuth integration
  // getting hit at /authorize doesn't crash on the optional method call.
  if (integration.manifest.hasOAuth) {
    if (action === 'authorize' && method === 'GET') {
      if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
      try {
        const url = integration.buildAuthorizeUrl!();
        json(res, 200, { url });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }

    if (action === 'callback' && method === 'GET') {
      // Hit by the user's browser after the OAuth redirect back to us.
      // The `state` param carries CSRF protection; auth is not possible here.
      if (!isLocalhost(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
        return true;
      }
      const url = new URL(req.url ?? '', 'http://localhost');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthErr = url.searchParams.get('error');
      if (oauthErr) {
        htmlResponse(res, 200, callbackHtml('Authorization cancelled', oauthErr, false));
        return true;
      }
      if (!code || !state) {
        htmlResponse(res, 400, callbackHtml('Bad request', 'Missing code or state.', false));
        return true;
      }
      try {
        const outcome = await integration.handleCallback!(code, state);
        htmlResponse(res, 200, callbackHtml(
          `Connected to ${integration.manifest.displayName}`,
          outcome.successMessage,
          true,
        ));
      } catch (err) {
        htmlResponse(res, 500, callbackHtml('Auth failed', (err as Error).message, false));
      }
      return true;
    }

    if (action === 'disconnect' && method === 'POST') {
      if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
      await integration.disconnectIntegration!();
      respondConfigStatus();
      return true;
    }
  }

  // IPC-auth (Discord etc.). Auth happens in the target app, not in a browser,
  // so we expose one endpoint that triggers the interactive flow and blocks
  // until the user approves or the request times out.
  if (integration.manifest.hasIpcAuth) {
    if (action === 'connect' && method === 'POST') {
      if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
      try {
        const outcome = await integration.connectInteractive!();
        ctx.onIntegrationsChanged();
        json(res, 200, {
          config: integration.publicConfig(),
          status: integration.status(),
          success: outcome.successMessage,
        });
      } catch (err) {
        json(res, 400, { error: (err as Error).message });
      }
      return true;
    }
    if (action === 'disconnect' && method === 'POST') {
      if (!authorizeLocalhost(req, token())) { unauthorized(res); return true; }
      await integration.disconnectIntegration!();
      ctx.onIntegrationsChanged();
      respondConfigStatus();
      return true;
    }
  }

  return false;
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

function buildPairing(token: string, scheme: 'http' | 'https') {
  const urls: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) {
        urls.push(`${scheme}://${ni.address}:8765/?token=${encodeURIComponent(token)}`);
      }
    }
  }
  return { token, urls };
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

function forbidden(res: ServerResponse, message: string): void {
  json(res, 403, { error: message });
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

import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { loadOrGenerateCert } from './https-cert.js';
import { loadOrInitLayout, reloadLayout, toPublic, watchLayout, findTile, collectStreamerLogins, collectKickStreamerSlugs, LAYOUT_FILE } from './layout.js';
import { executeAction, setShellActionsGate, withPromptValues } from './actions/types.js';
import { handleRequest } from './http.js';
import { loadOrInitConfig, saveConfig, CONFIG_FILE } from './config.js';
import { authorize, isLocalhost, isAllowedHost, isAllowedOrigin } from './auth.js';
import { startMdns, stopMdns } from './mdns.js';
import { migrateAppData } from './migrations.js';
import { getObs } from './integrations/obs.js';
import { getStreamlabs } from './integrations/streamlabs.js';
import { getTwitch } from './integrations/twitch.js';
import { getStreamers } from './integrations/twitch-streamers.js';
import { getKick } from './integrations/kick.js';
import { getKickStreamers } from './integrations/kick-streamers.js';
// scaffold-integration: additional integration imports inserted above this line
import { getIntegrations } from './integrations/base.js';
import { getMic } from './actions/mic.js';
import { computeButtonStates, type ButtonState } from './states.js';
import { startTray, stopTray, updateTrayMenu, type TrayMenu } from './tray.js';
import { spawn } from 'node:child_process';
import type { Layout, PublicLayout } from './layout.js';
import {
  getPreview, previewInfo, setPreviewListener, startPreviewWatchdog,
} from './templates.js';
import { checkForUpdate, canApplyInPlace, applyScriptPath, type UpdateCheck } from './updates.js';

const PORT = 8765;

type ClientMsg =
  | { type: 'press'; id: number; longPress?: boolean; promptValues?: Record<string, string> }
  | { type: 'slider'; id: number; value: number }
  | { type: 'slider-mute'; id: number };
type ServerMsg =
  | { type: 'layout'; layout: PublicLayout; preview?: { name: string; title: string } }
  | { type: 'ack'; id: number }
  | { type: 'nack'; id: number; error: string }
  | { type: 'states'; states: ButtonState[] };

await migrateAppData();
const serverConfig = await loadOrInitConfig();
let layout: Layout = await loadOrInitLayout();
console.log(`layout: ${LAYOUT_FILE} (${layout.pages.length} pages, ${layout.pages.reduce((n, p) => n + p.buttons.length, 0)} buttons)`);
console.log(`config: ${CONFIG_FILE} (token loaded)`);

// Migrate the shell-actions toggle on first run: if the field is unset,
// choose a value that preserves current behavior — enable when the layout
// already uses script/launch tiles, disable otherwise.
if (serverConfig.security.allowShellActions === null) {
  const usesShell = layoutUsesShellActions(layout);
  serverConfig.security.allowShellActions = usesShell;
  await saveConfig(serverConfig);
  console.log(`[security] shell-actions default set to ${usesShell} (based on existing layout)`);
}
setShellActionsGate(() => !!serverConfig.security.allowShellActions);

function layoutUsesShellActions(l: Layout): boolean {
  for (const page of l.pages) {
    for (const tile of page.buttons) {
      if (tile.kind !== 'button') continue;
      const steps = Array.isArray(tile.action) ? tile.action : [tile.action];
      if (steps.some((s) => s.type === 'script' || s.type === 'launch')) return true;
      if (tile.longPressAction) {
        const longSteps = Array.isArray(tile.longPressAction) ? tile.longPressAction : [tile.longPressAction];
        if (longSteps.some((s) => s.type === 'script' || s.type === 'launch')) return true;
      }
    }
  }
  return false;
}

// Trigger singleton creation so each integration registers itself in the
// central registry (see integrations/base.ts). Every downstream loop over
// `getIntegrations()` depends on this.
const obs = getObs();
const streamlabs = getStreamlabs();
const twitch = getTwitch();
const kick = getKick();
// scaffold-integration: additional singleton calls inserted above this line

// Uniform lifecycle wiring — applyConfig / attachSave / start — so adding a
// fifth integration is one manifest + register call, not another N lines here.
for (const i of getIntegrations()) {
  i.applyConfig(serverConfig.integrations);
  i.attach(serverConfig, () => saveConfig(serverConfig));
  void i.start();
}

// Streamer pollers (Twitch + Kick) are supporting services layered on top
// of their base integrations. They stay explicit — they poll independently
// and don't participate in the integration lifecycle contract.
const streamers = getStreamers();
streamers.setLogins(collectStreamerLogins(layout));
streamers.start();

const kickStreamers = getKickStreamers();
kickStreamers.setSlugs(collectKickStreamerSlugs(layout));
kickStreamers.start();

const mic = getMic();
mic.start();

function activeLayout(): Layout { return getPreview()?.layout ?? layout; }

function currentTrayMenu(): TrayMenu {
  const items: TrayMenu = [];
  for (const i of getIntegrations()) {
    items.push({ name: i.manifest.name, displayName: i.manifest.displayName, enabled: i.isEnabled() });
  }
  return items;
}

const requestHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
  handleRequest(req, res, {
    getLayout: () => layout,
    getServerConfig: () => serverConfig,
    onLayoutChanged: async () => {
      broadcastLayout();
      scheduleStateBroadcast();
    },
    onIntegrationsChanged: () => {
      updateTrayMenu(currentTrayMenu());
    },
  })
    .catch((err) => {
      console.error('http handler error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal error');
      }
    });
};

// HTTPS is opt-in. When enabled, we listen with a self-signed cert generated
// on demand and cached under %APPDATA%. If cert generation blows up we log and
// fall back to plain HTTP so the app still boots rather than becoming
// unreachable — the SecurityPanel status makes the fallback visible.
const httpServer = await createServerForConfig();

async function createServerForConfig() {
  if (serverConfig.security.httpsEnabled) {
    try {
      const { pfx, passphrase } = await loadOrGenerateCert();
      console.log('[https] listening with self-signed cert');
      return createHttpsServer({ pfx, passphrase }, requestHandler);
    } catch (err) {
      console.error('[https] cert setup failed, falling back to HTTP:', (err as Error).message);
    }
  }
  return createHttpServer(requestHandler);
}

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, cb) => {
    // Origin + Host allowlist first — these block Cross-Site WebSocket
    // Hijacking (a browser tab on evil.com opening ws://localhost:8765 to
    // press our tiles) and DNS rebinding (attacker's domain rebound to
    // 127.0.0.1 — passes source-IP checks but Host still reads as evil.com).
    if (!isAllowedOrigin(info.origin)) {
      console.warn(`[auth] WS rejected: bad origin ${info.origin}`);
      cb(false, 403, 'forbidden');
      return;
    }
    if (!isAllowedHost(info.req.headers.host)) {
      console.warn(`[auth] WS rejected: bad host ${info.req.headers.host}`);
      cb(false, 403, 'forbidden');
      return;
    }
    if (isLocalhost(info.req) || authorize(info.req, serverConfig.token)) {
      cb(true);
    } else {
      console.warn(`[auth] WS rejected from ${info.req.socket.remoteAddress}`);
      cb(false, 401, 'unauthorized');
    }
  },
});

function broadcastLayout() {
  const info = previewInfo();
  const msg: ServerMsg = info
    ? { type: 'layout', layout: toPublic(activeLayout()), preview: info }
    : { type: 'layout', layout: toPublic(activeLayout()) };
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastStates() {
  const states = computeButtonStates(activeLayout(), obs.status(), twitch.status(), streamlabs.status(), kick.status());
  const data = JSON.stringify({ type: 'states', states } satisfies ServerMsg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

let statesTimer: NodeJS.Timeout | null = null;
function scheduleStateBroadcast() {
  if (statesTimer) clearTimeout(statesTimer);
  statesTimer = setTimeout(() => { statesTimer = null; broadcastStates(); }, 150);
}

// Base wiring: every integration triggers a state broadcast on change.
for (const i of getIntegrations()) i.onChange(scheduleStateBroadcast);

// Extra: when Twitch or Kick just went to connected, refresh streamer thumbnails
// so tiles pop within seconds instead of waiting for the next poll.
twitch.onChange(() => {
  if (twitch.status().state === 'connected') streamers.refresh();
});
kick.onChange(() => {
  if (kick.status().state === 'connected') kickStreamers.refresh();
});

streamers.onChange(scheduleStateBroadcast);
kickStreamers.onChange(scheduleStateBroadcast);
mic.onChange(scheduleStateBroadcast);

watchLayout(async () => {
  try {
    layout = await reloadLayout();
    const total = layout.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`[layout reloaded] ${layout.pages.length} pages, ${total} buttons`);
    streamers.setLogins(collectStreamerLogins(layout));
    kickStreamers.setSlugs(collectKickStreamerSlugs(layout));
    broadcastLayout();
    scheduleStateBroadcast();
  } catch (err) {
    console.error('failed to reload layout (keeping old one):', (err as Error).message);
  }
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[+] client connected');
  const info = previewInfo();
  ws.send(JSON.stringify(info
    ? { type: 'layout', layout: toPublic(activeLayout()), preview: info }
    : { type: 'layout', layout: toPublic(activeLayout()) }
  ));
  ws.send(JSON.stringify({
    type: 'states',
    states: computeButtonStates(activeLayout(), obs.status(), twitch.status(), streamlabs.status(), kick.status()),
  } satisfies ServerMsg));

  ws.on('message', async (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    const tile = findTile(activeLayout(), msg.id);
    if (!tile) {
      console.warn(`unknown tile id: ${msg.id}`);
      return;
    }

    const previewing = !!getPreview();

    if (msg.type === 'press') {
      if (tile.kind !== 'button') return; // sliders don't accept press
      if (previewing) {
        console.log(`    [preview] press [${tile.id}] "${tile.label}" (no-op)`);
        ws.send(JSON.stringify({ type: 'ack', id: msg.id } satisfies ServerMsg));
        return;
      }
      const rawAction = msg.longPress && tile.longPressAction ? tile.longPressAction : tile.action;
      const action = withPromptValues(rawAction, msg.promptValues);
      const actionLabel = Array.isArray(action)
        ? `[${action.length} steps: ${action.map((s) => s.type).join(' → ')}]`
        : action.type;
      const which = msg.longPress && tile.longPressAction ? 'long-press' : 'press';
      const promptTag = msg.promptValues && Object.keys(msg.promptValues).length
        ? ` (prompted: ${Object.entries(msg.promptValues).map(([k, v]) => `${k}=${v}`).join(', ')})`
        : '';
      console.log(`    ${which} [${tile.id}] "${tile.label}" → ${actionLabel}${promptTag}`);
      try {
        await executeAction(action);
        ws.send(JSON.stringify({ type: 'ack', id: msg.id } satisfies ServerMsg));
      } catch (err) {
        const message = (err as Error).message;
        console.error('  action failed:', message);
        ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: message } satisfies ServerMsg));
      }
      return;
    }

    if (msg.type === 'slider') {
      if (tile.kind !== 'slider') return;
      if (previewing) return; // no-op during preview
      try {
        const provider = tile.provider ?? 'obs';
        if (provider === 'streamlabs') {
          await streamlabs.setInputVolume(tile.inputName, msg.value);
        } else {
          await obs.setInputVolume(tile.inputName, msg.value);
        }
      } catch (err) {
        const message = (err as Error).message;
        console.error('  slider failed:', message);
        ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: message } satisfies ServerMsg));
      }
      return;
    }

    if (msg.type === 'slider-mute') {
      if (tile.kind !== 'slider') return;
      if (previewing) return; // no-op during preview
      try {
        const provider = tile.provider ?? 'obs';
        if (provider === 'streamlabs') {
          await streamlabs.execute('toggle-mute', { inputName: tile.inputName });
        } else {
          await obs.execute('toggle-mute', { inputName: tile.inputName });
        }
      } catch (err) {
        const message = (err as Error).message;
        console.error('  slider mute failed:', message);
        ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: message } satisfies ServerMsg));
      }
      return;
    }
  });

  ws.on('close', () => console.log('[-] client disconnected'));
});

setPreviewListener(() => {
  broadcastLayout();
  scheduleStateBroadcast();
});
startPreviewWatchdog();

httpServer.listen(PORT, () => {
  console.log(`digi-deck server listening on :${PORT}`);
  console.log(`Open config UI on PC:  ${configUrl()}`);
});

startMdns(PORT);

function openInDefaultBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

function configUrl(): string {
  const scheme = serverConfig.security.httpsEnabled ? 'https' : 'http';
  return `${scheme}://localhost:${PORT}/config`;
}

startTray({
  onOpen: () => openInDefaultBrowser(configUrl()),
  onReload: async () => {
    layout = await reloadLayout();
    const total = layout.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`[tray] reloaded layout: ${layout.pages.length} pages, ${total} buttons`);
    streamers.setLogins(collectStreamerLogins(layout));
    kickStreamers.setSlugs(collectKickStreamerSlugs(layout));
    broadcastLayout();
    scheduleStateBroadcast();
  },
  onRestart: async (name: string) => {
    const integration = getIntegrations().find((i) => i.manifest.name === name);
    if (!integration) {
      console.warn(`[tray] restart requested for unknown integration: ${name}`);
      return;
    }
    console.log(`[tray] restarting ${integration.manifest.displayName} connection`);
    await integration.restart();
  },
  onCheckForUpdates: async () => {
    console.log('[tray] checking for updates');
    const [result, applyAvailable, applyScript] = await Promise.all([
      checkForUpdate(),
      canApplyInPlace(),
      applyScriptPath(),
    ]);
    showUpdateDialog(result, applyAvailable, applyScript);
  },
  onQuit: async () => {
    console.log('[tray] quit requested');
    await shutdown();
  },
}, currentTrayMenu());

function showUpdateDialog(result: UpdateCheck, applyAvailable: boolean, applyScript: string): void {
  const rendered = renderUpdateDialog(result, applyAvailable);
  const { title, body, mode, icon } = rendered;

  // Button mapping per mode:
  //   'apply-or-open' (three buttons):  Yes = Apply now, No = Open GitHub, Cancel = Later
  //   'open-only'    (two buttons):     Yes = Open GitHub, No = Later
  //   'info'         (one button):      OK
  const buttonsKind =
    mode === 'apply-or-open' ? 'YesNoCancel' :
    mode === 'open-only' ? 'YesNo' :
    'OK';

  const psLines: string[] = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    // Invisible topmost owner form so the MessageBox appears on top of whatever
    // is focused (game full-screen, browser, etc.) — a background powershell's
    // MessageBox otherwise easily ends up behind the active window.
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$owner.StartPosition = 'Manual'",
    "$owner.Location = New-Object System.Drawing.Point(-32000, -32000)",
    "$owner.Size = New-Object System.Drawing.Size(1, 1)",
    "$owner.ShowInTaskbar = $false",
    "$owner.FormBorderStyle = 'None'",
    "$owner.Show()",
    "$owner.Activate()",
    `$buttons = [System.Windows.Forms.MessageBoxButtons]::${buttonsKind}`,
    `$icon = [System.Windows.Forms.MessageBoxIcon]::${icon}`,
    `$result = [System.Windows.Forms.MessageBox]::Show($owner, ${psString(body)}, ${psString(title)}, $buttons, $icon)`,
    "$owner.Close()",
  ];
  if (mode === 'apply-or-open') {
    psLines.push(
      `if ($result -eq [System.Windows.Forms.DialogResult]::Yes) {`,
      `  Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psString(applyScript)}`,
      `} elseif ($result -eq [System.Windows.Forms.DialogResult]::No) {`,
      `  Start-Process ${psString(result.url)}`,
      `}`,
    );
  } else if (mode === 'open-only') {
    psLines.push(`if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { Start-Process ${psString(result.url)} }`);
  }

  const script = psLines.join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
    stdio: 'ignore',
    windowsHide: true,
    detached: true,
  }).unref();
}

type DialogMode = 'info' | 'open-only' | 'apply-or-open';

function renderUpdateDialog(r: UpdateCheck, applyAvailable: boolean): { title: string; body: string; mode: DialogMode; icon: 'Information' | 'Warning' | 'Error' } {
  const releaseLabel = (tag: string | null) => tag ?? 'latest commit';
  switch (r.status) {
    case 'up-to-date':
      return {
        title: 'Digi Deck — Up to date',
        body: r.tag
          ? `You're on the latest release: ${r.tag}.`
          : `You're up to date with main.\n\nCommit: ${r.localSha.slice(0, 7)}`,
        mode: 'info',
        icon: 'Information',
      };
    case 'update-available': {
      const headline = r.tag
        ? `New release available: ${r.tag}.`
        : 'New commits available on main.';
      const aheadLine = r.ahead != null && r.ahead > 0
        ? `\n\nYou're ${r.ahead} commit${r.ahead === 1 ? '' : 's'} behind.`
        : '';
      const localLine = r.localSha ? `\n\nLocal:  ${r.localSha.slice(0, 7)}` : '';
      const shaBlock = `${headline}${aheadLine}${localLine}\nRemote: ${r.remoteSha.slice(0, 7)}`;
      if (applyAvailable) {
        return {
          title: 'Digi Deck — Update available',
          body: `${shaBlock}\n\nApply now?  (Yes = pull + rebuild + restart, No = open GitHub, Cancel = later)`,
          mode: 'apply-or-open',
          icon: 'Information',
        };
      }
      return {
        title: 'Digi Deck — Update available',
        body: `${shaBlock}\n\nOpen GitHub to download the update?`,
        mode: 'open-only',
        icon: 'Information',
      };
    }
    case 'dev-build':
      return {
        title: 'Digi Deck — Dev build',
        body: `You're running ahead of the latest release (${releaseLabel(r.tag)}) by ${r.ahead} commit${r.ahead === 1 ? '' : 's'}.\n\nLocal:  ${r.localSha.slice(0, 7)}\nRelease: ${r.remoteSha.slice(0, 7)}\n\nNo update needed.`,
        mode: 'info',
        icon: 'Information',
      };
    case 'unknown-local':
      return {
        title: 'Digi Deck — Update check',
        body: `Couldn't determine the local version. The latest ${r.tag ? `release is ${r.tag}` : `commit is ${r.remoteSha.slice(0, 7)}`}.\n\nOpen GitHub to see what's new?`,
        mode: 'open-only',
        icon: 'Warning',
      };
    case 'error':
      return {
        title: 'Digi Deck — Update check failed',
        body: `Couldn't reach GitHub:\n${r.message}`,
        mode: 'info',
        icon: 'Error',
      };
  }
}

function psString(s: string): string {
  // Single-quoted PowerShell string with `'` doubled per PS escaping rules.
  return `'${s.replace(/'/g, "''")}'`;
}

async function shutdown() {
  stopTray();
  streamers.stop();
  kickStreamers.stop();
  mic.stop();
  await Promise.all(getIntegrations().map((i) => i.stop()));
  stopMdns();
  httpServer.close();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

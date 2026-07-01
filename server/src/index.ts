import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadOrInitLayout, reloadLayout, toPublic, watchLayout, findTile, collectStreamerLogins, collectKickStreamerSlugs, LAYOUT_FILE } from './layout.js';
import { executeAction } from './actions/types.js';
import { handleRequest } from './http.js';
import { loadOrInitConfig, saveConfig, CONFIG_FILE } from './config.js';
import { authorize, isLocalhost } from './auth.js';
import { startMdns, stopMdns } from './mdns.js';
import { migrateAppData } from './migrations.js';
import { getObs } from './integrations/obs.js';
import { getStreamlabs } from './integrations/streamlabs.js';
import { getTwitch } from './integrations/twitch.js';
import { getStreamers } from './integrations/twitch-streamers.js';
import { getKick } from './integrations/kick.js';
import { getKickStreamers } from './integrations/kick-streamers.js';
import { getMic } from './actions/mic.js';
import { computeButtonStates, type ButtonState } from './states.js';
import { startTray, stopTray, updateTrayMenu, type TrayMenu } from './tray.js';
import { spawn } from 'node:child_process';
import type { Layout, PublicLayout } from './layout.js';
import {
  getPreview, previewInfo, setPreviewListener, startPreviewWatchdog,
} from './templates.js';
import { checkForUpdate, type UpdateCheck } from './updates.js';

const PORT = 8765;

type ClientMsg =
  | { type: 'press'; id: number; longPress?: boolean }
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

const obs = getObs();
obs.setConfig(serverConfig.integrations.obs);
void obs.start();

const streamlabs = getStreamlabs();
streamlabs.setConfig(serverConfig.integrations.streamlabs);
void streamlabs.start();

const twitch = getTwitch();
twitch.setConfig(serverConfig.integrations.twitch);
twitch.setSaveCallback(async (cfg) => {
  serverConfig.integrations.twitch = cfg;
  await saveConfig(serverConfig);
});
void twitch.start();

const streamers = getStreamers();
streamers.setLogins(collectStreamerLogins(layout));
streamers.start();

const kick = getKick();
kick.setConfig(serverConfig.integrations.kick);
kick.setSaveCallback(async (cfg) => {
  serverConfig.integrations.kick = cfg;
  await saveConfig(serverConfig);
});
void kick.start();

const kickStreamers = getKickStreamers();
kickStreamers.setSlugs(collectKickStreamerSlugs(layout));
kickStreamers.start();

const mic = getMic();
mic.start();

function activeLayout(): Layout { return getPreview()?.layout ?? layout; }

function currentTrayMenu(): TrayMenu {
  return {
    obs:        !!serverConfig.integrations.obs.enabled,
    streamlabs: !!serverConfig.integrations.streamlabs.enabled,
    twitch:     !!serverConfig.integrations.twitch.enabled,
    kick:       !!serverConfig.integrations.kick.enabled,
  };
}

const httpServer = createServer((req, res) => {
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
});

const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, cb) => {
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

obs.onChange(scheduleStateBroadcast);
streamlabs.onChange(scheduleStateBroadcast);
twitch.onChange(() => {
  scheduleStateBroadcast();
  // Twitch just reconnected — refresh streamer info so thumbnails appear without waiting a minute.
  if (twitch.status().state === 'connected') streamers.refresh();
});
streamers.onChange(scheduleStateBroadcast);
kick.onChange(() => {
  scheduleStateBroadcast();
  if (kick.status().state === 'connected') kickStreamers.refresh();
});
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
      const action = msg.longPress && tile.longPressAction ? tile.longPressAction : tile.action;
      const actionLabel = Array.isArray(action)
        ? `[${action.length} steps: ${action.map((s) => s.type).join(' → ')}]`
        : action.type;
      const which = msg.longPress && tile.longPressAction ? 'long-press' : 'press';
      console.log(`    ${which} [${tile.id}] "${tile.label}" → ${actionLabel}`);
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
  console.log(`Open config UI on PC:  http://localhost:${PORT}/config`);
});

startMdns(PORT);

function openInDefaultBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

startTray({
  onOpen: () => openInDefaultBrowser(`http://localhost:${PORT}/config`),
  onReload: async () => {
    layout = await reloadLayout();
    const total = layout.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`[tray] reloaded layout: ${layout.pages.length} pages, ${total} buttons`);
    streamers.setLogins(collectStreamerLogins(layout));
    kickStreamers.setSlugs(collectKickStreamerSlugs(layout));
    broadcastLayout();
    scheduleStateBroadcast();
  },
  onRestartObs: async () => {
    console.log('[tray] restarting OBS connection');
    await obs.restart();
  },
  onRestartTwitch: async () => {
    console.log('[tray] restarting Twitch connection');
    await twitch.restart();
  },
  onRestartStreamlabs: async () => {
    console.log('[tray] restarting Streamlabs connection');
    await streamlabs.restart();
  },
  onRestartKick: async () => {
    console.log('[tray] restarting Kick connection');
    await kick.restart();
  },
  onCheckForUpdates: async () => {
    console.log('[tray] checking for updates');
    const result = await checkForUpdate();
    showUpdateDialog(result);
  },
  onQuit: async () => {
    console.log('[tray] quit requested');
    await shutdown();
  },
}, currentTrayMenu());

function showUpdateDialog(result: UpdateCheck): void {
  const { title, body, openRepo, icon } = renderUpdateDialog(result);
  const psLines: string[] = [
    "Add-Type -AssemblyName System.Windows.Forms",
    `$buttons = [System.Windows.Forms.MessageBoxButtons]::${openRepo ? 'YesNo' : 'OK'}`,
    `$icon = [System.Windows.Forms.MessageBoxIcon]::${icon}`,
    `$result = [System.Windows.Forms.MessageBox]::Show(${psString(body)}, ${psString(title)}, $buttons, $icon)`,
  ];
  if (openRepo) {
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

function renderUpdateDialog(r: UpdateCheck): { title: string; body: string; openRepo: boolean; icon: 'Information' | 'Warning' | 'Error' } {
  const releaseLabel = (tag: string | null) => tag ?? 'latest commit';
  switch (r.status) {
    case 'up-to-date':
      return {
        title: 'Digi Deck — Up to date',
        body: r.tag
          ? `You're on the latest release: ${r.tag}.`
          : `You're up to date with main.\n\nCommit: ${r.localSha.slice(0, 7)}`,
        openRepo: false,
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
      return {
        title: 'Digi Deck — Update available',
        body: `${headline}${aheadLine}${localLine}\nRemote: ${r.remoteSha.slice(0, 7)}\n\nOpen GitHub to download the update?`,
        openRepo: true,
        icon: 'Information',
      };
    }
    case 'dev-build':
      return {
        title: 'Digi Deck — Dev build',
        body: `You're running ahead of the latest release (${releaseLabel(r.tag)}) by ${r.ahead} commit${r.ahead === 1 ? '' : 's'}.\n\nLocal:  ${r.localSha.slice(0, 7)}\nRelease: ${r.remoteSha.slice(0, 7)}\n\nNo update needed.`,
        openRepo: false,
        icon: 'Information',
      };
    case 'unknown-local':
      return {
        title: 'Digi Deck — Update check',
        body: `Couldn't determine the local version. The latest ${r.tag ? `release is ${r.tag}` : `commit is ${r.remoteSha.slice(0, 7)}`}.\n\nOpen GitHub to see what's new?`,
        openRepo: true,
        icon: 'Warning',
      };
    case 'error':
      return {
        title: 'Digi Deck — Update check failed',
        body: `Couldn't reach GitHub:\n${r.message}`,
        openRepo: false,
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
  await obs.stop();
  await streamlabs.stop();
  await twitch.stop();
  await kick.stop();
  stopMdns();
  httpServer.close();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { loadOrInitLayout, reloadLayout, toPublic, watchLayout, findButton, LAYOUT_FILE } from './layout.js';
import { executeAction } from './actions/types.js';
import { handleRequest } from './http.js';
import { loadOrInitConfig, saveConfig, CONFIG_FILE } from './config.js';
import { authorize, isLocalhost } from './auth.js';
import { startMdns, stopMdns } from './mdns.js';
import { migrateAppData } from './migrations.js';
import { getObs } from './integrations/obs.js';
import { getTwitch } from './integrations/twitch.js';
import { computeButtonStates, type ButtonState } from './states.js';
import { startTray, stopTray } from './tray.js';
import { spawn } from 'node:child_process';
import type { Layout, PublicLayout } from './layout.js';

const PORT = 8765;

type ClientMsg = { type: 'press'; id: number };
type ServerMsg =
  | { type: 'layout'; layout: PublicLayout }
  | { type: 'ack'; id: number }
  | { type: 'states'; states: ButtonState[] };

await migrateAppData();
const serverConfig = await loadOrInitConfig();
let layout: Layout = await loadOrInitLayout();
console.log(`layout: ${LAYOUT_FILE} (${layout.pages.length} pages, ${layout.pages.reduce((n, p) => n + p.buttons.length, 0)} buttons)`);
console.log(`config: ${CONFIG_FILE} (token loaded)`);

const obs = getObs();
obs.setConfig(serverConfig.integrations.obs);
void obs.start();

const twitch = getTwitch();
twitch.setConfig(serverConfig.integrations.twitch);
twitch.setSaveCallback(async (cfg) => {
  serverConfig.integrations.twitch = cfg;
  await saveConfig(serverConfig);
});
void twitch.start();

const httpServer = createServer((req, res) => {
  handleRequest(req, res, { getLayout: () => layout, getServerConfig: () => serverConfig })
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
  const data = JSON.stringify({ type: 'layout', layout: toPublic(layout) } satisfies ServerMsg);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastStates() {
  const states = computeButtonStates(layout, obs.status(), twitch.status());
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
twitch.onChange(scheduleStateBroadcast);

watchLayout(async () => {
  try {
    layout = await reloadLayout();
    const total = layout.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`[layout reloaded] ${layout.pages.length} pages, ${total} buttons`);
    broadcastLayout();
    scheduleStateBroadcast();
  } catch (err) {
    console.error('failed to reload layout (keeping old one):', (err as Error).message);
  }
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[+] client connected');
  ws.send(JSON.stringify({ type: 'layout', layout: toPublic(layout) } satisfies ServerMsg));
  ws.send(JSON.stringify({
    type: 'states',
    states: computeButtonStates(layout, obs.status(), twitch.status()),
  } satisfies ServerMsg));

  ws.on('message', async (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.type !== 'press') return;
    const button = findButton(layout, msg.id);
    if (!button) {
      console.warn(`unknown button id: ${msg.id}`);
      return;
    }
    console.log(`    press [${button.id}] "${button.label}" → ${button.action.type}`);
    try {
      await executeAction(button.action);
      ws.send(JSON.stringify({ type: 'ack', id: msg.id } satisfies ServerMsg));
    } catch (err) {
      console.error('  action failed:', (err as Error).message);
    }
  });

  ws.on('close', () => console.log('[-] client disconnected'));
});

httpServer.listen(PORT, () => {
  console.log(`digi-deck server listening on :${PORT}`);
  console.log('Open config UI on PC:  http://localhost:5173/config');
});

startMdns(PORT);

function openInDefaultBrowser(url: string): void {
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
}

startTray({
  onOpen: () => openInDefaultBrowser('http://localhost:5173/config'),
  onReload: async () => {
    layout = await reloadLayout();
    const total = layout.pages.reduce((n, p) => n + p.buttons.length, 0);
    console.log(`[tray] reloaded layout: ${layout.pages.length} pages, ${total} buttons`);
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
  onQuit: async () => {
    console.log('[tray] quit requested');
    await shutdown();
  },
});

async function shutdown() {
  stopTray();
  await obs.stop();
  await twitch.stop();
  stopMdns();
  httpServer.close();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

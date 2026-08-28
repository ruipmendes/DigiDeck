import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadOrGenerateCert } from './https-cert.js';
import { loadOrInitLayout, reloadLayout, toPublic, watchLayout, findTile, collectStreamerLogins, collectKickStreamerSlugs, collectObsSceneNames, layoutUsesAppAudioSlider, layoutSystemMetricsNeeded, LAYOUT_FILE } from './layout.js';
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
import { getDiscord } from './integrations/discord.js';
import { getSpotify } from './integrations/spotify.js';
import { getHue } from './integrations/hue.js';
import { getHomeAssistant } from './integrations/homeassistant.js';
import { getOpenRgb } from './integrations/openrgb.js';
import { getNanoleaf } from './integrations/nanoleaf.js';
import { getAppAudio } from './actions/appAudio.js';
import { ensureIconPacksDir } from './icon-packs.js';
import { getSystemMetrics } from './system-metrics.js';
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
  | { type: 'slider-mute'; id: number }
  | { type: 'voice-panel-volume'; id: number; userId: string; value: number }
  | { type: 'voice-panel-mute'; id: number; userId: string };
type ServerMsg =
  | { type: 'layout'; layout: PublicLayout; preview?: { name: string; title: string } }
  | { type: 'ack'; id: number }
  | { type: 'nack'; id: number; error: string }
  | { type: 'states'; states: ButtonState[]; meta?: LiveMeta };

/** Global integration state used for dynamic tile labels (e.g. "REC 01:23:45").
 *  Sent alongside per-tile ButtonState so the phone has everything it needs to
 *  render templates without additional polling. */
type LiveMeta = {
  obs?: {
    recording?: boolean;
    streaming?: boolean;
    recordingStartedAtMs?: number;
    streamingStartedAtMs?: number;
    droppedFrames?: number;
    currentScene?: string;
  };
  discord?: {
    currentVoiceChannelName?: string | null;
    mute?: boolean;
    deaf?: boolean;
  };
  spotify?: {
    isPlaying?: boolean;
    track?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
    volumePercent?: number;
  };
  kick?: {
    isLive?: boolean;
    viewerCount?: number;
  };
  system?: {
    cpuPercent?: number;
    ramPercent?: number;
    gpuPercent?: number;
  };
};

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
const discord = getDiscord();
const spotify = getSpotify();
const hue = getHue();
const homeassistant = getHomeAssistant();
getOpenRgb(); // registered via getter; no local ref needed (no state broadcasts consume it)
const nanoleaf = getNanoleaf();
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

// Same pattern for OBS scene-preview thumbnails: only fetch screenshots for
// scenes actually referenced by set-scene tiles in the current layout.
obs.setTrackedScenes(collectObsSceneNames(layout));

const mic = getMic();
mic.start();

// Materialize the icon-packs dir on first run so the picker's help text
// points at a real folder — no "hunt for a hidden AppData path" step.
void ensureIconPacksDir();

// Per-app audio (Discord ducking, Spotify volume, etc.) only polls the Core
// Audio session list while there's a slider tile that needs the live values.
// Actions fire ad-hoc without a subscription. Refcount-based: subscribe when
// the layout brings a slider in, release when it goes away.
const appAudio = getAppAudio();
let appAudioSliderUnsub: (() => void) | null = null;
function reconcileAppAudioSliderPoll(l: Layout): void {
  const needed = layoutUsesAppAudioSlider(l);
  if (needed && !appAudioSliderUnsub) {
    appAudioSliderUnsub = appAudio.subscribe();
  } else if (!needed && appAudioSliderUnsub) {
    appAudioSliderUnsub();
    appAudioSliderUnsub = null;
  }
}
reconcileAppAudioSliderPoll(layout);
appAudio.onChange(() => scheduleStateBroadcast());

// System metrics (CPU / RAM / GPU) — poll schedule is driven by whether any
// chart tile in the current layout references a system.* source. Zero cost
// on layouts that don't chart system metrics.
const systemMetrics = getSystemMetrics();
function reconcileSystemMetrics(l: Layout): void {
  systemMetrics.setNeeded(layoutSystemMetricsNeeded(l));
}
reconcileSystemMetrics(layout);
systemMetrics.onChange(() => scheduleStateBroadcast());

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

function buildLiveMeta(): LiveMeta {
  const obsStatus = obs.status();
  const discordStatus = discord.status();
  return {
    obs: {
      recording: obsStatus.recording,
      streaming: obsStatus.streaming,
      recordingStartedAtMs: obsStatus.recordingStartedAtMs,
      streamingStartedAtMs: obsStatus.streamingStartedAtMs,
      droppedFrames: obsStatus.droppedFrames,
      currentScene: obsStatus.currentScene,
    },
    discord: {
      currentVoiceChannelName: discordStatus.currentVoiceChannelName,
      mute: discordStatus.mute,
      deaf: discordStatus.deaf,
    },
    spotify: (() => {
      const s = spotify.status();
      return {
        isPlaying: s.isPlaying,
        track: s.track,
        artist: s.artist,
        album: s.album,
        coverUrl: s.coverUrl,
        volumePercent: s.volumePercent,
      };
    })(),
    kick: (() => {
      const s = kick.status();
      return {
        isLive: s.isLive,
        viewerCount: s.viewerCount,
      };
    })(),
    system: systemMetrics.status(),
  };
}

function broadcastStates() {
  const obsStatus = obs.status();
  const discordStatus = discord.status();
  const states = computeButtonStates(activeLayout(), obsStatus, twitch.status(), streamlabs.status(), kick.status(), discordStatus);
  const meta = buildLiveMeta();
  const data = JSON.stringify({ type: 'states', states, meta } satisfies ServerMsg);
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
    obs.setTrackedScenes(collectObsSceneNames(layout));
    reconcileAppAudioSliderPoll(layout);
    reconcileSystemMetrics(layout);
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
  // Same meta the periodic broadcast sends. Without this, a phone that
  // connects mid-session gets zero liveMeta until an integration state
  // changes — which never happens if you were already in a voice channel
  // when you paired the phone, so dynamic labels like {discord.channel}
  // silently render as empty.
  ws.send(JSON.stringify({
    type: 'states',
    states: computeButtonStates(activeLayout(), obs.status(), twitch.status(), streamlabs.status(), kick.status(), discord.status()),
    meta: buildLiveMeta(),
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
        } else if (provider === 'discord') {
          await discord.setSliderVolume(tile.inputName === 'output' ? 'output' : 'input', msg.value);
        } else if (provider === 'spotify') {
          // Slider protocol is 0..1; Spotify wants 0..100.
          await spotify.setPlayerVolume(msg.value * 100);
        } else if (provider === 'app-audio') {
          await getAppAudio().setVolume(tile.inputName, msg.value);
        } else if (provider === 'hue') {
          await hue.setBrightness(tile.inputName, msg.value);
        } else if (provider === 'homeassistant') {
          await homeassistant.setSliderValue(tile.inputName, msg.value);
        } else if (provider === 'nanoleaf') {
          await nanoleaf.setBrightness(msg.value);
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
        } else if (provider === 'discord') {
          // Input slider mutes the mic (self-mute); output slider deafens.
          await discord.execute(tile.inputName === 'output' ? 'toggle-deafen' : 'toggle-mute');
        } else if (provider === 'spotify') {
          // Spotify volume slider "mute" == toggle play/pause: the natural
          // "silence" action for a music tile.
          await spotify.execute('toggle-play');
        } else if (provider === 'app-audio') {
          await getAppAudio().toggleMute(tile.inputName);
        } else if (provider === 'hue') {
          // Tap on a Hue slider toggles the light's power. Uses the same
          // "light:<id>" / "room:<id>" inputName encoding as setBrightness.
          const [kind, id] = tile.inputName.split(':');
          await hue.execute(kind === 'room' ? 'room-toggle' : 'light-toggle', kind === 'room' ? { roomId: id } : { lightId: id });
        } else if (provider === 'homeassistant') {
          await homeassistant.toggleSlider(tile.inputName);
        } else if (provider === 'nanoleaf') {
          await nanoleaf.togglePower();
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

    if (msg.type === 'voice-panel-volume') {
      if (tile.kind !== 'discord-voice-panel') return;
      if (previewing) return;
      try {
        // Client sends 0..1 to match the slider protocol; map to Discord's 0..200.
        const volume = Math.max(0, Math.min(200, Math.round(msg.value * 200)));
        await discord.setChannelMemberVolume(msg.userId, volume);
      } catch (err) {
        const message = (err as Error).message;
        console.error('  voice-panel volume failed:', message);
        ws.send(JSON.stringify({ type: 'nack', id: msg.id, error: message } satisfies ServerMsg));
      }
      return;
    }

    if (msg.type === 'voice-panel-mute') {
      if (tile.kind !== 'discord-voice-panel') return;
      if (previewing) return;
      try {
        const cur = discord.status().channelMembers?.find((m) => m.id === msg.userId);
        await discord.setChannelMemberMute(msg.userId, !cur?.ourMute);
      } catch (err) {
        const message = (err as Error).message;
        console.error('  voice-panel mute failed:', message);
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
    obs.setTrackedScenes(collectObsSceneNames(layout));
    reconcileAppAudioSliderPoll(layout);
    reconcileSystemMetrics(layout);
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
}, currentTrayMenu(), readServerVersion());

function readServerVersion(): string {
  // index.ts lives at server/src/index.ts in dev (tsx) and server/dist/index.js
  // in prod (tsc). Both resolve one level up to `server/`, where package.json
  // lives — so the version stays authoritative without duplicating the string.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolvePath(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch (err) {
    console.warn('[tray] could not read package.json version:', (err as Error).message);
    return 'unknown';
  }
}

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

import type { Layout, Page } from './types';
import { getStoredToken, storeToken } from './token';

/**
 * Every /api/* call goes through this wrapper. It adds an Authorization: Bearer
 * header when a token is stored — the server no longer bypasses auth on
 * localhost, so the config UI must have the token to hit anything except the
 * bootstrap /api/pairing endpoint below.
 */
async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

/**
 * On the config UI's first load (running at localhost:8765/config), no token
 * exists in localStorage yet. Fetch it once from /api/pairing (which stays
 * localhost-gated on the server as the bootstrap route), then use it for every
 * subsequent call. Safe no-op when a token is already present.
 */
export async function bootstrapTokenIfNeeded(): Promise<string | null> {
  const existing = getStoredToken();
  if (existing) return existing;
  try {
    const res = await apiFetch('/api/pairing');
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (typeof data.token !== 'string' || !data.token) return null;
    storeToken(data.token);
    return data.token;
  } catch {
    return null;
  }
}

export async function getLayout(): Promise<Layout> {
  const res = await apiFetch('/api/layout');
  if (!res.ok) throw new Error(`GET /api/layout failed: ${res.status}`);
  return res.json();
}

export async function putLayout(layout: Layout): Promise<void> {
  const res = await apiFetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT /api/layout failed: ${res.status}`);
  }
}

// ─── Templates / Preview ────────────────────────────────────────

export type TemplateMeta = { name: string; title: string; description: string };
export type PreviewInfo = { name: string; title: string };

export async function listTemplates(): Promise<{ templates: TemplateMeta[]; preview: PreviewInfo | null }> {
  const res = await apiFetch('/api/templates');
  if (!res.ok) throw new Error(`templates list failed: ${res.status}`);
  return res.json();
}

export async function getTemplate(name: string): Promise<unknown> {
  const res = await apiFetch(`/api/templates/${encodeURIComponent(name)}`);
  if (!res.ok) {
    let msg = `template fetch failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function startTemplatePreview(name: string, title: string, bundle: unknown): Promise<void> {
  const res = await apiFetch('/api/templates/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, title, bundle }),
  });
  if (!res.ok) {
    let msg = `preview start failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

export async function heartbeatPreview(): Promise<boolean> {
  const res = await apiFetch('/api/templates/preview/heartbeat', { method: 'POST' });
  return res.ok;
}

export async function exitPreview(): Promise<void> {
  await apiFetch('/api/templates/preview', { method: 'DELETE' });
}

/** Best-effort cleanup when the tab closes — uses fetch with keepalive so it can ship after unload. */
export function exitPreviewBeacon(): void {
  void apiFetch('/api/templates/preview', { method: 'DELETE', keepalive: true });
}

export async function applyPreview(): Promise<Layout> {
  const res = await apiFetch('/api/templates/apply', { method: 'POST' });
  if (!res.ok) {
    let msg = `apply failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const out = await res.json();
  return out.layout as Layout;
}

/** Download the current layout (with embedded images) as a JSON file. */
export async function exportLayoutBundle(): Promise<void> {
  const res = await apiFetch('/api/layout/export');
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const blob = await res.blob();
  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `digi-deck-layout-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Read a bundle file and replace the current layout with its contents. Returns the new layout. */
export async function importLayoutBundle(file: File): Promise<Layout> {
  const text = await file.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('not a valid JSON file'); }
  const res = await apiFetch('/api/layout/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `import failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const out = await res.json();
  return out.layout as Layout;
}

/**
 * Pops a native file dialog on the PC running the server and returns the
 * chosen path (null if the user cancelled). Used by the Launch action
 * editor so users can browse for an app instead of typing/pasting its path.
 */
export async function browseForFile(opts?: {
  title?: string;
  initialDir?: string;
  filter?: string;
}): Promise<string | null> {
  const res = await apiFetch('/api/system/browse-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) {
    let msg = `browse failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return typeof data.path === 'string' && data.path.length > 0 ? data.path : null;
}

export async function uploadImage(file: File): Promise<{ filename: string }> {
  const buf = await file.arrayBuffer();
  const res = await apiFetch('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) {
    let msg = `upload failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function deleteImage(filename: string): Promise<void> {
  const res = await apiFetch(`/api/images/file/${encodeURIComponent(filename)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete failed: ${res.status}`);
  }
}

/** Build a fetchable URL for a stored image. Appends token if one is stored. */
export function imageUrl(filename: string): string {
  const base = `/api/images/file/${encodeURIComponent(filename)}`;
  const token = getStoredToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * Count references to `filename` across the layout, optionally excluding a specific location.
 *
 * Exclude shapes:
 * - `{ tileId }` — skip this tile's `image` field
 * - `{ pageId }` — skip all of this page's image fields (both `image` and `backgroundImage`)
 * - `{ pageId, field }` — skip only that one page-level field, so removing one doesn't
 *   make the other on the same page look orphaned.
 */
export function imageReferenceCount(
  layout: Layout,
  filename: string,
  exclude?: { tileId?: number; pageId?: number; field?: 'image' | 'backgroundImage' },
): number {
  let n = 0;
  for (const p of layout.pages) {
    const excludeImage = exclude?.pageId === p.id && (exclude.field === undefined || exclude.field === 'image');
    const excludeBg    = exclude?.pageId === p.id && (exclude.field === undefined || exclude.field === 'backgroundImage');
    if (p.image === filename && !excludeImage) n++;
    if (p.backgroundImage === filename && !excludeBg) n++;
    for (const t of p.buttons) {
      if (t.kind === 'blank') continue;
      if (t.image === filename && exclude?.tileId !== t.id) n++;
    }
  }
  return n;
}

export function pageImages(page: Page): string[] {
  const out: string[] = [];
  if (page.image) out.push(page.image);
  if (page.backgroundImage) out.push(page.backgroundImage);
  for (const t of page.buttons) {
    if (t.kind === 'blank') continue;
    if (t.image) out.push(t.image);
  }
  return out;
}

export type Pairing = { token: string; urls: string[] };

export async function getPairing(): Promise<Pairing> {
  const res = await apiFetch('/api/pairing');
  if (!res.ok) throw new Error(`GET /api/pairing failed: ${res.status}`);
  return res.json();
}

export type ObsConfig = {
  enabled: boolean;
  host: string;
  port: number;
  password: string;
};

export type ObsState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ObsStatus = {
  state: ObsState;
  error?: string;
  scenes: string[];
  inputs: string[];
  /** Subset of inputs that are media (ffmpeg/vlc) sources. Filters the picker for media-* ops. */
  mediaInputs?: string[];
  /** Subset of inputs that are browser sources. Filters the picker for refresh-browser-source. */
  browserSources?: string[];
  sceneItems: Record<string, string[]>;
  /** "<sceneName>::<sourceName>" → visible. Use for at-a-glance state in pickers. */
  sourceStates: Record<string, boolean>;
  currentScene?: string;
  retryStopped: boolean;
  /** Whether OBS is currently recording. */
  recording?: boolean;
  streaming?: boolean;
  /** Epoch-ms when the current recording started — the client uses this to tick
   *  a live "REC 01:23:45" label between broadcasts. Undefined when not recording. */
  recordingStartedAtMs?: number;
  streamingStartedAtMs?: number;
  droppedFrames?: number;
  /** Live scene preview thumbnails — sceneName → data URL. Populated by the
   *  server for scenes referenced by set-scene tiles in the current layout. */
  sceneThumbnails?: Record<string, string>;
};

export type ObsState_API = { config: ObsConfig; status: ObsStatus };

export async function getObsState(): Promise<ObsState_API> {
  const res = await apiFetch('/api/integrations/obs');
  if (!res.ok) throw new Error(`GET /api/integrations/obs failed: ${res.status}`);
  return res.json();
}

export async function putObsConfig(config: ObsConfig): Promise<ObsState_API> {
  const res = await apiFetch('/api/integrations/obs/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT obs config failed: ${res.status}`);
  }
  return res.json();
}

export async function reconnectObs(): Promise<ObsState_API> {
  const res = await apiFetch('/api/integrations/obs/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

// ─── Streamlabs Desktop ─────────────────────────────────────────

export type StreamlabsState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type StreamlabsStatus = {
  state: StreamlabsState;
  error?: string;
  scenes: string[];
  inputs: string[];
  sceneItems: Record<string, string[]>;
  sourceStates: Record<string, boolean>;
  currentScene?: string;
  recording: boolean;
  streaming: boolean;
  virtualCam: boolean;
  replayBuffer: boolean;
  mutedInputs: string[];
  inputVolumes: Record<string, number>;
  retryStopped: boolean;
};

export type StreamlabsPublicConfig = {
  enabled: boolean;
  host: string;
  port: number;
  hasToken: boolean;
};

export type StreamlabsState_API = { config: StreamlabsPublicConfig; status: StreamlabsStatus };

export async function getStreamlabsState(): Promise<StreamlabsState_API> {
  const res = await apiFetch('/api/integrations/streamlabs');
  if (!res.ok) throw new Error(`GET /api/integrations/streamlabs failed: ${res.status}`);
  return res.json();
}

export async function putStreamlabsConfig(c: { enabled: boolean; host: string; port: number; token?: string }): Promise<StreamlabsState_API> {
  const res = await apiFetch('/api/integrations/streamlabs/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT streamlabs config failed: ${res.status}`);
  }
  return res.json();
}

export async function reconnectStreamlabs(): Promise<StreamlabsState_API> {
  const res = await apiFetch('/api/integrations/streamlabs/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

export type TwitchState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type TwitchStatus = {
  state: TwitchState;
  error?: string;
  username?: string;
  channel?: string;
};

export type TwitchPublicConfig = {
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  hasRefreshToken: boolean;
  username: string;
};

export type TwitchState_API = { config: TwitchPublicConfig; status: TwitchStatus };

export async function getTwitchState(): Promise<TwitchState_API> {
  const res = await apiFetch('/api/integrations/twitch');
  if (!res.ok) throw new Error(`GET twitch failed: ${res.status}`);
  return res.json();
}

export async function putTwitchConfig(c: { enabled: boolean; clientId: string; clientSecret?: string }): Promise<TwitchState_API> {
  const res = await apiFetch('/api/integrations/twitch/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT twitch config failed: ${res.status}`);
  }
  return res.json();
}

export async function getTwitchAuthorize(): Promise<{ url: string }> {
  const res = await apiFetch('/api/integrations/twitch/authorize');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `authorize failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectTwitch(): Promise<TwitchState_API> {
  const res = await apiFetch('/api/integrations/twitch/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectTwitch(): Promise<TwitchState_API> {
  const res = await apiFetch('/api/integrations/twitch/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

// ─── Spotify ────────────────────────────────────────────────────

export type SpotifyState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type SpotifyStatus = {
  state: SpotifyState;
  error?: string;
  username?: string;
  isPremium?: boolean;
  isPlaying?: boolean;
  track?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  deviceName?: string;
  volumePercent?: number;
};

export type SpotifyPublicConfig = {
  enabled: boolean;
  clientId: string;
  hasRefreshToken: boolean;
  username: string;
  isPremium: boolean;
};

export type SpotifyState_API = { config: SpotifyPublicConfig; status: SpotifyStatus };

export async function getSpotifyState(): Promise<SpotifyState_API> {
  const res = await apiFetch('/api/integrations/spotify');
  if (!res.ok) throw new Error(`GET spotify failed: ${res.status}`);
  return res.json();
}

export async function putSpotifyConfig(c: { enabled: boolean; clientId: string }): Promise<SpotifyState_API> {
  const res = await apiFetch('/api/integrations/spotify/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT spotify config failed: ${res.status}`);
  }
  return res.json();
}

export async function getSpotifyAuthorize(): Promise<{ url: string }> {
  const res = await apiFetch('/api/integrations/spotify/authorize');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `authorize failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectSpotify(): Promise<SpotifyState_API> {
  const res = await apiFetch('/api/integrations/spotify/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectSpotify(): Promise<SpotifyState_API> {
  const res = await apiFetch('/api/integrations/spotify/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

export async function recheckSpotifySubscription(): Promise<SpotifyState_API> {
  const res = await apiFetch('/api/integrations/spotify/recheck', { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `recheck failed: ${res.status}`);
  }
  return res.json();
}

// ─── Icon packs ─────────────────────────────────────────────────

export type IconPack = { name: string; icons: string[] };

export async function listIconPacks(): Promise<{ packs: IconPack[]; dir: string }> {
  const res = await apiFetch('/api/icon-packs');
  if (!res.ok) throw new Error(`GET icon-packs failed: ${res.status}`);
  return res.json();
}

export async function refreshIconPacks(): Promise<{ packs: IconPack[]; dir: string }> {
  const res = await apiFetch('/api/icon-packs/refresh', { method: 'POST' });
  if (!res.ok) throw new Error(`POST icon-packs/refresh failed: ${res.status}`);
  return res.json();
}

/** URL for one pack SVG — includes token when one is stored so <img src>
 *  passes auth (the phone browser can't add an Authorization header there). */
export function iconPackUrl(pack: string, iconName: string): string {
  const base = `/api/icon-packs/${encodeURIComponent(pack)}/${iconName.split('/').map(encodeURIComponent).join('/')}.svg`;
  const token = getStoredToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

// ─── App-audio ──────────────────────────────────────────────────

export type AppAudioSession = {
  name: string;
  pids: number[];
  volume: number;
  muted: boolean;
};

export async function getAppAudioSessions(): Promise<AppAudioSession[]> {
  const res = await apiFetch('/api/app-audio/sessions');
  if (!res.ok) throw new Error(`GET app-audio sessions failed: ${res.status}`);
  const body = await res.json() as { sessions?: AppAudioSession[] };
  return body.sessions ?? [];
}

// ─── Philips Hue ────────────────────────────────────────────────

export type HueState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type HueLight  = { id: string; name: string; on: boolean; brightness?: number };
export type HueRoom   = { id: string; name: string; groupedLightId: string; on: boolean; brightness?: number };
export type HueScene  = { id: string; name: string; groupName?: string };

export type HueStatus = {
  state: HueState;
  error?: string;
  bridgeIp?: string;
  bridgeName?: string;
  lights?: HueLight[];
  rooms?: HueRoom[];
  scenes?: HueScene[];
};

export type HuePublicConfig = {
  enabled: boolean;
  bridgeIp: string;
  bridgeId: string;
  hasApplicationKey: boolean;
};

export type HueState_API = { config: HuePublicConfig; status: HueStatus };

export async function getHueState(): Promise<HueState_API> {
  const res = await apiFetch('/api/integrations/hue');
  if (!res.ok) throw new Error(`GET hue failed: ${res.status}`);
  return res.json();
}

export async function putHueConfig(c: { enabled: boolean; bridgeIp: string }): Promise<HueState_API> {
  const res = await apiFetch('/api/integrations/hue/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT hue config failed: ${res.status}`);
  }
  return res.json();
}

export async function connectHue(): Promise<HueState_API> {
  const res = await apiFetch('/api/integrations/hue/connect', { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Hue connect failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectHue(): Promise<HueState_API> {
  const res = await apiFetch('/api/integrations/hue/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`Hue disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectHue(): Promise<HueState_API> {
  const res = await apiFetch('/api/integrations/hue/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`Hue reconnect failed: ${res.status}`);
  return res.json();
}

export async function discoverHueBridges(): Promise<Array<{ id: string; ip: string; port?: number }>> {
  const res = await apiFetch('/api/integrations/hue/discover');
  if (!res.ok) throw new Error(`Hue discover failed: ${res.status}`);
  const body = await res.json() as { bridges?: Array<{ id: string; ip: string; port?: number }> };
  return body.bridges ?? [];
}

// ─── Home Assistant ─────────────────────────────────────────────

export type HomeAssistantState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type HomeAssistantEntity = {
  id: string;
  name: string;
  domain: string;
  state: string;
  on: boolean;
  level?: number;
};

export type HomeAssistantStatus = {
  state: HomeAssistantState;
  error?: string;
  baseUrl?: string;
  version?: string;
  entities?: HomeAssistantEntity[];
};

export type HomeAssistantPublicConfig = {
  enabled: boolean;
  baseUrl: string;
  hasToken: boolean;
};

export type HomeAssistantState_API = { config: HomeAssistantPublicConfig; status: HomeAssistantStatus };

export async function getHomeAssistantState(): Promise<HomeAssistantState_API> {
  const res = await apiFetch('/api/integrations/homeassistant');
  if (!res.ok) throw new Error(`GET homeassistant failed: ${res.status}`);
  return res.json();
}

export async function putHomeAssistantConfig(c: { enabled: boolean; baseUrl: string; token?: string | null }): Promise<HomeAssistantState_API> {
  const res = await apiFetch('/api/integrations/homeassistant/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT homeassistant config failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectHomeAssistant(): Promise<HomeAssistantState_API> {
  const res = await apiFetch('/api/integrations/homeassistant/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectHomeAssistant(): Promise<HomeAssistantState_API> {
  const res = await apiFetch('/api/integrations/homeassistant/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

// ─── OpenRGB ────────────────────────────────────────────────────

export type OpenRgbState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type OpenRgbStatus = {
  state: OpenRgbState;
  error?: string;
  host?: string;
  port?: number;
  deviceCount?: number;
  profiles?: string[];
};

export type OpenRgbPublicConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export type OpenRgbState_API = { config: OpenRgbPublicConfig; status: OpenRgbStatus };

export async function getOpenRgbState(): Promise<OpenRgbState_API> {
  const res = await apiFetch('/api/integrations/openrgb');
  if (!res.ok) throw new Error(`GET openrgb failed: ${res.status}`);
  return res.json();
}

export async function putOpenRgbConfig(c: { enabled: boolean; host: string; port: number }): Promise<OpenRgbState_API> {
  const res = await apiFetch('/api/integrations/openrgb/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT openrgb config failed: ${res.status}`);
  }
  return res.json();
}

export async function reconnectOpenRgb(): Promise<OpenRgbState_API> {
  const res = await apiFetch('/api/integrations/openrgb/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

// ─── Nanoleaf ───────────────────────────────────────────────────

export type NanoleafState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type NanoleafStatus = {
  state: NanoleafState;
  error?: string;
  host?: string;
  name?: string;
  isOn?: boolean;
  brightness?: number;
  currentEffect?: string;
  effects?: string[];
  panelCount?: number;
  firmwareVersion?: string;
};

export type NanoleafPublicConfig = {
  enabled: boolean;
  host: string;
  hasAuthToken: boolean;
};

export type NanoleafState_API = { config: NanoleafPublicConfig; status: NanoleafStatus };

export async function getNanoleafState(): Promise<NanoleafState_API> {
  const res = await apiFetch('/api/integrations/nanoleaf');
  if (!res.ok) throw new Error(`GET nanoleaf failed: ${res.status}`);
  return res.json();
}

export async function putNanoleafConfig(c: { enabled: boolean; host: string }): Promise<NanoleafState_API> {
  const res = await apiFetch('/api/integrations/nanoleaf/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT nanoleaf config failed: ${res.status}`);
  }
  return res.json();
}

export async function connectNanoleaf(): Promise<NanoleafState_API> {
  const res = await apiFetch('/api/integrations/nanoleaf/connect', { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Nanoleaf connect failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectNanoleaf(): Promise<NanoleafState_API> {
  const res = await apiFetch('/api/integrations/nanoleaf/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`Nanoleaf disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectNanoleaf(): Promise<NanoleafState_API> {
  const res = await apiFetch('/api/integrations/nanoleaf/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`Nanoleaf reconnect failed: ${res.status}`);
  return res.json();
}

// ─── Sound library ──────────────────────────────────────────────

export type SoundClip = {
  id: string;
  name: string;
  folder: string;
  sizeBytes: number;
  defaultVolume?: number;
};

export async function listSounds(): Promise<{ sounds: SoundClip[]; dir: string }> {
  const res = await apiFetch('/api/sounds');
  if (!res.ok) throw new Error(`GET sounds failed: ${res.status}`);
  return res.json();
}

export async function refreshSounds(): Promise<{ sounds: SoundClip[]; dir: string }> {
  const res = await apiFetch('/api/sounds/refresh', { method: 'POST' });
  if (!res.ok) throw new Error(`POST sounds/refresh failed: ${res.status}`);
  return res.json();
}

export async function playSoundOnServer(id: string, volume?: number): Promise<void> {
  const res = await apiFetch('/api/sounds/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, volume }),
  });
  if (!res.ok) {
    let msg = `play failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

export async function setSoundDefaultVolume(id: string, volume: number | null): Promise<void> {
  const res = await apiFetch('/api/sounds/default-volume', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, volume }),
  });
  if (!res.ok) {
    let msg = `set default volume failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

/** URL for the raw audio bytes — plug straight into <audio src>. Token in
 *  query string because <audio> can't set an Authorization header. */
export function soundFileUrl(id: string): string {
  const base = `/api/sounds/file?id=${encodeURIComponent(id)}`;
  const token = getStoredToken();
  return token ? `${base}&token=${encodeURIComponent(token)}` : base;
}

// ─── Mix It Up ──────────────────────────────────────────────────

export type MixItUpState =
  | 'disabled' | 'not-configured'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type MixItUpCommand = {
  id: string;
  name: string;
  type?: string;
  group?: string;
  enabled?: boolean;
};

export type MixItUpCounter = {
  name: string;
  amount: number;
};

export type MixItUpStatus = {
  state: MixItUpState;
  error?: string;
  host?: string;
  port?: number;
  version?: string;
  commands?: MixItUpCommand[];
  counters?: MixItUpCounter[];
};

export type MixItUpPublicConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export type MixItUpState_API = { config: MixItUpPublicConfig; status: MixItUpStatus };

export async function getMixItUpState(): Promise<MixItUpState_API> {
  const res = await apiFetch('/api/integrations/mixitup');
  if (!res.ok) throw new Error(`GET mixitup failed: ${res.status}`);
  return res.json();
}

export async function putMixItUpConfig(c: { enabled: boolean; host: string; port: number }): Promise<MixItUpState_API> {
  const res = await apiFetch('/api/integrations/mixitup/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT mixitup config failed: ${res.status}`);
  }
  return res.json();
}

export async function reconnectMixItUp(): Promise<MixItUpState_API> {
  const res = await apiFetch('/api/integrations/mixitup/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`Mix It Up reconnect failed: ${res.status}`);
  return res.json();
}

// ─── Discord ────────────────────────────────────────────────────

export type DiscordState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'disconnected' | 'error';

export type DiscordStatus = {
  state: DiscordState;
  error?: string;
  username?: string;
  mute?: boolean;
  deaf?: boolean;
  inputVolume?: number;
  outputVolume?: number;
  voiceMode?: 'PUSH_TO_TALK' | 'VOICE_ACTIVITY';
  voiceThreshold?: number;
  voiceAutoThreshold?: boolean;
  noiseSuppression?: boolean;
  automaticGainControl?: boolean;
  echoCancellation?: boolean;
  currentVoiceChannelId?: string | null;
  currentVoiceChannelName?: string | null;
  currentVoiceGuildId?: string | null;
};

export type DiscordPublicConfig = {
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  hasAccessToken: boolean;
  username: string;
  primaryGuildId: string;
  hasBotToken: boolean;
};

export type DiscordState_API = { config: DiscordPublicConfig; status: DiscordStatus };

export async function getDiscordState(): Promise<DiscordState_API> {
  const res = await apiFetch('/api/integrations/discord');
  if (!res.ok) throw new Error(`GET discord failed: ${res.status}`);
  return res.json();
}

export async function putDiscordConfig(c: { enabled: boolean; clientId: string; clientSecret?: string; primaryGuildId?: string; botToken?: string | null }): Promise<DiscordState_API> {
  const res = await apiFetch('/api/integrations/discord/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT discord config failed: ${res.status}`);
  }
  return res.json();
}

export async function connectDiscord(): Promise<DiscordState_API & { success: string }> {
  const res = await apiFetch('/api/integrations/discord/connect', { method: 'POST' });
  if (!res.ok) {
    let msg = `connect failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function disconnectDiscord(): Promise<DiscordState_API> {
  const res = await apiFetch('/api/integrations/discord/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectDiscord(): Promise<DiscordState_API> {
  const res = await apiFetch('/api/integrations/discord/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

export async function getDiscordVoiceChannels(): Promise<Array<{ id: string; channelName: string; guildId: string; guildName: string }>> {
  const res = await apiFetch('/api/integrations/discord/voice-channels');
  if (!res.ok) {
    let msg = `voice channels failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return (await res.json()).channels;
}

export async function getDiscordGuilds(): Promise<Array<{ id: string; name: string }>> {
  const res = await apiFetch('/api/integrations/discord/guilds');
  if (!res.ok) {
    let msg = `guilds failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return (await res.json()).guilds;
}

export async function getDiscordChannelMembers(): Promise<Array<{ id: string; name: string }>> {
  const res = await apiFetch('/api/integrations/discord/channel-members');
  if (!res.ok) {
    let msg = `channel members failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return (await res.json()).members;
}

export async function getDiscordGuildVoiceMembers(): Promise<Array<{ id: string; name: string; channelName: string }>> {
  const res = await apiFetch('/api/integrations/discord/guild-voice-members');
  if (!res.ok) {
    let msg = `guild voice members failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return (await res.json()).members;
}

/** Prompt-at-tap choice sources: map from a source identifier to the fetcher.
 *  `showAll` disables the "just my server" filter — used by the modal's
 *  "Show all servers" toggle for voice-channel pickers. */
export async function fetchPromptChoices(
  source: string,
  opts: { showAll?: boolean } = {},
): Promise<Array<{ value: string; label: string }>> {
  if (source === 'discord-voice-channels') {
    // Default to the user's "primary server" (Discord panel setting), falling
    // back to whichever guild their current voice channel is in. If neither is
    // known, we don't filter — better to show everything than nothing.
    const [chs, dc] = await Promise.all([
      getDiscordVoiceChannels(),
      getDiscordState().catch(() => null),
    ]);
    const scopeGuildId = dc?.config.primaryGuildId || dc?.status.currentVoiceGuildId || '';
    const scoped = (!opts.showAll && scopeGuildId)
      ? chs.filter((c) => c.guildId === scopeGuildId)
      : chs;
    // If the scoped list is empty but the full list has channels, silently
    // widen so the user doesn't hit a "no options available" wall (e.g. because
    // their primary guild has no voice channels or they weren't looking at it).
    const list = scoped.length > 0 ? scoped : chs;
    const showGuildLabel = list === chs;
    return list.map((c) => ({
      value: c.id,
      label: showGuildLabel ? `${c.guildName} · ${c.channelName}` : c.channelName,
    }));
  }
  if (source === 'discord-channel-members') {
    const ms = await getDiscordChannelMembers();
    return ms.map((m) => ({ value: m.id, label: m.name }));
  }
  if (source === 'discord-guild-voice-members') {
    const ms = await getDiscordGuildVoiceMembers();
    return ms.map((m) => ({ value: m.id, label: `${m.name} · in ${m.channelName}` }));
  }
  throw new Error(`unknown choices source: ${source}`);
}

// ─── Security ───────────────────────────────────────────────────

export type SecurityConfig = { allowShellActions: boolean | null; httpsEnabled: boolean };

export function certDownloadUrl(): string {
  const t = getStoredToken();
  return t ? `/api/security/cert?token=${encodeURIComponent(t)}` : '/api/security/cert';
}

export async function installCertTrust(): Promise<{ installed: boolean; output: string }> {
  const res = await apiFetch('/api/security/install-trust', { method: 'POST' });
  if (!res.ok) {
    let msg = `install trust failed: ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function getSecurityConfig(): Promise<SecurityConfig> {
  const res = await apiFetch('/api/security');
  if (!res.ok) throw new Error(`GET /api/security failed: ${res.status}`);
  const body = await res.json();
  return body.config as SecurityConfig;
}

export async function putSecurityConfig(cfg: { allowShellActions?: boolean; httpsEnabled?: boolean }): Promise<SecurityConfig> {
  const res = await apiFetch('/api/security/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT /api/security/config failed: ${res.status}`);
  }
  const out = await res.json();
  return out.config as SecurityConfig;
}

// ─── Kick ───────────────────────────────────────────────────────

export type KickState =
  | 'disabled' | 'not-configured' | 'needs-auth'
  | 'connecting' | 'connected' | 'error';

export type KickStatus = {
  state: KickState;
  error?: string;
  slug?: string;
  channel?: string;
};

export type KickPublicConfig = {
  enabled: boolean;
  clientId: string;
  hasSecret: boolean;
  hasRefreshToken: boolean;
  slug: string;
};

export type KickState_API = { config: KickPublicConfig; status: KickStatus };

export async function getKickState(): Promise<KickState_API> {
  const res = await apiFetch('/api/integrations/kick');
  if (!res.ok) throw new Error(`GET kick failed: ${res.status}`);
  return res.json();
}

export async function putKickConfig(c: { enabled: boolean; clientId: string; clientSecret?: string }): Promise<KickState_API> {
  const res = await apiFetch('/api/integrations/kick/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT kick config failed: ${res.status}`);
  }
  return res.json();
}

export async function getKickAuthorize(): Promise<{ url: string }> {
  const res = await apiFetch('/api/integrations/kick/authorize');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `authorize failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectKick(): Promise<KickState_API> {
  const res = await apiFetch('/api/integrations/kick/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectKick(): Promise<KickState_API> {
  const res = await apiFetch('/api/integrations/kick/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

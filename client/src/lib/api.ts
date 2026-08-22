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
  sceneItems: Record<string, string[]>;
  /** "<sceneName>::<sourceName>" → visible. Use for at-a-glance state in pickers. */
  sourceStates: Record<string, boolean>;
  currentScene?: string;
  retryStopped: boolean;
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
};

export type DiscordState_API = { config: DiscordPublicConfig; status: DiscordStatus };

export async function getDiscordState(): Promise<DiscordState_API> {
  const res = await apiFetch('/api/integrations/discord');
  if (!res.ok) throw new Error(`GET discord failed: ${res.status}`);
  return res.json();
}

export async function putDiscordConfig(c: { enabled: boolean; clientId: string; clientSecret?: string; primaryGuildId?: string }): Promise<DiscordState_API> {
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

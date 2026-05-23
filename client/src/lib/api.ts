import type { Layout } from './types';

export async function getLayout(): Promise<Layout> {
  const res = await fetch('/api/layout');
  if (!res.ok) throw new Error(`GET /api/layout failed: ${res.status}`);
  return res.json();
}

export async function putLayout(layout: Layout): Promise<void> {
  const res = await fetch('/api/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `PUT /api/layout failed: ${res.status}`);
  }
}

export type Pairing = { token: string; urls: string[] };

export async function getPairing(): Promise<Pairing> {
  const res = await fetch('/api/pairing');
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
  currentScene?: string;
  retryStopped: boolean;
};

export type ObsState_API = { config: ObsConfig; status: ObsStatus };

export async function getObsState(): Promise<ObsState_API> {
  const res = await fetch('/api/integrations/obs');
  if (!res.ok) throw new Error(`GET /api/integrations/obs failed: ${res.status}`);
  return res.json();
}

export async function putObsConfig(config: ObsConfig): Promise<ObsState_API> {
  const res = await fetch('/api/integrations/obs/config', {
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
  const res = await fetch('/api/integrations/obs/reconnect', { method: 'POST' });
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
  const res = await fetch('/api/integrations/twitch');
  if (!res.ok) throw new Error(`GET twitch failed: ${res.status}`);
  return res.json();
}

export async function putTwitchConfig(c: { enabled: boolean; clientId: string; clientSecret?: string }): Promise<TwitchState_API> {
  const res = await fetch('/api/integrations/twitch/config', {
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
  const res = await fetch('/api/integrations/twitch/authorize');
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `authorize failed: ${res.status}`);
  }
  return res.json();
}

export async function disconnectTwitch(): Promise<TwitchState_API> {
  const res = await fetch('/api/integrations/twitch/disconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
  return res.json();
}

export async function reconnectTwitch(): Promise<TwitchState_API> {
  const res = await fetch('/api/integrations/twitch/reconnect', { method: 'POST' });
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`);
  return res.json();
}

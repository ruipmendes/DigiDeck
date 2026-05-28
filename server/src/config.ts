import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_OBS_CONFIG, type ObsConfig } from './integrations/obs.js';
import { DEFAULT_TWITCH_CONFIG, type TwitchConfig } from './integrations/twitch.js';
import { DEFAULT_STREAMLABS_CONFIG, type StreamlabsConfig } from './integrations/streamlabs.js';

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
export const CONFIG_FILE = join(APP_DIR, 'config.json');

export type IntegrationsConfig = {
  obs: ObsConfig;
  twitch: TwitchConfig;
  streamlabs: StreamlabsConfig;
};

export type ServerConfig = {
  token: string;
  integrations: IntegrationsConfig;
};

function withDefaults(parsed: Partial<ServerConfig> | null | undefined): ServerConfig {
  const token = (parsed && typeof parsed.token === 'string' && parsed.token.length > 0)
    ? parsed.token
    : randomBytes(16).toString('base64url');
  return {
    token,
    integrations: {
      obs:        { ...DEFAULT_OBS_CONFIG,        ...parsed?.integrations?.obs },
      twitch:     { ...DEFAULT_TWITCH_CONFIG,     ...parsed?.integrations?.twitch },
      streamlabs: { ...DEFAULT_STREAMLABS_CONFIG, ...parsed?.integrations?.streamlabs },
    },
  };
}

export async function loadOrInitConfig(): Promise<ServerConfig> {
  let parsed: Partial<ServerConfig> | null = null;
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    parsed = JSON.parse(data) as Partial<ServerConfig>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const config = withDefaults(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(config)) {
    await saveConfig(config);
  }
  return config;
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

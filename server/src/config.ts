import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_OBS_CONFIG, type ObsConfig } from './integrations/obs.js';
import { DEFAULT_TWITCH_CONFIG, type TwitchConfig } from './integrations/twitch.js';
import { DEFAULT_STREAMLABS_CONFIG, type StreamlabsConfig } from './integrations/streamlabs.js';
import { DEFAULT_KICK_CONFIG, type KickConfig } from './integrations/kick.js';
import { DEFAULT_DISCORD_CONFIG, type DiscordConfig } from './integrations/discord.js';
import { DEFAULT_SPOTIFY_CONFIG, type SpotifyConfig } from './integrations/spotify.js';
// scaffold-integration: additional imports inserted above this line

const APP_DIR = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'),
  'digi-deck',
);
export const CONFIG_FILE = join(APP_DIR, 'config.json');

export type IntegrationsConfig = {
  obs: ObsConfig;
  twitch: TwitchConfig;
  streamlabs: StreamlabsConfig;
  kick: KickConfig;
  discord: DiscordConfig;
  spotify: SpotifyConfig;
  // scaffold-integration: additional fields inserted above this line
};

export type SecurityConfig = {
  /**
   * Whether `script` (PowerShell) and `launch` actions may fire.
   * `null` means "never explicitly set" — server infers a safe value on startup
   * based on whether the current layout already relies on them.
   */
  allowShellActions: boolean | null;
  /**
   * When true the server listens over HTTPS/WSS on the same port (self-signed
   * cert generated at %APPDATA%/digi-deck/https/). Default off — flipping this
   * requires re-pairing every phone and updating OAuth redirect URIs.
   */
  httpsEnabled: boolean;
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowShellActions: null,
  httpsEnabled: false,
};

export type ServerConfig = {
  token: string;
  integrations: IntegrationsConfig;
  security: SecurityConfig;
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
      kick:       { ...DEFAULT_KICK_CONFIG,       ...parsed?.integrations?.kick },
      discord:    { ...DEFAULT_DISCORD_CONFIG,    ...parsed?.integrations?.discord },
      spotify:    { ...DEFAULT_SPOTIFY_CONFIG,    ...parsed?.integrations?.spotify },
      // scaffold-integration: additional defaults inserted above this line
    },
    security: {
      allowShellActions:
        parsed?.security && typeof parsed.security.allowShellActions === 'boolean'
          ? parsed.security.allowShellActions
          : null,
      httpsEnabled:
        parsed?.security && typeof parsed.security.httpsEnabled === 'boolean'
          ? parsed.security.httpsEnabled
          : false,
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

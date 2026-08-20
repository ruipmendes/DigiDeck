/**
 * Integration base + registry.
 *
 * Every integration (OBS, Streamlabs, Twitch, Kick, and any future ones)
 * registers itself here at module load. Central code (`index.ts` lifecycle
 * wiring, `tray.ts` menu items, tray-command dispatch) iterates the registry
 * instead of hardcoding integration names — so adding a fifth integration
 * only requires implementing this interface and calling `registerIntegration()`
 * in its singleton getter. No more hunting through `index.ts` / `tray.ts` /
 * `states.ts` for the checklist of insertion points.
 *
 * Config type is opaque per-integration — each one reads its own field out of
 * the top-level `IntegrationsConfig` via `applyConfig()`. This keeps the base
 * interface tiny and doesn't force a unified config shape onto integrations
 * that legitimately differ.
 */

import type { IntegrationsConfig, ServerConfig } from '../config.js';

export type IntegrationName = 'obs' | 'streamlabs' | 'twitch' | 'kick';

export interface IntegrationManifest {
  /** Unique key. Matches the field name in IntegrationsConfig and the /api/integrations/<name> path. */
  name: IntegrationName;
  /** Human-facing name (e.g. "OBS Studio", "Twitch chat"). Used in tray menu items, panel titles. */
  displayName: string;
  /** Action `type` values this integration owns (e.g. `['twitch', 'twitch-streamer']`). */
  actionTypes: readonly string[];
  /** OAuth integrations need /authorize + /callback + /disconnect routes wired. */
  hasOAuth: boolean;
}

/**
 * Minimal lifecycle contract every integration implements. Deliberately narrow —
 * integration-specific methods (execute, buildAuthorizeUrl, helixGet, etc.)
 * remain on the concrete class and are called directly by consumers.
 */
export interface IntegrationLifecycle {
  readonly manifest: IntegrationManifest;
  /** True when the user has flipped the integration on in config. */
  isEnabled(): boolean;
  /** Read this integration's field out of the full IntegrationsConfig and apply it. */
  applyConfig(all: IntegrationsConfig): void;
  /**
   * OAuth integrations mutate their config (refresh tokens, username/slug on connect).
   * Attach a persistence callback so those mutations survive restarts.
   * Non-OAuth integrations may leave this as a no-op.
   */
  attachSave?(config: ServerConfig, save: () => Promise<void>): void;
  /** Register a callback fired on any state change — used for state broadcast + tray refresh. */
  onChange(cb: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

const registry: IntegrationLifecycle[] = [];

export function registerIntegration(i: IntegrationLifecycle): void {
  if (registry.find((r) => r.manifest.name === i.manifest.name)) return;
  registry.push(i);
}

export function getIntegrations(): readonly IntegrationLifecycle[] {
  return registry;
}

export function findIntegration(name: string): IntegrationLifecycle | undefined {
  return registry.find((i) => i.manifest.name === name);
}

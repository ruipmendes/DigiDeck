/**
 * Alerts — the deck's event-awareness surface.
 *
 * Streamer-facing idea: a streamer playing a game can't glance at the deck's
 * current page every time a sub / raid / cheer / follow / stream-online
 * happens. The deck itself emits two notification surfaces for these events:
 *
 *   - **In-deck toast** — a short banner at the top of the deck UI,
 *     visible from any page, broadcast over the existing WS.
 *   - **Push notification** — OS-level notification on the paired phone
 *     via Web Push, so the streamer sees it even when the deck app is
 *     backgrounded. (Phase 4 — not wired yet.)
 *
 * The dispatcher is integration-agnostic. Twitch is the first source
 * (phase 1), but the shape allows adding Kick / OBS / Streamlabs sources
 * later without touching the broadcast or UI layers.
 */

import { EventEmitter } from 'node:events';

export type AlertEventType =
  | 'twitch.raid'
  | 'twitch.subscribe'
  | 'twitch.cheer'
  | 'twitch.follow'
  | 'twitch.stream-online'
  | 'twitch.stream-offline';

export const ALL_ALERT_EVENT_TYPES: readonly AlertEventType[] = [
  'twitch.raid',
  'twitch.subscribe',
  'twitch.cheer',
  'twitch.follow',
  'twitch.stream-online',
  'twitch.stream-offline',
];

/** Per-event configuration — currently only Twitch events, but the shape
 *  is portable to other integrations that'd store notifications under
 *  their own config block. */
export type AlertEventConfig = {
  push?: boolean;
  toast?: boolean;
  /** Minimum ms between consecutive fires of this event — swallows bursts. */
  cooldownMs?: number;
  /** Lower bound on `event.amount` for the alert to fire. Interpretation:
   *   - `twitch.cheer` → min bits
   *   - `twitch.raid`  → min viewers
   *   - others         → ignored */
  minAmount?: number;
};

/** The actual event, as pushed by an integration. */
export type AlertEvent = {
  type: AlertEventType;
  /** Rendered title line of the notification. Integration decides the
   *  format so phase 1 doesn't need templating. */
  title: string;
  /** Optional second line with detail. */
  body?: string;
  /** Payload interpretation per event:
   *   - `twitch.cheer`     → bits total
   *   - `twitch.raid`      → viewer count
   *   - `twitch.subscribe` → tier number (1 / 2 / 3)
   *   - others             → undefined */
  amount?: number;
};

class AlertDispatcher extends EventEmitter {
  /** eventType → last-fired unix ms. In-memory; cooldowns are a jitter
   *  smoother, not a scheduling guarantee, so persistence isn't needed. */
  private lastFired = new Map<AlertEventType, number>();

  /** Called by an integration (e.g. twitch.ts) with the event shape +
   *  the resolved per-event config. Applies cooldown + minAmount filter,
   *  then emits 'alert' for subscribers (phase 2: WS broadcast; phase 4:
   *  push notification sender). */
  fire(event: AlertEvent, cfg: AlertEventConfig | undefined): void {
    if (!cfg) return;
    if (!cfg.push && !cfg.toast) return;
    if (cfg.minAmount !== undefined && event.amount !== undefined && event.amount < cfg.minAmount) return;
    const cooldown = cfg.cooldownMs ?? 0;
    const now = Date.now();
    const last = this.lastFired.get(event.type) ?? 0;
    if (cooldown > 0 && now - last < cooldown) return;
    this.lastFired.set(event.type, now);
    console.log(`[alerts] ${event.type}: ${event.title}${event.body ? ` — ${event.body}` : ''}`);
    this.emit('alert', { event, cfg });
  }
}

let _instance: AlertDispatcher | null = null;
export function getAlerts(): AlertDispatcher {
  if (!_instance) _instance = new AlertDispatcher();
  return _instance;
}

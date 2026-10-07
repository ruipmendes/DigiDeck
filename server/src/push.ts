import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { appDataDir } from './platform.js';
import { getAlerts, type AlertEvent } from './alerts.js';

/**
 * Push-notification sender.
 *
 * Owns:
 *   - the VAPID keypair (generated on first run, cached under `%APPDATA%`)
 *   - the paired-device subscription list (also persisted)
 *   - fan-out: subscribes to the alert dispatcher and sends a Web Push for
 *     every alert whose per-event config has `push: true`.
 *
 * The phone registers a service worker, calls `pushManager.subscribe(...)`
 * with our VAPID public key, and POSTs the resulting subscription object to
 * `/api/push/subscribe`. From then on the OS delivers notifications even
 * when the deck PWA is backgrounded or the phone is locked.
 */

const APP_DIR = join(appDataDir(), 'digi-deck');
const VAPID_FILE = join(APP_DIR, 'push-vapid.json');
const SUBS_FILE = join(APP_DIR, 'push-subscriptions.json');

export type PushSubscriptionObject = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

type Vapid = { publicKey: string; privateKey: string };

let _vapid: Vapid | null = null;
let _subs: PushSubscriptionObject[] = [];
let _loaded = false;

async function loadOrCreateVapid(): Promise<Vapid> {
  if (_vapid) return _vapid;
  try {
    const raw = await fs.readFile(VAPID_FILE, 'utf8');
    _vapid = JSON.parse(raw) as Vapid;
    if (!_vapid.publicKey || !_vapid.privateKey) throw new Error('invalid vapid');
    return _vapid;
  } catch {
    const generated = webpush.generateVAPIDKeys();
    _vapid = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    await fs.mkdir(APP_DIR, { recursive: true });
    await fs.writeFile(VAPID_FILE, JSON.stringify(_vapid, null, 2), 'utf8');
    console.log('[push] generated new VAPID keypair');
    return _vapid;
  }
}

async function loadSubs(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  if (!existsSync(SUBS_FILE)) { _subs = []; return; }
  try {
    const raw = await fs.readFile(SUBS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PushSubscriptionObject[];
    if (Array.isArray(parsed)) _subs = parsed.filter((s) => s?.endpoint && s?.keys?.p256dh && s?.keys?.auth);
  } catch { _subs = []; }
}

async function persistSubs(): Promise<void> {
  await fs.mkdir(APP_DIR, { recursive: true });
  await fs.writeFile(SUBS_FILE, JSON.stringify(_subs, null, 2), 'utf8');
}

/** Expose the public key so the phone can hand it to `pushManager.subscribe`. */
export async function getVapidPublicKey(): Promise<string> {
  const v = await loadOrCreateVapid();
  return v.publicKey;
}

/** Hostnames whose push endpoints we'll relay to. Anything else is rejected
 *  so an authenticated phone can't plant a crafted endpoint that steers
 *  web-push requests at an internal LAN host (defense in depth — the phone
 *  can already hit the LAN directly, but there's no legitimate reason for a
 *  push endpoint to point anywhere but a real push provider). */
const ALLOWED_PUSH_HOSTS = [
  // Chrome / Edge / anything FCM-backed
  'fcm.googleapis.com',
  'fcm.google.com',
  // Mozilla Firefox
  'updates.push.services.mozilla.com',
  'autopush.services.mozilla.com',
  // Windows / Edge (WNS)
  'wns2-par02p.notify.windows.com',
  'wns2.notify.windows.com',
  // Safari / APNS
  'web.push.apple.com',
];
function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    // Allow exact match OR known-provider suffix (push providers rotate
    // regional subdomains).
    return ALLOWED_PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
      || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.notify.windows.com')
      || host.endsWith('.push.apple.com')
      || host.endsWith('.googleapis.com');
  } catch { return false; }
}

/** Idempotently add a subscription (keyed by endpoint URL). */
export async function addSubscription(sub: PushSubscriptionObject): Promise<void> {
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    throw new Error('push endpoint is not a recognized push provider');
  }
  await loadSubs();
  const existing = _subs.findIndex((s) => s.endpoint === sub.endpoint);
  if (existing >= 0) _subs[existing] = sub;
  else _subs.push(sub);
  await persistSubs();
  console.log(`[push] subscription added (${_subs.length} total)`);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await loadSubs();
  const before = _subs.length;
  _subs = _subs.filter((s) => s.endpoint !== endpoint);
  if (_subs.length !== before) await persistSubs();
  console.log(`[push] subscription removed (${_subs.length} total)`);
}

export async function listSubscriptions(): Promise<PushSubscriptionObject[]> {
  await loadSubs();
  return [..._subs];
}

async function sendOne(sub: PushSubscriptionObject, payload: string): Promise<'ok' | 'gone' | 'error'> {
  const v = await loadOrCreateVapid();
  // VAPID subject must be mailto: or https: URL per the spec; a stable
  // generic contact for self-hosted installs — we're not using it for
  // deliverability contact, just satisfying the field.
  webpush.setVapidDetails('mailto:digi-deck@localhost', v.publicKey, v.privateKey);
  try {
    await webpush.sendNotification(sub, payload);
    return 'ok';
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    console.warn(`[push] send failed (${status ?? '?'}):`, (err as Error).message);
    return 'error';
  }
}

async function dispatch(event: AlertEvent): Promise<void> {
  await loadSubs();
  if (_subs.length === 0) return;
  const payload = JSON.stringify({
    title: event.title,
    body: event.body ?? '',
    event: event.type,
  });
  const expired: string[] = [];
  await Promise.all(_subs.map(async (sub) => {
    const result = await sendOne(sub, payload);
    if (result === 'gone') expired.push(sub.endpoint);
  }));
  if (expired.length > 0) {
    _subs = _subs.filter((s) => !expired.includes(s.endpoint));
    await persistSubs();
    console.log(`[push] pruned ${expired.length} expired subscriptions`);
  }
}

/** Attach to the alert dispatcher — called once at server boot. */
export function wirePushToAlerts(): void {
  getAlerts().on('alert', ({ event, cfg }: { event: AlertEvent; cfg: { push?: boolean } }) => {
    if (!cfg.push) return;
    void dispatch(event);
  });
}

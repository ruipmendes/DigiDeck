import * as api from './api';

/**
 * Phone-side push lifecycle: register the service worker, subscribe to Web
 * Push with the server's VAPID key, and POST the subscription object back to
 * the server. On opt-out, unsubscribe locally AND tell the server to prune
 * the endpoint so we don't send to a dead subscription forever.
 *
 * All operations are no-ops when the browser doesn't support Push (older
 * iOS Safari, in-app webviews, etc.). Callers check `supported()` first and
 * fall back to toast-only reassurance in the UI.
 */

export function supported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function permission(): NotificationPermission {
  if (!supported()) return 'denied';
  return Notification.permission;
}

let _swRegPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return null;
  if (_swRegPromise) return _swRegPromise;
  _swRegPromise = navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('[push] service worker registration failed:', err);
    return null;
  });
  return _swRegPromise;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/** Request OS permission (if not already granted) and subscribe. Returns
 *  the PushSubscription on success; throws with a user-friendly message on
 *  failure. */
export async function subscribe(): Promise<PushSubscription> {
  if (!supported()) throw new Error('This browser doesn\'t support push notifications.');
  const reg = await ensureServiceWorker();
  if (!reg) throw new Error('Service worker registration failed.');
  // Prompt for permission if we don't have it. iOS requires this to happen
  // from a user gesture — the "Enable" button click satisfies that.
  if (Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') throw new Error('Notification permission was denied.');
  }
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await api.pushSubscribe(toSubscriptionJson(existing));
    return existing;
  }
  const { publicKey } = await api.pushPublicKey();
  // Cast through BufferSource — TS's lib.dom types are strict about
  // Uint8Array<ArrayBuffer> vs Uint8Array<ArrayBufferLike> but any Uint8Array
  // is accepted at runtime by the actual browser PushManager implementation.
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
  });
  await api.pushSubscribe(toSubscriptionJson(sub));
  return sub;
}

export async function unsubscribe(): Promise<void> {
  const reg = await ensureServiceWorker();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => { /* server might already have pruned */ });
  await sub.unsubscribe();
}

function toSubscriptionJson(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return {
    endpoint: j.endpoint ?? sub.endpoint,
    keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' },
  };
}

/** Convert the VAPID public key (URL-safe base64) to the Uint8Array that
 *  `pushManager.subscribe` expects as `applicationServerKey`. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const normal = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normal);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// Service worker for the Digi Deck PWA. Minimal scope:
//
//   1. Accept Web Push notifications sent by the server and render them as
//      OS-level notifications (vibration, lock-screen, notification shade).
//   2. Focus or open the deck PWA when the user taps the notification.
//
// We do NOT precache or intercept fetches — the deck is primarily
// network-driven (WS + REST on the LAN), so an offline shell doesn't make
// sense here. Scope is just push + notificationclick.

self.addEventListener('install', (event) => {
  // Activate as soon as installed so new SW versions take effect on reload.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'Digi Deck', body: event.data.text() }; }
  const title = payload.title || 'Digi Deck';
  const options = {
    body: payload.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.event || 'digi-deck-alert',
    renotify: true,
    data: payload,
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = self.registration.scope;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const win of windows) {
      if (win.url.startsWith(url)) { await win.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});

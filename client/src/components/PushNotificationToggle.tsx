import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import * as push from '../lib/push';

/**
 * Small header-row control that lets each phone opt in/out of push
 * notifications. Three visible states:
 *   - unsupported: hidden entirely.
 *   - off / not subscribed: Bell icon, says "Enable notifications". Click
 *     prompts for permission + subscribes.
 *   - on: Bell icon in green, says "Notifications on". Click unsubscribes.
 *
 * We check `pushManager.getSubscription()` on mount so refreshes don't
 * require re-granting — the browser remembers between sessions. Permission
 * denied yields a BellOff tooltip prompting the user to grant it from the
 * browser's site-permissions UI.
 */
export function PushNotificationToggle() {
  const [state, setState] = useState<'unknown' | 'unsupported' | 'off' | 'on' | 'denied'>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!push.supported()) { if (alive) setState('unsupported'); return; }
      if (push.permission() === 'denied') { if (alive) setState('denied'); return; }
      try {
        const sub = await push.currentSubscription();
        if (alive) setState(sub ? 'on' : 'off');
      } catch {
        if (alive) setState('off');
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state === 'unknown' || state === 'unsupported') return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await push.subscribe();
      setState('on');
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (push.permission() === 'denied') setState('denied');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await push.unsubscribe();
      setState('off');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'denied') {
    return (
      <span
        style={{ fontSize: 12, color: '#9ca3af', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        title="Browser blocked notifications. Grant permission in the site settings to re-enable."
      >
        <BellOff size={14} /> blocked
      </span>
    );
  }

  const on = state === 'on';
  return (
    <button
      onClick={() => { void (on ? disable() : enable()); }}
      disabled={busy}
      style={{
        fontSize: 12,
        color: on ? '#22c55e' : '#9ca3af',
        background: 'transparent',
        border: 0,
        padding: 0,
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
      title={error ?? (on ? 'click to turn off push notifications on this phone' : 'click to receive push notifications for Twitch events on this phone')}
    >
      <Bell size={14} />
      {on ? 'notify ✓' : 'notify'}
    </button>
  );
}

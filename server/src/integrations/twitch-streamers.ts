import { getTwitch } from './twitch.js';

export type StreamerInfo = {
  login: string;
  displayName: string;
  profileImageUrl: string;
  live: boolean;
};

const POLL_INTERVAL_MS = 60_000;

type HelixUsersResponse = {
  data: Array<{ id: string; login: string; display_name: string; profile_image_url: string }>;
};

type HelixStreamsResponse = {
  data: Array<{ user_login: string; type: string }>;
};

class StreamerPoller {
  private logins = new Set<string>();
  private cache = new Map<string, StreamerInfo>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private onChangeCb: (() => void) | null = null;

  setLogins(logins: string[]): void {
    const next = new Set(
      logins.map((l) => l.trim().toLowerCase()).filter((l) => l.length > 0),
    );
    const added = [...next].some((l) => !this.logins.has(l));
    const removed = [...this.logins].some((l) => !next.has(l));
    this.logins = next;
    // Drop cached entries for logins that are no longer used.
    for (const k of [...this.cache.keys()]) {
      if (!this.logins.has(k)) this.cache.delete(k);
    }
    // If new logins were added, poll immediately so the phone gets the thumbnail
    // without waiting up to a minute.
    if (added && this.timer) void this.poll();
    if (removed && !added) this.onChangeCb?.();
  }

  onChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  get(login: string): StreamerInfo | undefined {
    return this.cache.get(login.trim().toLowerCase());
  }

  /** Force an immediate refresh. Useful right after Twitch reconnects. */
  refresh(): void {
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (this.logins.size === 0) return;
    if (!getTwitch().isReady()) return;

    this.polling = true;
    try {
      const logins = [...this.logins];
      // Helix accepts up to 100 logins per request; we're well under that for personal use.
      const [users, streams] = await Promise.all([
        getTwitch().helixGet<HelixUsersResponse>('/users', { login: logins }),
        getTwitch().helixGet<HelixStreamsResponse>('/streams', { user_login: logins }),
      ]);

      const liveSet = new Set(streams.data.map((s) => s.user_login.toLowerCase()));

      let changed = false;
      const seen = new Set<string>();
      for (const u of users.data) {
        const login = u.login.toLowerCase();
        seen.add(login);
        const live = liveSet.has(login);
        const prev = this.cache.get(login);
        const next: StreamerInfo = {
          login,
          displayName: u.display_name,
          profileImageUrl: u.profile_image_url,
          live,
        };
        if (!prev || prev.live !== live || prev.profileImageUrl !== next.profileImageUrl || prev.displayName !== next.displayName) {
          changed = true;
        }
        this.cache.set(login, next);
      }
      // If the user typed a non-existent login, /users returns nothing for it; the cache
      // simply lacks an entry — render falls back to label-only.
      if (changed) this.onChangeCb?.();
    } catch (err) {
      console.warn('[streamers] poll failed:', (err as Error).message);
    } finally {
      this.polling = false;
    }
  }
}

let _instance: StreamerPoller | null = null;
export function getStreamers(): StreamerPoller {
  if (!_instance) _instance = new StreamerPoller();
  return _instance;
}

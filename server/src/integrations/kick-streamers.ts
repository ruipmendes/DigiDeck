import { getKick } from './kick.js';

export type KickStreamerInfo = {
  slug: string;
  displayName: string;
  profileImageUrl: string;
  live: boolean;
};

const POLL_INTERVAL_MS = 60_000;

type ChannelsResponse = {
  data?: unknown;
};

class KickStreamerPoller {
  private slugs = new Set<string>();
  private cache = new Map<string, KickStreamerInfo>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private onChangeCb: (() => void) | null = null;

  setSlugs(slugs: string[]): void {
    const next = new Set(
      slugs.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0),
    );
    const added = [...next].some((s) => !this.slugs.has(s));
    const removed = [...this.slugs].some((s) => !next.has(s));
    this.slugs = next;
    for (const k of [...this.cache.keys()]) {
      if (!this.slugs.has(k)) this.cache.delete(k);
    }
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

  get(slug: string): KickStreamerInfo | undefined {
    return this.cache.get(slug.trim().toLowerCase());
  }

  refresh(): void {
    void this.poll();
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    if (this.slugs.size === 0) return;
    // Kick's OAuth API is the only channels endpoint that isn't Cloudflare-blocked
    // server-side, so the poll requires an authorized Kick integration.
    if (!getKick().isReady()) return;

    this.polling = true;
    try {
      const slugs = [...this.slugs];
      const results = await Promise.all(slugs.map((s) => this.fetchOne(s)));

      let changed = false;
      for (let i = 0; i < slugs.length; i++) {
        const slug = slugs[i];
        const info = results[i];
        if (!info) continue;
        const prev = this.cache.get(slug);
        if (
          !prev ||
          prev.live !== info.live ||
          prev.profileImageUrl !== info.profileImageUrl ||
          prev.displayName !== info.displayName
        ) {
          changed = true;
        }
        this.cache.set(slug, info);
      }
      if (changed) this.onChangeCb?.();
    } catch (err) {
      console.warn('[kick-streamers] poll failed:', (err as Error).message);
    } finally {
      this.polling = false;
    }
  }

  private async fetchOne(slug: string): Promise<KickStreamerInfo | null> {
    try {
      const raw = await getKick().apiGet<ChannelsResponse>('/channels', { slug });
      const rows: unknown[] = Array.isArray(raw?.data)
        ? raw.data
        : raw?.data && typeof raw.data === 'object'
          ? [raw.data]
          : [];
      const row = rows.find((r) => matchesSlug(r, slug)) ?? rows[0];
      if (!row || typeof row !== 'object') return null;

      const c = row as Record<string, unknown>;
      const stream = (c.stream ?? c.livestream ?? null) as Record<string, unknown> | null;
      const live = !!(stream && (stream.is_live === true || stream.isLive === true));

      // /public/v1/channels doesn't return the broadcaster's profile picture, and
      // /public/v1/users?user_id=<id> ignores the filter and returns the auth'd
      // user. The best identity signal we can get from the API alone is the live
      // stream thumbnail; users who want a stable avatar paste the URL manually
      // via the action's optional `avatarUrl` field.
      const streamThumb = live && stream && typeof stream.thumbnail === 'string' ? stream.thumbnail : '';

      return { slug, displayName: slug, profileImageUrl: streamThumb, live };
    } catch (err) {
      console.warn(`[kick-streamers] ${slug} fetch failed:`, (err as Error).message);
      return null;
    }
  }
}

function matchesSlug(row: unknown, slug: string): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  const raw = r.slug;
  return typeof raw === 'string' && raw.toLowerCase() === slug;
}

let _instance: KickStreamerPoller | null = null;
export function getKickStreamers(): KickStreamerPoller {
  if (!_instance) _instance = new KickStreamerPoller();
  return _instance;
}

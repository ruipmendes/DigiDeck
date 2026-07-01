import { getKick } from './kick.js';

export type KickStreamerInfo = {
  slug: string;
  displayName: string;
  profileImageUrl: string;
  live: boolean;
};

const POLL_INTERVAL_MS = 60_000;

type ChannelsResponse = {
  data?: Array<{
    slug?: string;
    broadcaster_user_id?: number;
    user?: { profile_picture?: string; name?: string; username?: string };
    stream?: { is_live?: boolean } | null;
    stream_title?: string;
  }>;
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
    if (!getKick().isReady()) return;

    this.polling = true;
    try {
      // /public/v1/channels accepts repeated ?slug=<...> params. Fetch all in one call.
      const slugs = [...this.slugs];
      const result = await getKick().apiGet<ChannelsResponse>('/channels', { slug: slugs });

      let changed = false;
      for (const c of result.data ?? []) {
        const slug = (c.slug ?? '').toLowerCase();
        if (!slug) continue;
        const live = !!c.stream?.is_live;
        const displayName = c.user?.username ?? c.user?.name ?? slug;
        const profileImageUrl = c.user?.profile_picture ?? '';
        const prev = this.cache.get(slug);
        const next: KickStreamerInfo = { slug, displayName, profileImageUrl, live };
        if (
          !prev ||
          prev.live !== live ||
          prev.profileImageUrl !== profileImageUrl ||
          prev.displayName !== displayName
        ) {
          changed = true;
        }
        this.cache.set(slug, next);
      }
      if (changed) this.onChangeCb?.();
    } catch (err) {
      console.warn('[kick-streamers] poll failed:', (err as Error).message);
    } finally {
      this.polling = false;
    }
  }
}

let _instance: KickStreamerPoller | null = null;
export function getKickStreamers(): KickStreamerPoller {
  if (!_instance) _instance = new KickStreamerPoller();
  return _instance;
}

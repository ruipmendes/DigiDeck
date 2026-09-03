import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown, ChevronRight, Plug,
  Video, Radio, MessageCircle, MessageSquare,
  Headphones, Music, Bot, Lightbulb, Home, Palette, Star,
} from 'lucide-react';
import * as api from '../lib/api';
import { ObsPanel } from './ObsPanel';
import { StreamlabsPanel } from './StreamlabsPanel';
import { TwitchPanel } from './TwitchPanel';
import { KickPanel } from './KickPanel';
import { DiscordPanel } from './DiscordPanel';
import { SpotifyPanel } from './SpotifyPanel';
import { HuePanel } from './HuePanel';
import { HomeAssistantPanel } from './HomeAssistantPanel';
import { OpenRgbPanel } from './OpenRgbPanel';
import { NanoleafPanel } from './NanoleafPanel';
import { MixItUpPanel } from './MixItUpPanel';

/**
 * IntegrationsPanel — sidebar + detail pane layout.
 *
 * A left rail lists every integration with a category header + status dot;
 * clicking one shows that integration's config panel in the detail pane on
 * the right. Only one panel is visible at a time, so the vertical scroll
 * cost stays constant no matter how many integrations we add.
 *
 * Each per-integration panel is rendered with `alwaysOpen` so the panel's
 * own collapse UI stays out of the way — the rail already tells the user
 * which one is showing.
 *
 * Narrow layout (<= 700 px): the rail collapses into a horizontal scrollable
 * chip strip above the detail pane. Same navigation, less horizontal space.
 */

type StatusKind = 'connected' | 'connecting' | 'disconnected' | 'error' | 'disabled' | 'needs-auth' | 'not-configured';

type IntegrationId =
  | 'obs' | 'streamlabs' | 'twitch' | 'kick' | 'discord' | 'spotify' | 'mixitup'
  | 'hue' | 'homeassistant' | 'openrgb' | 'nanoleaf';

type Category = 'Streaming' | 'Lighting';

type IntegrationDef = {
  id: IntegrationId;
  name: string;
  category: Category;
  /** Rail icon — pulled from lucide so the rail stays visually cohesive. */
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  /** Accent color tint for the rail icon when connected. */
  accent: string;
  Panel: React.ComponentType<{ alwaysOpen?: boolean }>;
};

/** Order in this array = order in the rail. Streaming first (heavier use),
 *  Lighting second. Adding a new integration is one line here + the 15-step
 *  checklist elsewhere. */
const DEFS: IntegrationDef[] = [
  { id: 'obs',           name: 'OBS Studio',    category: 'Streaming', Icon: Video,         accent: '#38bdf8', Panel: ObsPanel },
  { id: 'streamlabs',    name: 'Streamlabs',    category: 'Streaming', Icon: Radio,         accent: '#f59e0b', Panel: StreamlabsPanel },
  { id: 'twitch',        name: 'Twitch',        category: 'Streaming', Icon: MessageCircle, accent: '#9146FF', Panel: TwitchPanel },
  { id: 'kick',          name: 'Kick',          category: 'Streaming', Icon: MessageSquare, accent: '#53fc18', Panel: KickPanel },
  { id: 'discord',       name: 'Discord',       category: 'Streaming', Icon: Headphones,    accent: '#5865F2', Panel: DiscordPanel },
  { id: 'spotify',       name: 'Spotify',       category: 'Streaming', Icon: Music,         accent: '#1DB954', Panel: SpotifyPanel },
  { id: 'mixitup',       name: 'Mix It Up',     category: 'Streaming', Icon: Bot,           accent: '#a78bfa', Panel: MixItUpPanel },
  { id: 'hue',           name: 'Hue',           category: 'Lighting',  Icon: Lightbulb,     accent: '#fbbf24', Panel: HuePanel },
  { id: 'homeassistant', name: 'Home Asst',     category: 'Lighting',  Icon: Home,          accent: '#03A9F4', Panel: HomeAssistantPanel },
  { id: 'openrgb',       name: 'OpenRGB',       category: 'Lighting',  Icon: Palette,       accent: '#f472b6', Panel: OpenRgbPanel },
  { id: 'nanoleaf',      name: 'Nanoleaf',      category: 'Lighting',  Icon: Star,          accent: '#c084fc', Panel: NanoleafPanel },
];

const CATEGORY_ORDER: Category[] = ['Streaming', 'Lighting'];

type Summary = Record<IntegrationId, { enabled: boolean; state: StatusKind }>;

const DEFAULT_SUMMARY: Summary = Object.fromEntries(
  DEFS.map((d) => [d.id, { enabled: false, state: 'disabled' as StatusKind }]),
) as Summary;

const NARROW_QUERY = '(max-width: 700px)';

/** Track viewport width crossing the narrow breakpoint so we can flip the
 *  rail layout without CSS-in-JSX gymnastics. matchMedia is synchronous, so
 *  the initial render already knows the correct layout. */
function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(NARROW_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isNarrow;
}

export function IntegrationsPanel() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<IntegrationId | null>(null);
  const [summary, setSummary] = useState<Summary>(DEFAULT_SUMMARY);
  const isNarrow = useIsNarrow();

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [obs, sl, tw, kk, dc, sp, hu, ha, org, nl, mu] = await Promise.all([
          api.getObsState().catch(() => null),
          api.getStreamlabsState().catch(() => null),
          api.getTwitchState().catch(() => null),
          api.getKickState().catch(() => null),
          api.getDiscordState().catch(() => null),
          api.getSpotifyState().catch(() => null),
          api.getHueState().catch(() => null),
          api.getHomeAssistantState().catch(() => null),
          api.getOpenRgbState().catch(() => null),
          api.getNanoleafState().catch(() => null),
          api.getMixItUpState().catch(() => null),
        ]);
        if (!alive) return;
        setSummary({
          obs:           { enabled: !!obs?.config.enabled, state: (obs?.status.state as StatusKind) ?? 'disabled' },
          streamlabs:    { enabled: !!sl?.config.enabled,  state: (sl?.status.state  as StatusKind) ?? 'disabled' },
          twitch:        { enabled: !!tw?.config.enabled,  state: (tw?.status.state  as StatusKind) ?? 'disabled' },
          kick:          { enabled: !!kk?.config.enabled,  state: (kk?.status.state  as StatusKind) ?? 'disabled' },
          discord:       { enabled: !!dc?.config.enabled,  state: (dc?.status.state  as StatusKind) ?? 'disabled' },
          spotify:       { enabled: !!sp?.config.enabled,  state: (sp?.status.state  as StatusKind) ?? 'disabled' },
          hue:           { enabled: !!hu?.config.enabled,  state: (hu?.status.state  as StatusKind) ?? 'disabled' },
          homeassistant: { enabled: !!ha?.config.enabled,  state: (ha?.status.state  as StatusKind) ?? 'disabled' },
          openrgb:       { enabled: !!org?.config.enabled, state: (org?.status.state as StatusKind) ?? 'disabled' },
          nanoleaf:      { enabled: !!nl?.config.enabled,  state: (nl?.status.state  as StatusKind) ?? 'disabled' },
          mixitup:       { enabled: !!mu?.config.enabled,  state: (mu?.status.state  as StatusKind) ?? 'disabled' },
        });
      } catch { /* harmless */ }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // First open — pick a sensible default:
  //   1. first connected integration (most likely to be edited)
  //   2. else first enabled (setup in progress)
  //   3. else first in the list (fresh user seeing this for the first time)
  useEffect(() => {
    if (!open || selected !== null) return;
    const firstConnected = DEFS.find((d) => summary[d.id].state === 'connected');
    const firstEnabled = DEFS.find((d) => summary[d.id].enabled);
    setSelected((firstConnected ?? firstEnabled ?? DEFS[0]).id);
  }, [open, selected, summary]);

  const grouped = useMemo(() => {
    const map = new Map<Category, IntegrationDef[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const d of DEFS) map.get(d.category)!.push(d);
    return map;
  }, []);

  const selectedDef = DEFS.find((d) => d.id === selected);
  const connectedCount = Object.values(summary).filter((s) => s.enabled && s.state === 'connected').length;
  const totalEnabled = Object.values(summary).filter((s) => s.enabled).length;

  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={triggerBtnStyle}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <Plug size={16} />
        <strong style={{ fontSize: 14 }}>Integrations</strong>
        <span style={{ marginLeft: 12, fontSize: 12, color: '#9ca3af' }}>
          {connectedCount} connected · {totalEnabled} enabled · {DEFS.length} available
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: '0 14px 14px',
            display: 'grid',
            gap: 14,
            gridTemplateColumns: isNarrow ? '1fr' : '160px 1fr',
          }}
        >
          <nav
            aria-label="Integration list"
            style={{
              display: 'flex',
              flexDirection: isNarrow ? 'row' : 'column',
              gap: isNarrow ? 6 : 4,
              overflowX: isNarrow ? 'auto' : 'visible',
              padding: isNarrow ? '4px 0' : 0,
              minWidth: 0,
            }}
          >
            {isNarrow
              ? DEFS.map((d) => (
                  <RailItem
                    key={d.id}
                    def={d}
                    s={summary[d.id]}
                    selected={selected === d.id}
                    onSelect={() => setSelected(d.id)}
                    compact
                  />
                ))
              : CATEGORY_ORDER.map((cat) => (
                  <div key={cat}>
                    <div style={categoryLabelStyle}>{cat.toUpperCase()}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {grouped.get(cat)!.map((d) => (
                        <RailItem
                          key={d.id}
                          def={d}
                          s={summary[d.id]}
                          selected={selected === d.id}
                          onSelect={() => setSelected(d.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
          </nav>

          <div style={{ minWidth: 0 }}>
            {selectedDef ? (
              <selectedDef.Panel alwaysOpen />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                Pick an integration on the left to configure it.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type RailItemProps = {
  def: IntegrationDef;
  s: { enabled: boolean; state: StatusKind };
  selected: boolean;
  onSelect: () => void;
  /** Compact = narrow-layout chip. Icon + name, but tighter padding + no left rule. */
  compact?: boolean;
};

function RailItem({ def, s, selected, onSelect, compact = false }: RailItemProps) {
  const { color, label } = describe(s);
  const { Icon } = def;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      title={`${def.name}: ${label}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 6 : 8,
        background: selected ? '#1e293b' : 'transparent',
        border: 0,
        color: '#e5e7eb',
        cursor: 'pointer',
        padding: compact ? '5px 10px' : '6px 8px',
        borderRadius: 6,
        textAlign: 'left',
        borderLeft: compact ? 'none' : (selected ? `2px solid ${def.accent}` : '2px solid transparent'),
        borderBottom: compact ? (selected ? `2px solid ${def.accent}` : '2px solid transparent') : 'none',
        flexShrink: 0,
      }}
    >
      <Icon size={compact ? 13 : 14} color={s.state === 'connected' ? def.accent : '#9ca3af'} />
      <span style={{ fontSize: 12, flex: compact ? 0 : 1, whiteSpace: 'nowrap' }}>{def.name}</span>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          boxShadow: color === '#22c55e' ? '0 0 6px rgba(34,197,94,0.6)' : 'none',
        }}
      />
    </button>
  );
}

function describe(s: { enabled: boolean; state: StatusKind }): { color: string; label: string } {
  if (!s.enabled)                  return { color: '#374151', label: 'not enabled' };
  switch (s.state) {
    case 'connected':              return { color: '#22c55e', label: 'connected' };
    case 'connecting':              return { color: '#eab308', label: 'connecting…' };
    case 'needs-auth':              return { color: '#eab308', label: 'needs auth' };
    case 'not-configured':          return { color: '#eab308', label: 'not configured' };
    case 'disconnected':            return { color: '#9ca3af', label: 'disconnected' };
    case 'error':                   return { color: '#ef4444', label: 'error' };
    case 'disabled': default:       return { color: '#374151', label: 'disabled' };
  }
}

const triggerBtnStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 0,
  color: '#fff',
  cursor: 'pointer',
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  textAlign: 'left',
};

const categoryLabelStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 0.6,
  color: '#6b7280',
  padding: '8px 8px 4px',
};

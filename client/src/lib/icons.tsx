import { useEffect, useState, type ComponentType, type SVGProps, type CSSProperties } from 'react';
import { iconPackUrl, type IconPack, type TintMode } from './api';
import {
  Play, Pause, Square, FastForward, Rewind, SkipBack, SkipForward,
  Volume1, Volume2, VolumeX,
  Mic, MicOff, Headphones, Music,
  Video, VideoOff, Camera,
  Monitor, Smartphone,
  Copy, Clipboard, Scissors, Save, File, FileText, Folder, FolderOpen,
  Terminal, Code, Command,
  Link, ExternalLink, Globe, Mail, Github, MessageCircle, Send,
  Power, Lock, Unlock, Eye, EyeOff,
  Sun, Moon, Zap, Star, Heart, Bell,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Plus, Minus, X, Check,
  Settings, Sliders, Search, RefreshCw,
  Home, Menu, MoreHorizontal, Grid3x3,
  Maximize, Minimize, Calendar, Clock,
} from 'lucide-react';
import {
  DiscordBrandIcon, TwitchBrandIcon, KickBrandIcon, ObsBrandIcon, StreamlabsBrandIcon, SpotifyBrandIcon,
} from './brand-icons';

/** Component shape both lucide icons, our custom brand icons, AND pack-icon
 *  wrappers conform to. Pack icons render as `<img>` (they're arbitrary SVGs
 *  fetched from the server, not React components), so the props are widened
 *  to what call-sites actually pass — size + optional strokeWidth. */
export type IconComponent = ComponentType<{
  size?: number | string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
} & SVGProps<SVGSVGElement>>;

export const ICONS: Record<string, IconComponent> = {
  'play': Play, 'pause': Pause, 'square': Square,
  'fast-forward': FastForward, 'rewind': Rewind,
  'skip-back': SkipBack, 'skip-forward': SkipForward,
  'volume-1': Volume1, 'volume-2': Volume2, 'volume-x': VolumeX,
  'mic': Mic, 'mic-off': MicOff, 'headphones': Headphones, 'music': Music,
  'video': Video, 'video-off': VideoOff, 'camera': Camera,
  'monitor': Monitor, 'smartphone': Smartphone,
  'copy': Copy, 'clipboard': Clipboard, 'scissors': Scissors,
  'save': Save, 'file': File, 'file-text': FileText,
  'folder': Folder, 'folder-open': FolderOpen,
  'terminal': Terminal, 'code': Code, 'command': Command,
  'link': Link, 'external-link': ExternalLink, 'globe': Globe,
  'mail': Mail, 'github': Github, 'message-circle': MessageCircle, 'send': Send,
  'power': Power, 'lock': Lock, 'unlock': Unlock, 'eye': Eye, 'eye-off': EyeOff,
  'sun': Sun, 'moon': Moon, 'zap': Zap, 'star': Star, 'heart': Heart, 'bell': Bell,
  'arrow-up': ArrowUp, 'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft, 'arrow-right': ArrowRight,
  'plus': Plus, 'minus': Minus, 'x': X, 'check': Check,
  'settings': Settings, 'sliders': Sliders, 'search': Search, 'refresh-cw': RefreshCw,
  'home': Home, 'menu': Menu, 'more-horizontal': MoreHorizontal, 'grid': Grid3x3,
  'maximize': Maximize, 'minimize': Minimize,
  'calendar': Calendar, 'clock': Clock,
  // Brand marks for the integrations Digi Deck ships (Simple Icons paths, CC0).
  'discord':    DiscordBrandIcon,
  'twitch':     TwitchBrandIcon,
  'kick':       KickBrandIcon,
  'obs':        ObsBrandIcon,
  'streamlabs': StreamlabsBrandIcon,
  'spotify':    SpotifyBrandIcon,
};

export const ICON_NAMES = Object.keys(ICONS).sort();

/** Module-level cache of per-pack tint modes. Populated on app boot (both
 *  the config UI and the grid app fetch the pack list at mount) and refreshed
 *  whenever the picker re-lists them. Unknown packs default to `invert` — the
 *  historical behavior. */
const _packTints: Record<string, TintMode> = {};
const _tintListeners = new Set<() => void>();

export function setPackTints(packs: Array<Pick<IconPack, 'name' | 'tint'>>): void {
  let changed = false;
  for (const p of packs) {
    if (_packTints[p.name] !== p.tint) { _packTints[p.name] = p.tint; changed = true; }
  }
  if (changed) for (const l of _tintListeners) l();
}

/** Bumps whenever the pack-tint cache changes. Components that render pack
 *  icons via `<img>` (ButtonGrid tiles, IconPicker grid) call this so React
 *  re-renders them when the config UI flips a pack's tint mode. */
export function useTintVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    _tintListeners.add(l);
    return () => { _tintListeners.delete(l); };
  }, []);
  return v;
}

export function tintFilter(mode: TintMode): string | undefined {
  // `invert(1) brightness(1.5)` is the monochrome-black baseline (Simple
  // Icons convention). `none` skips CSS filtering so colored packs render
  // as-drawn.
  return mode === 'none' ? undefined : 'invert(1) brightness(1.5)';
}

/** Pack icons are stored server-side and served via `<img src>` — wrap that
 *  into an IconComponent shape so every call-site keeps working unchanged.
 *  Pack format: `<pack>:<name>` (e.g. `simple-icons:spotify`, or
 *  `simple-icons:gaming/steam` for nested pack subdirs). Tint mode comes from
 *  the module cache; call-sites can override via `style.filter`. */
function makePackIcon(pack: string, iconName: string): IconComponent {
  const url = iconPackUrl(pack, iconName);
  return function PackIcon({ size = 24, style }: { size?: number | string; style?: CSSProperties }) {
    const filter = tintFilter(_packTints[pack] ?? 'invert');
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain', display: 'block', ...(filter ? { filter } : null), ...style }}
        draggable={false}
      />
    );
  } as unknown as IconComponent;
}

export function getIcon(name?: string): IconComponent | null {
  if (!name) return null;
  // `<pack>:<name>` naming for pack icons. Bare names still resolve against
  // the compiled-in ICONS map so all existing tiles keep working.
  const colonIdx = name.indexOf(':');
  if (colonIdx > 0 && colonIdx < name.length - 1) {
    const pack = name.slice(0, colonIdx);
    const iconName = name.slice(colonIdx + 1);
    return makePackIcon(pack, iconName);
  }
  return ICONS[name] ?? null;
}

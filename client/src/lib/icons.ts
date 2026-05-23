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
  type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
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
};

export const ICON_NAMES = Object.keys(ICONS).sort();

export function getIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  return ICONS[name] ?? null;
}

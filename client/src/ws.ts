import { useEffect, useRef, useState } from 'react';

export type ImageFit = 'cover' | 'fill' | 'contain';

export type Button = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  imageFit?: ImageFit;
  accentColor?: string;
  /** Server tells us the button has a long-press action; opt into hold detection. */
  hasLongPress?: boolean;
  /** Set on Twitch streamer buttons. Phone uses it to render a thumbnail. */
  streamerLogin?: string;
  /** Set on Kick streamer buttons. Phone uses it to render a thumbnail. */
  kickStreamerSlug?: string;
  /** Set when the button's action contains a goto-page step. Phone navigates locally on press. */
  gotoPageId?: number;
  /** Prompt-at-press descriptors for the tap action. */
  prompts?: PressPrompt[];
  /** Same for the long-press action — kept separate so a tap-side prompt
   *  doesn't fire on long-press and vice versa. */
  longPressPrompts?: PressPrompt[];
};

export type PressPrompt = { field: string; label: string; placeholder?: string; choicesSource?: string };
export type SliderProvider = 'obs' | 'streamlabs' | 'discord';

export type SliderTile = {
  kind: 'slider';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  accentColor?: string;
  provider?: SliderProvider;
  inputName: string;
};
/** Spacer tile — no label, no action, occupies one grid slot. */
export type BlankTile = {
  kind: 'blank';
  id: number;
};

/** Live roster of the voice channel the Discord account is currently in.
 *  Renders as a scrollable card with per-user volume slider + mute toggle. */
export type DiscordVoicePanelTile = {
  kind: 'discord-voice-panel';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  accentColor?: string;
};

export type Tile = Button | SliderTile | BlankTile | DiscordVoicePanelTile;

export type VoicePanelMember = {
  id: string;
  name: string;
  serverMute: boolean;
  selfMute: boolean;
  serverDeaf: boolean;
  selfDeaf: boolean;
  ourVolume: number;
  ourMute: boolean;
  /** Live-updates while the member is actually speaking (Discord SPEAKING_START/STOP events). */
  speaking: boolean;
};
export type Page = { id: number; name: string; icon?: string; image?: string; cols?: number; background?: string; backgroundImage?: string; buttons: Tile[] };
export type NavigationMode = 'tabs' | 'folders';
export type Layout = { navigation?: NavigationMode; pages: Page[] };

export type ButtonState = {
  id: number;
  active?: boolean;
  kind?: 'source';
  unavailable?: boolean;
  thumbnail?: string;
  live?: boolean;
  sliderValue?: number;
  sliderMuted?: boolean;
  /** Dynamic tile background image URL — e.g. a Discord guild icon on a
   *  join-channel tile. Rendered like `tile.image` when the user hasn't
   *  uploaded one of their own. */
  iconUrl?: string;
  /** Voice-panel roster — the current voice channel's members. */
  voicePanelMembers?: VoicePanelMember[];
  /** Voice-panel tile can't render: Discord disconnected or not in a channel. */
  voicePanelDisconnected?: boolean;
};

export type PreviewInfo = { name: string; title: string };

/** Global integration state — drives dynamic tile labels between broadcasts.
 *  Field shapes mirror the LiveMeta from the server; every field is optional
 *  so the phone tolerates older servers that don't send this. */
export type LiveMeta = {
  obs?: {
    recording?: boolean;
    streaming?: boolean;
    recordingStartedAtMs?: number;
    streamingStartedAtMs?: number;
    droppedFrames?: number;
    currentScene?: string;
  };
  discord?: {
    currentVoiceChannelName?: string | null;
    mute?: boolean;
    deaf?: boolean;
  };
};

type ServerMsg =
  | { type: 'layout'; layout: Layout; preview?: PreviewInfo }
  | { type: 'ack'; id: number }
  | { type: 'nack'; id: number; error: string }
  | { type: 'states'; states: ButtonState[]; meta?: LiveMeta };

export type WSStatus = 'connecting' | 'open' | 'closed';

function buildUrl(base: string, token: string | null): string {
  if (!token) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

export function useMacroWS(url: string, token: string | null) {
  const [status, setStatus] = useState<WSStatus>('connecting');
  const [layout, setLayout] = useState<Layout | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [lastAck, setLastAck] = useState<{ id: number; at: number } | null>(null);
  const [lastNack, setLastNack] = useState<{ id: number; error: string; at: number } | null>(null);
  const [buttonStates, setButtonStates] = useState<Map<number, ButtonState>>(new Map());
  const [liveMeta, setLiveMeta] = useState<LiveMeta>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(buildUrl(url, token));
      wsRef.current = ws;

      ws.onopen = () => setStatus('open');
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setStatus('closed');
        reconnect = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as ServerMsg;
          if (msg.type === 'layout') {
            setLayout(msg.layout);
            setPreview(msg.preview ?? null);
          }
          else if (msg.type === 'ack') setLastAck({ id: msg.id, at: Date.now() });
          else if (msg.type === 'nack') setLastNack({ id: msg.id, error: msg.error, at: Date.now() });
          else if (msg.type === 'states') {
            const m = new Map<number, ButtonState>();
            for (const s of msg.states) m.set(s.id, s);
            setButtonStates(m);
            if (msg.meta) setLiveMeta(msg.meta);
          }
        } catch {
          /* ignore malformed */
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnect) clearTimeout(reconnect);
      wsRef.current?.close();
    };
  }, [url, token]);

  function send(msg: object): void {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function press(id: number, longPress?: boolean, promptValues?: Record<string, string>) {
    const msg: Record<string, unknown> = { type: 'press', id };
    if (longPress) msg.longPress = true;
    if (promptValues && Object.keys(promptValues).length) msg.promptValues = promptValues;
    send(msg);
  }
  function sliderValue(id: number, value: number) { send({ type: 'slider', id, value }); }
  function sliderMute(id: number) { send({ type: 'slider-mute', id }); }
  function voicePanelVolume(id: number, userId: string, value: number) { send({ type: 'voice-panel-volume', id, userId, value }); }
  function voicePanelMute(id: number, userId: string) { send({ type: 'voice-panel-mute', id, userId }); }

  return { status, layout, preview, lastAck, lastNack, buttonStates, liveMeta, press, sliderValue, sliderMute, voicePanelVolume, voicePanelMute };
}

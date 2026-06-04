import { useEffect, useRef, useState } from 'react';

export type Button = {
  kind: 'button';
  id: number;
  label: string;
  icon?: string;
  image?: string;
  accentColor?: string;
  /** Server tells us the button has a long-press action; opt into hold detection. */
  hasLongPress?: boolean;
  /** Set on Twitch streamer buttons. Phone uses it to render a thumbnail. */
  streamerLogin?: string;
  /** Set when the button's action contains a goto-page step. Phone navigates locally on press. */
  gotoPageId?: number;
};
export type SliderProvider = 'obs' | 'streamlabs';

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
export type Tile = Button | SliderTile;
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
};

export type PreviewInfo = { name: string; title: string };

type ServerMsg =
  | { type: 'layout'; layout: Layout; preview?: PreviewInfo }
  | { type: 'ack'; id: number }
  | { type: 'states'; states: ButtonState[] };

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
  const [buttonStates, setButtonStates] = useState<Map<number, ButtonState>>(new Map());
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
          else if (msg.type === 'states') {
            const m = new Map<number, ButtonState>();
            for (const s of msg.states) m.set(s.id, s);
            setButtonStates(m);
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

  function press(id: number, longPress?: boolean) {
    send(longPress ? { type: 'press', id, longPress: true } : { type: 'press', id });
  }
  function sliderValue(id: number, value: number) { send({ type: 'slider', id, value }); }
  function sliderMute(id: number) { send({ type: 'slider-mute', id }); }

  return { status, layout, preview, lastAck, buttonStates, press, sliderValue, sliderMute };
}

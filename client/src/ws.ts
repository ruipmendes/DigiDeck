import { useEffect, useRef, useState } from 'react';

export type Button = { id: number; label: string; icon?: string };
export type Page = { id: number; name: string; icon?: string; buttons: Button[] };
export type Layout = { pages: Page[] };

export type ButtonState = {
  id: number;
  active?: boolean;
  kind?: 'source';
  unavailable?: boolean;
};

type ServerMsg =
  | { type: 'layout'; layout: Layout }
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
          if (msg.type === 'layout') setLayout(msg.layout);
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

  function press(id: number) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'press', id }));
    }
  }

  return { status, layout, lastAck, buttonStates, press };
}

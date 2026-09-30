import { useSyncExternalStore } from 'react';
import type { ClientMessage, GameView, LobbyView, ServerMessage } from '@dog/protocol';

export interface NetState {
  conn: 'connecting' | 'open' | 'offline';
  lobby: LobbyView | null;
  game: GameView | null;
  /** Letzte Fehlermeldung des Servers (verschwindet nach ein paar Sekunden) */
  error: string | null;
  /** Grund, warum die Sitzung beendet wurde (Host hat beendet, entfernt, ...) */
  closed: string | null;
}

const TOKEN_KEY = 'dog.token';

function store(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Speicher gesperrt (privater Modus): ohne Wiederverbinden weiterarbeiten */
  }
  return null;
}

export const savedName = () => store('dog.name') ?? '';
export const saveName = (n: string) => void store('dog.name', n);

class Net {
  private state: NetState = { conn: 'connecting', lobby: null, game: null, error: null, closed: null };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.connect();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  private set(patch: Partial<NetState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ conn: 'open' });
      const token = store(TOKEN_KEY);
      if (token) this.send({ t: 'resume', token });
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.set({ conn: 'offline' });
      setTimeout(() => this.connect(), Math.min(10000, 1000 * 2 ** this.retry++));
    };
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'welcome':
        store(TOKEN_KEY, m.token);
        this.set({ closed: null });
        break;
      case 'lobby':
        this.set({ lobby: m.lobby });
        break;
      case 'game':
        this.set({ game: m.view });
        break;
      case 'error':
        // Sitzung existiert nicht mehr (z. B. Server neu aufgesetzt): Token verwerfen
        if (/nicht mehr vorhanden/.test(m.message)) {
          store(TOKEN_KEY, null);
          this.set({ lobby: null, game: null });
        } else {
          this.set({ error: m.message });
          if (this.errorTimer) clearTimeout(this.errorTimer);
          this.errorTimer = setTimeout(() => this.set({ error: null }), 6000);
        }
        break;
      case 'closed':
        store(TOKEN_KEY, null);
        this.set({ lobby: null, game: null, closed: m.reason });
        break;
    }
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  dismissClosed() {
    this.set({ closed: null });
  }
  clearError() {
    this.set({ error: null });
  }
}

export const net = new Net();
export const useNet = (): NetState => useSyncExternalStore(net.subscribe, net.getSnapshot);

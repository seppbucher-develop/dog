import { randomInt } from 'node:crypto';
import { ProtocolError, parseClientMessage, type ClientMessage } from '@dog/protocol';
import { Room, type Connection, type RoomDeps, type RoomSnapshot } from './room';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne I, O, 0, 1
const CODE_LENGTH = 5;
const MAX_ROOMS = 200;
export const ROOM_MAX_IDLE_MS = 24 * 60 * 60 * 1000;

interface Binding {
  token: string;
  room: Room;
}

export interface HubOptions {
  schedule?: RoomDeps['schedule'];
  botDelayMs?: number;
  now?: () => number;
  /** Nach jeder Änderung (zum Speichern) */
  changed?: () => void;
}

export class Hub {
  private rooms = new Map<string, Room>();
  private bindings = new Map<string, Binding>(); // Verbindungs-ID -> Teilnehmer
  private deps: RoomDeps;

  constructor(opts: HubOptions = {}) {
    this.deps = {
      schedule: opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms)),
      botDelayMs: opts.botDelayMs ?? 900,
      now: opts.now ?? Date.now,
      changed: opts.changed ?? (() => {}),
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  private newCode(): string {
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let j = 0; j < CODE_LENGTH; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Kein freier Spielcode');
  }

  /** Verarbeitet eine rohe (bereits JSON-geparste) Nachricht einer Verbindung. */
  handle(conn: Connection, raw: unknown): void {
    let msg: ClientMessage;
    try {
      msg = parseClientMessage(raw);
    } catch (e) {
      conn.send({ t: 'error', message: e instanceof ProtocolError ? e.message : 'Nachricht ungültig' });
      return;
    }
    try {
      this.route(conn, msg);
    } catch (e) {
      conn.send({ t: 'error', message: e instanceof Error ? e.message : 'Fehler' });
    }
  }

  private route(conn: Connection, msg: ClientMessage): void {
    const bound = this.bindings.get(conn.id);

    if (msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') {
      if (bound && msg.t !== 'resume') throw new Error('Du bist bereits in einem Spiel');
      if (msg.t === 'create') return this.create(conn, msg.name);
      if (msg.t === 'join') return this.join(conn, msg.code, msg.name);
      return this.resume(conn, msg.token);
    }

    if (!bound) throw new Error('Kein Spiel – zuerst erstellen oder beitreten');
    bound.room.handle(bound.token, msg);
    if (bound.room.closed) this.dropRoom(bound.room);
    else if (!bound.room.participants.has(bound.token)) this.bindings.delete(conn.id);
  }

  private create(conn: Connection, name: string): void {
    if (this.rooms.size >= MAX_ROOMS) throw new Error('Server ausgelastet, bitte später erneut versuchen');
    const { room, token } = Room.create(this.newCode(), name, conn, this.deps);
    this.rooms.set(room.code, room);
    this.bindings.set(conn.id, { token, room });
    conn.send({ t: 'welcome', token, code: room.code });
    room.changed();
  }

  private join(conn: Connection, code: string, name: string): void {
    const room = this.rooms.get(code);
    if (!room) throw new Error('Spiel nicht gefunden');
    const token = room.addPending(name, conn);
    this.bindings.set(conn.id, { token, room });
    conn.send({ t: 'welcome', token, code: room.code });
    room.changed();
  }

  private resume(conn: Connection, token: string): void {
    for (const room of this.rooms.values()) {
      if (room.participants.has(token)) {
        const prev = [...this.bindings.entries()].find(([, b]) => b.token === token);
        if (prev && prev[0] !== conn.id) this.bindings.delete(prev[0]);
        room.attach(token, conn);
        this.bindings.set(conn.id, { token, room });
        conn.send({ t: 'welcome', token, code: room.code });
        room.changed();
        return;
      }
    }
    throw new Error('Sitzung nicht mehr vorhanden');
  }

  /** Verbindung wurde getrennt: Teilnehmer bleibt erhalten und kann sich mit dem Token wieder verbinden. */
  disconnect(conn: Connection): void {
    const bound = this.bindings.get(conn.id);
    if (!bound) return;
    this.bindings.delete(conn.id);
    bound.room.detach(bound.token, conn);
  }

  private dropRoom(room: Room): void {
    this.rooms.delete(room.code);
    for (const [id, b] of this.bindings) if (b.room === room) this.bindings.delete(id);
    this.deps.changed();
  }

  /** Entfernt lange inaktive Räume. */
  sweep(): number {
    const now = this.deps.now();
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (now - room.lastActivity > ROOM_MAX_IDLE_MS && !room.hasConnections()) {
        room.closeAll('Inaktiv');
        this.dropRoom(room);
        removed++;
      }
    }
    return removed;
  }

  snapshot(): RoomSnapshot[] {
    return [...this.rooms.values()].map((r) => r.snapshot());
  }

  restore(snapshots: RoomSnapshot[]): void {
    for (const s of snapshots) {
      const room = Room.restore(s, this.deps);
      this.rooms.set(room.code, room);
      room.resume();
    }
  }
}

import { randomBytes } from 'node:crypto';
import {
  applyAction,
  chooseAction,
  chooseExchange,
  createGame,
  layoutFor,
  legalPlays,
  makeRand,
  resolveRules,
  type BotLevel,
  type GameConfig,
  type GameState,
} from '@dog/engine';
import type {
  ClientMessage,
  GameView,
  LastPlay,
  LobbyPhase,
  LobbyView,
  SeatSpec,
  ServerMessage,
} from '@dog/protocol';
import { COLOR_COUNT } from '@dog/protocol';
import type { RuleSettings } from '@dog/engine';

export interface Connection {
  id: string;
  send(msg: ServerMessage): void;
  close(reason: string): void;
}

export interface RoomDeps {
  /** Verzögert eine Aktion (Bot-Züge); in Tests sofort/manuell */
  schedule: (fn: () => void, ms: number) => void;
  botDelayMs: number;
  now: () => number;
  /** Wird nach jeder Zustandsänderung aufgerufen (Speichern) */
  changed: () => void;
}

interface Participant {
  token: string;
  name: string;
  status: 'host' | 'player' | 'pending' | 'rejected';
  seat: number | null;
  requestId: string;
  conn: Connection | null;
}

type SeatKind = { kind: 'human' } | { kind: 'bot'; level: BotLevel };

interface Seat {
  spec: SeatKind;
  /** Token des sitzenden Menschen */
  occupant: string | null;
  /** Kugelfarbe (Index in COLOR_NAMES), gehört zum Spieler und wandert beim Platztausch mit */
  color: number;
}

export interface RoomSnapshot {
  code: string;
  phase: LobbyPhase;
  seats: Seat[];
  eightPegs: boolean;
  rules: Partial<RuleSettings>;
  participants: Omit<Participant, 'conn'>[];
  game: GameState | null;
  lastPlay: LastPlay | null;
  lastActivity: number;
}

const DEFAULT_LEVEL: BotLevel = 'intermediate';
const MAX_PENDING = 10;

export const newToken = () => randomBytes(24).toString('hex');
const newSeed = () => randomBytes(4).readUInt32LE(0);

export class Room {
  readonly code: string;
  phase: LobbyPhase = 'lobby';
  seats: Seat[] = [];
  eightPegs = false;
  rules: Partial<RuleSettings> = {};
  participants = new Map<string, Participant>();
  game: GameState | null = null;
  lastPlay: LastPlay | null = null;
  lastActivity: number;
  closed = false;
  private botPending = false;
  private rand = makeRand(newSeed());

  constructor(
    code: string,
    private deps: RoomDeps,
  ) {
    this.code = code;
    this.lastActivity = deps.now();
  }

  // ---------- Teilnehmer ----------

  static create(code: string, hostName: string, conn: Connection, deps: RoomDeps): { room: Room; token: string } {
    const room = new Room(code, deps);
    const token = newToken();
    room.participants.set(token, { token, name: hostName, status: 'host', seat: 0, requestId: newToken(), conn });
    room.seats = [
      { spec: { kind: 'human' }, occupant: token, color: 0 },
      { spec: { kind: 'bot', level: DEFAULT_LEVEL }, occupant: null, color: 1 },
      { spec: { kind: 'bot', level: DEFAULT_LEVEL }, occupant: null, color: 2 },
      { spec: { kind: 'bot', level: DEFAULT_LEVEL }, occupant: null, color: 3 },
    ];
    return { room, token };
  }

  addPending(name: string, conn: Connection): string {
    const pending = [...this.participants.values()].filter((p) => p.status === 'pending').length;
    if (this.phase !== 'lobby') throw new Error('Das Spiel läuft bereits');
    if (pending >= MAX_PENDING) throw new Error('Zu viele offene Anfragen');
    const token = newToken();
    this.participants.set(token, { token, name, status: 'pending', seat: null, requestId: newToken(), conn });
    this.touch();
    return token;
  }

  attach(token: string, conn: Connection): boolean {
    const p = this.participants.get(token);
    if (!p) return false;
    if (p.conn && p.conn !== conn) p.conn.close('Neue Verbindung geöffnet');
    p.conn = conn;
    this.touch();
    return true;
  }

  detach(token: string, conn: Connection): void {
    const p = this.participants.get(token);
    if (p && p.conn === conn) {
      p.conn = null;
      this.broadcast();
    }
  }

  hasConnections(): boolean {
    return [...this.participants.values()].some((p) => p.conn);
  }

  // ---------- Nachrichten ----------

  handle(token: string, msg: ClientMessage): void {
    const me = this.participants.get(token);
    if (!me || this.closed) return;
    try {
      this.dispatch(me, msg);
    } catch (e) {
      me.conn?.send({ t: 'error', message: e instanceof Error ? e.message : 'Fehler' });
    }
  }

  private dispatch(me: Participant, msg: ClientMessage): void {
    const isHost = me.status === 'host';
    const needHost = () => {
      if (!isHost) throw new Error('Nur der Spielinitiator darf das');
    };
    switch (msg.t) {
      case 'configure':
        needHost();
        return this.configure(msg.seats, msg.eightPegs, msg.rules);
      case 'approve':
        needHost();
        return this.approve(msg.requestId, msg.seat, msg.color);
      case 'move':
        needHost();
        return this.move(msg.seat, msg.to);
      case 'setColor':
        needHost();
        return this.setColor(msg.seat, msg.color);
      case 'reject':
        needHost();
        return this.reject(msg.requestId);
      case 'kick':
        needHost();
        return this.kick(msg.seat);
      case 'setBot':
        needHost();
        return this.setBot(msg.seat, msg.level);
      case 'start':
        needHost();
        return this.start();
      case 'rematch':
        needHost();
        if (this.phase !== 'finished') throw new Error('Das Spiel ist noch nicht beendet');
        this.phase = 'lobby';
        this.game = null;
        this.lastPlay = null;
        return this.changed();
      case 'leave':
        return this.leave(me);
      case 'exchange':
      case 'play':
        return this.playerAction(me, msg);
      case 'create':
      case 'join':
      case 'resume':
        throw new Error('Nicht erlaubt');
    }
  }

  // ---------- Lobby ----------

  private configure(specs: SeatSpec[], eightPegs: boolean, rules: Partial<RuleSettings>): void {
    if (this.phase !== 'lobby') throw new Error('Einstellungen nur in der Lobby änderbar');
    const n = specs.length;
    const eight = eightPegs && n === 2;
    // Bereits sitzende Menschen dürfen nicht stillschweigend verschwinden (auch der Initiator nicht)
    this.seats.forEach((s, i) => {
      if (s.occupant && (i >= n || specs[i]!.kind !== 'human')) throw new Error(`Platz ${i + 1} ist besetzt – zuerst entfernen`);
    });
    const config: GameConfig = { players: n, eightPegs: eight, rules };
    try {
      layoutFor(config);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Ungültige Einstellungen');
    }
    // Farben: ausdrücklich gewählte müssen verschieden sein; fehlende bekommen eine freie
    const explicit = specs.map((sp) => sp.color).filter((c): c is number => c !== undefined);
    if (new Set(explicit).size !== explicit.length) throw new Error('Jede Kugelfarbe darf nur einmal vergeben werden');
    const used = new Set(explicit);
    const colors = specs.map((sp, i) => {
      if (sp.color !== undefined) return sp.color;
      const keep = this.seats[i]?.color;
      const c = keep !== undefined && !used.has(keep) ? keep : [...Array(COLOR_COUNT).keys()].find((x) => !used.has(x))!;
      used.add(c);
      return c;
    });
    this.seats = specs.map((sp, i) => ({
      spec: sp.kind === 'bot' ? { kind: 'bot', level: sp.level } : { kind: 'human' },
      occupant: this.seats[i]?.occupant ?? null,
      color: colors[i]!,
    }));
    this.eightPegs = eight;
    this.rules = rules;
    for (const [i, s] of this.seats.entries()) if (s.occupant) this.participants.get(s.occupant)!.seat = i;
    this.changed();
  }

  private approve(requestId: string, seat?: number, color?: number): void {
    if (this.phase !== 'lobby') throw new Error('Das Spiel läuft bereits');
    const p = [...this.participants.values()].find((x) => x.requestId === requestId && x.status === 'pending');
    if (!p) throw new Error('Anfrage nicht gefunden');
    let idx = seat;
    if (idx === undefined) idx = this.seats.findIndex((s) => s.spec.kind === 'human' && !s.occupant);
    const target = this.seats[idx];
    if (idx < 0 || !target || target.spec.kind !== 'human' || target.occupant) throw new Error('Kein freier Platz für Menschen – Sitzplätze anpassen');
    target.occupant = p.token;
    p.status = 'player';
    p.seat = idx;
    if (color !== undefined) this.assignColor(idx, color);
    this.changed();
  }

  /** Farbe setzen; ist sie schon vergeben, tauschen die beiden Plätze ihre Farben. */
  private assignColor(seat: number, color: number): void {
    if (!Number.isInteger(color) || color < 0 || color >= COLOR_COUNT) throw new Error('Ungültige Kugelfarbe');
    const s = this.seats[seat];
    if (!s) throw new Error('Ungültiger Platz');
    const other = this.seats.findIndex((x, i) => i !== seat && x.color === color);
    if (other >= 0) this.seats[other]!.color = s.color;
    s.color = color;
  }

  private setColor(seat: number, color: number): void {
    if (this.phase !== 'lobby') throw new Error('Farben nur in der Lobby änderbar');
    this.assignColor(seat, color);
    this.changed();
  }

  /** Zwei Plätze tauschen: Spieler samt Farbe wechseln die Position am Brett (bei Teams: Partner gegenüber). */
  private move(from: number, to: number): void {
    if (this.phase !== 'lobby') throw new Error('Plätze nur in der Lobby änderbar');
    const a = this.seats[from];
    const b = this.seats[to];
    if (!a || !b || from === to) throw new Error('Ungültiger Platz');
    this.seats[from] = b;
    this.seats[to] = a;
    for (const [i, s] of this.seats.entries()) if (s.occupant) this.participants.get(s.occupant)!.seat = i;
    this.changed();
  }

  private reject(requestId: string): void {
    const p = [...this.participants.values()].find((x) => x.requestId === requestId && x.status === 'pending');
    if (!p) throw new Error('Anfrage nicht gefunden');
    p.status = 'rejected';
    this.changed();
  }

  private removeParticipant(p: Participant, reason: string): void {
    p.conn?.send({ t: 'closed', reason });
    this.participants.delete(p.token);
  }

  private kick(seat: number): void {
    const s = this.seats[seat];
    if (!s) throw new Error('Ungültiger Platz');
    const p = s.occupant ? this.participants.get(s.occupant) : undefined;
    if (!p) throw new Error('Platz ist nicht besetzt');
    if (p.status === 'host') throw new Error('Der Spielinitiator kann nicht entfernt werden');
    s.occupant = null;
    this.removeParticipant(p, 'Vom Spielinitiator entfernt');
    if (this.phase === 'playing') s.spec = { kind: 'bot', level: DEFAULT_LEVEL };
    this.changed();
  }

  private setBot(seat: number, level: BotLevel): void {
    if (this.phase !== 'playing') throw new Error('Nur während des Spiels');
    const s = this.seats[seat];
    if (!s) throw new Error('Ungültiger Platz');
    const p = s.occupant ? this.participants.get(s.occupant) : undefined;
    if (p?.status === 'host') throw new Error('Der Spielinitiator kann nicht ersetzt werden');
    if (p) this.removeParticipant(p, 'Ein Computerspieler hat deinen Platz übernommen');
    s.occupant = null;
    s.spec = { kind: 'bot', level };
    this.changed();
  }

  private start(): void {
    if (this.phase !== 'lobby') throw new Error('Das Spiel läuft bereits');
    const open = this.seats.findIndex((s) => s.spec.kind === 'human' && !s.occupant);
    if (open >= 0) throw new Error(`Platz ${open + 1} ist noch frei – Mitspieler bewilligen oder Computer einsetzen`);
    const config: GameConfig = { players: this.seats.length, eightPegs: this.eightPegs, rules: this.rules };
    this.game = createGame(config, newSeed());
    this.rand = makeRand(newSeed());
    this.lastPlay = null;
    this.phase = 'playing';
    // Wartende Anfragen verfallen mit dem Spielstart
    for (const p of [...this.participants.values()]) if (p.status === 'pending' || p.status === 'rejected') this.removeParticipant(p, 'Das Spiel hat begonnen');
    this.changed();
  }

  private leave(me: Participant): void {
    if (me.status === 'host') {
      for (const p of [...this.participants.values()]) this.removeParticipant(p, 'Der Spielinitiator hat das Spiel beendet');
      this.closed = true;
      return;
    }
    if (me.seat !== null) {
      const s = this.seats[me.seat];
      if (s) {
        s.occupant = null;
        if (this.phase === 'playing') s.spec = { kind: 'bot', level: DEFAULT_LEVEL };
      }
    }
    this.participants.delete(me.token);
    me.conn?.send({ t: 'closed', reason: 'Du hast das Spiel verlassen' });
    this.changed();
  }

  // ---------- Spiel ----------

  private playerAction(me: Participant, msg: Extract<ClientMessage, { t: 'exchange' | 'play' }>): void {
    if (this.phase !== 'playing' || !this.game) throw new Error('Kein laufendes Spiel');
    if (me.seat === null) throw new Error('Du sitzt nicht am Tisch');
    if (msg.t === 'exchange') {
      this.game = applyAction(this.game, { t: 'exchange', player: me.seat, card: msg.card });
    } else {
      const action = { t: 'play' as const, player: me.seat, card: msg.card, moves: msg.moves, ...(msg.as ? { as: msg.as } : {}) };
      this.game = applyAction(this.game, action);
      this.lastPlay = { player: me.seat, card: msg.card, moves: msg.moves, ...(msg.as ? { as: msg.as } : {}) };
    }
    this.changed();
  }

  /** Bots ziehen lassen, solange sie am Zug sind (Tauschkarten sofort, Züge mit Verzögerung). */
  private pump(): void {
    if (this.closed || this.phase !== 'playing' || !this.game) return;
    let g = this.game;
    if (g.phase === 'finished') {
      this.phase = 'finished';
      return;
    }
    if (g.phase === 'exchange') {
      for (let p = 0; p < this.seats.length; p++) {
        const s = this.seats[p]!;
        if (s.spec.kind === 'bot' && g.phase === 'exchange' && g.exchange[p] === null) {
          g = applyAction(g, chooseExchange(g, p, s.spec.level, this.rand));
        }
      }
      this.game = g;
      if (g.phase === 'exchange') return;
    }
    const spec = this.seats[g.current]?.spec;
    if (spec?.kind !== 'bot' || this.botPending) return;
    this.botPending = true;
    this.deps.schedule(() => {
      this.botPending = false;
      const cur = this.game;
      if (this.closed || !cur || this.phase !== 'playing' || cur.phase !== 'playing') return;
      const s = this.seats[cur.current];
      if (s?.spec.kind !== 'bot') return;
      const action = chooseAction(cur, cur.current, s.spec.level, this.rand);
      this.game = applyAction(cur, action);
      this.lastPlay = { player: action.player, card: action.card, moves: action.moves, ...(action.as ? { as: action.as } : {}) };
      this.changed();
    }, this.deps.botDelayMs);
  }

  // ---------- Sichten ----------

  private touch(): void {
    this.lastActivity = this.deps.now();
  }

  /** Nach jeder Zustandsänderung: Bots anstoßen, allen den neuen Stand schicken, speichern. */
  changed(): void {
    this.touch();
    this.pump();
    if (this.game?.phase === 'finished') this.phase = 'finished';
    this.broadcast();
    this.deps.changed();
  }

  private lobbyView(p: Participant): LobbyView {
    let teams: number[][] = [];
    let rules: RuleSettings;
    try {
      const cfg = { players: this.seats.length, eightPegs: this.eightPegs, rules: this.rules };
      const layout = layoutFor(cfg);
      rules = layout.rules;
      teams = layout.teams ? layout.teamList : [];
    } catch {
      rules = resolveRules({ players: 4 });
    }
    const view: LobbyView = {
      code: this.code,
      phase: this.phase,
      you: { status: p.status, seat: p.seat, name: p.name },
      seats: this.seats.map((s) => {
        const occ = s.occupant ? this.participants.get(s.occupant) : undefined;
        return {
          kind: s.spec.kind,
          color: s.color,
          ...(s.spec.kind === 'bot' ? { level: s.spec.level } : {}),
          ...(occ ? { name: occ.name } : {}),
          filled: s.spec.kind === 'bot' || !!occ,
          connected: s.spec.kind === 'bot' || !!occ?.conn,
        };
      }),
      eightPegs: this.eightPegs,
      rules,
      teams,
    };
    if (p.status === 'host') {
      view.requests = [...this.participants.values()].filter((x) => x.status === 'pending').map((x) => ({ id: x.requestId, name: x.name }));
    }
    return view;
  }

  /** Spielsicht eines Sitzplatzes: nur die eigene Hand, sonst nur Kartenzahlen. */
  private gameView(seat: number): GameView | null {
    const g = this.game;
    if (!g) return null;
    return {
      config: g.config,
      phase: g.phase,
      seat,
      pegs: g.pegs,
      handSizes: g.hands.map((h) => h.length),
      myHand: g.hands[seat] ?? [],
      deckCount: g.deck.length,
      current: g.current,
      dealer: g.dealer,
      round: g.round,
      exchangeDone: g.exchange.map((c) => c !== null),
      winners: g.winners,
      legal: g.phase === 'playing' && g.current === seat ? legalPlays(g, seat) : null,
      lastPlay: this.lastPlay,
    };
  }

  sendTo(p: Participant): void {
    if (!p.conn) return;
    p.conn.send({ t: 'lobby', lobby: this.lobbyView(p) });
    p.conn.send({ t: 'game', view: p.seat !== null ? this.gameView(p.seat) : null });
  }

  sendToToken(token: string): void {
    const p = this.participants.get(token);
    if (p) this.sendTo(p);
  }

  broadcast(): void {
    for (const p of this.participants.values()) this.sendTo(p);
  }

  closeAll(reason: string): void {
    for (const p of [...this.participants.values()]) this.removeParticipant(p, reason);
    this.closed = true;
  }

  // ---------- Speichern ----------

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      seats: this.seats,
      eightPegs: this.eightPegs,
      rules: this.rules,
      participants: [...this.participants.values()].map(({ conn: _conn, ...rest }) => rest),
      game: this.game,
      lastPlay: this.lastPlay,
      lastActivity: this.lastActivity,
    };
  }

  static restore(s: RoomSnapshot, deps: RoomDeps): Room {
    const room = new Room(s.code, deps);
    room.phase = s.phase;
    room.seats = s.seats.map((seat, i) => ({ ...seat, color: seat.color ?? i }));
    room.eightPegs = s.eightPegs;
    room.rules = s.rules;
    room.game = s.game;
    room.lastPlay = s.lastPlay;
    room.lastActivity = s.lastActivity;
    for (const p of s.participants) room.participants.set(p.token, { ...p, conn: null });
    return room;
  }

  /** Nach dem Laden: laufende Bot-Züge wieder anstoßen */
  resume(): void {
    this.pump();
  }
}

import {
  BOT_LEVELS,
  DEFAULT_RULES,
  RANKS,
  type BotLevel,
  type Card,
  type GameConfig,
  type Move,
  type Peg,
  type Phase,
  type Play,
  type Rank,
  type RuleSettings,
} from '@dog/engine';

// ---------- Client -> Server ----------

/** Anzahl wählbarer Kugelfarben und ihre Namen (Index = Farbnummer) */
export const COLOR_NAMES = ['Rot', 'Blau', 'Gelb', 'Grün', 'Schwarz', 'Weiß'] as const;
export const COLOR_COUNT = COLOR_NAMES.length;

/** Sitzplatz: Mensch oder Computer; `color` = Kugelfarbe (fehlt sie, vergibt der Server eine freie). */
export type SeatSpec = { kind: 'human'; color?: number } | { kind: 'bot'; level: BotLevel; color?: number };

export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; token: string }
  /** Host: Sitzplätze und Regeln festlegen. Platz 0 ist immer der Host (Mensch). */
  | { t: 'configure'; seats: SeatSpec[]; eightPegs: boolean; rules: Partial<RuleSettings> }
  /** Host: Anfrage bewilligen; Platz und Kugelfarbe wählbar (sonst erster freier Menschenplatz). */
  | { t: 'approve'; requestId: string; seat?: number; color?: number }
  /** Host (Lobby): Sitzplätze tauschen – Spieler samt Kugelfarbe wechseln die Position am Brett. */
  | { t: 'move'; seat: number; to: number }
  /** Host (Lobby): Kugelfarbe eines Platzes ändern; ist sie vergeben, tauschen die Plätze die Farben. */
  | { t: 'setColor'; seat: number; color: number }
  | { t: 'reject'; requestId: string }
  /** Host: Mensch von seinem Platz entfernen (Lobby: Platz wird frei; im Spiel: Bot übernimmt). */
  | { t: 'kick'; seat: number }
  /** Host: im Spiel einen Platz durch einen Bot ersetzen (z. B. bei Verbindungsabbruch). */
  | { t: 'setBot'; seat: number; level: BotLevel }
  | { t: 'start' }
  | { t: 'exchange'; card: Card }
  | { t: 'play'; card: Card; as?: Rank; moves: Move[] }
  | { t: 'rematch' }
  | { t: 'leave' };

// ---------- Server -> Client ----------

export type LobbyPhase = 'lobby' | 'playing' | 'finished';

export interface SeatView {
  kind: 'human' | 'bot';
  /** Kugelfarbe (Index in COLOR_NAMES) */
  color: number;
  level?: BotLevel;
  /** Mensch: Name, sobald jemand sitzt */
  name?: string;
  filled: boolean;
  connected: boolean;
}

export interface LobbyView {
  code: string;
  phase: LobbyPhase;
  you: { status: 'host' | 'player' | 'pending' | 'rejected'; seat: number | null; name: string };
  seats: SeatView[];
  eightPegs: boolean;
  rules: RuleSettings;
  /** Teams als Sitzplatz-Listen (im Einzelspiel leer) */
  teams: number[][];
  /** Nur für den Host */
  requests?: { id: string; name: string }[];
}

export interface LastPlay {
  /** Laufende Nummer des Zugs (zum Erkennen neuer Züge in der Anzeige) */
  n?: number;
  player: number;
  card: Card;
  as?: Rank;
  moves: Move[];
}

export interface GameView {
  config: GameConfig;
  phase: Phase;
  seat: number;
  pegs: Peg[];
  handSizes: number[];
  myHand: Card[];
  deckCount: number;
  /** Ablagestapel: Anzahl und oberste Karte */
  discardCount: number;
  discardTop: Card | null;
  current: number;
  dealer: number;
  round: number;
  /** Kartentausch: wer hat schon gewählt */
  exchangeDone: boolean[];
  winners: number[] | null;
  /** Legale Züge, nur wenn der Spieler am Zug ist */
  legal: Play[] | null;
  lastPlay: LastPlay | null;
  /** Letzte Fälle, in denen jemand keinen Zug hatte und die Hand abgeworfen wurde (neueste zuletzt) */
  passes: PassEvent[];
}

export interface PassEvent {
  id: number;
  player: number;
  cards: number;
}

export type ServerMessage =
  | { t: 'welcome'; token: string; code: string }
  | { t: 'lobby'; lobby: LobbyView }
  | { t: 'game'; view: GameView | null }
  | { t: 'error'; message: string }
  | { t: 'closed'; reason: string };

// ---------- Validierung ----------

export class ProtocolError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, what: string, max: number): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new ProtocolError(`${what} ungültig`);
  return v;
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ProtocolError(`${what} ungültig`);
  return v;
}

const RANK_SET = new Set<string>(RANKS);

function rank(v: unknown, what: string): Rank {
  if (typeof v !== 'string' || !RANK_SET.has(v)) throw new ProtocolError(`${what} ungültig`);
  return v as Rank;
}

function card(v: unknown): Card {
  if (v === 'JOKER') return 'JOKER';
  return rank(v, 'Karte');
}

function level(v: unknown): BotLevel {
  if (typeof v !== 'string' || !(BOT_LEVELS as string[]).includes(v)) throw new ProtocolError('Stufe ungültig');
  return v as BotLevel;
}

/** Namen: getrimmt, ohne Steuerzeichen, 1..20 Zeichen. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw new ProtocolError('Name ungültig');
  const n = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (n.length === 0 || n.length > 20) throw new ProtocolError('Name muss 1 bis 20 Zeichen lang sein');
  return n;
}

function move(v: unknown): Move {
  if (!isObj(v)) throw new ProtocolError('Zug ungültig');
  switch (v.t) {
    case 'start':
      return { t: 'start', peg: int(v.peg, 'Kugel', 0, 63) };
    case 'move':
      return { t: 'move', peg: int(v.peg, 'Kugel', 0, 63), steps: int(v.steps, 'Schritte', -13, 13), ...(v.pass === true ? { pass: true as const } : {}) };
    case 'swap':
      return { t: 'swap', a: int(v.a, 'Kugel', 0, 63), b: int(v.b, 'Kugel', 0, 63) };
    case 'steal':
      return { t: 'steal', from: int(v.from, 'Spieler', 0, 5), idx: int(v.idx, 'Kartenposition', 0, 19) };
    default:
      throw new ProtocolError('Zugart ungültig');
  }
}

/** Nur bekannte Regel-Schlüssel übernehmen; Werte prüft anschließend die Engine (resolveRules). */
export function cleanRules(v: unknown): Partial<RuleSettings> {
  if (v === undefined) return {};
  if (!isObj(v)) throw new ProtocolError('Regeln ungültig');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_RULES)) {
    if (Object.prototype.hasOwnProperty.call(v, key)) out[key] = v[key];
  }
  const hs = out.handSizes;
  if (hs !== undefined && (!Array.isArray(hs) || hs.length > 20)) throw new ProtocolError('handSizes ungültig');
  return out as Partial<RuleSettings>;
}

function colorOpt(v: unknown): number | undefined {
  return v === undefined ? undefined : int(v, 'Farbe', 0, COLOR_COUNT - 1);
}

function seatSpec(v: unknown): SeatSpec {
  if (!isObj(v)) throw new ProtocolError('Sitzplatz ungültig');
  const color = colorOpt(v.color);
  const c = color === undefined ? {} : { color };
  if (v.kind === 'human') return { kind: 'human', ...c };
  if (v.kind === 'bot') return { kind: 'bot', level: level(v.level), ...c };
  throw new ProtocolError('Sitzplatz ungültig');
}

/** Prüft eine Nachricht vom Client streng; wirft ProtocolError. */
export function parseClientMessage(raw: unknown): ClientMessage {
  if (!isObj(raw)) throw new ProtocolError('Nachricht ungültig');
  switch (raw.t) {
    case 'create':
      return { t: 'create', name: cleanName(raw.name) };
    case 'join':
      return { t: 'join', code: str(raw.code, 'Code', 8).toUpperCase(), name: cleanName(raw.name) };
    case 'resume':
      return { t: 'resume', token: str(raw.token, 'Token', 128) };
    case 'configure': {
      if (!Array.isArray(raw.seats) || raw.seats.length < 2 || raw.seats.length > 6) throw new ProtocolError('2 bis 6 Plätze');
      return {
        t: 'configure',
        seats: raw.seats.map(seatSpec),
        eightPegs: raw.eightPegs === true,
        rules: cleanRules(raw.rules),
      };
    }
    case 'approve': {
      const m: ClientMessage = { t: 'approve', requestId: str(raw.requestId, 'Anfrage', 64) };
      if (raw.seat !== undefined) m.seat = int(raw.seat, 'Platz', 0, 5);
      const color = colorOpt(raw.color);
      if (color !== undefined) m.color = color;
      return m;
    }
    case 'move':
      return { t: 'move', seat: int(raw.seat, 'Platz', 0, 5), to: int(raw.to, 'Zielplatz', 0, 5) };
    case 'setColor':
      return { t: 'setColor', seat: int(raw.seat, 'Platz', 0, 5), color: int(raw.color, 'Farbe', 0, COLOR_COUNT - 1) };
    case 'reject':
      return { t: 'reject', requestId: str(raw.requestId, 'Anfrage', 64) };
    case 'kick':
      return { t: 'kick', seat: int(raw.seat, 'Platz', 0, 5) };
    case 'setBot':
      return { t: 'setBot', seat: int(raw.seat, 'Platz', 0, 5), level: level(raw.level) };
    case 'start':
    case 'rematch':
    case 'leave':
      return { t: raw.t };
    case 'exchange':
      return { t: 'exchange', card: card(raw.card) };
    case 'play': {
      if (!Array.isArray(raw.moves) || raw.moves.length > 8) throw new ProtocolError('Züge ungültig');
      const m: ClientMessage = { t: 'play', card: card(raw.card), moves: raw.moves.map(move) };
      if (raw.as !== undefined) m.as = rank(raw.as, 'Rang');
      return m;
    }
    default:
      throw new ProtocolError('Unbekannte Nachricht');
  }
}

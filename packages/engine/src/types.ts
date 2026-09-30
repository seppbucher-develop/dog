export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Card = Rank | 'JOKER';

export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export interface GameConfig {
  /** 2..6 Spieler. 4 und 6 = Teamspiel (Partner gegenüber), sonst jeder für sich. */
  players: number;
  /** Nur bei 2 Spielern: 8 Kugeln (eigene + gegenüberliegende Farbe) statt 4. */
  eightPegs?: boolean;
}

export type Pos =
  | { t: 'home' }
  | { t: 'ring'; f: number } // absolutes Ringfeld
  | { t: 'fin'; s: number }; // Zielhaus-Platz 0..3

export interface Peg {
  id: number;
  color: number;
  pos: Pos;
}

export type Move =
  | { t: 'start'; peg: number }
  /** steps > 0 vorwärts, -4 rückwärts */
  | { t: 'move'; peg: number; steps: number }
  | { t: 'swap'; a: number; b: number }
  /** Bube im Einzelspiel: blind eine Karte (Position idx) eines Gegners ziehen */
  | { t: 'steal'; from: number; idx: number };

export type Action =
  | { t: 'exchange'; player: number; card: Card }
  /** `as` = Rang, als der der Joker gespielt wird (sonst weglassen) */
  | { t: 'play'; player: number; card: Card; as?: Rank; moves: Move[] };

export interface Play {
  card: Card;
  as?: Rank;
  moves: Move[];
}

export type Phase = 'exchange' | 'playing' | 'finished';

export interface GameState {
  config: GameConfig;
  phase: Phase;
  pegs: Peg[];
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  dealer: number;
  round: number;
  current: number;
  /** Teamspiel: pro Spieler die zum Tausch gewählte Karte */
  exchange: (Card | null)[];
  /** Gewinner (Spieler-Indizes des Teams bzw. der einzelne Spieler) */
  winners: number[] | null;
  rng: number;
}

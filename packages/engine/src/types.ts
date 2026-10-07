export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Card = Rank | 'JOKER';

export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Regel-Einstellungen; alle Werte sind beim Spielstart fix. */
export interface RuleSettings {
  /** 7: dieselbe Kugel darf mehrfach in einer Aufteilung vorkommen (ändert die erreichbaren Stellungen praktisch nie). */
  sevenRepeatPeg: boolean;
  /**
   * 7: darf auch auf fremde Kugeln (Gegner, Partner) aufgeteilt werden ('auto' = nur im Einzelspiel mit 2, 3, 5 Spielern).
   * Sonst nur eigene Kugeln, im Teamspiel zusätzlich die des Partners, sobald man selbst fertig ist.
   */
  sevenAnyPeg: 'auto' | 'on' | 'off';
  /** 4: 'backward' = nur rückwärts, 'both' = wahlweise vorwärts oder rückwärts (rückwärts nie ins Haus). */
  fourDirection: 'backward' | 'both';
  /** Bube (Teamspiel): auch mit Kugeln des Partners tauschen, nicht nur mit Gegnern. */
  jackSwapPartner: boolean;
  /**
   * Bube: auch zwei eigene Kugeln tauschen. Ändert das Brett meist nicht, verhindert aber den
   * Abwurf der ganzen Hand, wenn sonst kein Zug möglich wäre.
   */
  jackSwapOwn: boolean;
  /** 2 Spieler mit 4 Kugeln: Brett mit 2 (compact) oder 4 (full) Abschnitten. */
  twoPlayerBoard: 'compact' | 'full';
  /** 6 Spieler: 3 Teams zu 2 (Partner gegenüber) oder 2 Teams zu 3 (abwechselnd sitzend). */
  sixPlayerTeams: 'threeOfTwo' | 'twoOfThree';
  /** Kartentausch: 'auto' = nur im Teamspiel; 'on' = immer (Einzelspiel: an den nächsten Spieler); 'off' = nie. */
  cardExchange: 'auto' | 'on' | 'off';
  /** Darf man eigene Kugeln und Kugeln des Teams schlagen (heimschicken)? */
  captureOwn: boolean;
  /** Erste Kugel jeder Farbe steht schon auf dem Startfeld: 'auto' = nur im Einzelspiel (2, 3, 5 Spieler). */
  firstPegOnStart: 'auto' | 'on' | 'off';
  /** Kartenanzahl pro Runde, wird zyklisch wiederholt. */
  handSizes: number[];
  /** Zuggeschwindigkeit 1 (schnell) bis 5 (langsam): Takt der Computerzüge und Dauer der Kartenanimation. */
  turnSpeed: number;
}

export const DEFAULT_RULES: RuleSettings = {
  sevenRepeatPeg: true,
  sevenAnyPeg: 'auto',
  fourDirection: 'both',
  jackSwapPartner: true,
  jackSwapOwn: true,
  twoPlayerBoard: 'compact',
  sixPlayerTeams: 'threeOfTwo',
  cardExchange: 'auto',
  captureOwn: true,
  firstPegOnStart: 'auto',
  handSizes: [6, 5, 4, 3, 2],
  turnSpeed: 1,
};

export interface GameConfig {
  /** 2..6 Spieler. 4 und 6 = Teamspiel, sonst jeder für sich. */
  players: number;
  /** Nur bei 2 Spielern: 8 Kugeln (eigene + gegenüberliegende Farbe) statt 4. */
  eightPegs?: boolean;
  rules?: Partial<RuleSettings>;
}

export type Pos =
  | { t: 'home' }
  /** absolutes Ringfeld; `lap` = Kugel hat die Runde vollendet und steht wieder auf dem eigenen Startfeld (bereit fürs Zielhaus) */
  | { t: 'ring'; f: number; lap?: true }
  | { t: 'fin'; s: number }; // Zielhaus-Platz 0..3

export interface Peg {
  id: number;
  color: number;
  pos: Pos;
}

export type Move =
  | { t: 'start'; peg: number }
  /** steps > 0 vorwärts, -4 rückwärts; `pass` = am Zielhaus vorbei weiterlaufen statt hineinzuziehen */
  | { t: 'move'; peg: number; steps: number; pass?: true }
  | { t: 'swap'; a: number; b: number }
  /** 2 im Einzelspiel: blind eine Karte (Position idx) eines Gegners ziehen, statt 2 zu fahren (zählt als Zug) */
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
  /** Spieler, deren Hand in der letzten Aktion wegen fehlendem Zug automatisch abgeworfen wurde */
  passed?: { player: number; cards: number }[];
}

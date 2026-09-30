import type { GameConfig, GameState, Peg } from './types';

export const SEGMENT = 16;
export const PEGS_PER_COLOR = 4;
export const FINISH_SLOTS = 4;

export interface Layout {
  /** Anzahl Farben = Brettabschnitte */
  colors: number;
  ringSize: number;
  teams: boolean;
  /** Farben je Spieler */
  colorsOf: number[][];
  /** Spieler der Farbe */
  ownerOf: number[];
  /** Partner (nur Teamspiel) */
  partnerOf: (number | null)[];
}

export function layoutFor(config: GameConfig): Layout {
  const n = config.players;
  if (!Number.isInteger(n) || n < 2 || n > 6) throw new Error('2 bis 6 Spieler');
  const teams = n === 4 || n === 6;
  let colors = n;
  const colorsOf: number[][] = [];
  if (n === 2 && config.eightPegs) {
    colors = 4;
    colorsOf.push([0, 2], [1, 3]);
  } else {
    for (let p = 0; p < n; p++) colorsOf.push([p]);
  }
  const ownerOf: number[] = [];
  colorsOf.forEach((cs, p) => cs.forEach((c) => (ownerOf[c] = p)));
  const partnerOf = colorsOf.map((_, p) => (teams ? (p + n / 2) % n : null));
  return { colors, ringSize: colors * SEGMENT, teams, colorsOf, ownerOf, partnerOf };
}

export const mod = (a: number, m: number) => ((a % m) + m) % m;
export const startField = (color: number) => color * SEGMENT;

export function createPegs(layout: Layout): Peg[] {
  const pegs: Peg[] = [];
  for (let c = 0; c < layout.colors; c++) {
    for (let i = 0; i < PEGS_PER_COLOR; i++) {
      pegs.push({ id: c * PEGS_PER_COLOR + i, color: c, pos: { t: 'home' } });
    }
  }
  return pegs;
}

/** Schritte seit dem eigenen Startfeld (0..ringSize-1) für eine Kugel auf dem Ring. */
export function progress(layout: Layout, peg: Peg): number {
  if (peg.pos.t !== 'ring') throw new Error('Kugel nicht auf dem Ring');
  return mod(peg.pos.f - startField(peg.color), layout.ringSize);
}

/** Kugel steht auf dem eigenen Startfeld und blockiert damit das Überspringen. */
export function isBlocker(peg: Peg): boolean {
  return peg.pos.t === 'ring' && peg.pos.f === startField(peg.color);
}

export function pegAt(state: GameState, f: number): Peg | undefined {
  return state.pegs.find((p) => p.pos.t === 'ring' && p.pos.f === f);
}

export function allInFinish(state: GameState, color: number): boolean {
  return state.pegs.filter((p) => p.color === color).every((p) => p.pos.t === 'fin');
}

/** Farben, die der Spieler gerade bewegen darf (inkl. Partner, wenn er selbst fertig ist). */
export function controlledColors(state: GameState, layout: Layout, player: number): number[] {
  const own = layout.colorsOf[player]!;
  if (layout.teams && own.every((c) => allInFinish(state, c))) {
    const partner = layout.partnerOf[player];
    if (partner !== null && partner !== undefined) return [...own, ...layout.colorsOf[partner]!];
  }
  return own;
}

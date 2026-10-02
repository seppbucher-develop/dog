import type { Card, Move, Play, Rank } from '@dog/engine';

/** Auswahlzustand beim Ausspielen: gewählte Karte und bereits gewählte Teilzüge (z. B. bei der 7). */
export interface Selection {
  card: Card | null;
  /** Joker: als welche Karte er gespielt wird (erst nach der Wahl gibt es Züge) */
  as?: Rank;
  prefix: Move[];
}

export const emptySel: Selection = { card: null, prefix: [] };

export const sameMove = (a: Move, b: Move): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Alle legalen Züge mit der gewählten Karte, die mit den bisher gewählten Teilzügen beginnen. */
export function candidates(legal: Play[], sel: Selection): Play[] {
  const { card } = sel;
  if (!card) return [];
  if (card === 'JOKER' && !sel.as) return [];
  return legal.filter((p) => p.card === card && (card !== 'JOKER' || p.as === sel.as) && sel.prefix.every((m, i) => p.moves[i] !== undefined && sameMove(p.moves[i]!, m)));
}

/** Mögliche nächste Teilzüge (ohne Doppelte). */
export function nextMoves(cands: Play[], k: number): Move[] {
  const out: Move[] = [];
  for (const p of cands) {
    const m = p.moves[k];
    if (m && !out.some((o) => sameMove(o, m))) out.push(m);
  }
  return out;
}

/** Ein vollständiger Zug, der genau nach k Teilzügen endet (sonst null). */
export function completed(cands: Play[], k: number): Play | null {
  return cands.find((p) => p.moves.length === k) ?? null;
}

/** Ränge, als die ein Joker mit dem aktuellen Stand spielbar ist (in Kartenreihenfolge). */
export function jokerRanks(legal: Play[]): Rank[] {
  const set = new Set(legal.filter((p) => p.card === 'JOKER' && p.as).map((p) => p.as!));
  return RANK_ORDER.filter((r) => set.has(r));
}

const RANK_ORDER: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** Karten, mit denen es überhaupt einen legalen Zug gibt. */
export function playableCards(legal: Play[]): Set<Card> {
  return new Set(legal.map((p) => p.card));
}

/** Kugeln, die in einem der möglichen nächsten Teilzüge vorkommen. */
export function movablePegs(opts: Move[]): Set<number> {
  const s = new Set<number>();
  for (const m of opts) {
    if (m.t === 'start' || m.t === 'move') s.add(m.peg);
    else if (m.t === 'swap') {
      s.add(m.a);
      s.add(m.b);
    }
  }
  return s;
}

/** Teilzüge, an denen die Kugel beteiligt ist. */
export function optionsForPeg(opts: Move[], peg: number): Move[] {
  return opts.filter((m) => (m.t === 'start' || m.t === 'move' ? m.peg === peg : m.t === 'swap' ? m.a === peg || m.b === peg : false));
}

/** Verbleibende Schritte einer 7 nach den gewählten Teilzügen. */
export function sevenRemaining(prefix: Move[]): number {
  return 7 - prefix.reduce((n, m) => n + (m.t === 'move' && m.steps > 0 ? m.steps : 0), 0);
}

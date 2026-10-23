import type { Card } from '@dog/engine';
import type { GameView } from '@dog/protocol';
import type { Flight } from './Board';
import { suitOf } from './cards';
import type { Timing } from './speed';

export type FlightSpec = Omit<Flight, 'key'>;
type Spot = { x: number; y: number };

/** Orte auf dem Brett, zwischen denen Karten fliegen */
export interface Spots {
  nest(seat: number): Spot;
  pile: Spot;
  deck: Spot;
}

/** Anzeigestand ab dem Zeitpunkt `at` (ms nach Beginn); überlagert den alten Spielstand */
export interface Frame {
  at: number;
  patch: Partial<GameView>;
}

export interface Plan {
  frames: Frame[];
  flights: { at: number; spec: FlightSpec }[];
  /** Dauer bis der neue Spielstand vollständig gezeigt wird */
  total: number;
}

const STAGGER = 90;
const DEAL_CARDS = 3;
const PAUSE = 120;

/**
 * Zerlegt den Übergang vom angezeigten zum neuen Spielstand in zeitlich geordnete Schritte – in der Reihenfolge,
 * in der die Engine sie ausführt: Karte spielen → Kugeln → Kartenübergaben → Abwürfe → Neumischen/Austeilen.
 * Hand, Stapel, Kartenzahlen und Kugeln ändern sich erst, wenn die zugehörige Karte angekommen ist.
 */
export function planTransition(prev: GameView, next: GameView, tm: Timing, spots: Spots): Plan {
  const seat = next.seat;
  const frames: Frame[] = [];
  const flights: Plan['flights'] = [];
  let t = 0;

  const d = {
    myHand: [...prev.myHand],
    mySuits: [...prev.mySuits],
    handSizes: [...prev.handSizes],
    deckCount: prev.deckCount,
    discardCount: prev.discardCount,
    discardTop: prev.discardTop,
    discardSuit: prev.discardSuit,
    pegs: prev.pegs,
    round: prev.round,
    dealer: prev.dealer,
  };
  const emit = () => frames.push({ at: t, patch: { ...d, myHand: [...d.myHand], mySuits: [...d.mySuits], handSizes: [...d.handSizes] } });
  const fly = (spec: FlightSpec) => flights.push({ at: t, spec });
  const landOnPile = (top: Card, suit: number, cards: number) => {
    d.discardCount += cards;
    d.discardTop = top;
    d.discardSuit = suit;
  };
  const removeFromHand = (card: Card, suit: number) => {
    let i = d.myHand.findIndex((c, k) => c === card && (card === 'JOKER' || d.mySuits[k] === suit));
    if (i < 0) i = d.myHand.indexOf(card);
    if (i < 0) return;
    d.myHand.splice(i, 1);
    d.mySuits.splice(i, 1);
  };
  const pegsMove = JSON.stringify(prev.pegs) !== JSON.stringify(next.pegs);

  const seenTransfer = Math.max(0, ...prev.transfers.map((x) => x.id));
  const seenPass = Math.max(0, ...prev.passes.map((e) => e.id));
  const transfers = next.transfers.filter((x) => x.id > seenTransfer);
  const passes = next.passes.filter((e) => e.id > seenPass);
  const lp = next.lastPlay;
  const playNew = lp !== null && lp.n !== prev.lastPlay?.n;
  const dealNew = next.round > prev.round;

  // 1. Karte spielen: erst fliegt die Karte, danach (ab Stufe 2) laufen die Kugeln
  if (playNew && lp) {
    const suit = lp.suit ?? 0;
    const t0 = t;
    fly({ from: spots.nest(lp.player), card: lp.card, suit: suitOf(suit), ms: tm.flight });
    if (lp.player === seat) removeFromHand(lp.card, suit);
    d.handSizes[lp.player] = Math.max(0, (d.handSizes[lp.player] ?? 0) - 1);
    if (!tm.sequential) d.pegs = next.pegs;
    emit();
    t = t0 + tm.flight;
    landOnPile(lp.card, suit, 1);
    emit();
    if (tm.sequential && pegsMove) {
      d.pegs = next.pegs;
      emit();
      t += tm.peg;
    } else if (!tm.sequential && pegsMove) t = Math.max(t, t0 + tm.peg);
  }

  // 2. Kartenübergaben (Tausch, Ziehen, 2): die Karte verlässt die Hand beim Start und kommt bei der Ankunft an
  if (transfers.length > 0) {
    const ms = tm.flight * 2;
    for (const x of transfers) {
      fly({ from: spots.nest(x.from), to: spots.nest(x.to), card: x.card, suit: suitOf(x.suit), ms });
      if (x.from === seat && x.card) removeFromHand(x.card, x.suit ?? 0);
      d.handSizes[x.from] = Math.max(0, (d.handSizes[x.from] ?? 0) - 1);
    }
    emit();
    t += ms;
    for (const x of transfers) {
      d.handSizes[x.to] = (d.handSizes[x.to] ?? 0) + 1;
      if (x.to === seat && x.card) {
        d.myHand.push(x.card);
        d.mySuits.push(x.suit ?? 0);
      }
    }
    emit();
  }

  // Abwürfe der Hand, die keinen Zug mehr hat; Abwürfe nach dem Austeilen der nächsten Runde stehen hinter dem Austeilen
  const dump = (list: typeof passes) => {
    for (const e of list) {
      const backs = e.cards - 1;
      for (let j = 0; j <= backs; j++) fly({ from: spots.nest(e.player), card: j === backs ? e.top : null, suit: suitOf(e.suit), ms: tm.flight, delay: j * STAGGER });
      d.handSizes[e.player] = 0;
      if (e.player === seat) {
        d.myHand = [];
        d.mySuits = [];
      }
      emit();
      t += tm.flight + backs * STAGGER;
      landOnPile(e.top, e.suit, e.cards);
      emit();
      t += PAUSE;
    }
  };
  const after = (e: (typeof passes)[number]) => dealNew && e.round !== undefined && e.round > prev.round;
  // 3. Abwürfe vor dem Austeilen
  dump(passes.filter((e) => !after(e)));

  // 4. Neumischen und Austeilen
  if (dealNew) {
    if (next.discardCount < d.discardCount) {
      for (let j = 0; j < DEAL_CARDS; j++) fly({ from: spots.pile, to: spots.deck, card: null, suit: suitOf(0), ms: tm.flight, delay: j * STAGGER, direct: true });
      d.discardCount = 0;
      d.discardTop = null;
      emit();
      t += tm.flight + (DEAL_CARDS - 1) * STAGGER + PAUSE;
    }
    const later = passes.filter(after);
    const target = next.handSizes.map((n, p) => n + later.filter((e) => e.player === p).reduce((s, e) => s + e.cards, 0));
    const n = target.length;
    let order = 0;
    for (let k = 1; k <= n; k++) {
      const p = (next.dealer + k) % n;
      const count = Math.min(DEAL_CARDS, target[p] ?? 0);
      for (let j = 0; j < count; j++) fly({ from: spots.deck, to: spots.nest(p), card: null, suit: suitOf(0), ms: tm.flight, delay: order * 70 + j * 60, direct: true });
      if (count > 0) order++;
    }
    t += tm.flight + Math.max(0, order - 1) * 70 + (DEAL_CARDS - 1) * 60;
    d.handSizes = target;
    d.deckCount = next.deckCount;
    d.round = next.round;
    d.dealer = next.dealer;
    const mineLater = later.some((e) => e.player === seat);
    d.myHand = mineLater ? [] : [...next.myHand];
    d.mySuits = mineLater ? [] : [...next.mySuits];
    emit();
    t += PAUSE;
    dump(later);
  }

  return { frames, flights, total: frames.length > 0 || flights.length > 0 ? t : 0 };
}

/** Anzeigestand vor dem ersten Austeilen eines neuen Spiels: noch keine Karten verteilt (Animation des ersten Austeilens). */
export function beforeFirstDeal(view: GameView): GameView {
  const dealt = view.handSizes.reduce((s, n) => s + n, 0) + view.passes.reduce((s, e) => s + e.cards, 0);
  return {
    ...view,
    round: -1,
    myHand: [],
    mySuits: [],
    handSizes: view.handSizes.map(() => 0),
    deckCount: view.deckCount + dealt,
    discardCount: 0,
    discardTop: null,
    passes: [],
    transfers: view.transfers,
  };
}

/** Beginnt ein Spiel gerade erst (erste Runde, noch kein Zug)? */
export const isFreshGame = (v: GameView) => v.round === 0 && v.lastPlay === null && v.transfers.length === 0 && v.phase !== 'finished';

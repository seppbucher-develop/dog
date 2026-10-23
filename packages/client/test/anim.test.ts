import { describe, expect, it } from 'vitest';
import type { GameView } from '@dog/protocol';
import { beforeFirstDeal, isFreshGame, planTransition, type Spots } from '../src/anim';
import { timing } from '../src/speed';

const spots: Spots = { nest: (s) => ({ x: s * 100, y: 0 }), pile: { x: 1, y: 1 }, deck: { x: 2, y: 2 } };

function view(over: Partial<GameView> = {}): GameView {
  return {
    config: { players: 4, eightPegs: false },
    phase: 'playing',
    seat: 0,
    pegs: [],
    handSizes: [5, 5, 5, 5],
    myHand: ['A', '2', '3', '4', '5'],
    mySuits: [0, 0, 0, 0, 0],
    deckCount: 80,
    discardCount: 0,
    discardTop: null,
    discardSuit: 0,
    current: 0,
    dealer: 3,
    round: 0,
    exchangeDone: [false, false, false, false],
    winners: null,
    legal: null,
    lastPlay: null,
    passes: [],
    transfers: [],
    gave: [],
    ...over,
  } as GameView;
}

const peg = (pos: number) => ({ id: 0, color: 0, pos: { t: 'ring', f: pos } }) as GameView['pegs'][number];
const patchAt = (plan: ReturnType<typeof planTransition>, ms: number) => [...plan.frames].reverse().find((f) => f.at <= ms)?.patch;

describe('planTransition', () => {
  it('ändert nichts ohne Ereignis', () => {
    expect(planTransition(view(), view({ current: 1 }), timing(4), spots).total).toBe(0);
  });

  it('fremder Zug: erst Karte, dann Kugeln', () => {
    const tm = timing(4);
    const prev = view({ pegs: [peg(1)] });
    const next = view({ pegs: [peg(5)], current: 2, handSizes: [5, 4, 5, 5], discardCount: 1, discardTop: '5', lastPlay: { n: 1, player: 1, card: '5', suit: 1, moves: [] } });
    const plan = planTransition(prev, next, tm, spots);
    expect(plan.flights).toHaveLength(1);
    expect(patchAt(plan, 0)?.pegs).toEqual(prev.pegs);
    expect(patchAt(plan, 0)?.discardCount).toBe(0);
    expect(patchAt(plan, 0)?.handSizes?.[1]).toBe(4);
    expect(patchAt(plan, tm.flight)?.discardCount).toBe(1);
    expect(patchAt(plan, tm.flight - 1)?.pegs).toEqual(prev.pegs);
    expect(patchAt(plan, tm.flight)?.pegs).toEqual(next.pegs);
    expect(plan.total).toBe(tm.flight + tm.peg);
  });

  it('eigener Zug: Karte verlässt die Hand beim Abflug, Kugeln folgen nach dem Flug', () => {
    const tm = timing(3);
    const prev = view({ pegs: [peg(1)] });
    const next = view({ pegs: [peg(5)], current: 1, myHand: ['A', '2', '3', '4'], mySuits: [0, 0, 0, 0], handSizes: [4, 5, 5, 5], discardCount: 1, discardTop: '5', lastPlay: { n: 1, player: 0, card: '5', suit: 0, moves: [] } });
    const plan = planTransition(prev, next, tm, spots);
    expect(patchAt(plan, 0)?.myHand).toEqual(['A', '2', '3', '4']);
    expect(patchAt(plan, tm.flight - 1)?.pegs).toEqual(prev.pegs);
    expect(patchAt(plan, tm.flight)?.pegs).toEqual(next.pegs);
  });

  it('Stufe 1: Karte und Kugeln gleichzeitig', () => {
    const tm = timing(1);
    const next = view({ pegs: [peg(5)], discardCount: 1, discardTop: '5', lastPlay: { n: 1, player: 1, card: '5', suit: 1, moves: [] } });
    const plan = planTransition(view({ pegs: [peg(1)] }), next, tm, spots);
    expect(patchAt(plan, 0)?.pegs).toEqual(next.pegs);
  });

  it('Tausch: empfangene Karte erscheint erst bei der Ankunft, die abgegebene verschwindet beim Abflug', () => {
    const tm = timing(4);
    const prev = view({ phase: 'exchange' });
    const next = view({
      myHand: ['2', '3', '4', '5', 'K'],
      mySuits: [0, 0, 0, 0, 2],
      transfers: [
        { id: 1, from: 0, to: 2, card: 'A', suit: 0 },
        { id: 2, from: 2, to: 0, card: 'K', suit: 2 },
        { id: 3, from: 1, to: 3, card: null, suit: null },
        { id: 4, from: 3, to: 1, card: null, suit: null },
      ],
    });
    const plan = planTransition(prev, next, tm, spots);
    expect(plan.flights).toHaveLength(4);
    expect(patchAt(plan, 0)?.myHand).toEqual(['2', '3', '4', '5']);
    expect(patchAt(plan, tm.flight * 2 - 1)?.myHand).toEqual(['2', '3', '4', '5']);
    expect(patchAt(plan, tm.flight * 2)?.myHand).toEqual(['2', '3', '4', '5', 'K']);
    expect(patchAt(plan, tm.flight * 2)?.handSizes).toEqual([5, 5, 5, 5]);
  });

  it('Abwurf nach dem Spielen: erst Spielkarte, dann Abwurf, Hand leert sich beim Abflug', () => {
    const tm = timing(4);
    const prev = view({ discardCount: 3 });
    const next = view({
      current: 1,
      myHand: [],
      mySuits: [],
      handSizes: [0, 5, 5, 5],
      discardCount: 9,
      discardTop: '9',
      lastPlay: { n: 1, player: 1, card: '5', suit: 1, moves: [] },
      passes: [{ id: 1, player: 0, cards: 5, top: '9', suit: 2, round: 0 }],
    });
    const plan = planTransition(prev, next, tm, spots);
    const dumpStart = tm.flight;
    expect(patchAt(plan, dumpStart - 1)?.myHand).toHaveLength(5);
    expect(patchAt(plan, dumpStart)?.myHand).toEqual([]);
    expect(patchAt(plan, dumpStart)?.discardCount).toBe(4);
    expect(patchAt(plan, plan.total)?.discardCount).toBe(9);
  });

  it('neue Runde: Hand erscheint erst nach dem Kartenflug und dem Austeilen', () => {
    const tm = timing(4);
    const prev = view({ myHand: ['A'], mySuits: [0], handSizes: [1, 0, 0, 0], discardCount: 40, round: 0, dealer: 3 });
    const next = view({
      round: 1,
      dealer: 0,
      myHand: ['2', '3', '4', '5'],
      mySuits: [0, 0, 0, 0],
      handSizes: [4, 4, 4, 4],
      deckCount: 60,
      discardCount: 41,
      discardTop: 'A',
      lastPlay: { n: 1, player: 0, card: 'A', suit: 0, moves: [] },
    });
    const plan = planTransition(prev, next, tm, spots);
    expect(patchAt(plan, tm.flight - 1)?.myHand).toEqual([]);
    expect(patchAt(plan, tm.flight)?.discardCount).toBe(41);
    expect(patchAt(plan, tm.flight)?.myHand).toEqual([]);
    expect(patchAt(plan, plan.total)?.myHand).toEqual(next.myHand);
    expect(patchAt(plan, plan.total)?.round).toBe(1);
    expect(plan.flights.filter((f) => f.spec.direct).length).toBeGreaterThanOrEqual(12);
    const lastDeal = Math.max(...plan.flights.filter((f) => f.spec.direct).map((f) => f.at + (f.spec.delay ?? 0) + f.spec.ms));
    expect(plan.total).toBeGreaterThanOrEqual(lastDeal);
  });

  it('Neumischen leert den Ablagestapel vor dem Austeilen', () => {
    const tm = timing(2);
    const prev = view({ myHand: [], mySuits: [], handSizes: [0, 0, 0, 0], discardCount: 100, discardTop: 'K', round: 0 });
    const next = view({ round: 1, discardCount: 0, discardTop: null, deckCount: 90, handSizes: [5, 5, 5, 5] });
    const plan = planTransition(prev, next, tm, spots);
    expect(plan.frames[0]!.patch.discardCount).toBe(0);
    expect(plan.flights[0]!.spec.to).toEqual(spots.deck);
    expect(patchAt(plan, 0)?.myHand).toEqual([]);
  });

  it('erstes Austeilen eines Spiels', () => {
    const live = view();
    expect(isFreshGame(live)).toBe(true);
    const before = beforeFirstDeal(live);
    expect(before.myHand).toEqual([]);
    expect(before.deckCount).toBe(80 + 20);
    const plan = planTransition(before, live, timing(4), spots);
    expect(patchAt(plan, plan.total)?.myHand).toEqual(live.myHand);
    expect(patchAt(plan, plan.total)?.deckCount).toBe(80);
  });

  it('Abwurf direkt nach dem Austeilen: Hand wird gezeigt, bevor sie abgeworfen wird', () => {
    const tm = timing(4);
    const prev = view({ myHand: [], mySuits: [], handSizes: [0, 0, 0, 0], discardCount: 10, round: 0 });
    const next = view({
      round: 1,
      myHand: [],
      mySuits: [],
      handSizes: [0, 5, 5, 5],
      discardCount: 15,
      discardTop: '9',
      passes: [{ id: 1, player: 0, cards: 5, top: '9', suit: 0, round: 1 }],
    });
    const plan = planTransition(prev, next, tm, spots);
    const dealt = plan.frames.find((f) => f.patch.round === 1)!;
    expect(dealt.patch.handSizes).toEqual([5, 5, 5, 5]);
    const dumped = plan.frames.find((f) => f.at > dealt.at && f.patch.handSizes?.[0] === 0)!;
    expect(dumped).toBeTruthy();
    expect(patchAt(plan, plan.total)?.discardCount).toBe(15);
  });
});

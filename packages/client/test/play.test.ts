import { describe, expect, it } from 'vitest';
import { applyAction, createGame, layoutFor, legalPlays, type Play } from '@dog/engine';
import { candidates, completed, emptySel, movablePegs, nextMoves, optionsForPeg, sevenRemaining } from '../src/play';
import { makeGeo } from '../src/geometry';

const plays: Play[] = [
  { card: '7', moves: [{ t: 'move', peg: 0, steps: 7 }] },
  { card: '7', moves: [{ t: 'move', peg: 0, steps: 3 }, { t: 'move', peg: 1, steps: 4 }] },
  { card: '7', moves: [{ t: 'move', peg: 1, steps: 3 }, { t: 'move', peg: 0, steps: 4 }] },
  { card: 'A', moves: [{ t: 'start', peg: 2 }] },
  { card: 'A', moves: [{ t: 'move', peg: 0, steps: 1 }] },
  { card: 'A', moves: [{ t: 'move', peg: 0, steps: 11 }] },
  { card: 'J', moves: [{ t: 'swap', a: 0, b: 5 }] },
  { card: 'J', moves: [{ t: 'swap', a: 1, b: 5 }] },
  { card: 'J', moves: [] },
];

describe('Zugauswahl', () => {
  it('Karte wählen liefert nur deren Züge', () => {
    expect(candidates(plays, { card: 'A', prefix: [] })).toHaveLength(3);
    expect(candidates(plays, emptySel)).toHaveLength(0);
  });

  it('Kugeln und Optionen zur Karte', () => {
    const opts = nextMoves(candidates(plays, { card: 'A', prefix: [] }), 0);
    expect([...movablePegs(opts)].sort()).toEqual([0, 2]);
    expect(optionsForPeg(opts, 0)).toHaveLength(2); // 1 oder 11
    expect(optionsForPeg(opts, 2)).toHaveLength(1); // Herauskommen
  });

  it('Die 7 wird schrittweise gewählt und ist erst nach allen Teilzügen fertig', () => {
    const sel = { card: '7' as const, prefix: [] };
    const c0 = candidates(plays, sel);
    expect(completed(c0, 0)).toBeNull();
    const opts0 = nextMoves(c0, 0);
    expect(opts0).toHaveLength(3); // 7 | 3 | 3 (andere Kugel)
    const sel1 = { ...sel, prefix: [{ t: 'move' as const, peg: 0, steps: 3 }] };
    expect(sevenRemaining(sel1.prefix)).toBe(4);
    const c1 = candidates(plays, sel1);
    expect(c1).toHaveLength(1);
    expect(completed(c1, 1)).toBeNull();
    const sel2 = { ...sel, prefix: [...sel1.prefix, { t: 'move' as const, peg: 1, steps: 4 }] };
    expect(completed(candidates(plays, sel2), 2)).not.toBeNull();
  });

  it('Bube: Tausch über zwei Kugeln, Leerzug bei Abwurf-Alternative', () => {
    const c = candidates(plays, { card: 'J', prefix: [] });
    expect(completed(c, 0)).not.toBeNull(); // Bube ohne Wirkung
    const opts = nextMoves(c, 0);
    expect(optionsForPeg(opts, 5)).toHaveLength(2);
    expect(optionsForPeg(opts, 0)).toHaveLength(1);
  });

  it('Echte Engine-Züge: jede Auswahlfolge führt zu einem gültigen Zug', () => {
    let s = createGame({ players: 3 }, 4);
    for (let i = 0; i < 300 && s.phase !== 'finished'; i++) {
      const legal = legalPlays(s, s.current);
      const card = legal[i % legal.length]!.card;
      let sel = { card, prefix: [] as Play['moves'] };
      for (let guard = 0; guard < 10; guard++) {
        const c = candidates(legal, sel);
        const done = completed(c, sel.prefix.length);
        if (done && !c.some((p) => p.moves.length > sel.prefix.length)) {
          s = applyAction(s, { t: 'play', player: s.current, card: done.card, moves: done.moves, ...(done.as ? { as: done.as } : {}) });
          break;
        }
        sel = { card, prefix: [...sel.prefix, nextMoves(c, sel.prefix.length)[0]!] };
      }
    }
    expect(s.round).toBeGreaterThan(0);
  });
});

describe('Brettgeometrie', () => {
  it('Eigene Startfeld liegt unten in der Mitte; alle Felder liegen im Zeichenbereich', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      const layout = layoutFor({ players });
      const geo = makeGeo(layout, layout.colorsOf[0]![0]!);
      const start = geo.ring(0);
      expect(Math.abs(start.x)).toBeLessThan(1e-6);
      expect(start.y).toBeGreaterThan(0);
      for (let f = 0; f < layout.ringSize; f++) expect(Math.hypot(geo.ring(f).x, geo.ring(f).y)).toBeLessThan(330);
      for (const c of layout.usedColors) {
        for (let i = 0; i < 4; i++) expect(Math.hypot(geo.home(c, i).x, geo.home(c, i).y)).toBeLessThan(420);
        expect(geo.fin(c, 3)).toBeDefined();
      }
    }
  });
});

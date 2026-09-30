import { describe, expect, it } from 'vitest';
import { applyAction, createGame, layoutFor, legalPlays, type Play } from '@dog/engine';
import { candidates, completed, emptySel, movablePegs, nextMoves, optionsForPeg, sevenRemaining } from '../src/play';
import { hasOriginalShape, makeGeo, type BoardStyle } from '../src/geometry';

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
  const styles: BoardStyle[] = ['circle', 'original'];

  it('Felder liegen gleichmäßig auf dem Umriss, eigener Abschnitt unten, alles innerhalb der Zeichenfläche', () => {
    for (const style of styles) {
      for (const players of [2, 3, 4, 5, 6]) {
        const layout = layoutFor({ players });
        for (const seat of [0, players - 1]) {
          const myColor = layout.colorsOf[seat]![0]!;
          const geo = makeGeo(layout, myColor, style);
          const R = layout.ringSize;
          // gleichmäßiger Abstand (Sehnenlänge nahe Bogenlänge; in Kurven etwas kürzer)
          for (let f = 0; f < R; f++) {
            const a = geo.ring(f);
            const b = geo.ring(f + 1);
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            expect(d).toBeGreaterThan(geo.spacing * 0.8);
            expect(d).toBeLessThan(geo.spacing * 1.01);
          }
          // Kreis: mein Startfeld unten in der Mitte; Originalform: die Mitte meines Abschnitts unten in der Mitte
          const anchor = geo.style === 'circle' ? myColor * 16 : myColor * 16 + 8; // bei 2 und 5 Spielern fällt 'original' auf den Kreis zurück
          expect(Math.abs(geo.ring(anchor).x)).toBeLessThan(geo.spacing * 0.6);
          for (const c of layout.usedColors) if (c !== myColor) expect(geo.ring(anchor).y).toBeGreaterThanOrEqual(geo.ring(c * 16 + (geo.style === 'circle' ? 0 : 8)).y - 1e-6);
          // alles innerhalb der viewBox
          const [vx, vy, vw, vh] = geo.viewBox.split(' ').map(Number) as [number, number, number, number];
          const inside = (p: { x: number; y: number }) => p.x >= vx && p.x <= vx + vw && p.y >= vy && p.y <= vy + vh;
          for (let f = 0; f < R; f++) expect(inside(geo.ring(f))).toBe(true);
          for (const c of layout.usedColors) {
            for (let i = 0; i < 4; i++) expect(inside(geo.home(c, i))).toBe(true);
            expect(inside(geo.fin(c, 3))).toBe(true);
          }
        }
      }
    }
  });

  it('Originalform nur bei 3, 4 und 6 Abschnitten; sonst Kreis', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      const layout = layoutFor({ players });
      const expected = hasOriginalShape(layout.colors) ? 'original' : 'circle';
      expect(makeGeo(layout, 0, 'original').style).toBe(expected);
      expect(makeGeo(layout, 0, 'circle').style).toBe('circle');
    }
    expect(hasOriginalShape(layoutFor({ players: 2, eightPegs: true }).colors)).toBe(true); // 2 Spieler mit 8 Kugeln: 4er-Brett
  });

  it('Zielhäuser liegen innerhalb des Umrisses und die Nester außerhalb', () => {
    const inside = (poly: { x: number; y: number }[], q: { x: number; y: number }) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    for (const style of styles) {
      for (const players of [3, 4, 6]) {
        const layout = layoutFor({ players });
        const geo = makeGeo(layout, 0, style);
        const poly = Array.from({ length: layout.ringSize }, (_, f) => geo.ring(f));
        for (const c of layout.usedColors) {
          for (let s = 0; s < 4; s++) expect(inside(poly, geo.fin(c, s))).toBe(true);
          for (let i = 0; i < 4; i++) expect(inside(poly, geo.home(c, i))).toBe(false);
        }
      }
    }
  });
});

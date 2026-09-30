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
  const inside = (poly: { x: number; y: number }[], q: { x: number; y: number }) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!;
      const b = poly[j]!;
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };

  it('Löcher gleichmäßig verteilt, eigener Abschnitt unten, alles innerhalb der Zeichenfläche', () => {
    for (const style of styles) {
      for (const players of [2, 3, 4, 5, 6]) {
        const layout = layoutFor({ players });
        for (const seat of [0, players - 1]) {
          const myColor = layout.colorsOf[seat]![0]!;
          const geo = makeGeo(layout, myColor, style);
          const R = layout.ringSize;
          const pts = Array.from({ length: R }, (_, f) => geo.ring(f));
          // kein Loch zu nah am nächsten; aufeinanderfolgende Löcher etwa im Abstand spacing
          for (let f = 0; f < R; f++) {
            const d = Math.hypot(pts[f]!.x - pts[(f + 1) % R]!.x, pts[f]!.y - pts[(f + 1) % R]!.y);
            expect(d).toBeGreaterThan(geo.spacing * 0.5);
            expect(d).toBeLessThan(geo.spacing * 1.01);
          }
          // Anker unten in der Mitte: Kreis = mein Startfeld, Kreuz = Mitte meines Armendes (Feld vor dem Start)
          const anchor = geo.style === 'circle' ? geo.ring(myColor * 16) : geo.ring(myColor * 16 - 1 + R);
          expect(Math.abs(anchor.x)).toBeLessThan(geo.spacing * 0.6);
          expect(anchor.y).toBeGreaterThanOrEqual(Math.max(...pts.map((p) => p.y)) - 1e-6);
          const [vx, vy, vw, vh] = geo.viewBox.split(' ').map(Number) as [number, number, number, number];
          const inView = (p: { x: number; y: number }) => p.x >= vx && p.x <= vx + vw && p.y >= vy && p.y <= vy + vh;
          expect(pts.every(inView)).toBe(true);
          for (const c of layout.usedColors) {
            for (let i = 0; i < 4; i++) expect(inView(geo.home(c, i))).toBe(true);
            expect(inView(geo.fin(c, 3))).toBe(true);
          }
        }
      }
    }
  });

  it('Kreuz mit 4 Spielern: Raster, Arme 16 Löcher, Armenden im Abstand 8 vom Zentrum', () => {
    const layout = layoutFor({ players: 4 });
    const geo = makeGeo(layout, 0, 'original');
    const u = geo.spacing;
    for (let f = 0; f < 64; f++) {
      const p = geo.ring(f);
      const q = geo.ring(f + 1);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(u, 3); // im Raster: immer genau ein Schritt
      expect(Math.abs(Math.abs(p.x / u) * 2 - Math.round(Math.abs(p.x / u) * 2))).toBeLessThan(1e-6); // ganzzahlig (Mitte der Ränder eingeschlossen)
    }
    for (const c of [0, 1, 2, 3]) {
      const tip = geo.ring(c * 16 - 1 + 64);
      expect(Math.hypot(tip.x, tip.y) / u).toBeCloseTo(8, 3);
    }
    // Seitenlinien des Arms: 6 Löcher hinaus (x = +2), 5 Löcher über das Ende, 6 zurück; Start = ein Loch links der Armmitte
    const start = geo.ring(0);
    expect(start.x / u).toBeCloseTo(-1, 3);
    expect(start.y / u).toBeCloseTo(8, 3);
    // Zielhaus in der Armmitte, vier Löcher nach innen
    for (let s = 0; s < 4; s++) {
      expect(geo.fin(0, s).x / u).toBeCloseTo(0, 3);
      expect(geo.fin(0, s).y / u).toBeCloseTo(7 - s, 3);
    }
    // Nest: vier Löcher in einer Reihe außerhalb des Armendes
    const homes = [0, 1, 2, 3].map((i) => geo.home(0, i));
    expect(new Set(homes.map((h) => h.y.toFixed(3))).size).toBe(1);
    expect(homes[0]!.y / u).toBeGreaterThan(8);
  });

  it('Kreuz mit 6 Spielern: 96 Schritte, Arme unten/oben und je zwei links/rechts', () => {
    const layout = layoutFor({ players: 6 });
    const geo = makeGeo(layout, 0, 'original');
    const u = geo.spacing;
    for (let f = 0; f < 96; f++) {
      const p = geo.ring(f);
      const q = geo.ring(f + 1);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(u, 3);
    }
    const tips = [0, 1, 2, 3, 4, 5].map((c) => geo.ring(c * 16 - 1 + 96));
    const expected: [number, number][] = [[0, 11], [-8, 3], [-8, -3], [0, -11], [8, -3], [8, 3]];
    tips.forEach((t, i) => {
      expect(t.x / u).toBeCloseTo(expected[i]![0], 3);
      expect(t.y / u).toBeCloseTo(expected[i]![1], 3);
    });
  });

  it('Kreuz mit 3 Spielern: drei gleiche Arme im Abstand von 120 Grad', () => {
    const layout = layoutFor({ players: 3 });
    const geo = makeGeo(layout, 0, 'original');
    const tips = [0, 1, 2].map((c) => geo.ring(c * 16 - 1 + 48));
    const cx = (tips[0]!.x + tips[1]!.x + tips[2]!.x) / 3;
    const cy = (tips[0]!.y + tips[1]!.y + tips[2]!.y) / 3;
    const d = tips.map((t) => Math.hypot(t.x - cx, t.y - cy));
    expect(d[1]).toBeCloseTo(d[0]!, 3);
    expect(d[2]).toBeCloseTo(d[0]!, 3);
    // Abstand der Armenden untereinander gleich (gleichseitiges Dreieck)
    const e = [Math.hypot(tips[0]!.x - tips[1]!.x, tips[0]!.y - tips[1]!.y), Math.hypot(tips[1]!.x - tips[2]!.x, tips[1]!.y - tips[2]!.y)];
    expect(e[1]).toBeCloseTo(e[0]!, 3);
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

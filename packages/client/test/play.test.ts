import { describe, expect, it } from 'vitest';
import { applyAction, createGame, layoutFor, legalPlays, startField, type Move, type Play } from '@dog/engine';
import { candidates, completed, emptySel, jokerRanks, movablePegs, nextMoves, optionsForPeg, sevenClick, sevenRemaining, sevenTargets, sevenUndo, type Selection } from '../src/play';
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

  it('Joker: erst den Rang wählen, dann gibt es Züge nur für diesen Rang', () => {
    const jp: Play[] = [
      { card: 'JOKER', as: '5', moves: [{ t: 'move', peg: 0, steps: 5 }] },
      { card: 'JOKER', as: 'A', moves: [{ t: 'move', peg: 0, steps: 1 }] },
      { card: 'JOKER', as: 'A', moves: [{ t: 'start', peg: 2 }] },
    ];
    expect(candidates(jp, { card: 'JOKER', prefix: [] })).toHaveLength(0);
    expect(jokerRanks(jp)).toEqual(['A', '5']);
    expect(candidates(jp, { card: 'JOKER', as: 'A', prefix: [] })).toHaveLength(2);
    expect(candidates(jp, { card: 'JOKER', as: '5', prefix: [] })).toHaveLength(1);
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
      if (s.phase === 'exchange') {
        for (let p = 0; p < 3; p++) s = applyAction(s, { t: 'draw', player: p, idx: 0 }); // Kartentausch im Einzelspiel
        continue;
      }
      const legal = legalPlays(s, s.current);
      const pick = legal[i % legal.length]!;
      const card = pick.card;
      let sel: Selection = { card, ...(pick.as ? { as: pick.as } : {}), prefix: [] };
      for (let guard = 0; guard < 10; guard++) {
        const c = candidates(legal, sel);
        const done = completed(c, sel.prefix.length);
        if (done && !c.some((p) => p.moves.length > sel.prefix.length)) {
          s = applyAction(s, { t: 'play', player: s.current, card: done.card, moves: done.moves, ...(done.as ? { as: done.as } : {}) });
          break;
        }
        sel = { ...sel, prefix: [...sel.prefix, nextMoves(c, sel.prefix.length)[0]!] };
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
          // Anker unten in der Mitte: Kreis = mein Startfeld, Kreuz = Mitte meines Armendes (zwei Felder vor dem Start)
          const anchor = geo.style === 'circle' ? geo.ring(myColor * 16) : geo.ring(myColor * 16 - 2);
          // Original-6er: mein Arm liegt je nach Platz unten rechts, links oder in der Mitte (siehe eigener Test)
          if (!(geo.style === 'original' && layout.colors === 6)) {
            expect(Math.abs(anchor.x)).toBeLessThan(geo.spacing * 0.6);
            expect(anchor.y).toBeGreaterThanOrEqual(Math.max(...pts.map((p) => p.y)) - 1e-6);
          }
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

  it('Kreuz mit 4 Spielern: je Arm vier Abschnitte zu 4 (Seite, Ende, Seite, Abschrägung), Start in der rechten Ecke', () => {
    const layout = layoutFor({ players: 4 });
    const geo = makeGeo(layout, 0, 'original');
    const u = geo.spacing;
    for (let f = 0; f < 64; f++) {
      const p = geo.ring(f);
      const q = geo.ring(f + 1);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(u, 3); // immer genau ein Schritt
    }
    const L = 6 + 2 * Math.SQRT2; // Armende: 2 + 2*sqrt2 (Abschrägung 4 bei 45 Grad) + Seite 4
    for (const c of [0, 1, 2, 3]) {
      const tip = geo.ring(c * 16 - 2);
      expect(Math.hypot(tip.x, tip.y) / u).toBeCloseTo(L, 3);
    }
    // Seiten: 4 Löcherabstände geradeaus, Armende 4, dann Abschrägung
    const p = (f: number) => ({ x: geo.ring(f).x / u, y: geo.ring(f).y / u });
    // Start = rechte Ecke des unteren Armendes; von dort laufen die Felder nach oben (rechte Seite), gegen den Uhrzeigersinn
    expect(p(0).x).toBeCloseTo(2, 3);
    expect(p(0).y).toBeCloseTo(p(-2).y, 3);
    expect(p(-2).x).toBeCloseTo(0, 3);
    expect(p(-4).x).toBeCloseTo(-2, 3); // Armende ist 4 breit, links davon die linke Ecke
    for (let i = 1; i <= 4; i++) expect(p(i).x).toBeCloseTo(2, 3); // rechte Seite: 4 Felder aufwärts
    expect(p(4).y).toBeCloseTo(p(0).y - 4, 3);
    // Abschrägung: 4 Felder im Winkel von 45 Grad
    expect(p(8).x - p(4).x).toBeCloseTo(4 / Math.SQRT2, 3);
    expect(Math.abs(p(8).y - p(4).y)).toBeCloseTo(4 / Math.SQRT2, 3);
    // Zielhaus zweigt vom Startfeld ab: schräg neben das Startfeld, dann vier Plätze nach innen
    for (let s = 0; s < 4; s++) {
      expect(geo.fin(0, s).x / u).toBeCloseTo(1, 3);
      expect(geo.fin(0, s).y / u).toBeCloseTo(p(0).y - 1 - s, 3);
    }
    // Nest: vier Löcher in einer Reihe außerhalb des Armendes
    const homes = [0, 1, 2, 3].map((i) => geo.home(0, i));
    expect(new Set(homes.map((h) => h.y.toFixed(3))).size).toBe(1);
    expect(homes[0]!.y / u).toBeGreaterThan(p(0).y);
  });

  it('Kreuz mit 6 Spielern: 96 Schritte, hochkant, je zwei Arme links und rechts, Partner gegenüber, mein Arm unten', () => {
    const layout = layoutFor({ players: 6 });
    for (let me = 0; me < 6; me++) {
      const geo = makeGeo(layout, me, 'original');
      const u = geo.spacing;
      const pts = Array.from({ length: 96 }, (_, f) => geo.ring(f));
      for (let f = 0; f < 96; f++) {
        const p = pts[f]!;
        const q = pts[(f + 1) % 96]!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(u, 3);
      }
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs)); // hochkant
      const t = [0, 1, 2, 3, 4, 5].map((k) => geo.ring(((me + k) % 6) * 16 - 2));
      expect(t[0]!.y).toBeGreaterThanOrEqual(-1e-6); // mein Arm in der unteren Hälfte
      for (let k = 0; k < 3; k++) {
        expect(t[k]!.x / u).toBeCloseTo(-t[k + 3]!.x / u, 3);
        expect(t[k]!.y / u).toBeCloseTo(-t[k + 3]!.y / u, 3);
      }
    }
    // Reihenfolge wie im Original, von Blau (0) aus: Blau unten rechts, Weiss rechts, Grün oben, Rot oben links, Schwarz links, Gelb unten
    const geo = makeGeo(layout, 0, 'original');
    const t = [0, 1, 2, 3, 4, 5].map((c) => geo.ring(c * 16 - 2));
    expect(t[0]!.x).toBeGreaterThan(0);
    expect(t[0]!.y).toBeGreaterThan(0);
    expect(t[1]!.x / geo.spacing).toBeCloseTo(t[0]!.x / geo.spacing, 3); // beide Arme rechts
    expect(Math.abs(t[1]!.y)).toBeLessThanOrEqual(t[0]!.y + 1e-6);
    expect(t[2]!.y).toBeLessThan(0);
    expect(t[3]!.x).toBeLessThan(0);
    expect(t[4]!.x / geo.spacing).toBeCloseTo(t[3]!.x / geo.spacing, 3); // beide Arme links
    expect(t[5]!.y).toBeGreaterThan(0);
    expect(t[5]!.x).toBeLessThan(t[0]!.x);
  });

  it('Kreuz mit 3 Spielern: drei gleiche Arme im Abstand von 120 Grad', () => {
    const layout = layoutFor({ players: 3 });
    const geo = makeGeo(layout, 0, 'original');
    const tips = [0, 1, 2].map((c) => geo.ring(c * 16 - 2));
    const cx = (tips[0]!.x + tips[1]!.x + tips[2]!.x) / 3;
    const cy = (tips[0]!.y + tips[1]!.y + tips[2]!.y) / 3;
    const d = tips.map((t) => Math.hypot(t.x - cx, t.y - cy));
    expect(d[1]).toBeCloseTo(d[0]!, 3);
    expect(d[2]).toBeCloseTo(d[0]!, 3);
    // Abstand der Armenden untereinander gleich (gleichseitiges Dreieck)
    const e = [Math.hypot(tips[0]!.x - tips[1]!.x, tips[0]!.y - tips[1]!.y), Math.hypot(tips[1]!.x - tips[2]!.x, tips[1]!.y - tips[2]!.y)];
    expect(e[1]).toBeCloseTo(e[0]!, 3);
  });

  it('Gespielt wird gegen den Uhrzeigersinn; das Zielhaus zweigt vom Startfeld ab', () => {
    for (const style of styles) {
      for (const players of [3, 4, 6]) {
        const layout = layoutFor({ players });
        const geo = makeGeo(layout, 0, style);
        const R = layout.ringSize;
        // Kreuzprodukt der Schritte um den Mittelpunkt: auf dem Bildschirm (y nach unten) bedeutet < 0 gegen den Uhrzeigersinn
        let area = 0;
        for (let f = 0; f < R; f++) {
          const a = geo.ring(f);
          const b = geo.ring(f + 1);
          area += a.x * b.y - b.x * a.y;
        }
        expect(area).toBeLessThan(0);
        // Spielreihenfolge = Sitzreihenfolge: der nächste Abschnitt liegt gegen den Uhrzeigersinn
        const c0 = geo.ring(0);
        const c1 = geo.ring(16);
        expect(c0.x * c1.y - c0.y * c1.x).toBeLessThan(0);
        // Das Zielhaus beginnt am Startfeld: der erste Hausplatz liegt nah daran (höchstens ein Schritt schräg)
        for (const c of layout.usedColors) {
          const sp = geo.ring(c * 16);
          const z = geo.fin(c, 0);
          expect(Math.hypot(sp.x - z.x, sp.y - z.y)).toBeLessThanOrEqual(1.5 * Math.max(geo.spacing, 44));
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

describe('7: Klick auf eine Kugel zieht sofort ein Feld', () => {
  const setup = () => {
    const g = createGame({ players: 3 }, 1);
    const layout = layoutFor(g.config);
    for (const p of g.pegs) p.pos = { t: 'home' };
    const mine = g.pegs.filter((p) => p.color === layout.colorsOf[0]![0]!);
    mine[0]!.pos = { t: 'ring', f: startField(mine[0]!.color) + 2 };
    mine[1]!.pos = { t: 'ring', f: startField(mine[1]!.color) + 10 };
    return { g, layout, a: mine[0]!.id, b: mine[1]!.id, home: mine[2]!.id };
  };

  it('Felder derselben Kugel werden zusammengefasst, nach 7 Feldern ist der Zug fertig', () => {
    const { g, layout, a } = setup();
    let prefix: Move[] = [];
    for (let i = 1; i <= 7; i++) {
      const r = sevenClick(g.pegs, layout, 0, prefix, a, false);
      expect('reason' in r).toBe(false);
      if (!('prefix' in r)) return;
      prefix = r.prefix;
      expect(r.done).toBe(i === 7);
    }
    expect(prefix).toEqual([{ t: 'move', peg: a, steps: 7 }]);
  });

  it('Auf dem Startfeld: Wahl zwischen Haus und neuer Runde', () => {
    const { g, layout, a } = setup();
    const R = layout.ringSize;
    g.pegs.find((p) => p.id === a)!.pos = { t: 'ring', f: (startField(g.pegs.find((p) => p.id === a)!.color) - 5 + R) % R };
    let prefix: Move[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = sevenClick(g.pegs, layout, 0, prefix, a, false);
      if (!('prefix' in r)) throw new Error('kein Schritt');
      prefix = r.prefix;
    }
    const c = sevenClick(g.pegs, layout, 0, prefix, a, false);
    if (!('choice' in c)) throw new Error('keine Wahl');
    expect(c.choice.house.prefix).toEqual([{ t: 'move', peg: a, steps: 6 }]);
    expect(c.choice.pass.prefix).toEqual([{ t: 'move', peg: a, steps: 6, pass: true }]);
    expect(sevenClick(g.pegs, layout, 0, prefix, a, false, true)).toEqual(c.choice.pass);
  });

  it('Zielfelder: jede Schrittzahl bis 7 ist ein Ziel, am Haus gibt es zwei Varianten', () => {
    const { g, layout, a } = setup();
    const t = sevenTargets(g.pegs, layout, 0, [], a, false);
    expect(t.map((x) => x.steps)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t[6]!.step.done).toBe(true);
    const R = layout.ringSize;
    g.pegs.find((p) => p.id === a)!.pos = { t: 'ring', f: (startField(g.pegs.find((p) => p.id === a)!.color) - 2 + R) % R };
    const n = sevenTargets(g.pegs, layout, 0, [], a, false).filter((x) => x.steps === 4);
    expect(n.map((x) => x.pass).sort()).toEqual([false, true]);
  });

  it('Rückgängig nimmt nur ein Feld zurück', () => {
    expect(sevenUndo([{ t: 'move', peg: 1, steps: 3 }])).toEqual([{ t: 'move', peg: 1, steps: 2 }]);
    expect(sevenUndo([{ t: 'move', peg: 1, steps: 1 }])).toEqual([]);
  });

  it('Kugel im Haus: Grund wird geliefert', () => {
    const { g, layout, home } = setup();
    const r = sevenClick(g.pegs, layout, 0, [], home, false);
    expect(r).toHaveProperty('reason');
  });

  it('Fremde Kugel: Grund wird geliefert', () => {
    const { g } = setup();
    const layout = layoutFor({ ...g.config, rules: { sevenAnyPeg: 'off' } });
    const other = g.pegs.find((p) => p.color !== layout.colorsOf[0]![0]!)!;
    other.pos = { t: 'ring', f: 5 };
    expect(sevenClick(g.pegs, layout, 0, [], other.id, false)).toHaveProperty('reason');
  });

  it('Joker als 2 bietet im Einzelspiel auch das Ziehen einer Karte an', () => {
    const g = createGame({ players: 3 }, 2);
    g.phase = 'playing';
    g.current = 0;
    g.hands[0] = ['JOKER'];
    const legal = legalPlays(g, 0);
    const c = candidates(legal, { card: 'JOKER', as: '2', prefix: [] });
    expect(nextMoves(c, 0).some((m) => m.t === 'steal')).toBe(true);
  });
});

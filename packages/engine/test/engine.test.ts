import { describe, expect, it } from 'vitest';
import { applyAction, createGame, fullDeck, legalPlays, layoutFor, type Card } from '../src';
import { fin, peg, ring, scenario, start } from './helpers';

const four = { players: 4 };

describe('Setup', () => {
  it('Deck hat 110 Karten', () => {
    const d = fullDeck();
    expect(d).toHaveLength(110);
    expect(d.filter((c) => c === 'JOKER')).toHaveLength(6);
  });

  it('Layouts für 2..6 Spieler', () => {
    expect(layoutFor({ players: 3 }).ringSize).toBe(48);
    expect(layoutFor({ players: 5 }).ringSize).toBe(80);
    expect(layoutFor({ players: 4 }).teams).toBe(true);
    expect(layoutFor({ players: 6 }).giveTo[1]).toBe(4);
    expect(layoutFor({ players: 2, eightPegs: true }).colorsOf).toEqual([[0, 2], [1, 3]]);
    expect(() => layoutFor({ players: 7 })).toThrow();
  });

  it('Teilt aus und startet mit Kartentausch im Teamspiel', () => {
    const s = createGame(four, 42);
    expect(s.phase).toBe('exchange');
    expect(s.hands.map((h) => h.length)).toEqual([6, 6, 6, 6]);
  });

  it('Einzelspiel startet ohne Tausch', () => {
    const s = createGame({ players: 3 }, 42);
    expect(s.phase).toBe('playing');
  });
});

describe('Kartentausch', () => {
  it('Tauscht Karten mit dem Partner', () => {
    let s = createGame(four, 7);
    const give = s.hands.map((h) => h[0]!);
    const before = s.hands.map((h) => h.slice());
    for (let p = 0; p < 4; p++) s = applyAction(s, { t: 'exchange', player: p, card: give[p]! });
    expect(s.phase).toBe('playing');
    // Spieler 0 hat die Karte von Spieler 2 bekommen
    expect(s.hands[0]!.length).toBe(6);
    const expected = before[0]!.slice();
    expected.splice(expected.indexOf(give[0]!), 1);
    expected.push(give[2]!);
    expect([...s.hands[0]!].sort()).toEqual(expected.sort());
  });
});

describe('Herauskommen', () => {
  it('Ass, König und Joker bringen eine Kugel heraus', () => {
    const s = scenario(four, { hands: [['A', 'K', 'JOKER', '5'], [], [], []] });
    const plays = legalPlays(s, 0);
    const starts = plays.filter((p) => p.moves[0]!.t === 'start');
    expect(new Set(starts.map((p) => p.card))).toEqual(new Set(['A', 'K', 'JOKER']));
    expect(plays.some((p) => p.card === '5')).toBe(false);
  });

  it('Fremde Kugel auf dem Startfeld wird heimgeschickt, eigene blockiert', () => {
    let s = scenario(four, { pegs: { [peg(1, 0)]: ring(start(0)) }, hands: [['K'], [], [], []] });
    s = applyAction(s, { t: 'play', player: 0, card: 'K', moves: [{ t: 'start', peg: peg(0, 0) }] });
    expect(s.pegs[peg(1, 0)]!.pos).toEqual({ t: 'home' });
    expect(s.pegs[peg(0, 0)]!.pos).toEqual(ring(start(0)));

    const blocked = scenario(four, { pegs: { [peg(0, 1)]: ring(start(0)) }, hands: [['K', '5'], [], [], []] });
    expect(legalPlays(blocked, 0).filter((p) => p.moves[0]!.t === 'start')).toHaveLength(0);
  });
});

describe('Bewegung', () => {
  it('Schlägt eine Kugel am Zielfeld', () => {
    let s = scenario(four, {
      pegs: { [peg(0, 0)]: ring(start(0)), [peg(1, 0)]: ring(start(0) + 5) },
      hands: [['5'], ['2'], [], []],
    });
    s = applyAction(s, { t: 'play', player: 0, card: '5', moves: [{ t: 'move', peg: peg(0, 0), steps: 5 }] });
    expect(s.pegs[peg(1, 0)]!.pos).toEqual({ t: 'home' });
  });

  it('Kugel auf eigenem Startfeld blockiert Überspringen', () => {
    const s = scenario(four, {
      pegs: { [peg(0, 0)]: ring(start(1) - 2), [peg(1, 0)]: ring(start(1)) },
      hands: [['5'], [], [], []],
    });
    expect(legalPlays(s, 0)).toHaveLength(0);
  });

  it('Gelaufene Kugel auf dem Startfeld sperrt nicht: Überspringen und Schlagen erlaubt', () => {
    const lapped = { t: 'ring' as const, f: start(1), lap: true as const };
    const s = scenario(four, { pegs: { [peg(0, 0)]: ring(start(1) - 2), [peg(1, 0)]: lapped }, hands: [['5', '2'], [], [], []] });
    expect(legalPlays(s, 0).some((p) => p.card === '5')).toBe(true); // überspringen
    const hit = legalPlays(s, 0).find((p) => p.card === '2')!;
    expect(applyAction(s, { t: 'play', player: 0, card: '2', moves: hit.moves }).pegs[peg(1, 0)]!.pos).toEqual({ t: 'home' });
  });

  it('Neue Kugel kommt heraus und schlägt die eigene gelaufene Kugel auf dem Startfeld', () => {
    const lapped = { t: 'ring' as const, f: start(0), lap: true as const };
    const s = scenario(four, { pegs: { [peg(0, 0)]: lapped }, hands: [['A'], [], [], []] });
    const out = legalPlays(s, 0).find((p) => p.moves[0]?.t === 'start')!;
    const after = applyAction(s, { t: 'play', player: 0, card: 'A', moves: out.moves });
    expect(after.pegs[peg(0, 0)]!.pos).toEqual({ t: 'home' });
    expect(after.pegs[(out.moves[0] as { peg: number }).peg]!.pos).toEqual({ t: 'ring', f: start(0) });
    // frisch herausgekommene eigene Kugel blockiert dagegen
    const fresh = scenario(four, { pegs: { [peg(0, 0)]: ring(start(0)) }, hands: [['A'], [], [], []] });
    expect(legalPlays(fresh, 0).some((p) => p.moves[0]?.t === 'start')).toBe(false);
  });

  it('4 geht rückwärts, auch über das eigene Startfeld hinaus', () => {
    let s = scenario(four, { pegs: { [peg(0, 0)]: ring(start(0)) }, hands: [['4'], ['A'], [], []] });
    s = applyAction(s, { t: 'play', player: 0, card: '4', moves: [{ t: 'move', peg: peg(0, 0), steps: -4 }] });
    expect(s.pegs[peg(0, 0)]!.pos).toEqual(ring(60));
  });

  it('Ziel: exakt hinein, nicht über eigene Kugeln im Zielhaus', () => {
    const s = scenario(four, {
      pegs: { [peg(0, 0)]: ring(start(0) + 62), [peg(0, 1)]: fin(1) },
      hands: [['3', '5'], [], [], []],
    });
    const plays = legalPlays(s, 0);
    const moves = (card: string, pass = false) =>
      plays.some((p) => p.card === card && p.moves[0]!.t === 'move' && (p.moves[0] as { peg: number }).peg === peg(0, 0) && !!(p.moves[0] as { pass?: boolean }).pass === pass);
    // 3 Schritte -> fin 0 (frei), 5 Schritte -> über die besetzte fin 1 hinweg ins Haus unzulässig, aber am Haus vorbei erlaubt
    expect(moves('3')).toBe(true);
    expect(moves('5')).toBe(false);
    expect(moves('5', true)).toBe(true);
  });

  it('Ins Haus geht es nur über das Startfeld: es zählt als Schritt, das Haus beginnt dahinter', () => {
    const s = scenario(four, { pegs: { [peg(0, 0)]: ring(start(0) + 62) }, hands: [['2', '3', '8'], [], [], []] });
    const play = (card: Card) => legalPlays(s, 0).find((p) => p.card === card && p.moves[0]!.t === 'move' && !(p.moves[0] as { pass?: boolean }).pass);
    // 2 Schritte: genau auf das Startfeld (Runde vollendet), noch nicht im Haus
    expect(applyAction(s, { t: 'play', player: 0, card: '2', moves: play('2')!.moves }).pegs[0]!.pos).toEqual({ t: 'ring', f: start(0), lap: true });
    // 3 Schritte: über das Startfeld hinweg auf den ersten Hausplatz
    expect(applyAction(s, { t: 'play', player: 0, card: '3', moves: play('3')!.moves }).pegs[0]!.pos).toEqual(fin(0));
    // 8 Schritte: zu weit (Haus hat 4 Plätze)
    expect(play('8')).toBeUndefined();
  });

  it('Eine Kugel, die gerade erst auf das Startfeld kam, muss erst eine Runde laufen', () => {
    const s = scenario(four, { pegs: { [peg(0, 0)]: ring(start(0)) }, hands: [['2'], [], [], []] });
    const next = applyAction(s, { t: 'play', player: 0, card: '2', moves: [{ t: 'move', peg: peg(0, 0), steps: 2 }] });
    expect(next.pegs[0]!.pos).toEqual(ring(start(0) + 2));
  });

  it('Kugel, die auf dem Startfeld die Runde vollendet hat, zieht von dort ins Haus', () => {
    const s = scenario(four, { pegs: { [peg(0, 0)]: { t: 'ring', f: start(0), lap: true } }, hands: [['2'], [], [], []] });
    const plays = legalPlays(s, 0);
    expect(plays).toHaveLength(2); // ins Haus oder am Haus vorbei
    expect(applyAction(s, { t: 'play', player: 0, card: '2', moves: plays[0]!.moves }).pegs[0]!.pos).toEqual(fin(1));
  });

  it('Eigene Kugel auf dem Startfeld versperrt den Weg ins Haus', () => {
    const s = scenario(four, {
      pegs: { [peg(0, 0)]: ring(start(0) + 62), [peg(0, 1)]: ring(start(0)) },
      hands: [['3'], [], [], []],
    });
    expect(legalPlays(s, 0).some((p) => p.moves[0]!.t === 'move' && (p.moves[0] as { peg: number }).peg === peg(0, 0))).toBe(false);
  });

  it('Im Zielhaus weiterrücken', () => {
    const s = scenario(four, { pegs: { [peg(0, 0)]: fin(0) }, hands: [['3'], [], [], []] });
    const plays = legalPlays(s, 0);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.moves[0]).toEqual({ t: 'move', peg: peg(0, 0), steps: 3 });
  });
});

describe('Die 7', () => {
  it('Kann auf zwei Kugeln aufgeteilt werden und wirft übersprungene Kugeln heim', () => {
    const s = scenario(four, {
      pegs: {
        [peg(0, 0)]: ring(start(0)),
        [peg(0, 1)]: ring(start(0) + 10),
        [peg(2, 0)]: ring(start(0) + 3),
      },
      hands: [['7'], [], [], []],
    });
    const plays = legalPlays(s, 0);
    const split = plays.find(
      (p) => p.moves.length === 2 && p.moves.some((m) => m.t === 'move' && m.peg === peg(0, 0) && m.steps === 4),
    );
    expect(split).toBeDefined();
    const s2 = applyAction(s, { t: 'play', player: 0, card: '7', moves: split!.moves });
    expect(s2.pegs[peg(2, 0)]!.pos).toEqual({ t: 'home' });
    expect(s2.pegs[peg(0, 0)]!.pos).toEqual(ring(start(0) + 4));
  });
});

describe('Bube', () => {
  it('Teamspiel: tauscht eigene Kugel mit fremder, nicht mit blockierender', () => {
    const s = scenario(four, {
      pegs: { [peg(0, 0)]: ring(5), [peg(1, 0)]: ring(20), [peg(2, 0)]: ring(start(2)) },
      hands: [['J'], [], [], []],
    });
    const plays = legalPlays(s, 0);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.moves[0]).toEqual({ t: 'swap', a: peg(0, 0), b: peg(1, 0) });
    const s2 = applyAction(s, { t: 'play', player: 0, card: 'J', moves: plays[0]!.moves });
    expect(s2.pegs[peg(0, 0)]!.pos).toEqual(ring(20));
    expect(s2.pegs[peg(1, 0)]!.pos).toEqual(ring(5));
  });

  it('Einzelspiel: Bube tauscht Kugeln mit einem Gegner', () => {
    let s = scenario({ players: 3 }, {
      pegs: { [peg(0, 0)]: ring(5), [peg(1, 0)]: ring(20) },
      hands: [['J', '2'], ['5', '9'], []],
      current: 0,
    });
    const plays = legalPlays(s, 0).filter((p) => p.card === 'J');
    expect(plays).toHaveLength(1);
    s = applyAction(s, { t: 'play', player: 0, card: 'J', moves: plays[0]!.moves });
    expect(s.pegs[peg(0, 0)]!.pos).toEqual(ring(20));
    expect(s.pegs[peg(1, 0)]!.pos).toEqual(ring(5));
  });

});

describe('Ablauf', () => {
  it('Wirft automatisch ab, wenn kein Zug möglich ist', () => {
    const s = scenario(four, { hands: [['5'], ['A'], ['A'], ['A']], current: 0 });
    // Spieler 0 hat keine Kugel auf dem Brett -> fällt raus, Spieler 1 ist dran
    const s2 = applyAction({ ...s, current: 3, hands: [['5'], ['A'], ['A'], ['2', 'A']] }, {
      t: 'play', player: 3, card: 'A', moves: [{ t: 'start', peg: peg(3, 0) }],
    });
    expect(s2.hands[0]).toEqual([]); // 5 wurde automatisch abgeworfen
    expect(s2.current).toBe(1);
  });

  it('Sieg im Einzelspiel, wenn alle Kugeln im Ziel', () => {
    const pegs = { [peg(0, 0)]: fin(3), [peg(0, 1)]: fin(2), [peg(0, 2)]: fin(1), [peg(0, 3)]: ring(start(0) + 47) };
    let s = scenario({ players: 3 }, { pegs, hands: [['2'], ['5'], ['5']] });
    s = applyAction(s, { t: 'play', player: 0, card: '2', moves: [{ t: 'move', peg: peg(0, 3), steps: 2 }] });
    expect(s.phase).toBe('finished');
    expect(s.winners).toEqual([0]);
  });

  it('Teamspiel: fertiger Spieler bewegt die Kugeln des Partners', () => {
    const pegs = {
      [peg(0, 0)]: fin(0), [peg(0, 1)]: fin(1), [peg(0, 2)]: fin(2), [peg(0, 3)]: fin(3),
      [peg(2, 0)]: ring(start(2)),
    };
    const s = scenario(four, { pegs, hands: [['5'], [], [], []] });
    const plays = legalPlays(s, 0);
    expect(plays.some((p) => p.moves[0]!.t === 'move' && (p.moves[0] as { peg: number }).peg === peg(2, 0))).toBe(true);
  });

  it('Zufallsspiel bricht nie ab: zufällige legale Züge bis Spielende', () => {
    for (const cfg of [{ players: 2 }, { players: 2, eightPegs: true }, { players: 3 }, { players: 4 }, { players: 5 }, { players: 6 }]) {
      let s = createGame(cfg, 99);
      let steps = 0;
      while (s.phase !== 'finished' && steps++ < 20000) {
        if (s.phase === 'exchange') {
          for (let p = 0; p < cfg.players; p++) s = applyAction(s, { t: 'exchange', player: p, card: s.hands[p]![0]! });
          continue;
        }
        const plays = legalPlays(s, s.current);
        expect(plays.length).toBeGreaterThan(0);
        const pick = plays[(steps * 7919) % plays.length]!;
        s = applyAction(s, { t: 'play', player: s.current, ...pick });
      }
      expect(s.phase, JSON.stringify(cfg)).toBe('finished');
    }
  });
});

describe('Automatischer Abwurf', () => {
  it('wird im Zustand vermerkt und bei der nächsten Aktion zurückgesetzt', () => {
    // Spieler 1 hat nur eine 5, aber keine Kugel auf dem Brett -> kein Zug, Hand wird abgeworfen
    const s = scenario(four, { pegs: { [peg(0, 0)]: ring(5) }, hands: [['2', '3'], ['5'], ['9'], ['9']] });
    const s2 = applyAction(s, { t: 'play', player: 0, card: '2', moves: [{ t: 'move', peg: peg(0, 0), steps: 2 }] });
    expect(s2.passed).toEqual([{ player: 1, cards: 1 }, { player: 2, cards: 1 }, { player: 3, cards: 1 }]);
    expect(s2.current).toBe(0);
    const s3 = applyAction(s2, { t: 'play', player: 0, card: '3', moves: [{ t: 'move', peg: peg(0, 0), steps: 3 }] });
    expect(s3.passed ?? []).not.toContainEqual({ player: 1, cards: 1 });
  });
});


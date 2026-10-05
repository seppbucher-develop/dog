import { describe, expect, it } from 'vitest';
import { applyAction, createGame, layoutFor, legalPlays, controlledColors, sevenNext, sevenValid, type Card, type Pos } from '../src';
import { fin, peg, ring, scenario, start } from './helpers';

describe('Einstellungen: Validierung', () => {
  it('Standardwerte werden ergänzt, ungültige Werte abgelehnt', () => {
    expect(layoutFor({ players: 4 }).rules.captureOwn).toBe(true);
    expect(() => layoutFor({ players: 4, rules: { handSizes: [] } })).toThrow();
    expect(() => layoutFor({ players: 4, rules: { handSizes: [0] } })).toThrow();
    expect(() => layoutFor({ players: 6, rules: { handSizes: [19] } })).toThrow();
    expect(() => layoutFor({ players: 4, rules: { cardExchange: 'x' as never } })).toThrow();
    expect(() => layoutFor({ players: 4, rules: { captureOwn: 1 as never } })).toThrow();
  });
});

describe('Option 1: 7 mit mehrfacher Kugelnutzung', () => {
  it('Beide Einstellungen liefern dieselben Endstellungen; Aufteilung auf zwei Kugeln funktioniert', () => {
    const pegs = { [peg(0, 0)]: ring(0), [peg(0, 1)]: ring(10), [peg(1, 0)]: ring(20) };
    const plays = (sevenRepeatPeg: boolean) =>
      legalPlays(scenario({ players: 4, rules: { sevenRepeatPeg } }, { pegs, hands: [['7'], [], [], []] }), 0);
    const finals = (repeat: boolean) => {
      const s = scenario({ players: 4, rules: { sevenRepeatPeg: repeat } }, { pegs, hands: [['7'], ['A'], ['A'], ['A']] });
      return new Set(plays(repeat).map((p) => JSON.stringify(applyAction(s, { t: 'play', player: 0, ...p }).pegs)));
    };
    expect(finals(true)).toEqual(finals(false));
    expect(plays(false).some((p) => p.moves.length === 2)).toBe(true);
  });
});

describe('Option 2: Bube-Tausch mit Partner-Kugeln', () => {
  const base = (jackSwapPartner: boolean) =>
    scenario(
      { players: 4, rules: { jackSwapPartner } },
      { pegs: { [peg(0, 0)]: ring(5), [peg(2, 0)]: ring(20) }, hands: [['J'], [], [], []] },
    );
  it('Standard: Tausch mit Partner erlaubt', () => {
    expect(legalPlays(base(true), 0)).toHaveLength(1);
  });
  it('Aus: Partner-Kugeln sind tabu, Gegner bleiben erlaubt', () => {
    expect(legalPlays(base(false), 0)).toHaveLength(0);
    const s = base(false);
    s.pegs.find((p) => p.id === peg(1, 0))!.pos = ring(30);
    expect(legalPlays(s, 0)).toHaveLength(1);
  });
});

describe('Bube-Tausch mit eigenen Kugeln', () => {
  const mk = (jackSwapOwn: boolean) =>
    scenario(
      { players: 4, rules: { jackSwapOwn } },
      { pegs: { [peg(0, 0)]: ring(5), [peg(0, 1)]: ring(9) }, hands: [['J', '5'], ['A'], ['A'], ['A']] },
    );
  it('an (Standard): Tausch zweier eigener Kugeln ist ein gültiger Zug und verhindert den Abwurf', () => {
    const plays = legalPlays(mk(true), 0).filter((p) => p.card === 'J');
    expect(plays).toHaveLength(1);
    expect(plays[0]!.moves[0]).toEqual({ t: 'swap', a: peg(0, 0), b: peg(0, 1) });
  });
  it('aus: kein Tausch eigener Kugeln', () => {
    expect(legalPlays(mk(false), 0).some((p) => p.card === 'J')).toBe(false);
  });
});

describe('Bube und 2 im Einzelspiel', () => {
  const mk = (hands: Card[][]) =>
    scenario({ players: 3 }, { pegs: { [peg(0, 0)]: ring(5), [peg(1, 0)]: ring(20) }, hands });
  it('Bube tauscht auch im Einzelspiel nur Kugeln, nie Karten', () => {
    const plays = legalPlays(mk([['J'], ['5'], []]), 0);
    expect(plays).toHaveLength(1);
    expect(plays[0]!.moves).toEqual([{ t: 'swap', a: peg(0, 0), b: peg(1, 0) }]);
  });
  it('Bube ist ohne tauschbare Kugeln nicht spielbar', () => {
    const s = scenario({ players: 3 }, { pegs: { [peg(0, 0)]: ring(5) }, hands: [['J', '2'], ['5'], []] });
    expect(legalPlays(s, 0).some((p) => p.card === 'J')).toBe(false);
  });
  it('2: fahren oder blind eine Karte ziehen (zählt als Zug)', () => {
    const s = mk([['2'], ['5', '9'], []]);
    const plays = legalPlays(s, 0);
    expect(plays.filter((p) => p.moves[0]!.t === 'move')).toHaveLength(1);
    expect(plays.filter((p) => p.moves[0]!.t === 'steal')).toHaveLength(2);
    const s2 = applyAction(s, { t: 'play', player: 0, card: '2', moves: [{ t: 'steal', from: 1, idx: 0 }] });
    expect(s2.hands[0]).toEqual(['5']);
    expect(s2.hands[1]).toEqual(['9']);
    expect(s2.current).toBe(1);
  });
  it('Teamspiel: mit der 2 kann man keine Karte ziehen', () => {
    const s = scenario({ players: 4 }, { pegs: { [peg(0, 0)]: ring(5) }, hands: [['2'], ['5'], [], []] });
    expect(legalPlays(s, 0).some((p) => p.moves.some((m) => m.t === 'steal'))).toBe(false);
  });
});

describe('Option 4: 2 Spieler mit 4 Kugeln', () => {
  it('compact: 2 Abschnitte, full: 4 Abschnitte mit leeren Farben', () => {
    const c = layoutFor({ players: 2 });
    expect(c.ringSize).toBe(32);
    const f = layoutFor({ players: 2, rules: { twoPlayerBoard: 'full' } });
    expect(f.ringSize).toBe(64);
    expect(f.colorsOf).toEqual([[0], [2]]);
    expect(createGame({ players: 2, rules: { twoPlayerBoard: 'full' } }, 1).pegs).toHaveLength(8);
  });
  it('8 Kugeln: immer das 4er-Brett', () => {
    expect(layoutFor({ players: 2, eightPegs: true, rules: { twoPlayerBoard: 'compact' } }).ringSize).toBe(64);
  });
  it('Spiel auf dem vollen Brett läuft durch', () => {
    let s = createGame({ players: 2, rules: { twoPlayerBoard: 'full' } }, 3);
    for (let i = 0; i < 20000 && s.phase !== 'finished'; i++) {
      const plays = legalPlays(s, s.current);
      s = applyAction(s, { t: 'play', player: s.current, ...plays[(i * 31) % plays.length]! });
    }
    expect(s.phase).toBe('finished');
  });
});

describe('Option 5: 6 Spieler', () => {
  it('threeOfTwo: Partner gegenüber', () => {
    const l = layoutFor({ players: 6 });
    expect(l.teamList).toEqual([[0, 3], [1, 4], [2, 5]]);
  });
  it('twoOfThree: 2 Teams zu 3, Tausch reihum im Team', () => {
    const l = layoutFor({ players: 6, rules: { sixPlayerTeams: 'twoOfThree' } });
    expect(l.teamList).toEqual([[0, 2, 4], [1, 3, 5]]);
    expect(l.giveTo).toEqual([2, 3, 4, 5, 0, 1]);
  });
  it('twoOfThree: Fertiger Spieler zieht für den nächsten unfertigen Teamkollegen; Team gewinnt erst komplett', () => {
    const cfg = { players: 6, rules: { sixPlayerTeams: 'twoOfThree' as const } };
    const l = layoutFor(cfg);
    const done = { [peg(0, 0)]: fin(0), [peg(0, 1)]: fin(1), [peg(0, 2)]: fin(2), [peg(0, 3)]: fin(3) };
    const s = scenario(cfg, { pegs: done, hands: [['5'], [], [], [], [], []] });
    expect(controlledColors(s, l, 0)).toEqual([0, 2]);
    // auch Spieler 2 fertig -> Spieler 0 zieht für Spieler 4
    for (let i = 0; i < 4; i++) s.pegs.find((p) => p.id === peg(2, i))!.pos = fin(i);
    expect(controlledColors(s, l, 0)).toEqual([0, 4]);
  });
});

describe('Option 6: Kartentausch', () => {
  it('off: Teamspiel ohne Tausch', () => {
    expect(createGame({ players: 4, rules: { cardExchange: 'off' } }, 1).phase).toBe('playing');
  });
  it('on: Einzelspiel mit Tausch an den nächsten Spieler', () => {
    let s = createGame({ players: 3, rules: { cardExchange: 'on' } }, 1);
    expect(s.phase).toBe('exchange');
    const give = s.hands.map((h) => h[0]!);
    for (let p = 0; p < 3; p++) s = applyAction(s, { t: 'exchange', player: p, card: give[p]! });
    expect(s.phase).toBe('playing');
    // 18 Karten ausgeteilt; ohne Kugeln auf dem Brett werden manche Hände sofort abgeworfen
    expect(s.hands.flat().length + s.discard.length).toBe(18);
  });
  it('auto: nur im Teamspiel', () => {
    expect(createGame({ players: 3 }, 1).phase).toBe('playing');
    expect(createGame({ players: 4 }, 1).phase).toBe('exchange');
  });
});

describe('Option 7: Eigene Kugeln schlagen', () => {
  const mk = (captureOwn: boolean, card: '5' | '7' | 'K') =>
    scenario(
      { players: 4, rules: { captureOwn } },
      { pegs: { [peg(0, 0)]: ring(0), [peg(0, 1)]: ring(5), [peg(2, 0)]: ring(3) }, hands: [[card], [], [], []] },
    );
  it('an (Standard): Landen auf eigener Kugel erlaubt', () => {
    expect(legalPlays(mk(true, '5'), 0).some((p) => p.moves[0]!.t === 'move' && (p.moves[0] as { peg: number }).peg === peg(0, 0))).toBe(true);
  });
  it('aus: weder Landen noch Überspringen (7) von Eigenen/Partner', () => {
    const plays5 = legalPlays(mk(false, '5'), 0);
    expect(plays5.some((p) => (p.moves[0] as { peg: number }).peg === peg(0, 0))).toBe(false); // landet auf eigener (5)
    const plays7 = legalPlays(mk(false, '7'), 0);
    for (const p of plays7) {
      const s = applyAction(mk(false, '7'), { t: 'play', player: 0, ...p });
      expect(s.pegs.filter((x) => x.pos.t === 'home' && [0, 2].includes(x.color) && [peg(0, 0), peg(0, 1), peg(2, 0)].includes(x.id))).toHaveLength(0);
    }
  });
  it('aus: Herauskommen auf Startfeld mit Partnerkugel verboten', () => {
    const s = scenario({ players: 4, rules: { captureOwn: false } }, { pegs: { [peg(2, 0)]: ring(start(0)) }, hands: [['K'], [], [], []] });
    expect(legalPlays(s, 0).some((p) => p.moves[0]!.t === 'start')).toBe(false);
    const s2 = scenario({ players: 4 }, { pegs: { [peg(2, 0)]: ring(start(0)) }, hands: [['K'], [], [], []] });
    expect(legalPlays(s2, 0).some((p) => p.moves[0]!.t === 'start')).toBe(true);
  });
});

describe('Option 8: Handgrößen', () => {
  it('Eigene Folge wird zyklisch verwendet', () => {
    // cardExchange 'on': das Spiel hält nach jedem Austeilen in der Tauschphase an
    let s = createGame({ players: 3, rules: { handSizes: [3, 1], cardExchange: 'on' } }, 5);
    expect(s.phase).toBe('exchange');
    expect(s.hands.map((h) => h.length)).toEqual([3, 3, 3]);
    for (let i = 0; i < 500 && s.round === 0 && s.phase !== 'finished'; i++) {
      if (s.phase === 'exchange') {
        for (let p = 0; p < 3; p++) s = applyAction(s, { t: 'exchange', player: p, card: s.hands[p]![0]! });
      } else {
        s = applyAction(s, { t: 'play', player: s.current, ...legalPlays(s, s.current)[0]! });
      }
    }
    expect(s.round).toBe(1);
    expect(s.phase).toBe('exchange');
    expect(s.hands.map((h) => h.length)).toEqual([1, 1, 1]);
  });
});

describe('Regelkombinationen', () => {
  it('Zufallsspiele enden bei allen Kombinationen', () => {
    const combos: Parameters<typeof createGame>[0][] = [];
    for (const players of [2, 3, 4, 5, 6]) {
      for (const captureOwn of [true, false]) {
        for (const cardExchange of ['auto', 'on', 'off'] as const) {
          combos.push({
            players,
            rules: {
              captureOwn,
              cardExchange,
              sevenRepeatPeg: players % 2 === 0,
              jackSwapPartner: captureOwn,
              sixPlayerTeams: players === 6 && !captureOwn ? 'twoOfThree' : 'threeOfTwo',
              twoPlayerBoard: cardExchange === 'off' ? 'full' : 'compact',
              handSizes: cardExchange === 'off' ? [4, 2] : [6, 5, 4, 3, 2],
            },
          });
        }
      }
    }
    for (const cfg of combos) {
      let s = createGame(cfg, 11);
      for (let i = 0; i < 30000 && s.phase !== 'finished'; i++) {
        if (s.phase === 'exchange') {
          for (let p = 0; p < cfg.players; p++) s = applyAction(s, { t: 'exchange', player: p, card: s.hands[p]![0]! });
          continue;
        }
        const plays = legalPlays(s, s.current);
        if (plays.length === 0) throw new Error(`Spieler ohne Zug und ohne Abwurf: ${JSON.stringify(cfg)}`);
        s = applyAction(s, { t: 'play', player: s.current, ...plays[(i * 7919) % plays.length]! });
      }
      expect(s.phase, JSON.stringify(cfg)).toBe('finished');
    }
  });
});

describe('firstPegOnStart: erste Kugel schon auf dem Startfeld', () => {
  const out = (cfg: Parameters<typeof createGame>[0]) => {
    const s = createGame(cfg, 1);
    const l = layoutFor(cfg);
    return l.usedColors.map((c) => s.pegs.find((p) => p.id === c * 4)!.pos);
  };
  it('auto: bei 2, 3 und 5 Spielern ja, bei 4 und 6 nein', () => {
    for (const players of [2, 3, 5]) {
      const cfg = { players };
      out(cfg).forEach((pos, i) => expect(pos).toEqual(ring(start(layoutFor(cfg).usedColors[i]!))));
    }
    for (const players of [4, 6]) out({ players }).forEach((pos) => expect(pos).toEqual({ t: 'home' }));
  });
  it('2 Spieler mit 8 Kugeln: pro Farbe eine Kugel auf dem Start', () => {
    const s = createGame({ players: 2, eightPegs: true }, 1);
    expect(s.pegs.filter((p) => p.pos.t === 'ring')).toHaveLength(4);
  });
  it('on/off überschreibt auto', () => {
    expect(out({ players: 3, rules: { firstPegOnStart: 'off' } }).every((p) => p.t === 'home')).toBe(true);
    expect(out({ players: 4, rules: { firstPegOnStart: 'on' } }).every((p) => p.t === 'ring')).toBe(true);
  });
  it('Die Startkugel kann sofort ziehen', () => {
    const s = createGame({ players: 3 }, 1);
    s.hands[0] = ['5'];
    s.current = 0;
    expect(legalPlays(s, 0).length).toBeGreaterThan(0);
  });
});

describe('4, Joker und 7 (neue Regeln)', () => {
  const stepsOf = (s: ReturnType<typeof scenario>, card: Card, peg_: number) =>
    legalPlays(s, 0)
      .filter((p) => p.card === card)
      .flatMap((p) => p.moves.filter((m) => m.t === 'move' && m.peg === peg_ && !m.pass).map((m) => (m as { steps: number }).steps));

  it('4 darf vorwärts und rückwärts gespielt werden, rückwärts nie ins Haus', () => {
    const s = scenario({ players: 4 }, { pegs: { [peg(0, 0)]: ring(start(0) + 62) }, hands: [['4'], [], [], []] });
    expect(stepsOf(s, '4', peg(0, 0)).sort()).toEqual([-4, 4]);
    // rückwärts bleibt auf dem Ring (nie im Haus), vorwärts geht ins Haus
    const back = applyAction(s, { t: 'play', player: 0, card: '4', moves: [{ t: 'move', peg: peg(0, 0), steps: -4 }] });
    expect(back.pegs[0]!.pos).toEqual(ring(start(0) + 58));
    // im Haus gibt es keinen Rückwärtszug
    const inHouse = scenario({ players: 4 }, { pegs: { [peg(0, 0)]: fin(2) }, hands: [['4'], [], [], []] });
    expect(stepsOf(inHouse, '4', peg(0, 0))).toEqual([]);
  });

  it('4 nur rückwärts, wenn so eingestellt', () => {
    const s = scenario({ players: 4, rules: { fourDirection: 'backward' } }, { pegs: { [peg(0, 0)]: ring(10) }, hands: [['4'], [], [], []] });
    expect(stepsOf(s, '4', peg(0, 0))).toEqual([-4]);
  });

  it('Mit dem Joker darf die letzte Kugel nicht ins Haus gebracht werden', () => {
    const pegs = { [peg(0, 0)]: fin(3), [peg(0, 1)]: fin(2), [peg(0, 2)]: fin(1), [peg(0, 3)]: ring(start(0) + 46) };
    const s = scenario({ players: 3 }, { pegs, hands: [['JOKER', '3'], [], []] });
    // 3 Schritte ins Haus (fin 0): mit der 3 erlaubt, mit dem Joker nicht
    const finishing = (card: Card) =>
      legalPlays(s, 0).some((p) => p.card === card && p.moves.some((m) => m.t === 'move' && m.peg === peg(0, 3) && m.steps === 3));
    expect(finishing('3')).toBe(true);
    expect(legalPlays(s, 0).some((p) => p.card === 'JOKER' && p.as === '3' && !p.moves.some((m) => m.t === 'move' && m.pass))).toBe(false);
    // nicht die letzte Kugel: der Joker bleibt normal spielbar
    const s2 = scenario({ players: 3 }, { pegs: { [peg(0, 0)]: ring(start(0) + 46), [peg(0, 1)]: ring(5) }, hands: [['JOKER'], [], []] });
    expect(legalPlays(s2, 0).some((p) => p.card === 'JOKER' && p.as === '3')).toBe(true);
  });

  it('7: standardmäßig nur eigene Kugeln, mit sevenAnyPeg auch fremde', () => {
    const pegs = { [peg(0, 0)]: ring(0), [peg(1, 0)]: ring(20) };
    const touched = (rules: object) => {
      const s = scenario({ players: 3, rules }, { pegs, hands: [['7'], [], []] });
      return new Set(legalPlays(s, 0).flatMap((p) => p.moves.map((m) => (m as { peg: number }).peg)));
    };
    expect(touched({})).toEqual(new Set([peg(0, 0)]));
    expect(touched({ sevenAnyPeg: true })).toEqual(new Set([peg(0, 0), peg(1, 0)]));
  });

  it('7 im Teamspiel: Kugeln des Partners nur, wenn man selbst fertig ist', () => {
    const own = { [peg(0, 0)]: ring(0), [peg(2, 0)]: ring(40) };
    const s = scenario({ players: 4 }, { pegs: own, hands: [['7'], [], [], []] });
    expect(legalPlays(s, 0).every((p) => p.moves.every((m) => (m as { peg: number }).peg === peg(0, 0)))).toBe(true);
    const done = { [peg(0, 0)]: fin(0), [peg(0, 1)]: fin(1), [peg(0, 2)]: fin(2), [peg(0, 3)]: fin(3), [peg(2, 0)]: ring(40) };
    const s2 = scenario({ players: 4 }, { pegs: done, hands: [['7'], [], [], []] });
    expect(legalPlays(s2, 0).some((p) => p.moves.some((m) => (m as { peg: number }).peg === peg(2, 0)))).toBe(true);
  });
});

describe('7 in beliebigen Teilzügen', () => {
  const four = { players: 4 };
  const mv = (peg_: number, steps: number) => ({ t: 'move' as const, peg: peg_, steps });
  const setup = () =>
    scenario(four, { pegs: { [peg(0, 0)]: ring(5), [peg(0, 1)]: ring(20), [peg(0, 2)]: ring(30) }, hands: [['7'], [], [], []] });

  it('bietet Schritt für Schritt alle Kugeln und Schrittzahlen an, bis 7 verteilt sind', () => {
    const s = setup();
    const layout = layoutFor(four);
    const first = sevenNext(s.pegs, layout, 0, []);
    expect(first.remaining).toBe(7);
    expect(new Set(first.next.map((m) => (m as { peg: number }).peg))).toEqual(new Set([peg(0, 0), peg(0, 1), peg(0, 2)]));
    expect(first.next.filter((m) => (m as { peg: number }).peg === peg(0, 0)).map((m) => (m as { steps: number }).steps)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // 1 + 1 + 1 + 1 + 1 + 1 + 1: sieben einzelne Teilzüge, auch mit derselben Kugel mehrmals
    const seq = [mv(peg(0, 0), 1), mv(peg(0, 1), 1), mv(peg(0, 0), 1), mv(peg(0, 2), 1), mv(peg(0, 1), 1), mv(peg(0, 0), 1), mv(peg(0, 2), 1)];
    expect(sevenValid(s.pegs, layout, 0, seq)).toBe(true);
    expect(sevenValid(s.pegs, layout, 0, seq.slice(0, 6))).toBe(false); // noch nicht alles verteilt
    const done = applyAction(s, { t: 'play', player: 0, card: '7', moves: seq });
    expect(done.pegs[peg(0, 0)]!.pos).toEqual(ring(8));
    expect(done.pegs[peg(0, 1)]!.pos).toEqual(ring(22));
    expect(done.pegs[peg(0, 2)]!.pos).toEqual(ring(32));
  });

  it('Reihenfolge ist frei, fremde Kugeln und zu viele Schritte werden abgelehnt', () => {
    const s = setup();
    const layout = layoutFor(four);
    expect(sevenValid(s.pegs, layout, 0, [mv(peg(0, 2), 4), mv(peg(0, 0), 3)])).toBe(true);
    expect(sevenValid(s.pegs, layout, 0, [mv(peg(0, 0), 3), mv(peg(0, 2), 4)])).toBe(true);
    expect(sevenValid(s.pegs, layout, 0, [mv(peg(0, 0), 8)])).toBe(false);
    expect(sevenValid(s.pegs, layout, 0, [mv(peg(1, 0), 7)])).toBe(false);
    expect(() => applyAction(s, { t: 'play', player: 0, card: '7', moves: [mv(peg(0, 0), 6)] })).toThrow();
  });

  it('Mit dem Joker als 7 darf die letzte Kugel nicht ins Haus', () => {
    const pegs = { [peg(0, 0)]: fin(3), [peg(0, 1)]: fin(2), [peg(0, 2)]: fin(1), [peg(0, 3)]: ring(start(0) + 62) };
    const s = scenario(four, { pegs, hands: [['JOKER', '7'], [], [], []] });
    const layout = layoutFor(four);
    expect(sevenValid(s.pegs, layout, 0, [mv(peg(0, 3), 3)])).toBe(false); // nur 3 von 7 verteilt
    const single = scenario(four, { pegs: { [peg(0, 3)]: ring(start(0) + 57), [peg(0, 0)]: fin(0) }, hands: [['JOKER'], [], [], []] });
    expect(sevenValid(single.pegs, layout, 0, [mv(peg(0, 3), 6)], true)).toBe(false);
  });
});


describe('Am Zielhaus vorbeilaufen', () => {
  const two = { players: 3 } as const;
  it('Mit belegtem ersten Hausplatz muss man vorbeilaufen', () => {
    const s = scenario(two, {
      pegs: { [peg(0, 0)]: { t: 'ring', f: start(0), lap: true }, [peg(0, 1)]: fin(0) },
      hands: [['3'], [], []],
    });
    const plays = legalPlays(s, 0).filter((p) => p.moves[0]!.t === 'move' && (p.moves[0] as { peg: number }).peg === peg(0, 0));
    expect(plays).toEqual([{ card: '3', moves: [{ t: 'move', peg: peg(0, 0), steps: 3, pass: true }] }]);
    const s2 = applyAction(s, { t: 'play', player: 0, card: '3', moves: plays[0]!.moves });
    expect(s2.pegs[peg(0, 0)]!.pos).toEqual({ t: 'ring', f: start(0) + 3, lap: true });
  });
  it('Zu viele Augen fürs Haus: vorbeilaufen statt ins Haus; sonst beides wählbar', () => {
    const base = { [peg(0, 0)]: { t: 'ring', f: start(0) - 2 } as Pos };
    const s = scenario(two, { pegs: base, hands: [['5', '6'], [], []] });
    const mine = (card: string) => legalPlays(s, 0).filter((p) => p.card === card).map((p) => p.moves[0]);
    expect(mine('5')).toEqual([
      { t: 'move', peg: peg(0, 0), steps: 5 },
      { t: 'move', peg: peg(0, 0), steps: 5, pass: true },
    ]);
    const s2 = scenario(two, { pegs: { ...base, [peg(0, 1)]: fin(2) }, hands: [['5'], [], []] });
    expect(legalPlays(s2, 0).map((p) => p.moves[0])).toEqual([{ t: 'move', peg: peg(0, 0), steps: 5, pass: true }]);
  });
  it('Nach dem Vorbeilaufen geht es in der nächsten Runde ins Haus', () => {
    const s = scenario(two, { pegs: { [peg(0, 0)]: { t: 'ring', f: start(0) + 3, lap: true } }, hands: [['3'], [], []] });
    expect(legalPlays(s, 0)).toHaveLength(1);
    const far = scenario(two, { pegs: { [peg(0, 0)]: { t: 'ring', f: start(0) - 1, lap: true } }, hands: [['3'], [], []] });
    expect(legalPlays(far, 0).map((p) => p.moves[0])).toContainEqual({ t: 'move', peg: peg(0, 0), steps: 3 });
  });
  it('4 vor, 4 zurück aufs Startfeld: mit der 2 wahlweise ins Haus oder vorwärts', () => {
    const s = scenario(two, { pegs: { [peg(0, 0)]: { t: 'ring', f: start(0) + 4 } }, hands: [['4', '2'], [], []] });
    const back = legalPlays(s, 0).find((p) => p.card === '4' && (p.moves[0] as { steps: number }).steps === -4)!;
    const s2 = applyAction(s, { t: 'play', player: 0, card: '4', moves: back.moves });
    expect(s2.pegs[peg(0, 0)]!.pos).toEqual({ t: 'ring', f: start(0), lap: true });
    s2.current = 0;
    s2.hands[0] = ['2'];
    const m = legalPlays(s2, 0).map((p) => p.moves[0]).filter((x) => x && x.t === 'move');
    expect(m).toEqual([
      { t: 'move', peg: peg(0, 0), steps: 2 },
      { t: 'move', peg: peg(0, 0), steps: 2, pass: true },
    ]);
  });
});

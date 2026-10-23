import { describe, expect, it } from 'vitest';
import { applyAction, BOT_LEVELS, chooseAction, evaluate, type Card, chooseDraw, chooseExchange, createGame, layoutFor, legalPlays, LEVEL_PARAMS, makeRand, type BotLevel, type GameConfig, type GivenCard } from '../src';
import { fin, peg, ring, scenario } from './helpers';

/** Experte ohne Vorausschau: prüft die Ein-Zug-Regeln zum Kartentausch isoliert (die Vorausschau bewertet solche Stellungen eigenständig). */
const EXPERT_1PLY = { ...LEVEL_PARAMS.expert, lookahead: undefined };

/** Spielt ein komplettes Spiel; `levels[p]` ist die Stufe von Spieler p. Liefert die Gewinner. */
function playGame(cfg: GameConfig, levels: BotLevel[], seed: number): number[] {
  let s = createGame(cfg, seed);
  const rand = makeRand(seed + 1000);
  for (let i = 0; i < 50000 && s.phase !== 'finished'; i++) {
    if (s.phase === 'exchange') {
      for (let p = 0; p < cfg.players; p++) s = applyAction(s, layoutFor(s.config).teams ? chooseExchange(s, p, levels[p]!, rand) : chooseDraw(s, p, rand));
    } else {
      s = applyAction(s, chooseAction(s, s.current, levels[s.current]!, rand));
    }
  }
  if (s.phase !== 'finished') throw new Error('Spiel nicht beendet');
  return s.winners!;
}

describe('Sperre', () => {
  const layout = layoutFor({ players: 4 });
  const score = (pegs: Parameters<typeof evaluate>[0], block: number) => evaluate(pegs, layout, 0, 0, 0.5, undefined, block);
  const pegsOf = (pos: Record<number, ReturnType<typeof ring>>) => scenario({ players: 4 }, { pegs: pos }).pegs;

  it('Sperre vor einer gegnerischen Kugel zählt als Vorteil', () => {
    const pegs = pegsOf({ [peg(0, 0)]: ring(0), [peg(1, 0)]: ring(60) });
    expect(score(pegs, 50)).toBeGreaterThan(score(pegs, 0));
  });

  it('Sperre vor einer Partnerkugel zählt als Nachteil', () => {
    const pegs = pegsOf({ [peg(0, 0)]: ring(0), [peg(2, 0)]: ring(60) });
    expect(score(pegs, 50)).toBeLessThan(score(pegs, 0));
  });

  it('Gegner, der die Sperre nicht mehr passiert, zählt nicht', () => {
    // Farbe 1 steht kurz vor ihrem Startfeld 16 (Fortschritt 63): die Sperre auf 0 liegt nicht mehr auf ihrem Weg
    const pegs = pegsOf({ [peg(0, 0)]: ring(0), [peg(1, 0)]: ring(15) });
    expect(score(pegs, 50)).toBe(score(pegs, 0));
  });

  it('Sperre ohne gelaufene Runde endet, sobald die Kugel ihre Runde vollendet hat', () => {
    const pegs = pegsOf({ [peg(0, 0)]: { t: 'ring', f: 0, lap: true }, [peg(1, 0)]: ring(60) });
    expect(score(pegs, 50)).toBe(score(pegs, 0));
  });

  it('Experte mit Sperrterm gibt die Sperre frei, wenn der Partner dahinter wartet', () => {
    const s = scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(0), [peg(0, 1)]: ring(20), [peg(2, 0)]: ring(60) }, hands: [['5'], ['A'], ['A'], ['A']] },
    );
    expect(legalPlays(s, 0).length).toBeGreaterThan(1);
    const a = chooseAction(s, 0, { ...EXPERT_1PLY, block: 100 }, makeRand(1));
    expect(applyAction(s, a).pegs.find((p) => p.id === peg(0, 0))!.pos).toEqual(ring(5));
  });
});

describe('Erzwungener Abwurf', () => {
  /** Farbe `c` hat drei Kugeln im Haus und eine auf Feld 62, zwei Felder vor meiner Sperre auf Feld 0. */
  const stuck = (c: number) => ({ [peg(c, 0)]: ring(62), [peg(c, 1)]: fin(0), [peg(c, 2)]: fin(1), [peg(c, 3)]: fin(2) });
  /** `bait`: ein Schlag mit der Sperrkugel (Feld 5) bzw. mit der anderen Kugel (Feld 25) lockt zum jeweils anderen Zug. */
  const pick = (who: number, forceDump = 200, bait = false) => {
    const hands: Card[][] = [['5'], ['A'], ['A'], ['A']];
    hands[who] = ['2', '3', '5', '6', '8'];
    const s = scenario({ players: 4 }, { pegs: { [peg(0, 0)]: ring(0), [peg(0, 1)]: ring(20), ...stuck(who), ...(bait ? { [peg(3, 0)]: ring(who === 1 ? 5 : 25) } : {}) }, hands });
    const a = chooseAction(s, 0, { ...EXPERT_1PLY, forceDump }, makeRand(1));
    return applyAction(s, a).pegs.find((p) => p.id === peg(0, 0))!.pos;
  };

  it('Behält die Sperre, wenn der Gegner dahinter sonst abwerfen muss', () => {
    expect(pick(1, 200, true)).toEqual(ring(0));
    expect(pick(1, 0, true)).toEqual(ring(5)); // ohne den Term schlägt der Bot mit der Sperrkugel
  });

  it('Gibt die Sperre frei, wenn sonst der Partner abwerfen muss', () => {
    expect(pick(2, 1000, true)).toEqual(ring(5));
    expect(pick(2, 0, true)).toEqual(ring(0)); // ohne den Term schlägt der Bot mit der anderen Kugel
  });
});

describe('Kartentausch mit Sperre', () => {
  const setup = () => {
    // Partner (Spieler 2) steht mit der letzten Kugel 2 Felder vor meiner Sperre auf Feld 0, die übrigen Kugeln sind im Haus
    const s = scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(0), [peg(2, 0)]: ring(62), [peg(2, 1)]: fin(0), [peg(2, 2)]: fin(1), [peg(2, 3)]: fin(2) }, hands: [['10', '4', '3'], ['A'], ['2', '3', '5', '6', '8'], ['A']] },
    );
    return s;
  };

  it('Gibt dem Partner eine Karte, die er trotz meiner Sperre spielen kann', () => {
    expect(chooseExchange(setup(), 0, { ...LEVEL_PARAMS.expert, giftPlayable: 50 }, makeRand(1)).card).toBe('4'); // rückwärts
  });

  it('Ohne den Term gibt er die höhere Karte, die der Partner nicht spielen kann', () => {
    expect(chooseExchange(setup(), 0, 'expert', makeRand(1)).card).toBe('10');
  });
});

describe('Kartentausch mit Schlag', () => {
  // Partner (Spieler 2) hat eine freie Fahrt; eine gegnerische Kugel (Farbe 1) steht 5 Felder vor ihm kurz vor ihrem Haus
  const setup = () =>
    scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(0), [peg(2, 0)]: ring(40), [peg(1, 0)]: ring(45) }, hands: [['10', '5', '3'], ['A'], ['2', '3', '6', '8', '9'], ['A']] },
    );

  it('Gibt dem Partner die Karte, mit der er die gegnerische Kugel schlagen kann', () => {
    expect(chooseExchange(setup(), 0, { ...LEVEL_PARAMS.expert, giftTactic: 0.3 }, makeRand(1)).card).toBe('5');
  });

  it('Ohne den Term gibt er die höchste Karte', () => {
    expect(chooseExchange(setup(), 0, 'expert', makeRand(1)).card).toBe('10');
  });
});

describe('Bots', () => {
  it('Alle Stufen spielen ein Teamspiel und ein Einzelspiel legal bis zum Ende', () => {
    for (const level of BOT_LEVELS) {
      expect(playGame({ players: 4 }, Array(4).fill(level), 3).length).toBe(2);
      expect(playGame({ players: 3 }, Array(3).fill(level), 3).length).toBe(1);
    }
  });

  it('Sind deterministisch bei gleichem Seed', () => {
    expect(playGame({ players: 4 }, Array(4).fill('expert'), 8)).toEqual(playGame({ players: 4 }, Array(4).fill('expert'), 8));
  });

  it('Experte schlägt eine gegnerische Kugel, wenn es geht', () => {
    const s = scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(0), [peg(1, 0)]: ring(5) }, hands: [['5', '2'], ['A'], ['A'], ['A']] },
    );
    const a = chooseAction(s, 0, 'expert', makeRand(1));
    expect(a.card).toBe('5');
    expect(applyAction(s, a).pegs.find((p) => p.id === peg(1, 0))!.pos).toEqual({ t: 'home' });
  });

  it('Experte schlägt keine eigene Kugel, wenn eine Alternative besteht', () => {
    const s = scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(0), [peg(0, 1)]: ring(5) }, hands: [['5', '2'], ['A'], ['A'], ['A']] },
    );
    const a = chooseAction(s, 0, 'expert', makeRand(1));
    expect(applyAction(s, a).pegs.find((p) => p.id === peg(0, 1))!.pos).not.toEqual({ t: 'home' });
  });

  it('Experte gibt dem Partner beim Tausch die beste Karte, nicht die schwächste', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['JOKER', 'A', '2', '3', '9', 'K'];
    s.pegs.find((p) => p.id === peg(2, 0))!.pos = ring(32); // Partner ist schon unterwegs
    s.pegs.find((p) => p.id === peg(0, 0))!.pos = ring(0); // ich habe selbst eine Kugel im Spiel
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('JOKER'); // die beste Karte; ich behalte A und K zum Rauskommen
    expect(chooseExchange(s, 0, 'advanced', makeRand(1)).card).toBe('2'); // ohne Partner-Logik
  });

  it('Experte gibt dem Partner einen Starter (König zuerst), wenn dessen Kugeln noch alle im Heim sind', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['A', 'K', '2', '3', '9', '5'];
    s.pegs.find((p) => p.id === peg(0, 0))!.pos = ring(0);
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('K');
  });

  it('Ohne Kugel im Spiel gibt der Bot mit König/Ass und Joker den Joker an den Partner', () => {
    for (const level of ['intermediate', 'advanced', 'expert'] as const) {
      for (const starter of ['K', 'A'] as const) {
        const s = createGame({ players: 4 }, 5);
        s.hands[0] = ['JOKER', starter, '2', '3', '9', '5'];
        expect(chooseExchange(s, 0, level, makeRand(1)).card).toBe('JOKER');
      }
    }
  });

  it('Experte gibt seinen einzigen Starter nur ab, wenn er selbst schon eine Kugel auf dem Ring hat', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['A', '2', '3', '9', '5', '6'];
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('9'); // alle Kugeln im Heim: Ass behalten
    s.pegs.find((p) => p.id === peg(0, 0))!.pos = ring(0);
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('A');
  });

  it('Der Tausch wird gemerkt und nach dem Spielen der Karte vergessen', () => {
    let s = createGame({ players: 4 }, 5);
    s.hands = [['K', '2'], ['5', '3'], ['9', '4'], ['6', '7']];
    for (let c = 0; c < 4; c++) s.pegs.find((p) => p.id === peg(c, 0))!.pos = ring(c * 16); // alle können ziehen
    for (let p = 0; p < 4; p++) s = applyAction(s, { t: 'exchange', player: p, card: s.hands[p]![1]! });
    expect(s.given!.map(({ from, to, card }) => ({ from, to, card }))).toEqual([
      { from: 0, to: 2, card: '2' },
      { from: 1, to: 3, card: '3' },
      { from: 2, to: 0, card: '4' },
      { from: 3, to: 1, card: '7' },
    ]);
    const me = s.current;
    const received = s.given!.find((g) => g.to === me)!.card;
    const play = legalPlays(s, me).find((pl) => pl.card === received);
    if (!play) throw new Error('Testaufbau: erhaltene Karte nicht spielbar');
    s = applyAction(s, { t: 'play', player: me, card: received, moves: play.moves });
    expect(s.given!.some((g) => g.to === me && g.card === received)).toBe(false);
    expect(s.given!.filter((g) => g.to !== me).length).toBeGreaterThan(0);
  });

  it('Experte spielt die vom Partner erhaltene Karte möglichst spät', () => {
    const s = scenario({ players: 4 }, { pegs: { [peg(0, 0)]: ring(0) }, hands: [['9', '8'], ['A'], ['A'], ['A']] });
    expect(chooseAction(s, 0, 'expert', makeRand(1)).card).toBe('9');
    s.given = [{ from: 2, to: 0, card: '9' }];
    expect(chooseAction(s, 0, 'expert', makeRand(1)).card).toBe('8');
  });

  it('Experte bereitet mit seinem Zug den Zug mit der abgegebenen Karte vor', () => {
    // Partner (Spieler 2) hält die 9 und steht 8 Felder vor dem Haus; der Bube holt ihn mit dem Tausch genau dorthin
    const s = scenario(
      { players: 4 },
      { pegs: { [peg(0, 0)]: ring(24), [peg(2, 0)]: ring(10) }, hands: [['J', '5'], ['A'], ['9', '3'], ['A']] },
    );
    expect(chooseAction(s, 0, EXPERT_1PLY, makeRand(1)).card).toBe('5');
    s.given = [{ from: 0, to: 2, card: '9' }];
    const a = chooseAction(s, 0, EXPERT_1PLY, makeRand(1));
    expect(a.card).toBe('J');
    const after = applyAction(s, a);
    expect(after.pegs.find((p) => p.id === peg(2, 0))!.pos).toEqual(ring(24));
  });

  it('Experte nutzt Tauschkarten fremder Teams nicht (nur eigene abgegebene und erhaltene)', () => {
    // Spieler 1 (Team 1/3) spielt; die Einträge 0 -> 2 gehören zum anderen Team
    const foreign: GivenCard[] = [{ from: 0, to: 2, card: '9' }];
    const own: GivenCard[] = [{ from: 3, to: 1, card: '9' }];
    const late = scenario({ players: 4 }, { pegs: { [peg(1, 0)]: ring(16) }, hands: [['A'], ['9', '8'], ['A'], ['A']], current: 1 });
    expect(chooseAction(late, 1, EXPERT_1PLY, makeRand(1)).card).toBe('9');
    expect(chooseAction({ ...late, given: foreign }, 1, EXPERT_1PLY, makeRand(1)).card).toBe('9'); // fremde 9 verzögert nichts
    expect(chooseAction({ ...late, given: own }, 1, EXPERT_1PLY, makeRand(1)).card).toBe('8'); // eigene erhaltene 9 schon

    // Vorbereiten für den Partner (Spieler 3): nur mit der eigenen abgegebenen Karte
    const prep = scenario(
      { players: 4 },
      { pegs: { [peg(1, 0)]: ring(40), [peg(3, 0)]: ring(26) }, hands: [['A'], ['J', '5'], ['A'], ['9', '3']], current: 1 },
    );
    expect(chooseAction({ ...prep, given: foreign }, 1, EXPERT_1PLY, makeRand(1)).card).toBe('5');
    expect(chooseAction({ ...prep, given: [{ from: 1, to: 3, card: '9' }] }, 1, EXPERT_1PLY, makeRand(1)).card).toBe('J');
  });

  it('Experte-Team schlägt Anfänger-Team deutlich', () => {
    let expertWins = 0;
    const games = 16;
    for (let g = 0; g < games; g++) {
      // Spieler 0 und 2 (ein Team) = Experte, 1 und 3 = Anfänger; Startspieler wechselt mit dem Seed
      const winners = playGame({ players: 4 }, ['expert', 'beginner', 'expert', 'beginner'], 100 + g);
      if (winners.includes(0)) expertWins++;
    }
    expect(expertWins).toBeGreaterThanOrEqual(13);
  });

  it('Stufen sind in der Stärke geordnet (Experte gegen Mittel im Einzelspiel)', () => {
    let expertWins = 0;
    const games = 36;
    for (let g = 0; g < games; g++) {
      const winners = playGame({ players: 3 }, ['expert', 'intermediate', 'beginner'], 200 + g);
      if (winners.includes(0)) expertWins++;
    }
    expect(expertWins).toBeGreaterThanOrEqual(16); // Zufallsniveau wäre 12 von 36
  });
});

import { describe, expect, it } from 'vitest';
import { applyAction, BOT_LEVELS, chooseAction, chooseExchange, createGame, legalPlays, makeRand, type BotLevel, type GameConfig } from '../src';
import { peg, ring, scenario } from './helpers';

/** Spielt ein komplettes Spiel; `levels[p]` ist die Stufe von Spieler p. Liefert die Gewinner. */
function playGame(cfg: GameConfig, levels: BotLevel[], seed: number): number[] {
  let s = createGame(cfg, seed);
  const rand = makeRand(seed + 1000);
  for (let i = 0; i < 50000 && s.phase !== 'finished'; i++) {
    if (s.phase === 'exchange') {
      for (let p = 0; p < cfg.players; p++) s = applyAction(s, chooseExchange(s, p, levels[p]!, rand));
    } else {
      s = applyAction(s, chooseAction(s, s.current, levels[s.current]!, rand));
    }
  }
  if (s.phase !== 'finished') throw new Error('Spiel nicht beendet');
  return s.winners!;
}

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
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('JOKER'); // die beste Karte; ich behalte A und K zum Rauskommen
    expect(chooseExchange(s, 0, 'advanced', makeRand(1)).card).toBe('2'); // ohne Partner-Logik
  });

  it('Experte gibt dem Partner einen Starter (König zuerst), wenn dessen Kugeln noch alle im Heim sind', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['JOKER', 'A', '2', '3', '9', 'K'];
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('K');
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
    expect(s.given).toEqual([
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
    expect(chooseAction(s, 0, 'expert', makeRand(1)).card).toBe('5');
    s.given = [{ from: 0, to: 2, card: '9' }];
    const a = chooseAction(s, 0, 'expert', makeRand(1));
    expect(a.card).toBe('J');
    const after = applyAction(s, a);
    expect(after.pegs.find((p) => p.id === peg(2, 0))!.pos).toEqual(ring(24));
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

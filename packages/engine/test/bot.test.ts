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

  it('Experte gibt beim Tausch schwache Karten ab und behält den Joker', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['JOKER', 'A', '2', '3', '9', 'K'];
    s.pegs.find((p) => p.id === peg(2, 0))!.pos = ring(32); // Partner ist schon unterwegs
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('2');
  });

  it('Experte gibt dem Partner einen Starter, wenn dessen Kugeln noch alle im Heim sind', () => {
    const s = createGame({ players: 4 }, 5);
    s.hands[0] = ['JOKER', 'A', '2', '3', '9', 'K'];
    expect(chooseExchange(s, 0, 'expert', makeRand(1)).card).toBe('K');
    expect(chooseExchange(s, 0, 'advanced', makeRand(1)).card).toBe('2'); // ohne Partner-Logik
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

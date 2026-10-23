/**
 * Bot-Simulation: Bots spielen gegeneinander, pro Spiel eine JSON-Zeile mit Kennzahlen.
 *
 *   npx esbuild sim/run.ts --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs
 *   node /tmp/sim.mjs --players 4 --levels expert,advanced,expert,advanced --games 200 --seed 1 --out out.jsonl
 *
 * `--levels` gilt für Sitz 0..n-1; pro Spiel wird die Sitzbelegung um einen Platz gedreht (Startvorteil ausgleichen).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import {
  applyAction, chooseAction, chooseDraw, chooseExchange, createGame, layoutFor, makeRand,
  type BotLevel, type GameState,
} from '../src';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const players = Number(arg('players', '4'));
const games = Number(arg('games', '100'));
const seed0 = Number(arg('seed', '1'));
const out = arg('out');
const levels = (arg('levels', 'expert') as string).split(',') as BotLevel[];
const seatLevels0 = Array.from({ length: players }, (_, i) => levels[i % levels.length]!);
const maxTurns = 4000;

export interface SeatStat { level: BotLevel; passes: number; passedCards: number; captures: number; ownLosses: number; friendlyFire: number }

function teamPegsInFinish(s: GameState, team: number): number {
  const layout = layoutFor(s.config);
  const colors = layout.teamList[team]!.flatMap((p) => layout.colorsOf[p]!);
  return s.pegs.filter((p) => colors.includes(p.color) && p.pos.t === 'fin').length;
}

for (let g = 0; g < games; g++) {
  const shift = g % players;
  const seatLevel = seatLevels0.map((_, i) => seatLevels0[(i + shift) % players]!);
  const layout = layoutFor({ players });
  let s = createGame({ players }, seed0 * 100003 + g);
  const rand = makeRand(seed0 * 7919 + g);
  const seats: SeatStat[] = seatLevel.map((level) => ({ level, passes: 0, passedCards: 0, captures: 0, ownLosses: 0, friendlyFire: 0 }));
  const colorOwner = new Map<number, number>();
  layout.colorsOf.forEach((cs, p) => cs.forEach((c) => colorOwner.set(c, p)));
  let turns = 0;
  while (s.phase !== 'finished' && turns < maxTurns) {
    if (s.phase === 'exchange') {
      for (let p = 0; p < players; p++) {
        s = applyAction(s, layout.teams ? chooseExchange(s, p, seatLevel[p]!, rand) : chooseDraw(s, p, rand));
      }
      continue;
    }
    const player = s.current;
    const before = s.pegs;
    const action = chooseAction(s, player, seatLevel[player]!, rand);
    s = applyAction(s, action);
    turns++;
    for (const pg of s.pegs) {
      const old = before.find((q) => q.id === pg.id)!;
      if (old.pos.t !== 'home' && pg.pos.t === 'home') {
        const victimTeam = layout.teamOf[colorOwner.get(pg.color)!]!;
        seats[player]!.captures++;
        if (victimTeam === layout.teamOf[player]!) seats[player]!.friendlyFire++;
        else seats[colorOwner.get(pg.color)!]!.ownLosses++;
      }
    }
    for (const ps of s.passed ?? []) { seats[ps.player]!.passes++; seats[ps.player]!.passedCards += ps.cards; }
  }
  const winnerTeam = s.winners ? layout.teamOf[s.winners[0]!]! : null;
  const rec = {
    players, game: g, shift, seatLevel, turns, rounds: s.round, finished: s.phase === 'finished',
    winners: s.winners, winnerLevels: s.winners ? s.winners.map((w) => seatLevel[w]) : null,
    finishPegs: layout.teamList.map((_, t) => teamPegsInFinish(s, t)), winnerTeam, seats,
  };
  const line = JSON.stringify(rec);
  if (out) { if (g === 0) writeFileSync(out, ''); appendFileSync(out, line + '\n'); } else console.log(line);
}

/**
 * Stärkevergleich zweier Bot-Parametersätze im Einzelspiel (Sitze rotieren), parallel über Worker.
 *   node match.mjs '{"A":{...},"B":"advanced"}' 2 400 3 150 ...   (Spielerzahl, Spiele, ...)
 * A, B: Stufenname oder Parameter-Objekt (Teile werden über `expert` gelegt). Ausgabe: Siegquote von A je Spielerzahl.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import {
  applyAction, chooseAction, chooseDraw, chooseExchange, createGame, layoutFor, makeRand,
  LEVEL_PARAMS, type BotLevel, type LevelParams,
} from '../src';

type Spec = BotLevel | Partial<LevelParams>;
const resolve = (s: Spec): BotLevel | LevelParams => (typeof s === 'string' ? s : { ...LEVEL_PARAMS.expert, ...s });

function play(a: Spec, b: Spec, players: number, from: number, to: number): { wins: number; games: number } {
  const A = resolve(a), B = resolve(b);
  const layout = layoutFor({ players });
  let wins = 0;
  for (let g = from; g < to; g++) {
    const aSeat = g % players; // A sitzt rotierend, alle anderen spielen B
    const lv = (p: number) => (p === aSeat ? A : B);
    let s = createGame({ players }, (Number(process.env.SEED0 ?? 31337)) + g);
    const rand = makeRand(777 + g);
    let turns = 0;
    while (s.phase !== 'finished' && turns < 4000) {
      if (s.phase === 'exchange') {
        for (let p = 0; p < players; p++) s = applyAction(s, layout.teams ? chooseExchange(s, p, typeof lv(p) === 'string' ? (lv(p) as BotLevel) : 'expert', rand) : chooseDraw(s, p, rand));
        continue;
      }
      s = applyAction(s, chooseAction(s, s.current, lv(s.current), rand));
      turns++;
    }
    if (s.winners?.includes(aSeat)) wins++;
  }
  return { wins, games: to - from };
}

if (!isMainThread) {
  const d = workerData as { a: Spec; b: Spec; players: number; from: number; to: number };
  parentPort!.postMessage(play(d.a, d.b, d.players, d.from, d.to));
} else {
  const [specJson, ...rest] = process.argv.slice(2);
  const spec = JSON.parse(specJson!) as { A: Spec; B: Spec };
  const jobs: { players: number; n: number }[] = [];
  for (let i = 0; i < rest.length; i += 2) jobs.push({ players: Number(rest[i]), n: Number(rest[i + 1]) });
  const cores = cpus().length;
  const run = (players: number, from: number, to: number) => new Promise<{ wins: number; games: number }>((res) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { a: spec.A, b: spec.B, players, from, to } });
    w.on('message', res);
  });
  for (const j of jobs) {
    const chunk = Math.ceil(j.n / cores);
    const parts = await Promise.all(Array.from({ length: cores }, (_, i) => run(j.players, i * chunk, Math.min(j.n, (i + 1) * chunk))));
    const wins = parts.reduce((x, p) => x + p.wins, 0), games = parts.reduce((x, p) => x + p.games, 0);
    const p = wins / games, base = 1 / j.players, ci = 1.96 * Math.sqrt(p * (1 - p) / games);
    console.log(`${j.players}p: A ${(100 * p).toFixed(1)}% ±${(100 * ci).toFixed(1)} (fair ${(100 * base).toFixed(1)}%) n=${games}`);
  }
}

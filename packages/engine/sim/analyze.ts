/**
 * Analyse einer Log-Datei (im Spiel: Rückblick -> "Log exportieren").
 *
 *   npx tsx sim/analyze.ts spiel.json                 # Übersicht: Spieler, Ausgang, alle Aktionen
 *   npx tsx sim/analyze.ts spiel.json 174             # Stellung vor Aktion 174 + Bewertung der Bot-Entscheidung
 *   npx tsx sim/analyze.ts spiel.json 174 --runs 40   # Häufigkeit der Wahl über 40 Zufallsstichproben (Vorausschau würfelt)
 *
 * Aktionen zählen wie im Rückblick: "Zug N" = Stand nach N Aktionen, die Entscheidung ist die Aktion mit Index N.
 */
import { readFileSync } from 'node:fs';
import {
  applyAction, chooseAction, createGame, layoutFor, makeRand, startField,
  type Action, type BotLevel, type GameConfig, type GameState, type Peg, type PlayTrace,
} from '../src';

interface Log {
  format: string;
  config: GameConfig;
  seed: number;
  seats: { kind: 'human' | 'bot'; level?: BotLevel; colorName: string; name?: string }[];
  actions: Action[];
  finished: boolean;
}

const file = process.argv[2];
if (!file) {
  console.error('Aufruf: analyze.ts <log.json> [aktionsindex] [--runs N]');
  process.exit(1);
}
const log = JSON.parse(readFileSync(file, 'utf8')) as Log;
if (log.format !== 'dog-log') throw new Error('Keine dog-log-Datei');
const idxArg = process.argv[3] && !process.argv[3].startsWith('--') ? Number(process.argv[3]) : null;
const runs = Number(process.argv[process.argv.indexOf('--runs') + 1]) || 1;
const layout = layoutFor(log.config);
const who = (p: number) => `${log.seats[p]?.name ?? 'Computer'} ${log.seats[p]?.colorName ?? p}${log.seats[p]?.level ? ` (${log.seats[p]!.level})` : ''}`;

/** Stand nach n Aktionen */
function stateAt(n: number): GameState {
  let s = createGame(log.config, log.seed);
  for (const a of log.actions.slice(0, n)) s = applyAction(s, a);
  return s;
}

const posText = (p: Peg): string => {
  if (p.pos.t === 'home') return 'Heim';
  if (p.pos.t === 'fin') return `Haus${p.pos.s}`;
  const prog = p.pos.lap ? layout.ringSize : (p.pos.f - startField(p.color) + layout.ringSize) % layout.ringSize;
  return `f${p.pos.f}(+${prog}${p.pos.lap ? ',Runde' : ''})`;
};

function describe(a: Action): string {
  if (a.t === 'draw') return `${who(a.player)} zieht blind Position ${a.idx}`;
  if (a.t === 'exchange') return `${who(a.player)} gibt ${a.card} ab`;
  const mv = a.moves
    .map((m) => (m.t === 'start' ? `Peg${m.peg} raus` : m.t === 'move' ? `Peg${m.peg} ${m.steps > 0 ? '+' : ''}${m.steps}${m.pass ? ' (vorbei)' : ''}` : m.t === 'swap' ? `tausche Peg${m.a}<->Peg${m.b}` : `stiehlt Karte ${m.idx} von ${m.from}`))
    .join(', ');
  return `${who(a.player)} spielt ${a.card}${a.as ? ` als ${a.as}` : ''}: ${mv || 'ohne Wirkung (Hand abgeworfen)'}`;
}

function show(s: GameState): void {
  console.log(`Runde ${s.round + 1}, Stapel ${s.deck.length}, Geber ${who(s.dealer)}, Phase ${s.phase}, am Zug: ${who(s.current)}`);
  s.hands.forEach((h, p) => console.log(`  Hand ${who(p)}: ${h.join(' ') || '-'}`));
  console.log('  Ringfelder: Farbe c hat Startfeld f = 16*c (4 Spieler); +N = Fortschritt seit Start');
  for (const c of layout.usedColors) {
    const ps = s.pegs.filter((p) => p.color === c);
    console.log(`  Farbe ${c} (${log.seats.find((_, i) => layout.colorsOf[i]!.includes(c))?.colorName}): ${ps.map((p) => `#${p.id}:${posText(p)}`).join('  ')}`);
  }
  if (s.given?.length) console.log(`  Tauschkarten (noch bekannt): ${s.given.map((g) => `${g.from}->${g.to}: ${g.card}`).join(', ')}`);
}

if (idxArg === null) {
  console.log(`Spiel mit ${log.seats.length} Spielern, seed ${log.seed}, ${log.actions.length} Aktionen, ${log.finished ? 'beendet' : 'laufend'}`);
  log.seats.forEach((s, p) => console.log(`  Platz ${p}: ${s.kind === 'bot' ? `Computer ${s.colorName} (${s.level})` : `${s.name ?? 'Mensch'} ${s.colorName}`}`));
  log.actions.forEach((a, i) => console.log(`${String(i).padStart(4)}  ${describe(a)}`));
} else {
  const s = stateAt(idxArg);
  const a = log.actions[idxArg];
  console.log(`=== Stellung vor Aktion ${idxArg} (Rückblick „Zug ${idxArg} von ${log.actions.length}“) ===`);
  show(s);
  if (!a) process.exit(0);
  console.log(`\nTatsächlich: ${describe(a)}`);
  const seat = log.seats[a.player];
  if (a.t === 'play' && seat?.kind === 'bot') {
    const freq = new Map<string, number>();
    let last: PlayTrace[] = [];
    for (let r = 0; r < runs; r++) {
      const trace: PlayTrace[] = [];
      const c = chooseAction(structuredClone(s), a.player, seat.level!, makeRand(r + 1), trace);
      const key = `${c.card}${c.as ? `(${c.as})` : ''} ${JSON.stringify(c.moves)}`;
      freq.set(key, (freq.get(key) ?? 0) + 1);
      last = trace;
    }
    console.log(`\nBot-Bewertung (${seat.level}, Stichprobe ${runs}; Ausgabe = letzter Lauf):`);
    last
      .sort((x, y) => y.total - x.total)
      .forEach((t) => {
        const mv = t.play.moves.map((m) => (m.t === 'move' ? `#${m.peg}${m.steps > 0 ? '+' : ''}${m.steps}` : m.t === 'start' ? `#${m.peg} raus` : m.t === 'swap' ? `${m.a}<->${m.b}` : 'Karte klauen')).join(' ');
        const terms = Object.entries(t.terms).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
        console.log(`  ${t.chosen ? '>>' : '  '} ${t.play.card}${t.play.as ? `(${t.play.as})` : ''} ${mv}: gesamt ${t.total.toFixed(1)} = Stellung ${t.base.toFixed(1)}${t.look !== undefined ? `, Vorausschau ${t.look.toFixed(1)}` : ''}${terms ? `; ${terms}` : ''}`);
      });
    if (runs > 1) {
      console.log('\nHäufigkeit der Wahl:');
      [...freq.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, n]) => console.log(`  ${n}/${runs}  ${k}`));
    }
  }
}

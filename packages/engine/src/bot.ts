import { layoutFor, mod, progress, type Layout } from './board';
import { legalPlays, pegsAfterPlay } from './moves';
import { nextRandom } from './rng';
import type { Action, Card, GameState, Peg, Play } from './types';

export type BotLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export const BOT_LEVELS: BotLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];
export const BOT_LEVEL_LABELS: Record<BotLevel, string> = {
  beginner: 'Anfänger',
  intermediate: 'Mittel',
  advanced: 'Fortgeschritten',
  expert: 'Experte',
};

interface LevelParams {
  /** Zufälliger legaler Zug */
  random: boolean;
  /** Zufallsrauschen auf die Bewertung (größer = ungenauer) */
  noise: number;
  /** Gewicht der Gefahr, geschlagen zu werden */
  threat: number;
  /** Gewicht der Kosten für "verbrauchte" wertvolle Karten */
  cardCost: number;
}

const LEVEL_PARAMS: Record<BotLevel, LevelParams> = {
  beginner: { random: true, noise: 0, threat: 0, cardCost: 0 },
  intermediate: { random: false, noise: 90, threat: 0, cardCost: 0 },
  advanced: { random: false, noise: 25, threat: 0.12, cardCost: 0.5 },
  expert: { random: false, noise: 0, threat: 0.2, cardCost: 1 },
};

/** Zufallsquelle für Bots aus einem Seed (deterministisch, unabhängig vom Spielzustand). */
export function makeRand(seed: number): () => number {
  let s = seed;
  return () => {
    const [v, next] = nextRandom(s);
    s = next;
    return v;
  };
}

/** Wert einer einzelnen Kugel: Heim 0, Ring 100..400 nach Fortschritt, Zielhaus 600+. */
function pegValue(layout: Layout, peg: Peg): number {
  if (peg.pos.t === 'home') return 0;
  if (peg.pos.t === 'fin') return 600 + 30 * peg.pos.s;
  return 100 + (300 * progress(layout, peg)) / layout.ringSize;
}

function teamColors(layout: Layout, player: number): number[] {
  return layout.teamList[layout.teamOf[player]!]!.flatMap((q) => layout.colorsOf[q]!);
}

/** Bewertung einer Stellung aus Sicht des Spielers (höher = besser). */
export function evaluate(pegs: Peg[], layout: Layout, player: number, threatWeight: number): number {
  const friendly = teamColors(layout, player);
  let score = 0;
  for (const p of pegs) {
    const v = pegValue(layout, p);
    if (friendly.includes(p.color)) {
      score += v;
      if (threatWeight > 0 && p.pos.t === 'ring' && v > 0) score -= threatWeight * v * Math.min(2, threatCount(pegs, layout, p, friendly));
    } else {
      score -= 0.5 * v;
    }
  }
  return score;
}

/** Wie viele gegnerische Kugeln könnten diese Kugel in einem Zug erreichen (1..13 Felder dahinter, oder Start vom Heimfeld). */
function threatCount(pegs: Peg[], layout: Layout, mine: Peg, friendly: number[]): number {
  if (mine.pos.t !== 'ring') return 0;
  if (mine.pos.f === mine.color * 16) return 0; // eigenes Startfeld ist geschützt
  let n = 0;
  for (const o of pegs) {
    if (friendly.includes(o.color)) continue;
    if (o.pos.t === 'ring') {
      const d = mod(mine.pos.f - o.pos.f, layout.ringSize);
      if (d >= 1 && d <= 13) n++;
    } else if (o.pos.t === 'home' && o.color * 16 === mine.pos.f) {
      n++; // Gegner kann mit Ass/König/Joker herauskommen und schlägt
    }
  }
  return n;
}

const KEEP_VALUE: Record<Card, number> = {
  JOKER: 100, A: 90, K: 85, '7': 60, J: 50, Q: 40, '10': 35, '4': 30, '8': 28, '9': 26, '6': 24, '5': 22, '3': 20, '2': 18,
};

function isStarter(c: Card): boolean {
  return c === 'A' || c === 'K' || c === 'JOKER';
}

function cardCost(state: GameState, layout: Layout, player: number, play: Play): number {
  const isStart = play.moves.some((m) => m.t === 'start');
  const teamHasHome = state.pegs.some((p) => layout.colorsOf[player]!.includes(p.color) && p.pos.t === 'home');
  if (play.card === 'JOKER') return isStart ? 15 : 45;
  if (isStarter(play.card) && !isStart && teamHasHome) return play.card === 'A' ? 25 : 20;
  return 0;
}

/** Wählt den Zug des Bots (der Spieler muss am Zug sein und mindestens einen legalen Zug haben). */
export function chooseAction(
  state: GameState,
  player: number,
  level: BotLevel,
  rand: () => number,
): Extract<Action, { t: 'play' }> {
  const plays = legalPlays(state, player);
  if (plays.length === 0) throw new Error('Kein legaler Zug');
  const params = LEVEL_PARAMS[level];
  const layout = layoutFor(state.config);

  let best: Play = plays[Math.floor(rand() * plays.length)]!;
  if (!params.random) {
    let bestScore = -Infinity;
    for (const play of plays) {
      const after = pegsAfterPlay(state.pegs, layout, play);
      let score = evaluate(after, layout, player, params.threat);
      if (play.moves.some((m) => m.t === 'steal')) score += 25; // eine (unbekannte) Karte gewonnen
      score -= params.cardCost * cardCost(state, layout, player, play);
      score += rand() * params.noise;
      if (score > bestScore) {
        bestScore = score;
        best = play;
      }
    }
  }
  const action: Extract<Action, { t: 'play' }> = { t: 'play', player, card: best.card, moves: best.moves };
  if (best.as !== undefined) action.as = best.as;
  return action;
}

/** Wählt die Karte, die der Bot beim Kartentausch abgibt. */
export function chooseExchange(state: GameState, player: number, level: BotLevel, rand: () => number): Extract<Action, { t: 'exchange' }> {
  const hand = state.hands[player]!;
  const layout = layoutFor(state.config);
  let card: Card = hand[Math.floor(rand() * hand.length)]!;
  if (level !== 'beginner') {
    const sorted = hand.slice().sort((a, b) => KEEP_VALUE[a] - KEEP_VALUE[b]);
    card = sorted[0]!; // die unwichtigste Karte
    const target = layout.giveTo[player]!;
    const helps = layout.teamOf[target] === layout.teamOf[player];
    if (level === 'expert' && helps) {
      // Hat der Partner noch alle Kugeln im Heim, braucht er Starterkarten mehr als ich
      const partnerColors = layout.colorsOf[target]!;
      const partnerAllHome = state.pegs.filter((p) => partnerColors.includes(p.color)).every((p) => p.pos.t === 'home');
      const starters = hand.filter(isStarter);
      if (partnerAllHome && starters.length >= 2) {
        card = starters.includes('K') ? 'K' : starters.includes('A') ? 'A' : 'JOKER';
      }
    }
  }
  return { t: 'exchange', player, card };
}

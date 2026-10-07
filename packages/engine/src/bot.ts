import { controlledColors, layoutFor, mod, progress, type Layout } from './board';
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
  /** Teamspiel: Kartentausch gezielt für den Partner und Wissen über dessen bekannte Karte nutzen */
  teamwork: boolean;
}

const LEVEL_PARAMS: Record<BotLevel, LevelParams> = {
  beginner: { random: true, noise: 0, threat: 0, cardCost: 0, teamwork: false },
  intermediate: { random: false, noise: 90, threat: 0, cardCost: 0, teamwork: false },
  advanced: { random: false, noise: 25, threat: 0.12, cardCost: 0.5, teamwork: false },
  expert: { random: false, noise: 0, threat: 0.2, cardCost: 1, teamwork: true },
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

/** Abzug, wenn die vom Partner erhaltene Karte gespielt wird: der Partner kennt sie und kann damit planen, solange sie noch auf meiner Hand ist. */
const RECEIVED_CARD_DELAY = 20;
/** Gewicht des Vorteils, den die dem Partner abgegebene (noch ungespielte) Karte nach meinem Zug hätte. */
const PARTNER_CARD_WEIGHT = 0.6;

/** Was Bot `player` aus dem Kartentausch weiß: die Karte, die der Empfänger noch hält, und die, die er selbst erhalten hat. */
function exchangeKnowledge(state: GameState, player: number): { heldBy?: { partner: number; card: Card }; received?: Card } {
  const out: { heldBy?: { partner: number; card: Card }; received?: Card } = {};
  for (const g of state.given ?? []) {
    if (g.from === player && g.to !== player) out.heldBy = { partner: g.to, card: g.card };
    if (g.to === player && g.from !== player) out.received = g.card;
  }
  return out;
}

/** Gewinn für das Team, wenn der Partner mit seiner bekannten Karte aus der Stellung `pegs` den besten Zug macht (>= 0). */
function partnerCardGain(state: GameState, layout: Layout, player: number, partner: number, card: Card, pegs: Peg[]): number {
  if (card === 'JOKER') return 0; // zu vielseitig, um ihn vorherzusagen
  const hypothetical: GameState = { ...state, pegs, hands: state.hands.map((h, q) => (q === partner ? [card] : h)) };
  const base = evaluate(pegs, layout, player, 0);
  let best = 0;
  for (const play of legalPlays(hypothetical, partner)) {
    best = Math.max(best, evaluate(pegsAfterPlay(pegs, layout, play), layout, player, 0) - base);
  }
  return best;
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
    const known = params.teamwork ? exchangeKnowledge(state, player) : {};
    let bestScore = -Infinity;
    for (const play of plays) {
      const after = pegsAfterPlay(state.pegs, layout, play);
      let score = evaluate(after, layout, player, params.threat);
      if (play.moves.some((m) => m.t === 'steal')) score += 25; // eine (unbekannte) Karte gewonnen
      score -= params.cardCost * cardCost(state, layout, player, play);
      if (known.received !== undefined && play.card === known.received) score -= RECEIVED_CARD_DELAY;
      if (known.heldBy) score += PARTNER_CARD_WEIGHT * partnerCardGain(state, layout, player, known.heldBy.partner, known.heldBy.card, after);
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

/** Beim Kartentausch an den Partner: Wert einer Starterkarte, wenn er noch keine Kugel draußen hat (König zuerst, Joker zuletzt). */
const STARTER_GIFT: Record<string, number> = { K: 200, A: 195, JOKER: 190 };

/**
 * Die Karte, die dem Partner am meisten hilft: bei lauter Kugeln im Heim eine Starterkarte, sonst die stärkste Karte.
 * Nie eine Karte, ohne die man sich selbst blockiert (Starterkarte nur abgeben, wenn man schon eine Kugel auf dem
 * Ring hat oder noch eine weitere Starterkarte behält).
 */
function cardForPartner(state: GameState, layout: Layout, player: number, hand: Card[]): Card | undefined {
  const pegsOf = (who: number) => state.pegs.filter((p) => controlledColors(state, layout, who).includes(p.color));
  const partnerPegs = pegsOf(layout.giveTo[player]!);
  const partnerHome = partnerPegs.filter((p) => p.pos.t === 'home').length;
  const partnerOut = partnerPegs.filter((p) => p.pos.t === 'ring').length;
  const myPegs = pegsOf(player);
  const needStarter = myPegs.some((p) => p.pos.t === 'home') && !myPegs.some((p) => p.pos.t === 'ring');
  const myStarters = hand.filter(isStarter).length;

  let best: Card | undefined;
  let bestValue = -Infinity;
  for (const c of new Set(hand)) {
    if (isStarter(c) && needStarter && myStarters < 2) continue; // sonst komme ich selbst nicht mehr raus
    let value = KEEP_VALUE[c];
    if (isStarter(c) && partnerHome > 0) value = partnerOut === 0 ? STARTER_GIFT[c]! : value + 20;
    if (value > bestValue) {
      bestValue = value;
      best = c;
    }
  }
  return best;
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
    if (LEVEL_PARAMS[level].teamwork && helps) card = cardForPartner(state, layout, player, hand) ?? card;
  }
  return { t: 'exchange', player, card };
}

import { controlledColors, layoutFor, mod, progress, type Layout } from './board';
import { legalPlays, pegsAfterPlay } from './moves';
import { applyAction } from './game';
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

export interface LevelParams {
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
  /** Gewicht gegnerischer Kugeln in der Bewertung (Abzug des Gegnerfortschritts) */
  enemy?: number;
  /** Bonus für gewonnene Karte (Zug 2 stiehlt eine Karte) */
  steal?: number;
  /** Teamspiel: zusätzlicher Abzug für jede eigene oder Partnerkugel, die der Zug heimschickt (über ihren Wertverlust hinaus) */
  friendlyFire?: number;
  /** Einzelspiel: Vorausschau über Stichproben möglicher Gegnerhände (k Kandidaten, je `samples` Stichproben, Anteil `weight`) */
  lookahead?: { k: number; samples: number; weight: number };
  /** Gewicht des Schlagrisikos aus Kartenzählung (ersetzt `threat`, wenn > 0) */
  risk?: number;
}

export const LEVEL_PARAMS: Record<BotLevel, LevelParams> = {
  beginner: { random: true, noise: 0, threat: 0, cardCost: 0, teamwork: false },
  intermediate: { random: false, noise: 90, threat: 0, cardCost: 0, teamwork: false },
  advanced: { random: false, noise: 25, threat: 0.12, cardCost: 0.5, teamwork: false },
  expert: { random: false, noise: 0, threat: 0.2, cardCost: 1, teamwork: true, risk: 1.5, steal: 60, friendlyFire: 500 },
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

/** Kartenzählung: was die Gegner noch halten können (alles, was weder abgeworfen noch auf meiner Hand ist). */
export interface RiskModel {
  unseen: Map<Card, number>;
  total: number;
  hands: number[];
  ownerOf: number[];
  weight: number;
}

/** Karten, mit denen eine Kugel `d` Felder hinter einer gegnerischen Kugel erreicht (schlägt) werden kann. */
function reachCards(d: number, ringSize: number): Card[] {
  const out: Card[] = ['JOKER'];
  if (d >= 1 && d <= 7) out.push('7');
  if (d === 1 || d === 11) out.push('A');
  if (d >= 2 && d <= 6 && d !== 7) out.push(String(d) as Card);
  if (d >= 8 && d <= 10) out.push(String(d) as Card);
  if (d === 12) out.push('Q');
  if (d === 13) out.push('K');
  if (d === ringSize - 4) out.push('4'); // 4 rückwärts
  return out;
}

export function buildRisk(state: GameState, layout: Layout, player: number, weight: number): RiskModel {
  const unseen = new Map<Card, number>();
  const ranks: Card[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  for (const r of ranks) unseen.set(r, 8);
  unseen.set('JOKER', 6);
  const dec = (c: Card) => unseen.set(c, Math.max(0, unseen.get(c)! - 1));
  state.discard.forEach(dec);
  state.hands[player]!.forEach(dec);
  let total = 0;
  unseen.forEach((n) => (total += n));
  const ownerOf: number[] = [];
  layout.colorsOf.forEach((cs, q) => cs.forEach((c) => (ownerOf[c] = q)));
  return { unseen, total: Math.max(1, total), hands: state.hands.map((h) => h.length), ownerOf, weight };
}

/** Wahrscheinlichkeit, dass die Kugel `mine` im nächsten Gegnerzug geschlagen wird. */
function captureProb(pegs: Peg[], layout: Layout, mine: Peg, friendly: number[], risk: RiskModel): number {
  if (mine.pos.t !== 'ring' || mine.pos.f === mine.color * 16) return 0;
  let safe = 1;
  const hit = (cards: Card[], q: number) => {
    const h = risk.hands[q]!;
    if (h === 0) return;
    let n = 0;
    for (const c of new Set(cards)) n += risk.unseen.get(c) ?? 0;
    safe *= Math.pow(1 - Math.min(1, n / risk.total), h);
  };
  for (const o of pegs) {
    if (friendly.includes(o.color)) continue;
    const q = risk.ownerOf[o.color]!;
    if (o.pos.t === 'ring') hit(reachCards(mod(mine.pos.f - o.pos.f, layout.ringSize), layout.ringSize), q);
    else if (o.pos.t === 'home' && o.color * 16 === mine.pos.f) hit(['A', 'K', 'JOKER'], q);
  }
  return 1 - safe;
}

/** Bewertung einer Stellung aus Sicht des Spielers (höher = besser). */
export function evaluate(pegs: Peg[], layout: Layout, player: number, threatWeight: number, enemyWeight = 0.5, risk?: RiskModel): number {
  const friendly = teamColors(layout, player);
  let score = 0;
  for (const p of pegs) {
    const v = pegValue(layout, p);
    if (friendly.includes(p.color)) {
      score += v;
      if (risk && p.pos.t === 'ring' && v > 0) score -= risk.weight * v * captureProb(pegs, layout, p, friendly, risk);
      else if (threatWeight > 0 && p.pos.t === 'ring' && v > 0) score -= threatWeight * v * Math.min(2, threatCount(pegs, layout, p, friendly));
    } else {
      score -= enemyWeight * v;
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

/** Anzahl eigener Teamkugeln, die der Zug vom Brett heimschickt. */
function friendlySent(before: Peg[], after: Peg[], layout: Layout, player: number): number {
  const friendly = teamColors(layout, player);
  let n = 0;
  for (const p of after) {
    if (p.pos.t !== 'home' || !friendly.includes(p.color)) continue;
    if (before.find((q) => q.id === p.id)!.pos.t !== 'home') n++;
  }
  return n;
}

/** Einfache Gegnerstrategie für die Vorausschau. */
const LOOKAHEAD_OPPONENT: LevelParams = { random: false, noise: 0, threat: 0.12, cardCost: 0.5, teamwork: false };

/**
 * Vorausschau: für jeden Kandidaten werden mehrere mögliche Gegnerhände gezogen (aus den unbekannten Karten), der Zug
 * gespielt, die Gegner antworten mit einfacher Strategie, dann zieht der Bot seinen besten Folgezug. Mittelwert der
 * Bewertung der Stellung danach (gleiche Stichproben für alle Kandidaten).
 */
function lookaheadValues(state: GameState, layout: Layout, player: number, cands: Play[], params: LevelParams, rand: () => number): number[] {
  const la = params.lookahead!;
  const n = state.config.players;
  const full: Card[] = [];
  for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as Card[]) for (let i = 0; i < 8; i++) full.push(r);
  for (let i = 0; i < 6; i++) full.push('JOKER');
  const remove = (c: Card) => {
    const i = full.indexOf(c);
    if (i >= 0) full.splice(i, 1);
  };
  state.discard.forEach(remove);
  state.hands[player]!.forEach(remove);
  const sizes = state.hands.map((h) => h.length);
  const totals = cands.map(() => 0);
  const valueOf = (sim: GameState): number => {
    if (sim.winners) return layout.teamOf[sim.winners[0]!] === layout.teamOf[player] ? 5000 : -5000;
    if (sim.phase === 'playing' && sim.current === player && sim.hands[player]!.length > 0) {
      let best = -Infinity;
      for (const p of legalPlays(sim, player)) best = Math.max(best, evaluate(pegsAfterPlay(sim.pegs, layout, p), layout, player, params.threat, params.enemy));
      if (best > -Infinity) return best;
    }
    return evaluate(sim.pegs, layout, player, params.threat, params.enemy);
  };
  for (let s = 0; s < la.samples; s++) {
    const pool = full.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const hands: Card[][] = sizes.map((_, q) => (q === player ? state.hands[q]!.slice() : []));
    for (let q = 0; q < n; q++) if (q !== player) hands[q] = pool.splice(0, sizes[q]!);
    for (let c = 0; c < cands.length; c++) {
      const sim = structuredClone(state);
      delete sim.suits;
      delete sim.given;
      sim.hands = hands.map((h) => h.slice());
      sim.deck = pool.slice();
      let cur = sim;
      const play = cands[c]!;
      const first: Extract<Action, { t: 'play' }> = { t: 'play', player, card: play.card, moves: play.moves };
      if (play.as !== undefined) first.as = play.as;
      cur = applyAction(cur, first);
      for (let step = 0; step < 2 * n && cur.phase === 'playing' && cur.current !== player; step++) {
        cur = applyAction(cur, chooseAction(cur, cur.current, LOOKAHEAD_OPPONENT, rand));
      }
      totals[c]! += valueOf(cur);
    }
  }
  return totals.map((t) => t / la.samples);
}

/** Wählt den Zug des Bots (der Spieler muss am Zug sein und mindestens einen legalen Zug haben). */
export function chooseAction(
  state: GameState,
  player: number,
  level: BotLevel | LevelParams,
  rand: () => number,
): Extract<Action, { t: 'play' }> {
  const plays = legalPlays(state, player);
  if (plays.length === 0) throw new Error('Kein legaler Zug');
  const params = typeof level === 'string' ? LEVEL_PARAMS[level] : level;
  const layout = layoutFor(state.config);

  let best: Play = plays[Math.floor(rand() * plays.length)]!;
  if (!params.random) {
    const known = params.teamwork ? exchangeKnowledge(state, player) : {};
    const risk = params.risk && params.risk > 0 ? buildRisk(state, layout, player, params.risk) : undefined;
    const scores: number[] = [];
    for (const play of plays) {
      const after = pegsAfterPlay(state.pegs, layout, play);
      let score = evaluate(after, layout, player, params.threat, params.enemy, risk);
      if (play.moves.some((m) => m.t === 'steal')) score += params.steal ?? 25; // eine (unbekannte) Karte gewonnen
      score -= params.cardCost * cardCost(state, layout, player, play);
      if (params.friendlyFire && layout.teams) score -= params.friendlyFire * friendlySent(state.pegs, after, layout, player);
      if (known.received !== undefined && play.card === known.received) score -= RECEIVED_CARD_DELAY;
      if (known.heldBy) score += PARTNER_CARD_WEIGHT * partnerCardGain(state, layout, player, known.heldBy.partner, known.heldBy.card, after);
      score += rand() * params.noise;
      scores.push(score);
    }
    const order = plays.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!);
    best = plays[order[0]!]!;
    if (params.lookahead && !layout.teams && plays.length > 1) {
      const top = order.slice(0, params.lookahead.k);
      const look = lookaheadValues(state, layout, player, top.map((i) => plays[i]!), params, rand);
      const w = params.lookahead.weight;
      let bestScore = -Infinity;
      top.forEach((i, c) => {
        const v = (1 - w) * scores[i]! + w * look[c]!;
        if (v > bestScore) {
          bestScore = v;
          best = plays[i]!;
        }
      });
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

/**
 * Hat der Bot keine Kugel im Spiel (alle noch im Heim) und neben einem König oder Ass einen Joker, behält er die
 * Starterkarte, um selbst herauszukommen, und gibt den Joker dem Partner.
 */
function keepsStarterAndGivesJoker(state: GameState, layout: Layout, player: number, hand: Card[]): boolean {
  const mine = state.pegs.filter((p) => controlledColors(state, layout, player).includes(p.color));
  const noneInPlay = mine.some((p) => p.pos.t === 'home') && !mine.some((p) => p.pos.t === 'ring');
  return noneInPlay && hand.includes('JOKER') && (hand.includes('K') || hand.includes('A'));
}

/** Einzelspiel: Bot zieht blind eine Karte des rechten Nachbarn. */
export function chooseDraw(state: GameState, player: number, rand: () => number): Extract<Action, { t: 'draw' }> {
  const theirs = state.hands[(player + 1) % state.config.players]!;
  return { t: 'draw', player, idx: Math.floor(rand() * theirs.length) };
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
    if (helps && keepsStarterAndGivesJoker(state, layout, player, hand)) card = 'JOKER';
  }
  return { t: 'exchange', player, card };
}

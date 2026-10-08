import { allInFinish, createPegs, layoutFor, type Layout } from './board';
import { applyMoveToPegs, legalPlays, sevenValid } from './moves';
import { shuffle } from './rng';
import { RANKS, type Action, type Card, type GameConfig, type GameState, type Play } from './types';

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let suit = 0; suit < 4; suit++) deck.push(...RANKS);
    deck.push('JOKER', 'JOKER', 'JOKER');
  }
  return deck; // 110 Karten
}

/** Farben passend zu fullDeck(): je Rang vier Farben pro Satz, Joker ohne Farbe (0). */
function fullSuits(): number[] {
  const out: number[] = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let suit = 0; suit < 4; suit++) for (let r = 0; r < RANKS.length; r++) out.push(suit);
    out.push(0, 0, 0);
  }
  return out;
}

/** Ergänzt Farben bei Spielständen ohne Farbverfolgung (Rang für Rang reihum). */
export function ensureSuits(state: GameState): void {
  if (state.suits) return;
  const seen = new Map<Card, number>();
  const assign = (cards: Card[]) => cards.map((c) => {
    const n = seen.get(c) ?? 0;
    seen.set(c, n + 1);
    return c === 'JOKER' ? 0 : n % 4;
  });
  state.suits = { hands: state.hands.map(assign), deck: assign(state.deck), discard: assign(state.discard) };
}

/** Index der Karte auf der Hand; mit `suit` nur die Karte dieser Farbe. -1 = nicht vorhanden. */
export function cardIndex(state: GameState, player: number, card: Card, suit?: number): number {
  const hand = state.hands[player] ?? [];
  if (suit === undefined || card === 'JOKER' || !state.suits) return hand.indexOf(card);
  const sh = state.suits.hands[player] ?? [];
  return hand.findIndex((c, i) => c === card && sh[i] === suit);
}

/** Nimmt die Karte an Position `idx` von der Hand und gibt ihre Farbe zurück. */
function takeFromHand(state: GameState, player: number, idx: number): number {
  state.hands[player]!.splice(idx, 1);
  return state.suits?.hands[player]?.splice(idx, 1)[0] ?? 0;
}

export function createGame(config: GameConfig, seed: number): GameState {
  const layout = layoutFor(config);
  const cards = fullDeck();
  const allSuits = fullSuits();
  const [order, rng] = shuffle(cards.map((_, i) => i), seed);
  const deck = order.map((i) => cards[i]!);
  const state: GameState = {
    config,
    phase: 'playing',
    pegs: createPegs(layout),
    hands: Array.from({ length: config.players }, () => []),
    deck,
    discard: [],
    dealer: config.players - 1,
    round: -1,
    current: 0,
    exchange: Array(config.players).fill(null),
    winners: null,
    rng,
    suits: { hands: Array.from({ length: config.players }, () => []), deck: order.map((i) => allSuits[i]!), discard: [] },
  };
  startRound(state, layout);
  settle(state, layout);
  return state;
}

function startRound(state: GameState, layout: Layout): void {
  const n = state.config.players;
  state.round++;
  state.dealer = (state.dealer + 1) % n;
  const sizes = layout.rules.handSizes;
  const size = sizes[state.round % sizes.length]!;
  if (state.deck.length < n * size) {
    const pool = [...state.deck, ...state.discard];
    const poolSuits = state.suits ? [...state.suits.deck, ...state.suits.discard] : [];
    const [order, rng] = shuffle(pool.map((_, i) => i), state.rng);
    state.deck = order.map((i) => pool[i]!);
    state.discard = [];
    state.rng = rng;
    if (state.suits) {
      state.suits.deck = order.map((i) => poolSuits[i] ?? 0);
      state.suits.discard = [];
    }
  }
  for (let p = 0; p < n; p++) {
    state.hands[p] = state.deck.splice(state.deck.length - size, size);
    if (state.suits) state.suits.hands[p] = state.suits.deck.splice(state.suits.deck.length - size, size);
  }
  state.current = (state.dealer + 1) % n;
  state.exchange = Array(n).fill(null);
  state.exchangeSuit = Array(n).fill(undefined);
  state.drawPick = Array(n).fill(undefined);
  delete state.given;
  state.phase = layout.exchangeOn ? 'exchange' : 'playing';
}

/** Der Empfänger hat eine Tauschkarte gespielt (bzw. abgeworfen): sie ist nicht mehr "bekannt". Bei zwei gleichen Karten zählt die erste. */
function dropGiven(state: GameState, player: number, card: Card, suit?: number): void {
  if (!state.given) return;
  let i = state.given.findIndex((g) => g.to === player && g.card === card && (suit === undefined || g.suit === undefined || g.suit === suit));
  if (i < 0) i = state.given.findIndex((g) => g.to === player && g.card === card);
  if (i >= 0) state.given.splice(i, 1);
}

/** Überspringt Spieler ohne Karten, wirft bei Zugunfähigkeit automatisch ab und teilt neu aus. */
function settle(state: GameState, layout: Layout): void {
  const n = state.config.players;
  while (state.phase === 'playing') {
    if (state.hands.every((h) => h.length === 0)) {
      startRound(state, layout);
      continue;
    }
    const cur = state.current;
    if (state.hands[cur]!.length === 0) {
      state.current = (cur + 1) % n;
      continue;
    }
    if (legalPlays(state, cur).length === 0) {
      const dumped = state.hands[cur]!;
      (state.passed ??= []).push({ player: cur, cards: dumped.length, top: dumped[dumped.length - 1]!, suit: state.suits?.hands[cur]?.[dumped.length - 1] ?? 0 });
      if (state.given) state.given = state.given.filter((g) => g.to !== cur);
      state.discard.push(...state.hands[cur]!);
      if (state.suits) state.suits.discard.push(...(state.suits.hands[cur] ?? []));
      state.hands[cur] = [];
      if (state.suits) state.suits.hands[cur] = [];
      state.current = (cur + 1) % n;
      continue;
    }
    return;
  }
}

function findWinners(state: GameState, layout: Layout, player: number): number[] | null {
  const group = layout.teamList[layout.teamOf[player]!]!;
  const done = group.every((p) => layout.colorsOf[p]!.every((c) => allInFinish(state, c)));
  return done ? group.slice() : null;
}

const canon = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canon).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : String(v);

export function playsEqual(a: Play, b: Play): boolean {
  return canon(a) === canon(b);
}

/** Wendet eine Aktion an und liefert den neuen Zustand. Wirft bei unzulässigen Aktionen. */
export function applyAction(prev: GameState, action: Action): GameState {
  const state = structuredClone(prev);
  const layout = layoutFor(state.config);
  const n = state.config.players;

  if (state.phase === 'finished') throw new Error('Spiel ist beendet');
  state.passed = [];

  if (action.t === 'draw') {
    if (state.phase !== 'exchange') throw new Error('Kein Kartentausch aktiv');
    if (layout.teams) throw new Error('Im Teamspiel wird mit dem Partner getauscht');
    const neighbour = (action.player + 1) % n;
    const theirs = state.hands[neighbour]!;
    if (!Number.isInteger(action.idx) || action.idx < 0 || action.idx >= theirs.length) throw new Error('Karte nicht vorhanden');
    if (state.exchange[action.player] !== null) throw new Error('Karte bereits gewählt');
    state.exchange[action.player] = theirs[action.idx]!; // nur als Merker, dass der Spieler gewählt hat
    (state.drawPick ??= Array(n).fill(undefined))[action.player] = action.idx;
    if (state.exchange.every((c) => c !== null)) {
      // Alle ziehen gleichzeitig aus den Händen, wie sie ausgeteilt wurden
      const picks = state.drawPick!;
      const taken = Array.from({ length: n }, (_, p) => {
        const q = (p + 1) % n;
        return { card: state.hands[q]![picks[p]!]!, suit: state.suits?.hands[q]?.[picks[p]!] ?? 0 };
      });
      for (let q = 0; q < n; q++) takeFromHand(state, q, picks[(q - 1 + n) % n]!);
      for (let p = 0; p < n; p++) {
        state.hands[p]!.push(taken[p]!.card);
        state.suits?.hands[p]?.push(taken[p]!.suit);
      }
      state.exchange = Array(n).fill(null);
      state.exchangeSuit = Array(n).fill(undefined);
      state.drawPick = Array(n).fill(undefined);
      state.phase = 'playing';
      settle(state, layout);
    }
    return state;
  }

  if (action.t === 'exchange') {
    if (state.phase !== 'exchange') throw new Error('Kein Kartentausch aktiv');
    const hand = state.hands[action.player];
    if (!hand || cardIndex(state, action.player, action.card, action.suit) < 0) throw new Error('Karte nicht auf der Hand');
    if (state.exchange[action.player] !== null) throw new Error('Tauschkarte bereits gewählt');
    if (!layout.teams) throw new Error('Im Einzelspiel wird eine Karte gezogen');
    state.exchange[action.player] = action.card;
    (state.exchangeSuit ??= Array(n).fill(undefined))[action.player] = action.suit;
    if (state.exchange.every((c) => c !== null)) {
      const given = state.exchange as Card[];
      const givenSuit: number[] = [];
      for (let p = 0; p < n; p++) givenSuit[p] = takeFromHand(state, p, cardIndex(state, p, given[p]!, state.exchangeSuit![p]));
      for (let p = 0; p < n; p++) {
        state.hands[layout.giveTo[p]!]!.push(given[p]!);
        state.suits?.hands[layout.giveTo[p]!]?.push(givenSuit[p]!);
      }
      if (layout.teams) state.given = given.map((card, p) => ({ from: p, to: layout.giveTo[p]!, card, suit: givenSuit[p]! }));
      state.exchange = Array(n).fill(null);
      state.exchangeSuit = Array(n).fill(undefined);
      state.phase = 'playing';
      settle(state, layout);
    }
    return state;
  }

  if (state.phase !== 'playing') throw new Error('Kartentausch läuft noch');
  if (action.player !== state.current) throw new Error('Nicht am Zug');

  const handIdx = cardIndex(state, action.player, action.card, action.suit);
  if (handIdx < 0) throw new Error('Karte nicht auf der Hand');
  const play: Play = { card: action.card, moves: action.moves };
  if (action.as !== undefined) play.as = action.as;
  const asRank = action.card === 'JOKER' ? action.as : action.card;
  if (asRank === '7') {
    // 7: beliebige Reihenfolge der Teilzüge, deshalb nicht gegen die (zusammengefasste) Liste prüfen
    const handHas = state.hands[action.player]!.includes(action.card);
    if (!handHas || (action.card === 'JOKER' && action.as !== '7') || !sevenValid(state.pegs, layout, action.player, action.moves, action.card === 'JOKER')) {
      throw new Error('Unzulässiger Spielzug');
    }
  } else if (!legalPlays(state, action.player).some((p) => playsEqual(p, play))) throw new Error('Unzulässiger Spielzug');

  const hand = state.hands[action.player]!;
  const playedSuit = takeFromHand(state, action.player, handIdx);
  state.discard.push(action.card);
  state.suits?.discard.push(playedSuit);
  dropGiven(state, action.player, action.card, playedSuit);

  const rank = action.card === 'JOKER' ? action.as : action.card;
  for (const m of action.moves) {
    if (m.t === 'steal') {
      const from = state.hands[m.from]!;
      hand.push(...from.splice(m.idx, 1));
      if (state.suits) (state.suits.hands[action.player] ??= []).push(...(state.suits.hands[m.from]?.splice(m.idx, 1) ?? [0]));
    } else {
      state.pegs = applyMoveToPegs(state.pegs, layout, m, rank === '7')!;
    }
  }

  const winners = findWinners(state, layout, action.player);
  if (winners) {
    state.winners = winners;
    state.phase = 'finished';
    return state;
  }
  state.current = (action.player + 1) % n;
  settle(state, layout);
  return state;
}

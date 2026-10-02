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

export function createGame(config: GameConfig, seed: number): GameState {
  const layout = layoutFor(config);
  const [deck, rng] = shuffle(fullDeck(), seed);
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
    const [deck, rng] = shuffle([...state.deck, ...state.discard], state.rng);
    state.deck = deck;
    state.discard = [];
    state.rng = rng;
  }
  for (let p = 0; p < n; p++) state.hands[p] = state.deck.splice(state.deck.length - size, size);
  state.current = (state.dealer + 1) % n;
  state.exchange = Array(n).fill(null);
  state.phase = layout.exchangeOn ? 'exchange' : 'playing';
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
      (state.passed ??= []).push({ player: cur, cards: state.hands[cur]!.length });
      state.discard.push(...state.hands[cur]!);
      state.hands[cur] = [];
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

  if (action.t === 'exchange') {
    if (state.phase !== 'exchange') throw new Error('Kein Kartentausch aktiv');
    const hand = state.hands[action.player];
    if (!hand || !hand.includes(action.card)) throw new Error('Karte nicht auf der Hand');
    if (state.exchange[action.player] !== null) throw new Error('Tauschkarte bereits gewählt');
    state.exchange[action.player] = action.card;
    if (state.exchange.every((c) => c !== null)) {
      const given = state.exchange as Card[];
      for (let p = 0; p < n; p++) {
        const h = state.hands[p]!;
        h.splice(h.indexOf(given[p]!), 1);
      }
      for (let p = 0; p < n; p++) state.hands[layout.giveTo[p]!]!.push(given[p]!);
      state.exchange = Array(n).fill(null);
      state.phase = 'playing';
      settle(state, layout);
    }
    return state;
  }

  if (state.phase !== 'playing') throw new Error('Kartentausch läuft noch');
  if (action.player !== state.current) throw new Error('Nicht am Zug');

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
  hand.splice(hand.indexOf(action.card), 1);
  state.discard.push(action.card);

  const rank = action.card === 'JOKER' ? action.as : action.card;
  for (const m of action.moves) {
    if (m.t === 'steal') {
      const from = state.hands[m.from]!;
      hand.push(...from.splice(m.idx, 1));
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

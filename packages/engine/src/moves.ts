import {
  FINISH_SLOTS,
  type Layout,
  controlledColors,
  isBlocker,
  layoutFor,
  mod,
  progress,
  startField,
} from './board';
import { RANKS, type GameState, type Move, type Peg, type Play, type Rank } from './types';

const clonePegs = (pegs: Peg[]): Peg[] => pegs.map((p) => ({ ...p, pos: { ...p.pos } }));

export const pegsKey = (pegs: Peg[]): string =>
  pegs.map((p) => (p.pos.t === 'home' ? 'h' : p.pos.t === 'ring' ? `r${p.pos.f}` : `f${p.pos.s}`)).join(',');

function ringPegAt(pegs: Peg[], f: number): Peg | undefined {
  return pegs.find((p) => p.pos.t === 'ring' && p.pos.f === f);
}

/**
 * Bewegt eine Kugel um `steps` (negativ = rückwärts). Liefert die neue Kugelliste oder null, wenn illegal.
 * Blockierende Kugeln (auf eigenem Startfeld) dürfen weder übersprungen noch geschlagen werden.
 * Am Ziel stehende Kugeln werden heimgeschickt; bei `capturePassed` (7er) auch alle übersprungenen.
 */
export function tryMove(
  pegs: Peg[],
  layout: Layout,
  pegId: number,
  steps: number,
  capturePassed: boolean,
): Peg[] | null {
  const peg = pegs.find((p) => p.id === pegId);
  if (!peg || peg.pos.t === 'home' || steps === 0) return null;
  const R = layout.ringSize;
  const crossed: number[] = [];
  let dest: Peg['pos'];

  const finFree = (slot: number) => !pegs.some((p) => p.color === peg.color && p.pos.t === 'fin' && p.pos.s === slot);
  const ringOk = (f: number) => {
    const o = ringPegAt(pegs, f);
    return !(o && o.id !== peg.id && isBlocker(o));
  };

  if (steps < 0) {
    if (peg.pos.t !== 'ring') return null;
    let f = peg.pos.f;
    for (let i = 0; i < -steps; i++) {
      f = mod(f - 1, R);
      if (!ringOk(f)) return null;
      crossed.push(f);
    }
    dest = { t: 'ring', f };
  } else if (peg.pos.t === 'ring') {
    const prog = progress(layout, peg);
    dest = peg.pos;
    for (let i = 1; i <= steps; i++) {
      const q = prog + i;
      if (q <= R - 1) {
        const f = mod(startField(peg.color) + q, R);
        if (!ringOk(f)) return null;
        crossed.push(f);
        dest = { t: 'ring', f };
      } else {
        const slot = q - R;
        if (slot >= FINISH_SLOTS || !finFree(slot)) return null;
        dest = { t: 'fin', s: slot };
      }
    }
  } else {
    let slot = peg.pos.s;
    for (let i = 1; i <= steps; i++) {
      slot++;
      if (slot >= FINISH_SLOTS || !finFree(slot)) return null;
    }
    dest = { t: 'fin', s: slot };
  }

  const next = clonePegs(pegs);
  const friendly = layout.friendlyColors[peg.color]!;
  let illegal = false;
  const send = (f: number) => {
    const o = ringPegAt(next, f);
    if (!o || o.id === pegId) return;
    if (!layout.rules.captureOwn && friendly.includes(o.color)) illegal = true;
    o.pos = { t: 'home' };
  };
  if (capturePassed) crossed.forEach(send);
  else if (dest.t === 'ring') send(dest.f);
  if (illegal) return null;
  next.find((p) => p.id === pegId)!.pos = dest;
  return next;
}

export function tryStart(pegs: Peg[], layout: Layout, pegId: number): Peg[] | null {
  const peg = pegs.find((p) => p.id === pegId);
  if (!peg || peg.pos.t !== 'home') return null;
  const f = startField(peg.color);
  const occ = ringPegAt(pegs, f);
  if (occ && occ.color === peg.color) return null;
  if (occ && !layout.rules.captureOwn && layout.friendlyColors[peg.color]!.includes(occ.color)) return null;
  const next = clonePegs(pegs);
  if (occ) next.find((p) => p.id === occ.id)!.pos = { t: 'home' };
  next.find((p) => p.id === pegId)!.pos = { t: 'ring', f };
  return next;
}

export function trySwap(pegs: Peg[], a: number, b: number): Peg[] | null {
  const pa = pegs.find((p) => p.id === a);
  const pb = pegs.find((p) => p.id === b);
  if (!pa || !pb || pa.id === pb.id) return null;
  if (pa.pos.t !== 'ring' || pb.pos.t !== 'ring') return null;
  if (isBlocker(pa) || isBlocker(pb)) return null;
  const next = clonePegs(pegs);
  next.find((p) => p.id === a)!.pos = { ...pb.pos };
  next.find((p) => p.id === b)!.pos = { ...pa.pos };
  return next;
}

/** Wendet einen einzelnen Zug auf die Kugeln an (null = illegal). Steal betrifft nur Hände, nicht Kugeln. */
export function applyMoveToPegs(pegs: Peg[], layout: Layout, m: Move, isSeven: boolean): Peg[] | null {
  switch (m.t) {
    case 'start':
      return tryStart(pegs, layout, m.peg);
    case 'move':
      return tryMove(pegs, layout, m.peg, m.steps, isSeven);
    case 'swap':
      return trySwap(pegs, m.a, m.b);
    case 'steal':
      return pegs;
  }
}

/**
 * Alle Aufteilungen der 7; die Reihenfolge zählt (wegen Schlagen). Ohne `sevenRepeatPeg` kommt jede Kugel
 * höchstens einmal vor. Zugfolgen mit gleichem Endzustand werden nur einmal geliefert.
 */
function sevenPlays(pegs: Peg[], layout: Layout, mine: number[]): Move[][] {
  const results: Move[][] = [];
  const leafSeen = new Set<string>();
  const repeat = layout.rules.sevenRepeatPeg;
  const visited = new Set<string>();
  const dfs = (cur: Peg[], remaining: number, seq: Move[], used: number[]) => {
    const vk = `${remaining}|${repeat ? '' : used.join('.')}|${pegsKey(cur)}`;
    if (visited.has(vk)) return;
    visited.add(vk);
    for (const id of mine) {
      if (!repeat && used.includes(id)) continue;
      for (let k = remaining; k >= 1; k--) {
        const np = tryMove(cur, layout, id, k, true);
        if (!np) continue;
        const move: Move = { t: 'move', peg: id, steps: k };
        if (k === remaining) {
          const lk = pegsKey(np);
          if (!leafSeen.has(lk)) {
            leafSeen.add(lk);
            results.push([...seq, move]);
          }
        } else {
          dfs(np, remaining - k, [...seq, move], [...used, id]);
        }
      }
    }
  };
  dfs(pegs, 7, [], []);
  return results;
}

function movesForRank(state: GameState, layout: Layout, player: number, rank: Rank): Move[][] {
  const colors = controlledColors(state, layout, player);
  const mine = state.pegs.filter((p) => colors.includes(p.color));
  const out: Move[][] = [];
  const forward = (n: number) => {
    for (const p of mine) if (tryMove(state.pegs, layout, p.id, n, false)) out.push([{ t: 'move', peg: p.id, steps: n }]);
  };
  const start = () => {
    for (const c of colors) {
      const home = mine.find((p) => p.color === c && p.pos.t === 'home');
      if (home && tryStart(state.pegs, layout, home.id)) out.push([{ t: 'start', peg: home.id }]);
    }
  };
  switch (rank) {
    case 'A':
      start();
      forward(1);
      forward(11);
      break;
    case 'K':
      start();
      forward(13);
      break;
    case 'Q':
      forward(12);
      break;
    case '4':
      for (const p of mine) if (tryMove(state.pegs, layout, p.id, -4, false)) out.push([{ t: 'move', peg: p.id, steps: -4 }]);
      break;
    case '7':
      out.push(...sevenPlays(state.pegs, layout, mine.map((p) => p.id)));
      break;
    case 'J':
      if (layout.teams) {
        for (const a of mine) {
          for (const b of state.pegs) {
            if (b.id === a.id) continue;
            if (mine.includes(b) && b.id < a.id) continue; // Paar nur einmal
            if (mine.includes(b) && !layout.rules.jackSwapOwn) continue;
            if (!mine.includes(b) && !layout.rules.jackSwapPartner && layout.friendlyColors[a.color]!.includes(b.color)) continue;
            if (trySwap(state.pegs, a.id, b.id)) out.push([{ t: 'swap', a: a.id, b: b.id }]);
          }
        }
      } else {
        state.hands.forEach((h, q) => {
          if (q === player) return;
          for (let idx = 0; idx < h.length; idx++) out.push([{ t: 'steal', from: q, idx }]);
        });
        if (out.length === 0 && layout.rules.jackStealNoCards === 'void') out.push([]);
      }
      break;
    default:
      forward(Number(rank));
  }
  return out;
}

/** Alle regelkonformen Spielzüge (eine Karte) des Spielers im aktuellen Zustand. */
export function legalPlays(state: GameState, player: number): Play[] {
  const layout = layoutFor(state.config);
  const plays: Play[] = [];
  for (const card of new Set(state.hands[player])) {
    if (card === 'JOKER') {
      for (const rank of RANKS) for (const moves of movesForRank(state, layout, player, rank)) plays.push({ card, as: rank, moves });
    } else {
      for (const moves of movesForRank(state, layout, player, card)) plays.push({ card, moves });
    }
  }
  return plays;
}

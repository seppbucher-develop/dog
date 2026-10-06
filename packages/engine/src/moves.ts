import {
  FINISH_SLOTS,
  type Layout,
  allInFinish,
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
  pegs.map((p) => (p.pos.t === 'home' ? 'h' : p.pos.t === 'ring' ? `r${p.pos.f}${p.pos.lap ? 'l' : ''}` : `f${p.pos.s}`)).join(',');

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
  pass = false,
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

  if (pass && (steps < 0 || peg.pos.t !== 'ring')) return null;
  if (steps < 0) {
    if (peg.pos.t !== 'ring') return null;
    const k = mod(peg.pos.f - startField(peg.color), R);
    const keepLap = peg.pos.lap === true && k > 0 && k >= -steps;
    let f = peg.pos.f;
    for (let i = 0; i < -steps; i++) {
      f = mod(f - 1, R);
      if (!ringOk(f)) return null;
      crossed.push(f);
    }
    // Rückwärts genau auf das eigene Startfeld: die Kugel ist wieder bereit fürs Zielhaus
    dest = keepLap || (k > 0 && k === -steps) ? { t: 'ring', f, lap: true } : { t: 'ring', f };
  } else if (peg.pos.t === 'ring') {
    const sf = startField(peg.color);
    // Schritte bis zum eigenen Startfeld (Einfahrt ins Zielhaus): 0 = steht schon darauf (Runde vollendet)
    const toStart = peg.pos.lap ? mod(sf - peg.pos.f, R) : R - mod(peg.pos.f - sf, R);
    const beyond = steps - toStart;
    if (pass && (beyond <= 0 || beyond >= R)) return null; // "am Haus vorbei" gibt es nur hinter dem Startfeld
    const ringSteps = beyond > 0 && !pass ? toStart : steps;
    let f = peg.pos.f;
    for (let i = 1; i <= ringSteps; i++) {
      f = mod(f + 1, R);
      if (!ringOk(f)) return null;
      crossed.push(f);
    }
    if (beyond > 0 && !pass) {
      const slot = beyond - 1;
      for (let i = 0; i <= slot; i++) if (i >= FINISH_SLOTS || !finFree(i)) return null;
      dest = { t: 'fin', s: slot };
    } else {
      dest = peg.pos.lap || ringSteps >= toStart ? { t: 'ring', f, lap: true } : { t: 'ring', f };
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
      return tryMove(pegs, layout, m.peg, m.steps, isSeven, m.pass === true);
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
/** Kugelstellung nach einem (als legal vorausgesetzten) Spielzug; Kartenwechsel durch Steal bleibt außen vor. */
export function pegsAfterPlay(pegs: Peg[], layout: Layout, play: Play): Peg[] {
  const rank = play.card === 'JOKER' ? play.as : play.card;
  let cur = pegs;
  for (const m of play.moves) {
    const next = applyMoveToPegs(cur, layout, m, rank === '7');
    if (!next) throw new Error('Unzulässiger Spielzug');
    cur = next;
  }
  return cur;
}

/**
 * Obergrenzen bei der 7, damit eine volle Brettbelegung bei `sevenAnyPeg` nicht ewig rechnet: untersuchte
 * Stellungen und gelieferte Spielzüge. Greifen erst bei sehr vielen Kugeln auf dem Brett (ca. 12 und mehr).
 */
const SEVEN_MAX_STATES = 60_000;
const SEVEN_MAX_PLAYS = 30_000;

function sevenPlays(pegs: Peg[], layout: Layout, player: number): Move[][] {
  const results: Move[][] = [];
  const leafSeen = new Set<string>();
  // Bei fremden Kugeln wäre der Aufwand ohne Zusammenfassen gleicher Stellungen enorm; das Ergebnis ändert sich praktisch nie.
  const repeat = layout.rules.sevenRepeatPeg || layout.sevenAny;
  const visited = new Set<string>();
  const dfs = (cur: Peg[], remaining: number, seq: Move[], used: number[]) => {
    const vk = `${remaining}|${repeat ? '' : used.join('.')}|${pegsKey(cur)}`;
    if (visited.has(vk) || visited.size >= SEVEN_MAX_STATES || results.length >= SEVEN_MAX_PLAYS) return;
    visited.add(vk);
    // Sind die eigenen Kugeln im Haus, darf mit dem Rest der 7 der Partner ziehen: Berechtigung je Zwischenstand
    for (const id of sevenPegIds(cur, layout, player)) {
      if (!repeat && used.includes(id)) continue;
      for (let k = remaining; k >= 1; k--) {
        for (const pass of [false, true]) {
          const np = tryMove(cur, layout, id, k, true, pass);
          if (!np) continue;
          const move: Move = pass ? { t: 'move', peg: id, steps: k, pass: true } : { t: 'move', peg: id, steps: k };
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
    }
  };
  dfs(pegs, 7, [], []);
  return results;
}

/** Kugeln, mit denen eine 7 gespielt werden darf (eigene bzw. die des Partners, bei `sevenAnyPeg` alle auf dem Brett). */
export function sevenPegIds(pegs: Peg[], layout: Layout, player: number): number[] {
  const colors = controlledColors({ pegs } as GameState, layout, player);
  return pegs
    .filter((p) => (layout.sevenAny ? p.pos.t !== 'home' : colors.includes(p.color)))
    .map((p) => p.id);
}

/**
 * Teilzüge der 7: Aus der Stellung nach `prefix` die nächsten möglichen Teilzüge (Kugel + Schritte), aus denen
 * sich die 7 noch vollständig verteilen lässt. `remaining` = noch zu verteilende Schritte (0 = fertig).
 * Die Reihenfolge der Teilzüge ist frei; `joker` = als Joker gespielt (damit darf keine Farbe fertig werden).
 */
export function sevenNext(
  pegs: Peg[],
  layout: Layout,
  player: number,
  prefix: Move[],
  joker = false,
): { remaining: number; next: Move[]; pegs: Peg[] | null } {
  const repeat = layout.rules.sevenRepeatPeg || layout.sevenAny;
  let cur = pegs;
  let remaining = 7;
  const used: number[] = [];
  for (const m of prefix) {
    if (m.t !== 'move' || m.steps < 1 || m.steps > remaining || !sevenPegIds(cur, layout, player).includes(m.peg) || (!repeat && used.includes(m.peg))) return { remaining, next: [], pegs: null };
    const np = tryMove(cur, layout, m.peg, m.steps, true, m.pass === true);
    if (!np) return { remaining, next: [], pegs: null };
    cur = np;
    remaining -= m.steps;
    used.push(m.peg);
  }
  const leafOk = (ps: Peg[]) => sevenLeafOk(pegs, ps, layout, player, joker);
  const memo = new Map<string, boolean>();
  let budget = 200_000;
  const canFinish = (ps: Peg[], rem: number, usedIds: number[]): boolean => {
    if (rem === 0) return leafOk(ps);
    const key = `${rem}|${repeat ? '' : usedIds.join('.')}|${pegsKey(ps)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    if (budget-- > 0) {
      outer: for (const id of sevenPegIds(ps, layout, player)) {
        if (!repeat && usedIds.includes(id)) continue;
        for (let k = rem; k >= 1; k--) {
          for (const pass of [false, true]) {
            const np = tryMove(ps, layout, id, k, true, pass);
            if (np && canFinish(np, rem - k, [...usedIds, id])) {
              ok = true;
              break outer;
            }
          }
        }
      }
    }
    memo.set(key, ok);
    return ok;
  };
  const next: Move[] = [];
  if (remaining > 0) {
    for (const id of sevenPegIds(cur, layout, player)) {
      if (!repeat && used.includes(id)) continue;
      for (let k = 1; k <= remaining; k++) {
        for (const pass of [false, true]) {
          const np = tryMove(cur, layout, id, k, true, pass);
          if (np && canFinish(np, remaining - k, [...used, id])) next.push(pass ? { t: 'move', peg: id, steps: k, pass: true } : { t: 'move', peg: id, steps: k });
        }
      }
    }
  }
  return { remaining, next, pegs: cur };
}

/** Ist die Teilzugfolge eine vollständig verteilte, regelkonforme 7? */
export function sevenValid(pegs: Peg[], layout: Layout, player: number, moves: Move[], joker = false): boolean {
  if (moves.length === 0) return false;
  const r = sevenNext(pegs, layout, player, moves, joker);
  if (r.pegs === null || r.remaining !== 0) return false;
  return sevenLeafOk(pegs, r.pegs, layout, player, joker);
}

/** Joker-7: keine Farbe darf damit fertig werden (auch nicht die des Partners, dessen Kugeln nach den eigenen ziehen dürfen). */
function sevenLeafOk(before: Peg[], after: Peg[], layout: Layout, player: number, joker: boolean): boolean {
  if (!joker) return true;
  const colors = [...new Set([...controlledColors({ pegs: before } as GameState, layout, player), ...controlledColors({ pegs: after } as GameState, layout, player)])];
  return !colors.some((c) => !before.filter((p) => p.color === c).every((p) => p.pos.t === 'fin') && after.filter((p) => p.color === c).every((p) => p.pos.t === 'fin'));
}

function movesForRank(state: GameState, layout: Layout, player: number, rank: Rank): Move[][] {
  const colors = controlledColors(state, layout, player);
  const mine = state.pegs.filter((p) => colors.includes(p.color));
  // 7: wahlweise auf alle Kugeln auf dem Brett aufteilbar
  const out: Move[][] = [];
  const forward = (n: number) => {
    for (const p of mine) {
      if (tryMove(state.pegs, layout, p.id, n, false)) out.push([{ t: 'move', peg: p.id, steps: n }]);
      if (tryMove(state.pegs, layout, p.id, n, false, true)) out.push([{ t: 'move', peg: p.id, steps: n, pass: true }]);
    }
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
      if (layout.rules.fourDirection === 'both') forward(4);
      for (const p of mine) if (tryMove(state.pegs, layout, p.id, -4, false)) out.push([{ t: 'move', peg: p.id, steps: -4 }]);
      break;
    case '7':
      for (const m of sevenPlays(state.pegs, layout, player)) out.push(m);
      break;
    case 'J':
      // Der Bube dient immer nur zum Tauschen zweier Kugeln
      for (const a of mine) {
        for (const b of state.pegs) {
          if (b.id === a.id) continue;
          if (mine.includes(b) && b.id < a.id) continue; // Paar nur einmal
          if (mine.includes(b) && !layout.rules.jackSwapOwn) continue;
          if (!mine.includes(b) && !layout.rules.jackSwapPartner && layout.friendlyColors[a.color]!.includes(b.color)) continue;
          if (trySwap(state.pegs, a.id, b.id)) out.push([{ t: 'swap', a: a.id, b: b.id }]);
        }
      }
      break;
    case '2':
      forward(2);
      // Einzelspiel (2, 3, 5 Spieler): statt 2 zu fahren darf man blind eine Karte eines Gegners ziehen (zählt als Zug)
      if (!layout.teams) {
        state.hands.forEach((h, q) => {
          if (q === player) return;
          for (let idx = 0; idx < h.length; idx++) out.push([{ t: 'steal', from: q, idx }]);
        });
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
  const colors = controlledColors(state, layout, player);
  const unfinished = colors.filter((c) => !allInFinish(state, c));
  for (const card of new Set(state.hands[player])) {
    if (card === 'JOKER') {
      for (const rank of RANKS) {
        for (const moves of movesForRank(state, layout, player, rank)) {
          // Die letzte Kugel darf nicht mit einem Joker ins Haus gebracht werden
          if (unfinished.length > 0 && moves.length > 0) {
            const after = pegsAfterPlay(state.pegs, layout, { card, as: rank, moves });
            const done = (c: number) => after.filter((p) => p.color === c).every((p) => p.pos.t === 'fin');
            if (unfinished.some(done)) continue;
          }
          plays.push({ card, as: rank, moves });
        }
      }
    } else {
      for (const moves of movesForRank(state, layout, player, card)) plays.push({ card, moves });
    }
  }
  return plays;
}

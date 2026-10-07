import { DEFAULT_RULES, type GameConfig, type GameState, type Peg, type RuleSettings } from './types';

export const SEGMENT = 16;
export const PEGS_PER_COLOR = 4;
export const FINISH_SLOTS = 4;
export const DECK_SIZE = 110;

export function resolveRules(config: GameConfig): RuleSettings {
  const r: RuleSettings = { ...DEFAULT_RULES, ...config.rules };
  const oneOf = <T extends string>(name: string, v: T, allowed: T[]) => {
    if (!allowed.includes(v)) throw new Error(`Ungültige Regel ${name}: ${String(v)}`);
  };
  oneOf('twoPlayerBoard', r.twoPlayerBoard, ['compact', 'full']);
  oneOf('sixPlayerTeams', r.sixPlayerTeams, ['threeOfTwo', 'twoOfThree']);
  oneOf('cardExchange', r.cardExchange, ['auto', 'on', 'off']);
  oneOf('firstPegOnStart', r.firstPegOnStart, ['auto', 'on', 'off']);
  oneOf('fourDirection', r.fourDirection, ['backward', 'both']);
  oneOf('sevenAnyPeg', r.sevenAnyPeg, ['auto', 'on', 'off']);
  for (const k of ['sevenRepeatPeg', 'jackSwapPartner', 'jackSwapOwn', 'captureOwn'] as const) {
    if (typeof r[k] !== 'boolean') throw new Error(`Ungültige Regel ${k}`);
  }
  if (!Array.isArray(r.handSizes) || r.handSizes.length === 0 || !r.handSizes.every((n) => Number.isInteger(n) && n >= 1)) {
    throw new Error('Ungültige Regel handSizes');
  }
  if (!Number.isInteger(r.turnSpeed) || r.turnSpeed < 1 || r.turnSpeed > 5) throw new Error('Ungültige Regel turnSpeed');
  if (config.players * Math.max(...r.handSizes) > DECK_SIZE) throw new Error('handSizes: zu viele Karten für diese Spielerzahl');
  return r;
}

export interface Layout {
  /** Anzahl Brettabschnitte (Farben, auch unbenutzte) */
  colors: number;
  ringSize: number;
  teams: boolean;
  rules: RuleSettings;
  /** Farben je Spieler */
  colorsOf: number[][];
  /** Benutzte Farben (haben Kugeln) */
  usedColors: number[];
  /** Teams als Spielerlisten (im Einzelspiel: jeder Spieler ein eigenes "Team") */
  teamList: number[][];
  teamOf: number[];
  /** An wen ein Spieler beim Kartentausch eine Karte gibt */
  giveTo: number[];
  exchangeOn: boolean;
  /** Erste Kugel jeder Farbe beginnt auf dem Startfeld */
  startPegOut: boolean;
  /** 7 darf auf alle Kugeln auf dem Brett aufgeteilt werden */
  sevenAny: boolean;
  /** Je Farbe: alle Farben des Teams (eigene inklusive) */
  friendlyColors: number[][];
}

export function layoutFor(config: GameConfig): Layout {
  const n = config.players;
  if (!Number.isInteger(n) || n < 2 || n > 6) throw new Error('2 bis 6 Spieler');
  const rules = resolveRules(config);
  const teams = n === 4 || n === 6;

  let colors = n;
  const colorsOf: number[][] = [];
  if (n === 2 && config.eightPegs) {
    colors = 4;
    colorsOf.push([0, 2], [1, 3]);
  } else if (n === 2 && rules.twoPlayerBoard === 'full') {
    colors = 4;
    colorsOf.push([0], [2]);
  } else {
    for (let p = 0; p < n; p++) colorsOf.push([p]);
  }

  let teamList: number[][];
  if (n === 4) teamList = [[0, 2], [1, 3]];
  else if (n === 6) teamList = rules.sixPlayerTeams === 'twoOfThree' ? [[0, 2, 4], [1, 3, 5]] : [[0, 3], [1, 4], [2, 5]];
  else teamList = colorsOf.map((_, p) => [p]);
  const teamOf: number[] = [];
  teamList.forEach((t, i) => t.forEach((p) => (teamOf[p] = i)));

  const giveTo = colorsOf.map((_, p) => {
    if (!teams) return (p + 1) % n;
    const t = teamList[teamOf[p]!]!;
    return t[(t.indexOf(p) + 1) % t.length]!;
  });
  const friendlyColors: number[][] = [];
  colorsOf.forEach((cs, p) => {
    const friendly = teamList[teamOf[p]!]!.flatMap((q) => colorsOf[q]!);
    cs.forEach((c) => (friendlyColors[c] = friendly));
  });

  return {
    colors,
    ringSize: colors * SEGMENT,
    teams,
    rules,
    colorsOf,
    usedColors: colorsOf.flat().sort((a, b) => a - b),
    teamList,
    teamOf,
    giveTo,
    exchangeOn: rules.cardExchange === 'on' || (rules.cardExchange === 'auto' && teams),
    startPegOut: rules.firstPegOnStart === 'on' || (rules.firstPegOnStart === 'auto' && !teams),
    sevenAny: rules.sevenAnyPeg === 'on' || (rules.sevenAnyPeg === 'auto' && !teams),
    friendlyColors,
  };
}

export const mod = (a: number, m: number) => ((a % m) + m) % m;
export const startField = (color: number) => color * SEGMENT;

export function createPegs(layout: Layout): Peg[] {
  const pegs: Peg[] = [];
  for (const c of layout.usedColors) {
    for (let i = 0; i < PEGS_PER_COLOR; i++) {
      const out = i === 0 && layout.startPegOut;
      pegs.push({ id: c * PEGS_PER_COLOR + i, color: c, pos: out ? { t: 'ring', f: startField(c) } : { t: 'home' } });
    }
  }
  return pegs;
}

/**
 * Schritte seit dem eigenen Startfeld für eine Kugel auf dem Ring: 0..ringSize-1, nach vollendeter Runde
 * (wieder auf dem Startfeld, `lap`) genau ringSize. Das Zielhaus beginnt hinter dem Startfeld.
 */
export function progress(layout: Layout, peg: Peg): number {
  if (peg.pos.t !== 'ring') throw new Error('Kugel nicht auf dem Ring');
  if (peg.pos.lap) return layout.ringSize;
  return mod(peg.pos.f - startField(peg.color), layout.ringSize);
}

/** Kugel steht auf dem eigenen Startfeld und blockiert damit das Überspringen. */
export function isBlocker(peg: Peg): boolean {
  return peg.pos.t === 'ring' && peg.pos.f === startField(peg.color);
}

export function pegAt(state: GameState, f: number): Peg | undefined {
  return state.pegs.find((p) => p.pos.t === 'ring' && p.pos.f === f);
}

export function allInFinish(state: GameState, color: number): boolean {
  return state.pegs.filter((p) => p.color === color).every((p) => p.pos.t === 'fin');
}

/**
 * Farben, die der Spieler gerade bewegen darf. Ist er selbst fertig (nur Teamspiel), spielt er zusätzlich
 * für den nächsten Teamkollegen (in Spielrichtung, gegen den Uhrzeigersinn), der noch nicht fertig ist.
 */
export function controlledColors(state: GameState, layout: Layout, player: number): number[] {
  const own = layout.colorsOf[player]!;
  if (!layout.teams || !own.every((c) => allInFinish(state, c))) return own;
  const team = layout.teamList[layout.teamOf[player]!]!;
  const at = team.indexOf(player);
  for (let i = 1; i < team.length; i++) {
    const cs = layout.colorsOf[team[(at + i) % team.length]!]!;
    if (!cs.every((c) => allInFinish(state, c))) return [...own, ...cs];
  }
  return own;
}

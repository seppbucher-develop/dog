import { applyAction, createGame, layoutFor, startField, type Card, type GameConfig, type GameState, type Pos } from '../src';

/** Spiel mit leerem Brett; `setup` platziert Kugeln, `hands` setzt Handkarten. */
export function scenario(
  config: GameConfig,
  opts: { pegs?: Record<number, Pos>; hands?: Card[][]; current?: number } = {},
): GameState {
  const s = createGame(config, 1);
  s.phase = 'playing';
  for (const p of s.pegs) p.pos = { t: 'home' }; // leeres Brett, unabhängig von firstPegOnStart
  for (const [id, pos] of Object.entries(opts.pegs ?? {})) s.pegs.find((p) => p.id === Number(id))!.pos = pos;
  if (opts.hands) s.hands = opts.hands.map((h) => h.slice());
  s.current = opts.current ?? 0;
  return s;
}

export const ring = (f: number): Pos => ({ t: 'ring', f });
export const fin = (s: number): Pos => ({ t: 'fin', s });
export const start = (color: number) => startField(color);
export const peg = (color: number, i: number) => color * 4 + i;
export { layoutFor };

/** Alle Spieler erledigen den Kartentausch: Team = erste Karte an den Partner, sonst blind die erste Karte des rechten Nachbarn. */
export function exchangeAll(s: GameState): GameState {
  const n = s.config.players;
  const teams = layoutFor(s.config).teams;
  for (let p = 0; p < n; p++) s = applyAction(s, teams ? { t: 'exchange', player: p, card: s.hands[p]![0]! } : { t: 'draw', player: p, idx: 0 });
  return s;
}

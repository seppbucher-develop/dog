/** Zeiten (ms) der Kartenanimation je Zuggeschwindigkeit 1 (schnell) bis 5 (langsam). Client und Server rechnen damit. */
export interface Timing {
  /** Flug der Karte zum Ablagestapel */
  flight: number;
  /** Dauer, in der die Kugeln zum Ziel laufen */
  peg: number;
  /** Kugeln erst nach dem Kartenflug bewegen (ab Stufe 2); sonst gleichzeitig */
  sequential: boolean;
}

const FLIGHT = [400, 550, 750, 950, 1200];
const PEG = [450, 550, 700, 850, 1000];

export function timing(speed: number): Timing {
  const i = Math.min(5, Math.max(1, Math.round(speed))) - 1;
  return { flight: FLIGHT[i]!, peg: PEG[i]!, sequential: i > 0 };
}

/** Versatz zwischen mehreren fliegenden Karten und Pausen zwischen den Schritten (ms) */
export const ANIM = {
  /** Abstand der Karten eines Abwurfs und des Mischens */
  stagger: 90,
  /** Pause nach einem Schritt (Abwurf, Mischen, Austeilen) */
  pause: 120,
  /** Rückseiten, die je Spieler beim Austeilen fliegen */
  dealCards: 3,
  /** Abstand zwischen den Spielern beim Austeilen */
  dealSeat: 70,
  /** Abstand der Karten eines Spielers beim Austeilen */
  dealCard: 60,
} as const;

/** Was eine Aktion auf dem Tisch bewegt hat (für die Dauer der Animation) */
export interface AnimEvents {
  /** Karte gespielt */
  play?: boolean;
  /** Kugeln haben sich bewegt */
  pegsMove?: boolean;
  /** Anzahl übergebener Karten (Tausch, Ziehen, 2) */
  transfers?: number;
  /** Kartenzahl je automatischem Abwurf */
  dumps?: number[];
  /** Neue Runde ausgeteilt (Zahl der Spieler) */
  deal?: number;
  /** Ablagestapel dabei neu gemischt */
  reshuffle?: boolean;
}

/** Obergrenze für die Dauer, die der Client für diese Ereignisse braucht (siehe planTransition im Client). */
export function animationMs(speed: number, e: AnimEvents): number {
  const tm = timing(speed);
  let t = 0;
  if (e.play) t += tm.sequential ? tm.flight + (e.pegsMove ? tm.peg : 0) : Math.max(tm.flight, e.pegsMove ? tm.peg : 0);
  if ((e.transfers ?? 0) > 0) t += tm.flight * 2;
  for (const cards of e.dumps ?? []) t += tm.flight + Math.max(0, cards - 1) * ANIM.stagger + ANIM.pause;
  if (e.reshuffle) t += tm.flight + (ANIM.dealCards - 1) * ANIM.stagger + ANIM.pause;
  if (e.deal) t += tm.flight + Math.max(0, e.deal - 1) * ANIM.dealSeat + (ANIM.dealCards - 1) * ANIM.dealCard + ANIM.pause;
  return t;
}

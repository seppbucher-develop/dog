/** Zeiten (ms) der Kartenanimation je Zuggeschwindigkeit 1 (schnell) bis 5 (langsam). */
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

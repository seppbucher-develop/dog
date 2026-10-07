import type { Card } from '@dog/engine';

/** Kartenfarben: Herz, Kreuz, Ecke (Karo), Schaufel (Pik). Rein optisch – die Regeln kennen keine Farben. */
export const SUITS = ['♥', '♣', '♦', '♠'] as const;
export type Suit = (typeof SUITS)[number];
export const isRedSuit = (s: Suit) => s === '♥' || s === '♦';

/** Beständige Farbe zu einer Zahl (z. B. laufende Zugnummer) */
export const suitFromNumber = (n: number): Suit => SUITS[Math.abs(Math.imul(n | 0, 2654435761) >>> 7) % 4]!;

/**
 * Farben der Handkarten nachführen: je Rang eine Liste. Gespielte Karten verschwinden mit ihrer Farbe,
 * neue bekommen eine Farbe, die dieser Rang noch nicht hat (soweit möglich). So bleibt die Farbe einer Karte
 * stehen, solange sie auf der Hand liegt.
 */
export function reconcileSuits(prev: Map<Card, Suit[]>, hand: Card[], played: { card: Card; suit: Suit } | null, seed: number): Map<Card, Suit[]> {
  const counts = new Map<Card, number>();
  for (const c of hand) counts.set(c, (counts.get(c) ?? 0) + 1);
  const next = new Map<Card, Suit[]>();
  let k = 0;
  for (const [card, n] of counts) {
    if (card === 'JOKER') continue;
    let list = [...(prev.get(card) ?? [])];
    if (list.length > n && played?.card === card) {
      const i = list.indexOf(played.suit);
      if (i >= 0) list.splice(i, 1);
    }
    list = list.slice(0, n);
    while (list.length < n) {
      const free = SUITS.filter((s) => !list.includes(s));
      const pool = free.length > 0 ? free : SUITS;
      list.push(pool[Math.abs(Math.imul(seed + 31 * ++k + card.length * 7 + card.charCodeAt(0), 2654435761) >>> 9) % pool.length]!);
    }
    next.set(card, list);
  }
  return next;
}

/** Kartenfarben: Herz, Kreuz, Ecke (Karo), Schaufel (Pik). Die Farbe jeder Karte führt der Server mit (Nummer = Index in SUITS). */
export const SUITS = ['♥', '♣', '♦', '♠'] as const;
export type Suit = (typeof SUITS)[number];
export const isRedSuit = (s: Suit) => s === '♥' || s === '♦';

/** Farbe zu ihrer Nummer (0 Herz, 1 Kreuz, 2 Ecke, 3 Schaufel), wie sie der Server vergibt */
export const suitOf = (n: number | null | undefined): Suit => SUITS[(n ?? 0) & 3]!;

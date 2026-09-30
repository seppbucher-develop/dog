import { COLOR_NAMES } from '@dog/protocol';

/** Kugelfarben (Index = Farbnummer aus dem Protokoll) */
export const PALETTE = ['#d9483b', '#2f6fd6', '#f0c419', '#2e9e50', '#2a2a2e', '#f6f3ea'];
export const NEUTRAL = '#b8b09c';
export const colorName = (i: number) => COLOR_NAMES[i] ?? '?';
export const colorHex = (i: number) => PALETTE[i] ?? NEUTRAL;

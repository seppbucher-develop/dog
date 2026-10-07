import { describe, expect, it } from 'vitest';
import type { Card } from '@dog/engine';
import { SUITS, reconcileSuits, suitFromNumber, type Suit } from '../src/cards';
import { timing } from '../src/speed';

describe('Kartenfarben', () => {
  it('vergibt je Rang verschiedene Farben und lässt den Joker aus', () => {
    const m = reconcileSuits(new Map(), ['5', '5', '5', 'JOKER'], null, 7);
    expect(new Set(m.get('5')).size).toBe(3);
    expect(m.has('JOKER')).toBe(false);
  });

  it('behält die Farben der übrigen Karten, wenn eine gespielt wird', () => {
    const start = reconcileSuits(new Map(), ['5', '5', 'K'], null, 1);
    const [a, b] = start.get('5')!;
    const after = reconcileSuits(start, ['5', 'K'], { card: '5' as Card, suit: a! }, 2);
    expect(after.get('5')).toEqual([b]);
    expect(after.get('K')).toEqual(start.get('K'));
  });

  it('liefert stets eine gültige Farbe', () => {
    for (let n = 0; n < 50; n++) expect(SUITS).toContain(suitFromNumber(n) as Suit);
  });
});

describe('Zuggeschwindigkeit', () => {
  it('Stufe 1 bewegt Karte und Kugeln gleichzeitig, ab Stufe 2 nacheinander', () => {
    expect(timing(1).sequential).toBe(false);
    expect(timing(2).sequential).toBe(true);
  });

  it('wird mit der Stufe langsamer und passt in den Serverzug (900 ms … 2,5 s)', () => {
    const delay = [900, 1300, 1700, 2100, 2500];
    for (let s = 1; s <= 5; s++) {
      const t = timing(s);
      if (s > 1) expect(t.flight).toBeGreaterThan(timing(s - 1).flight);
      expect(t.sequential ? t.flight + t.peg : Math.max(t.flight, t.peg)).toBeLessThanOrEqual(delay[s - 1]!);
    }
  });
});

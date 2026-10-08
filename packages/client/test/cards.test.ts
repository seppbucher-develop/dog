import { describe, expect, it } from 'vitest';
import { SUITS, isRedSuit, suitOf } from '../src/cards';
import { timing } from '../src/speed';

describe('Kartenfarben', () => {
  it('ordnet Nummern den vier Farben zu', () => {
    expect([0, 1, 2, 3].map(suitOf)).toEqual([...SUITS]);
    expect(isRedSuit(suitOf(0))).toBe(true);
    expect(isRedSuit(suitOf(1))).toBe(false);
    expect(suitOf(null)).toBe(SUITS[0]);
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

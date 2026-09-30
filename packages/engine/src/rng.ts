/** Deterministischer PRNG (mulberry32); Zustand ist eine einzelne Zahl und damit serialisierbar. */
export function nextRandom(seed: number): [value: number, nextSeed: number] {
  const s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function shuffle<T>(items: T[], seed: number): [T[], number] {
  const a = items.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextRandom(s);
    const j = Math.floor(r * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return [a, s];
}

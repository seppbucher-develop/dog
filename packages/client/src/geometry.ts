import { SEGMENT, startField, type Layout, type Peg } from '@dog/engine';

export const R0 = 320; // Radius des Rings
export const VIEW = 535; // halbe Kantenlänge der Zeichenfläche

export interface Pt {
  x: number;
  y: number;
}

export interface Geo {
  ring(f: number): Pt;
  home(color: number, i: number): Pt;
  fin(color: number, s: number): Pt;
  /** Position einer Kugel */
  peg(p: Peg): Pt;
  /** Textposition des Spielernamens am Nest einer Farbe */
  label(color: number): Pt & { anchor: 'start' | 'middle' | 'end' };
  fieldR: number;
  pegR: number;
  /** Abstand benachbarter Ringfelder */
  spacing: number;
}

/** Brettgeometrie; die Farbe `myColor` liegt unten, damit man immer von seinem Platz aus sieht. */
export function makeGeo(layout: Layout, myColor: number): Geo {
  const R = layout.ringSize;
  const angle = (f: number) => ((f - startField(myColor)) / R) * 2 * Math.PI + Math.PI / 2;
  const polar = (a: number, r: number): Pt => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  const fieldR = Math.min(14, ((2 * Math.PI * R0) / R) * 0.42);
  const ring = (f: number) => polar(angle(f), R0);
  const finAngle = (c: number) => angle(startField(c) - 1 + R);
  const home = (c: number, i: number): Pt => {
    const a = angle(startField(c));
    const centre = polar(a, R0 + 62);
    const tang = { x: -Math.sin(a), y: Math.cos(a) };
    const norm = { x: Math.cos(a), y: Math.sin(a) };
    const ox = (i % 2 === 0 ? -1 : 1) * 15;
    const oy = (i < 2 ? -1 : 1) * 15;
    return { x: centre.x + tang.x * ox + norm.x * oy, y: centre.y + tang.y * ox + norm.y * oy };
  };
  const fin = (c: number, s: number): Pt => polar(finAngle(c), R0 - 44 * (s + 1));
  return {
    ring,
    home,
    fin,
    peg: (p) => (p.pos.t === 'ring' ? ring(p.pos.f) : p.pos.t === 'fin' ? fin(p.color, p.pos.s) : home(p.color, p.id % 4)),
    label(c) {
      // Relativ zum Nest: seitlich daneben, oben/unten außerhalb (oben mit Platz für zwei Zeilen)
      const n = polar(angle(startField(c)), R0 + 62);
      if (Math.abs(n.x) > 40) {
        const sign = n.x > 0 ? 1 : -1;
        return { x: n.x + sign * 46, y: n.y + 2, anchor: sign > 0 ? 'start' : 'end' };
      }
      return { x: n.x, y: n.y + (n.y < 0 ? -68 : 62), anchor: 'middle' };
    },
    fieldR,
    spacing: (2 * Math.PI * R0) / R,
    pegR: Math.max(8, Math.min(13, fieldR * 1.1)),
  };
}

export { SEGMENT };

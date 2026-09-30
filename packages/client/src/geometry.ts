import { startField, type Layout, type Peg } from '@dog/engine';

export const R0 = 320; // Radius des Kreisbretts
export type BoardStyle = 'circle' | 'original';

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
  /** SVG-viewBox, die das ganze Brett samt Nestern und Namen umfasst */
  viewBox: string;
  /** Umriss der Brettscheibe, `margin` Pixel außerhalb des Rings (SVG-Pfad) */
  outline(margin: number): string;
  /** Mitte für den Text (bei schmalen Formen nach oben verschoben, damit keine Zielhäuser darüber liegen) */
  centre: Pt;
  /** Radius der Zielfelder */
  slotR: number;
  /** Tatsächlich verwendete Form (Original nur bei 3, 4 und 6 Brettabschnitten) */
  style: BoardStyle;
}

/** Gibt es für diese Anzahl Brettabschnitte eine Originalform? */
export const hasOriginalShape = (colors: number) => colors === 3 || colors === 4 || colors === 6;

// ---------- Umrisse ----------

/** Geschlossene, im Uhrzeigersinn (auf dem Bildschirm) durchlaufene Linie; Start = Mitte der unteren Kante. */
interface Curve {
  points: Pt[];
  cum: number[]; // kumulierte Länge je Punkt
  length: number;
}

function toCurve(points: Pt[]): Curve {
  const cum = [0];
  for (let i = 1; i <= points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i % points.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { points, cum, length: cum[points.length]! };
}

/** Abgerundetes konvexes Polygon: `inner` = Eckpunkte des geschrumpften Polygons (im Uhrzeigersinn), `rc` = Radius. */
function roundedPolygon(inner: Pt[], rc: number): Pt[] {
  const n = inner.length;
  const dirs = inner.map((w, i) => {
    const nx = inner[(i + 1) % n]!;
    const l = Math.hypot(nx.x - w.x, nx.y - w.y);
    return { x: (nx.x - w.x) / l, y: (nx.y - w.y) / l };
  });
  const outN = dirs.map((d) => ({ x: d.y, y: -d.x })); // nach außen
  const at = (w: Pt, o: Pt): Pt => ({ x: w.x + o.x * rc, y: w.y + o.y * rc });
  const a0 = at(inner[0]!, outN[0]!);
  const b0 = at(inner[1]!, outN[0]!);
  const pts: Pt[] = [{ x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }];
  for (let k = 1; k <= n; k++) {
    const i = k % n;
    const w = inner[i]!;
    const a1 = Math.atan2(outN[k - 1]!.y, outN[k - 1]!.x);
    let a2 = Math.atan2(outN[i]!.y, outN[i]!.x);
    while (a2 < a1) a2 += 2 * Math.PI; // Uhrzeigersinn = wachsender Winkel (y nach unten)
    const steps = Math.max(4, Math.ceil((a2 - a1) / 0.04));
    for (let s = 0; s <= steps; s++) {
      const a = a1 + ((a2 - a1) * s) / steps;
      pts.push({ x: w.x + Math.cos(a) * rc, y: w.y + Math.sin(a) * rc });
    }
  }
  return pts;
}

const SQ = 1;
const TRI = { x: 0.866, y: 0.5 };

/** Form, Zielumfang: Kreis, abgerundetes Quadrat (4), Dreieck (3), hochkant liegendes Oval (6). */
function curveFor(style: BoardStyle, colors: number): Curve {
  let raw: Pt[];
  let perimeter: number;
  if (style === 'original' && colors === 4) {
    raw = roundedPolygon([{ x: SQ, y: SQ }, { x: -SQ, y: SQ }, { x: -SQ, y: -SQ }, { x: SQ, y: -SQ }], 0.42);
    perimeter = 2350;
  } else if (style === 'original' && colors === 3) {
    raw = roundedPolygon([{ x: TRI.x, y: TRI.y }, { x: -TRI.x, y: TRI.y }, { x: 0, y: -1 }], 0.34);
    perimeter = 2150;
  } else if (style === 'original' && colors === 6) {
    raw = roundedPolygon([{ x: 0.3, y: 0.95 }, { x: -0.3, y: 0.95 }, { x: -0.3, y: -0.95 }, { x: 0.3, y: -0.95 }], 0.62);
    perimeter = 2250;
  } else {
    const pts: Pt[] = [];
    for (let i = 0; i < 720; i++) {
      const a = Math.PI / 2 + (i / 720) * 2 * Math.PI;
      pts.push({ x: Math.cos(a), y: Math.sin(a) });
    }
    raw = pts;
    perimeter = 2 * Math.PI * R0;
  }
  const len = toCurve(raw).length;
  const k = perimeter / len;
  const xs = raw.map((p) => p.x * k);
  const ys = raw.map((p) => p.y * k);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return toCurve(raw.map((p) => ({ x: p.x * k - cx, y: p.y * k - cy })));
}

/** Punkt und Außennormale bei Bogenlängenanteil t (0..1, Start = Mitte der unteren Kante). */
function sample(c: Curve, t: number): { p: Pt; n: Pt } {
  const u = (((t % 1) + 1) % 1) * c.length;
  let lo = 0;
  let hi = c.points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.cum[mid]! <= u) lo = mid;
    else hi = mid - 1;
  }
  const a = c.points[lo]!;
  const b = c.points[(lo + 1) % c.points.length]!;
  const seg = c.cum[lo + 1]! - c.cum[lo]!;
  const f = seg > 0 ? (u - c.cum[lo]!) / seg : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { p: { x: a.x + dx * f, y: a.y + dy * f }, n: { x: dy / l, y: -dx / l } };
}

// ---------- Geometrie ----------

/** Brettgeometrie; die Farbe `myColor` liegt unten, damit man immer von seinem Platz aus sieht. */
export function makeGeo(layout: Layout, myColor: number, wanted: BoardStyle = 'circle'): Geo {
  const R = layout.ringSize;
  const style: BoardStyle = wanted === 'original' && hasOriginalShape(layout.colors) ? 'original' : 'circle';
  const curve = curveFor(style, layout.colors);
  // Kreis: mein Startfeld unten in der Mitte. Eckige Formen: mein Abschnitt liegt mittig unten.
  const shift = style === 'circle' ? 0 : -0.5 / layout.colors;
  const at = (f: number) => sample(curve, (f - startField(myColor)) / R + shift);
  const ring = (f: number): Pt => at(f).p;

  const spacing = curve.length / R;
  const fieldR = Math.min(14, spacing * 0.42);
  const pegR = Math.max(8, Math.min(13, fieldR * 1.1));
  const radii = Array.from({ length: 64 }, (_, i) => Math.hypot(sample(curve, i / 64).p.x, sample(curve, i / 64).p.y));
  const laneStep = Math.max(26, Math.min(44, Math.min(...radii) * 0.15));
  const slotR = Math.min(fieldR * 1.15, laneStep * 0.46);

  const nestCentre = (c: number): Pt => {
    const { p, n } = at(startField(c));
    return { x: p.x + n.x * 62, y: p.y + n.y * 62 };
  };
  const home = (c: number, i: number): Pt => {
    const { n } = at(startField(c));
    const centre = nestCentre(c);
    const tang = { x: -n.y, y: n.x };
    const ox = (i % 2 === 0 ? -1 : 1) * 15;
    const oy = (i < 2 ? -1 : 1) * 15;
    return { x: centre.x + tang.x * ox + n.x * oy, y: centre.y + tang.y * ox + n.y * oy };
  };
  const fin = (c: number, s: number): Pt => {
    const { p, n } = at(startField(c) - 1 + R);
    return { x: p.x - n.x * laneStep * (s + 1), y: p.y - n.y * laneStep * (s + 1) };
  };
  const label = (c: number): Pt & { anchor: 'start' | 'middle' | 'end' } => {
    const n = nestCentre(c);
    if (Math.abs(n.x) > 40) {
      const sign = n.x > 0 ? 1 : -1;
      return { x: n.x + sign * 46, y: n.y + 2, anchor: sign > 0 ? 'start' : 'end' };
    }
    return { x: n.x, y: n.y + (n.y < 0 ? -68 : 62), anchor: 'middle' };
  };

  // Zeichenfläche: alles, was gezeichnet wird, plus Rand für Namen
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (x: number, y: number, mx = 0, my = 0) => {
    minX = Math.min(minX, x - mx); maxX = Math.max(maxX, x + mx);
    minY = Math.min(minY, y - my); maxY = Math.max(maxY, y + my);
  };
  for (let f = 0; f < R; f++) grow(ring(f).x, ring(f).y, 44, 44);
  for (const c of layout.usedColors) {
    const n = nestCentre(c);
    grow(n.x, n.y, 40, 40);
    const l = label(c);
    if (l.anchor === 'middle') grow(l.x, l.y, 60, 30);
    else grow(l.x + (l.anchor === 'start' ? 120 : -120), l.y, 10, 20);
  }
  const pad = 10;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;

  const outline = (margin: number): string => {
    const n = 360;
    const pts = Array.from({ length: n }, (_, i) => {
      const { p, n: nr } = sample(curve, i / n);
      return `${(p.x + nr.x * margin).toFixed(1)} ${(p.y + nr.y * margin).toFixed(1)}`;
    });
    return `M${pts.join('L')}Z`;
  };

  return {
    ring,
    home,
    fin,
    peg: (p) => (p.pos.t === 'ring' ? ring(p.pos.f) : p.pos.t === 'fin' ? fin(p.color, p.pos.s) : home(p.color, p.id % 4)),
    label,
    fieldR,
    pegR,
    spacing,
    viewBox,
    outline,
    centre: style === 'original' && layout.colors === 6 ? { x: 0, y: -85 } : { x: 0, y: 0 },
    slotR,
    style,
  };
}

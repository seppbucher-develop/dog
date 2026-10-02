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
  label(color: number): Pt & { anchor: 'start' | 'middle' | 'end'; above: boolean };
  fieldR: number;
  pegR: number;
  /** Abstand benachbarter Ringfelder */
  spacing: number;
  /** SVG-viewBox, die das ganze Brett samt Nestern und Namen umfasst */
  viewBox: string;
  /** Umriss des Bretts (SVG-Pfad, geschlossen); wird mit dicker Kontur nach außen verbreitert gezeichnet */
  edgePath: string;
  /** Nest einer Farbe: Kapsel/Kreis zwischen zwei Punkten mit Breite w */
  nest(color: number): { x1: number; y1: number; x2: number; y2: number; w: number; cx: number; cy: number };
  /** Mitte für den Text */
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

// Kreuzförmige Originalbretter. Einheit = Lochabstand. Jeder Spieler hat einen Arm (Breite 4): Die Löcher laufen
// an einer Seite hinaus, über das Armende und an der anderen Seite zurück (16 Löcher pro Arm). Das Zielhaus liegt
// in der Mitte des Arms, die Nestlöcher in einer Reihe am Armende. Start des Umrisses = Mitte des Armendes unten;
// von dort im Uhrzeigersinn folgen die Arme der übrigen Spieler. Gespielt wird entgegengesetzt: Die Felder
// (und die Spielreihenfolge) laufen auf dem Bildschirm gegen den Uhrzeigersinn. Das Startfeld liegt in der Ecke
// des Armendes; von dort zweigt das Zielhaus nach innen ab.

/** Sternumriss mit n gleichen Armen (n = 3, 4): Armachse Λ = c + 6, wobei c der Abstand der Einbuchtung ist. */
function starOutline(n: number): Pt[] {
  const c = 2 / Math.tan(Math.PI / n);
  const L = c + 6;
  const rot = (p: Pt, k: number): Pt => {
    const a = (2 * Math.PI * k) / n; // wachsender Winkel = Uhrzeigersinn (y nach unten)
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
  };
  const pts: Pt[] = [{ x: 0, y: L }, { x: -2, y: L }, { x: -2, y: c }];
  for (let k = 1; k < n; k++) for (const q of [{ x: 2, y: c }, { x: 2, y: L }, { x: -2, y: L }, { x: -2, y: c }]) pts.push(rot(q, k));
  pts.push({ x: 2, y: L });
  // doppelte Punkte (Einbuchtungen, die zwei Arme teilen) entfernen
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 1e-6);
}

/** Umriss für 6 Spieler: Arm unten und oben, je zwei Arme links und rechts; 96 Schritte, Armabstand je 16. */
function sixOutline(): Pt[] {
  const right: [number, number][] = [
    [0, 11], [-2, 11], [-2, 7], [-3, 7], [-3, 5], [-8, 5], [-8, 1], [-3, 1], [-3, -1], [-8, -1], [-8, -5], [-3, -5], [-3, -7],
    [-2, -7], [-2, -11], [2, -11], [2, -7], [3, -7], [3, -5], [8, -5], [8, -1], [3, -1], [3, 1], [8, 1], [8, 5], [3, 5], [3, 7], [2, 7], [2, 11],
  ];
  return right.map(([x, y]) => ({ x, y }));
}

function curveFor(style: BoardStyle, colors: number): Curve {
  let raw: Pt[];
  let target: number; // größte Ausdehnung in Pixeln
  if (style === 'original' && colors === 4) [raw, target] = [starOutline(4), 660];
  else if (style === 'original' && colors === 3) [raw, target] = [starOutline(3), 660];
  else if (style === 'original' && colors === 6) [raw, target] = [sixOutline(), 720];
  else {
    raw = Array.from({ length: 720 }, (_, i) => {
      const a = Math.PI / 2 + (i / 720) * 2 * Math.PI;
      return { x: Math.cos(a) * R0, y: Math.sin(a) * R0 };
    });
    target = 0;
  }
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const k = target === 0 ? 1 : target / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return toCurve(raw.map((p) => ({ x: (p.x - cx) * k, y: (p.y - cy) * k })));
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
  const orig = style === 'original';
  // Die Kurve läuft im Uhrzeigersinn, gespielt wird dagegen: wachsendes Feld = abnehmender Kurvenparameter.
  // Kreis: mein Startfeld unten in der Mitte. Kreuz: die Mitte meines Armendes liegt unten in der Mitte, mein
  // Startfeld (in der Ecke, links davon) liegt ein Loch daneben, damit das Zielhaus neben den Seitenlöchern
  // nach innen laufen kann.
  const at = (f: number) => sample(curve, ((orig ? 1 : 0) - (f - startField(myColor))) / R);
  /** Mitte des Armendes einer Farbe (nur Kreuz) */
  const armEnd = (c: number) => sample(curve, -(startField(c) - startField(myColor)) / R);
  const ring = (f: number): Pt => at(f).p;

  const spacing = curve.length / R;
  const fieldR = Math.min(14, spacing * 0.42);
  const pegR = Math.max(8, Math.min(13, fieldR * 1.1));
  const radii = Array.from({ length: 64 }, (_, i) => Math.hypot(sample(curve, i / 64).p.x, sample(curve, i / 64).p.y));
  const laneStep = orig ? spacing : Math.max(26, Math.min(44, Math.min(...radii) * 0.15));
  const slotR = Math.min(fieldR * 1.15, laneStep * 0.46);

  const nestCentre = (c: number): Pt => {
    if (orig) {
      const { p, n } = armEnd(c);
      return { x: p.x + n.x * spacing * 2, y: p.y + n.y * spacing * 2 };
    }
    const { p, n } = at(startField(c));
    return { x: p.x + n.x * 62, y: p.y + n.y * 62 };
  };
  const home = (c: number, i: number): Pt => {
    const centre = nestCentre(c);
    if (orig) {
      // vier Löcher in einer Reihe quer zum Arm
      const { n } = armEnd(c);
      const tang = { x: -n.y, y: n.x };
      const o = (i - 1.5) * spacing * 0.95;
      return { x: centre.x + tang.x * o, y: centre.y + tang.y * o };
    }
    const { n } = at(startField(c));
    const tang = { x: -n.y, y: n.x };
    const ox = (i % 2 === 0 ? -1 : 1) * 15;
    const oy = (i < 2 ? -1 : 1) * 15;
    return { x: centre.x + tang.x * ox + n.x * oy, y: centre.y + tang.y * ox + n.y * oy };
  };
  const nest = (c: number) => {
    const cc = nestCentre(c);
    if (orig) {
      const a = home(c, 0);
      const b = home(c, 3);
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: pegR * 2 + 14, cx: cc.x, cy: cc.y };
    }
    return { x1: cc.x, y1: cc.y, x2: cc.x + 0.01, y2: cc.y, w: 68, cx: cc.x, cy: cc.y };
  };
  const fin = (c: number, s: number): Pt => {
    const { p, n } = at(startField(c));
    return { x: p.x - n.x * laneStep * (s + 1), y: p.y - n.y * laneStep * (s + 1) };
  };
  /** Beschriftung: `y` ist die Grundlinie der letzten Zeile (above) bzw. der ersten Zeile (sonst). */
  const label = (c: number): Pt & { anchor: 'start' | 'middle' | 'end'; above: boolean } => {
    const n = nestCentre(c);
    if (orig) {
      const { n: axis } = armEnd(c);
      const hs = [0, 1, 2, 3].map((i) => home(c, i));
      const top = Math.min(...hs.map((h) => h.y));
      const bottom = Math.max(...hs.map((h) => h.y));
      // Unten am Brett unter das Nest, sonst über das Nest
      if (axis.y > 0.5) return { x: n.x, y: bottom + pegR + 28, anchor: 'middle', above: false };
      return { x: n.x, y: top - pegR - 14, anchor: 'middle', above: true };
    }
    if (Math.abs(n.x) > 40) {
      const sign = n.x > 0 ? 1 : -1;
      return { x: n.x + sign * 46, y: n.y + 2, anchor: sign > 0 ? 'start' : 'end', above: false };
    }
    return { x: n.x, y: n.y + (n.y < 0 ? -68 : 62), anchor: 'middle', above: false };
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
    for (let i = 0; i < 4; i++) grow(home(c, i).x, home(c, i).y, 30, 30);
    const l = label(c);
    if (l.anchor === 'middle') grow(l.x, l.y - (l.above ? 26 : 0), 60, 30);
    else grow(l.x + (l.anchor === 'start' ? 120 : -120), l.y, 10, 20);
  }
  const pad = 10;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;

  const edgePath = `M${curve.points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`;

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
    edgePath,
    nest,
    centre: { x: 0, y: 0 },
    slotR,
    style,
  };
}

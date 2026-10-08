import type { Card, Layout, Peg } from '@dog/engine';
import { isRedSuit, type Suit } from './cards';
import { CARD_TEXT } from './labels';
import { NEUTRAL } from './colors';
import type { Geo } from './geometry';

export interface BoardMarker {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface PileView {
  /** Anzahl Karten im Stapel (ohne die gerade fliegende) */
  count: number;
  top: Card | null;
  suit: Suit;
}

export interface Flight {
  /** wechselt mit jedem Zug und startet die Animation neu */
  key: number;
  from: { x: number; y: number };
  /** Ziel statt Ablagestapel (Kartenübergabe) */
  to?: { x: number; y: number };
  /** null = verdeckt (Rückseite) */
  card: Card | null;
  suit: Suit;
  ms: number;
  /** Verzögerung bis zum Start (ms) */
  delay?: number;
}

interface Props {
  layout: Layout;
  geo: Geo;
  pegs: Peg[];
  /** Anzeigefarbe je Brettabschnitt */
  segColors: string[];
  /** Beschriftung je Brettabschnitt: 1-2 Zeilen (leer bei unbenutzten) */
  segNames: string[][];
  /** Brettabschnitte, deren Spieler gerade am Zug ist */
  activeSegs: Set<number>;
  selectable: Set<number>;
  /** Zusätzlich anklickbare Kugeln (ohne Hervorhebung), z. B. um einen Grund anzuzeigen */
  clickable?: Set<number>;
  focus: number | null;
  markers: BoardMarker[];
  onPeg(id: number): void;
  onMarker(id: string): void;
  centerLines: string[];
  pile: PileView;
  flights: Flight[];
}

const CARD_W = 46;
const CARD_H = 64;
/** Darstellungsgröße der Karten im Ablagestapel (Faktor auf CARD_W x CARD_H) */
const PILE_SCALE = 2;

function CardBack() {
  return (
    <g>
      <rect x={-CARD_W / 2} y={-CARD_H / 2} width={CARD_W} height={CARD_H} rx={6} fill="var(--accent)" stroke="#fffefa" strokeWidth={3} />
      <rect x={-CARD_W / 2 + 5} y={-CARD_H / 2 + 5} width={CARD_W - 10} height={CARD_H - 10} rx={3} fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.5} />
    </g>
  );
}

function CardFace({ card, suit }: { card: Card; suit: Suit }) {
  const joker = card === 'JOKER';
  const red = !joker && isRedSuit(suit);
  const ink = joker ? '#7a3fb3' : red ? '#c0392b' : '#222';
  return (
    <g>
      <rect x={-CARD_W / 2} y={-CARD_H / 2} width={CARD_W} height={CARD_H} rx={6} fill={joker ? '#fff3c4' : '#fffefa'} stroke="#8a8474" strokeWidth={1.5} />
      <text x={-CARD_W / 2 + 5} y={-CARD_H / 2 + 17} fill={ink} fontSize={card === '10' ? 14 : 16} fontWeight={800}>{CARD_TEXT[card]}</text>
      <text x={0} y={joker ? 12 : 14} textAnchor="middle" fill={ink} fontSize={joker ? 34 : 30}>{joker ? '★' : suit}</text>
      {!joker && <text x={CARD_W / 2 - 5} y={CARD_H / 2 - 6} textAnchor="end" fill={ink} fontSize={13}>{suit}</text>}
    </g>
  );
}

const stroke = (fill: string) => (fill === '#f6f3ea' ? '#8a8474' : '#15151a');

export function Board({ layout, geo, pegs, segColors, segNames, activeSegs, selectable, clickable, focus, markers, onPeg, onMarker, centerLines, pile, flights }: Props) {
  const R = layout.ringSize;
  const fields = Array.from({ length: R }, (_, f) => f);
  return (
    <svg className="board" viewBox={geo.viewBox} role="img" aria-label="Spielbrett">
      <path d={geo.edgePath} className="board-edge" style={{ strokeWidth: geo.woodW + 6 }} />
      {layout.usedColors.map((c) => {
        const t = geo.tab(c);
        return <line key={`te${c}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="board-edge" style={{ strokeWidth: t.w + 6, strokeLinecap: 'round' }} />;
      })}
      <path d={geo.edgePath} className="board-disc" style={{ strokeWidth: geo.woodW }} />
      {layout.usedColors.map((c) => {
        const t = geo.tab(c);
        return <line key={`td${c}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className="board-disc" style={{ strokeWidth: t.w, strokeLinecap: 'round' }} />;
      })}

      {/* Zielhäuser */}
      {layout.usedColors.map((c) => {
        const col = segColors[c] ?? NEUTRAL;
        const a = geo.ring(c * 16);
        const z0 = geo.fin(c, 0);
        const z = geo.fin(c, 3);
        return (
          <g key={`fin${c}`}>
            <polyline points={`${a.x},${a.y} ${z0.x},${z0.y} ${z.x},${z.y}`} fill="none" stroke={col} strokeOpacity={0.45} strokeWidth={geo.fieldR * 1.4} strokeLinecap="round" strokeLinejoin="round" />
            {[0, 1, 2, 3].map((s) => (
              <circle key={s} cx={geo.fin(c, s).x} cy={geo.fin(c, s).y} r={geo.slotR} fill={col} fillOpacity={0.35} stroke={col} strokeWidth={2} />
            ))}
          </g>
        );
      })}

      {/* Ring */}
      {fields.map((f) => {
        const seg = Math.floor(f / 16);
        const col = segColors[seg] ?? NEUTRAL;
        const start = f % 16 === 0;
        const p = geo.ring(f);
        return (
          <circle
            key={f}
            cx={p.x}
            cy={p.y}
            r={start ? Math.min(geo.fieldR * 1.5, geo.spacing * 0.56) : geo.fieldR}
            fill={col}
            fillOpacity={start ? 0.16 : 0.22}
            stroke={col}
            strokeWidth={start ? 4.5 : 1.5}
          />
        );
      })}

      {/* Nester und Namen */}
      {layout.usedColors.map((c) => {
        const col = segColors[c] ?? NEUTRAL;
        const nst = geo.nest(c);
        const l = geo.label(c);
        return (
          <g key={`nest${c}`}>
            <line
              x1={nst.x1} y1={nst.y1} x2={nst.x2} y2={nst.y2}
              stroke={col} strokeOpacity={0.22} strokeWidth={nst.w} strokeLinecap="round"
              className={activeSegs.has(c) ? 'nest active' : 'nest'}
            />
            {[0, 1, 2, 3].map((i) => <circle key={i} cx={geo.home(c, i).x} cy={geo.home(c, i).y} r={geo.pegR + 1} fill="none" stroke={col} strokeOpacity={0.6} strokeDasharray="3 3" />)}
            <text
              x={l.x}
              y={l.above ? l.y - ((segNames[c] ?? []).length - 1) * 21 : l.y}
              textAnchor={l.anchor}
              className={`pname${activeSegs.has(c) ? ' active' : ''}`}
            >
              {(segNames[c] ?? []).map((line, i) => <tspan key={i} x={l.x} dy={i === 0 ? 0 : 21}>{line}</tspan>)}
            </text>
          </g>
        );
      })}

      {/* Ablagestapel */}
      <g className="pile" transform={`translate(${geo.centre.x} ${geo.centre.y - 44}) scale(${PILE_SCALE})`} aria-label={`Ablagestapel: ${pile.count} Karten`}>
        {pile.count === 0 && <rect x={-CARD_W / 2} y={-CARD_H / 2} width={CARD_W} height={CARD_H} rx={6} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 4" />}
        {pile.count > 2 && <rect x={-CARD_W / 2} y={-CARD_H / 2} width={CARD_W} height={CARD_H} rx={6} fill="#e8e1cf" stroke="#8a8474" strokeWidth={1.5} transform="rotate(-7) translate(-2 2)" />}
        {pile.count > 1 && <rect x={-CARD_W / 2} y={-CARD_H / 2} width={CARD_W} height={CARD_H} rx={6} fill="#f2ecdc" stroke="#8a8474" strokeWidth={1.5} transform="rotate(5) translate(2 1)" />}
        {pile.count > 0 && pile.top && <CardFace card={pile.top} suit={pile.suit} />}
      </g>
      <text textAnchor="middle" className="center-text">
        {centerLines.map((t, i) => <tspan key={i} x={geo.centre.x} y={geo.centre.y + 54 + i * 21}>{t}</tspan>)}
      </text>

      {/* Startfeld-Anzeige: frisch herausgekommen (sperrt, muss erst eine Runde laufen) oder Runde gelaufen (darf ins Haus) */}
      {pegs.map((p) => {
        if (p.pos.t !== 'ring' || p.pos.f !== p.color * 16) return null;
        const a = geo.ring(p.pos.f);
        const r = Math.min(geo.fieldR * 1.5, geo.spacing * 0.56);
        const lap = p.pos.lap === true;
        return (
          <text key={`st${p.id}`} x={a.x + r * 0.9} y={a.y - r * 0.5} fontSize={geo.fieldR * 1.5} textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: 'none' }}>
            <title>{lap ? 'Runde gelaufen: sperrt nicht, kann geschlagen werden, darf ins Zielhaus' : 'Frisch herausgekommen: sperrt und muss erst eine Runde laufen'}</title>
            {lap ? '🏠' : '🔒'}
          </text>
        );
      })}

      {/* Kugeln */}
      {pegs.map((p) => {
        const pt = geo.peg(p);
        const fill = segColors[p.color] ?? NEUTRAL;
        const can = selectable.has(p.id);
        return (
          <g key={p.id} className="peg-move" style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}>
            <circle r={geo.pegR + 2.5} fill="#fff" />
            <circle r={geo.pegR} fill={fill} stroke={stroke(fill)} strokeWidth={2} />
            <circle r={geo.pegR * 0.4} cx={-geo.pegR * 0.25} cy={-geo.pegR * 0.3} fill="#fff" fillOpacity={0.35} />
            {!can && focus !== p.id && clickable?.has(p.id) && (
              <circle r={geo.pegR + 5} fill="transparent" onClick={() => onPeg(p.id)} role="button" aria-label="Kugel wählen" />
            )}
            {(can || focus === p.id) && (
              <circle
                r={geo.pegR + 5}
                className={focus === p.id ? 'ring-focus' : 'ring-can'}
                fill="transparent"
                onClick={() => onPeg(p.id)}
                role="button"
                aria-label="Kugel wählen"
              />
            )}
          </g>
        );
      })}

      {/* Wer ist am Zug: Pfeil direkt neben dem Haus */}
      {layout.usedColors.filter((c) => activeSegs.has(c)).map((c) => {
        const m = turnMark(geo, c);
        return (
          <g key={`turn${c}`} transform={`translate(${m.x} ${m.y})`} role="img" aria-label="Am Zug">
            <g transform={`rotate(${m.angle})`}>
              <g className="turn-mark">
                <circle r={15} fill="var(--accent)" stroke="#fff" strokeWidth={2.5} />
                <path d="M-5 -8 L8 0 L-5 8 Z" fill="#fff" />
              </g>
            </g>
          </g>
        );
      })}

      {/* Karte fliegt zum Ablagestapel */}
      {flights.map((flight) => (
        <g
          key={flight.key}
          className={flight.to ? 'flight xfer' : 'flight'}
          style={{ '--fx': `${flight.from.x}px`, '--fy': `${flight.from.y}px`, '--tx': `${flight.to?.x ?? geo.centre.x}px`, '--ty': `${flight.to?.y ?? geo.centre.y - 44}px`, '--ms': `${flight.ms}ms`, animationDelay: `${flight.delay ?? 0}ms` } as React.CSSProperties}
        >
          <g transform={`scale(${PILE_SCALE})`}>{flight.card ? <CardFace card={flight.card} suit={flight.suit} /> : <CardBack />}</g>
        </g>
      ))}

      {/* Zielmarken der gewählten Kugel */}
      {markers.map((m) => (
        <g key={m.id} className="marker" onClick={() => onMarker(m.id)} role="button" aria-label={`Ziel: ${m.label}`}>
          <circle cx={m.x} cy={m.y} r={Math.min(geo.pegR + 6, geo.spacing / 2 - 1)} />
          <text x={m.x} y={m.y - geo.pegR - 8} textAnchor="middle">{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Pfeil neben dem Nest: seitlich daneben (auf der Seite zur Brettmitte), zeigt auf das Nest. */
function turnMark(geo: Geo, c: number): { x: number; y: number; angle: number } {
  const n = geo.nest(c);
  const len = Math.hypot(n.x2 - n.x1, n.y2 - n.y1);
  const rl = Math.hypot(n.cx, n.cy) || 1;
  const t = len > 1 ? { x: (n.x2 - n.x1) / len, y: (n.y2 - n.y1) / len } : { x: -n.cy / rl, y: n.cx / rl };
  const half = len / 2 + n.w / 2 + 20;
  const a = { x: n.cx + t.x * half, y: n.cy + t.y * half };
  const b = { x: n.cx - t.x * half, y: n.cy - t.y * half };
  // Original: auf die Seite, die vom Namen abgewandt ist; Kreis: auf die Seite zur Brettmitte
  const l = geo.label(c);
  const p = geo.style === 'original' ? (Math.hypot(a.x - l.x, a.y - l.y) >= Math.hypot(b.x - l.x, b.y - l.y) ? a : b) : Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b;
  return { x: p.x, y: p.y, angle: (Math.atan2(n.cy - p.y, n.cx - p.x) * 180) / Math.PI };
}

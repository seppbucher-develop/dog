import type { Layout, Peg } from '@dog/engine';
import { NEUTRAL } from './colors';
import { R0, VIEW, type Geo } from './geometry';

export interface BoardMarker {
  id: string;
  x: number;
  y: number;
  label: string;
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
  focus: number | null;
  markers: BoardMarker[];
  onPeg(id: number): void;
  onMarker(id: string): void;
  centerLines: string[];
}

const stroke = (fill: string) => (fill === '#f6f3ea' ? '#8a8474' : '#15151a');

export function Board({ layout, geo, pegs, segColors, segNames, activeSegs, selectable, focus, markers, onPeg, onMarker, centerLines }: Props) {
  const R = layout.ringSize;
  const fields = Array.from({ length: R }, (_, f) => f);
  return (
    <svg className="board" viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`} role="img" aria-label="Spielbrett">
      <circle r={R0 + 34} className="board-disc" />

      {/* Zielhäuser */}
      {layout.usedColors.map((c) => {
        const col = segColors[c] ?? NEUTRAL;
        const a = geo.ring(((c * 16 - 1) % R + R) % R);
        const z = geo.fin(c, 3);
        return (
          <g key={`fin${c}`}>
            <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={col} strokeOpacity={0.45} strokeWidth={geo.fieldR * 1.4} strokeLinecap="round" />
            {[0, 1, 2, 3].map((s) => (
              <circle key={s} cx={geo.fin(c, s).x} cy={geo.fin(c, s).y} r={geo.fieldR * 1.15} fill={col} fillOpacity={0.35} stroke={col} strokeWidth={2} />
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
            r={start ? geo.fieldR * 1.35 : geo.fieldR}
            fill={col}
            fillOpacity={start ? 0.75 : 0.22}
            stroke={col}
            strokeWidth={start ? 3 : 1.5}
          />
        );
      })}

      {/* Nester und Namen */}
      {layout.usedColors.map((c) => {
        const col = segColors[c] ?? NEUTRAL;
        const hs = [0, 1, 2, 3].map((i) => geo.home(c, i));
        const cx = hs.reduce((n, p) => n + p.x, 0) / 4;
        const cy = hs.reduce((n, p) => n + p.y, 0) / 4;
        const l = geo.label(c);
        return (
          <g key={`nest${c}`}>
            <circle cx={cx} cy={cy} r={34} fill={col} fillOpacity={0.2} stroke={col} strokeWidth={2} className={activeSegs.has(c) ? 'nest active' : 'nest'} />
            {hs.map((h, i) => <circle key={i} cx={h.x} cy={h.y} r={geo.pegR + 1} fill="none" stroke={col} strokeOpacity={0.5} strokeDasharray="3 3" />)}
            <text x={l.x} y={l.y} textAnchor={l.anchor} className={`pname${activeSegs.has(c) ? ' active' : ''}`}>
              {(segNames[c] ?? []).map((line, i) => <tspan key={i} x={l.x} dy={i === 0 ? 0 : 21}>{line}</tspan>)}
            </text>
          </g>
        );
      })}

      <text textAnchor="middle" className="center-text">
        {centerLines.map((t, i) => <tspan key={i} x={0} y={-10 + i * 30}>{t}</tspan>)}
      </text>

      {/* Kugeln */}
      {pegs.map((p) => {
        const pt = geo.peg(p);
        const fill = segColors[p.color] ?? NEUTRAL;
        const can = selectable.has(p.id);
        return (
          <g key={p.id} className="peg-move" style={{ transform: `translate(${pt.x}px, ${pt.y}px)` }}>
            <circle r={geo.pegR} fill={fill} stroke={stroke(fill)} strokeWidth={2} />
            <circle r={geo.pegR * 0.4} cx={-geo.pegR * 0.25} cy={-geo.pegR * 0.3} fill="#fff" fillOpacity={0.35} />
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

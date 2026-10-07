import { useState } from 'react';
import { COLOR_COUNT, type LobbyView, type SeatSpec, type SeatView } from '@dog/protocol';
import type { RuleSettings } from '@dog/engine';
import { colorHex, colorName } from './colors';
import { LEVEL_LABEL, RULE_FIELDS } from './labels';
import { net } from './net';

const teamName = (i: number) => `Team ${String.fromCharCode(65 + i)}`;

const specOf = (s: SeatView): SeatSpec => (s.kind === 'human' ? { kind: 'human', color: s.color } : { kind: 'bot', level: s.level ?? 'expert', color: s.color });

function ColorDots({ value, onPick, disabled }: { value: number; onPick: (c: number) => void; disabled?: boolean }) {
  return (
    <span className="dots" role="radiogroup" aria-label="Kugelfarbe">
      {Array.from({ length: COLOR_COUNT }, (_, c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={colorName(c)}
          title={colorName(c)}
          disabled={disabled}
          className={`dot${c === value ? ' on' : ''}`}
          style={{ background: colorHex(c) }}
          onClick={() => onPick(c)}
        />
      ))}
    </span>
  );
}

export function Lobby({ lobby }: { lobby: LobbyView }) {
  const isHost = lobby.you.status === 'host';
  const n = lobby.seats.length;
  const freeHuman = lobby.seats.map((s, i) => (s.kind === 'human' && !s.filled ? i : -1)).filter((i) => i >= 0);
  const allFilled = lobby.seats.every((s) => s.filled);
  const link = `${location.origin}/?code=${lobby.code}`;
  const [copied, setCopied] = useState(false);

  const configure = (seats: SeatSpec[], eightPegs = lobby.eightPegs, rules: Partial<RuleSettings> = lobby.rules) =>
    net.send({ t: 'configure', seats, eightPegs, rules });

  const setCount = (count: number) => {
    const seats = lobby.seats.map(specOf);
    while (seats.length < count) seats.push({ kind: 'bot', level: 'expert' });
    seats.length = count;
    configure(seats, count === 2 ? lobby.eightPegs : false);
  };
  const setKind = (i: number, value: string) => {
    const seats = lobby.seats.map(specOf);
    const c = seats[i]!.color;
    seats[i] = value === 'human' ? { kind: 'human', color: c } : { kind: 'bot', level: value.slice(4) as never, color: c };
    configure(seats);
  };

  return (
    <div className="lobby">
      <header className="lobby-head">
        <div>
          <h1>Spiellobby</h1>
          <p className="muted">
            Code <b className="code-badge">{lobby.code}</b>
            {isHost && (
              <>
                {' '}
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Kopiert ✓' : 'Einladungslink kopieren'}
                </button>
              </>
            )}
          </p>
        </div>
        <button onClick={() => confirm(isHost ? 'Spiel für alle beenden?' : 'Spiel verlassen?') && net.send({ t: 'leave' })}>
          {isHost ? 'Spiel beenden' : 'Verlassen'}
        </button>
      </header>

      {isHost && lobby.requests && lobby.requests.length > 0 && (
        <section className="card">
          <h2>Beitrittsanfragen</h2>
          {lobby.requests.map((r) => (
            <Request key={r.id} id={r.id} name={r.name} lobby={lobby} freeHuman={freeHuman} />
          ))}
        </section>
      )}

      <section className="card">
        <h2>Spieler und Plätze</h2>
        {isHost && (
          <div className="row">
            <span>Anzahl Spieler:</span>
            {[2, 3, 4, 5, 6].map((c) => (
              <button key={c} className={c === n ? 'primary' : ''} onClick={() => setCount(c)} aria-pressed={c === n}>{c}</button>
            ))}
            {n === 2 && (
              <label className="inline">
                <input type="checkbox" checked={lobby.eightPegs} onChange={(e) => configure(lobby.seats.map(specOf), e.target.checked)} /> 8 Kugeln (eigene + gegenüberliegende Farbe)
              </label>
            )}
          </div>
        )}
        <p className="muted">
          {lobby.teams.length > 0
            ? 'Teamspiel: Partner sitzen sich gegenüber. ' + lobby.teams.map((t, i) => `${teamName(i)}: Platz ${t.map((p) => p + 1).join(' + ')}`).join(' · ')
            : 'Jeder spielt für sich.'}
        </p>
        <ol className="seats">
          {lobby.seats.map((s, i) => {
            const team = lobby.teams.findIndex((t) => t.includes(i));
            const isMe = lobby.you.seat === i;
            const occupiedHuman = s.kind === 'human' && s.filled;
            return (
              <li key={i} className={`seat${isMe ? ' me' : ''}`}>
                <span className="pos">Platz {i + 1}{team >= 0 && <small> · {teamName(team)}</small>}</span>
                <span className="who">
                  {s.kind === 'bot' ? `Computer (${LEVEL_LABEL[s.level ?? 'expert']})` : s.filled ? `${s.name}${isMe ? ' (du)' : ''}${s.connected ? '' : ' – getrennt'}` : '— wartet auf Mitspieler —'}
                </span>
                {isHost ? (
                  <>
                    <ColorDots value={s.color} onPick={(c) => net.send({ t: 'setColor', seat: i, color: c })} />
                    <select
                      aria-label={`Platz ${i + 1}: Art`}
                      value={s.kind === 'human' ? 'human' : `bot:${s.level}`}
                      disabled={occupiedHuman}
                      onChange={(e) => setKind(i, e.target.value)}
                    >
                      <option value="human">Mensch (online)</option>
                      {Object.entries(LEVEL_LABEL).map(([lv, label]) => (
                        <option key={lv} value={`bot:${lv}`}>Computer: {label}</option>
                      ))}
                    </select>
                    <span className="mv">
                      <button aria-label="Platz nach oben" disabled={i === 0} onClick={() => net.send({ t: 'move', seat: i, to: i - 1 })}>↑</button>
                      <button aria-label="Platz nach unten" disabled={i === n - 1} onClick={() => net.send({ t: 'move', seat: i, to: i + 1 })}>↓</button>
                      {occupiedHuman && !isMe && <button aria-label="Spieler entfernen" title="Spieler entfernen" onClick={() => net.send({ t: 'kick', seat: i })}>✕</button>}
                    </span>
                  </>
                ) : (
                  <span className="swatch" style={{ background: colorHex(s.color) }} title={colorName(s.color)} />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <RulesPanel lobby={lobby} isHost={isHost} onChange={(rules) => configure(lobby.seats.map(specOf), lobby.eightPegs, rules)} />

      <section className="card center">
        {isHost ? (
          <>
            <button className="primary big" disabled={!allFilled} onClick={() => net.send({ t: 'start' })}>Spiel starten</button>
            {!allFilled && <p className="muted">Es warten noch Menschenplätze auf Mitspieler – bewillige Anfragen oder setze Computer ein.</p>}
          </>
        ) : (
          <p>Warte, bis der Spielinitiator das Spiel startet …</p>
        )}
      </section>
    </div>
  );
}

function Request({ id, name, lobby, freeHuman }: { id: string; name: string; lobby: LobbyView; freeHuman: number[] }) {
  const [seat, setSeat] = useState<number | null>(null);
  const seatIdx = seat !== null && freeHuman.includes(seat) ? seat : (freeHuman[0] ?? -1);
  const [color, setColor] = useState<number | null>(null);
  const shownColor = color ?? (seatIdx >= 0 ? lobby.seats[seatIdx]!.color : 0);
  return (
    <div className="request">
      <b>{name}</b>
      {freeHuman.length === 0 ? (
        <span className="muted">Kein freier Menschenplatz – stelle einen Computerplatz auf „Mensch“.</span>
      ) : (
        <>
          <label className="inline">
            Platz
            <select value={seatIdx} onChange={(e) => { setSeat(Number(e.target.value)); setColor(null); }}>
              {freeHuman.map((i) => <option key={i} value={i}>Platz {i + 1}</option>)}
            </select>
          </label>
          <ColorDots value={shownColor} onPick={setColor} />
        </>
      )}
      <button className="primary" disabled={seatIdx < 0} onClick={() => net.send({ t: 'approve', requestId: id, seat: seatIdx, ...(color !== null ? { color } : {}) })}>Bewilligen</button>
      <button onClick={() => net.send({ t: 'reject', requestId: id })}>Ablehnen</button>
    </div>
  );
}

function RulesPanel({ lobby, isHost, onChange }: { lobby: LobbyView; isHost: boolean; onChange: (r: Partial<RuleSettings>) => void }) {
  const r = lobby.rules;
  const [sizes, setSizes] = useState(r.handSizes.join(','));
  const [bad, setBad] = useState(false);
  const commitSizes = () => {
    const list = sizes.split(',').map((x) => Number(x.trim()));
    if (list.length === 0 || list.some((x) => !Number.isInteger(x) || x < 1)) return setBad(true);
    setBad(false);
    onChange({ ...r, handSizes: list });
  };
  return (
    <details className="card rules">
      <summary><h2>Einstellungen</h2></summary>
      <div className="rule-grid">
        {RULE_FIELDS.map((f) => (
          <label key={f.key} className="rule">
            <span>{f.label}{f.hint && <small> ({f.hint})</small>}</span>
            {f.kind === 'bool' && (
              <input type="checkbox" checked={r[f.key] as boolean} disabled={!isHost} onChange={(e) => onChange({ ...r, [f.key]: e.target.checked })} />
            )}
            {f.kind === 'select' && (
              <select value={r[f.key] as string} disabled={!isHost} onChange={(e) => onChange({ ...r, [f.key]: f.key === 'turnSpeed' ? Number(e.target.value) : e.target.value })}>
                {f.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
            {f.kind === 'sizes' && (
              <input
                value={sizes}
                disabled={!isHost}
                aria-invalid={bad}
                onChange={(e) => setSizes(e.target.value)}
                onBlur={commitSizes}
                onKeyDown={(e) => e.key === 'Enter' && commitSizes()}
              />
            )}
          </label>
        ))}
      </div>
      {bad && <p className="error">Bitte ganze Zahlen ab 1, durch Komma getrennt.</p>}
    </details>
  );
}

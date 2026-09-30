import { useEffect, useMemo, useState } from 'react';
import { applyMoveToPegs, layoutFor, type Card, type Move, type Play, type Pos } from '@dog/engine';
import type { GameView, LobbyView } from '@dog/protocol';
import { Board, type BoardMarker } from './Board';
import { NEUTRAL, colorHex, colorName } from './colors';
import { makeGeo } from './geometry';
import { CARD_TEXT, LEVEL_LABEL, cardHint, moveText } from './labels';
import { net } from './net';
import { candidates, completed, emptySel, movablePegs, nextMoves, optionsForPeg, playableCards, sevenRemaining, type Selection } from './play';

const ORDER: Card[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];
const sortHand = (h: Card[]) => [...h].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

export function Game({ lobby, view }: { lobby: LobbyView; view: GameView | null }) {
  if (!view) return <div className="card center">Spiel wird geladen …</div>;
  return <GameInner lobby={lobby} view={view} />;
}

function GameInner({ lobby, view }: { lobby: LobbyView; view: GameView }) {
  const layout = useMemo(() => layoutFor(view.config), [view.config]);
  const isHost = lobby.you.status === 'host';
  // Computer tragen die Farbe im Namen, damit sie sich unterscheiden lassen
  const names = lobby.seats.map((s, i) => (s.kind === 'bot' ? `Computer ${colorName(s.color)}` : (s.name ?? `Spieler ${i + 1}`)));
  const boardLines = lobby.seats.map((s, i) =>
    s.kind === 'bot' ? [names[i]!, LEVEL_LABEL[s.level ?? 'intermediate']!] : [names[i]!.length > 14 ? `${names[i]!.slice(0, 13)}…` : names[i]!],
  );

  const seatOfColor: number[] = [];
  layout.colorsOf.forEach((cs, p) => cs.forEach((c) => (seatOfColor[c] = p)));
  const segColors = Array.from({ length: layout.colors }, (_, c) => (seatOfColor[c] !== undefined ? colorHex(lobby.seats[seatOfColor[c]!]?.color ?? 0) : NEUTRAL));
  const segNames = Array.from({ length: layout.colors }, (_, c) => (seatOfColor[c] !== undefined ? boardLines[seatOfColor[c]!]! : []));
  const activeSegs = new Set<number>(view.phase === 'playing' ? (layout.colorsOf[view.current] ?? []) : []);
  const geo = useMemo(() => makeGeo(layout, layout.colorsOf[view.seat]![0]!), [layout, view.seat]);

  const [sel, setSel] = useState<Selection>(emptySel);
  const [focus, setFocus] = useState<number | null>(null);
  const [xCard, setXCard] = useState<Card | null>(null);

  // Neuer Spielstand vom Server: angefangene Auswahl verwerfen
  const stateKey = JSON.stringify([view.phase, view.current, view.myHand, view.pegs.map((p) => p.pos)]);
  useEffect(() => {
    setSel(emptySel);
    setFocus(null);
    setXCard(null);
  }, [stateKey]);

  const myTurn = view.phase === 'playing' && view.current === view.seat && view.legal !== null;
  const legal = view.legal ?? [];
  const teams = layout.teams;
  const hand = sortHand(view.myHand);

  const cands = candidates(legal, sel);
  const k = sel.prefix.length;
  const opts = nextMoves(cands, k);
  const onlyPlay = sel.card && cands.length === 1 && k === 0 ? cands[0]! : null;
  const voidPlay = sel.card ? completed(cands, k) : null;

  const submit = (p: Play) => {
    net.send({ t: 'play', card: p.card, ...(p.as ? { as: p.as } : {}), moves: p.moves });
    setSel(emptySel);
    setFocus(null);
  };

  const choose = (m: Move) => {
    const next: Selection = { ...sel, prefix: [...sel.prefix, m] };
    const c = candidates(legal, next);
    const done = completed(c, next.prefix.length);
    if (done && !c.some((p) => p.moves.length > next.prefix.length)) submit(done);
    else {
      setSel(next);
      setFocus(null);
    }
  };

  const onPeg = (id: number) => {
    if (!myTurn || !sel.card) return;
    if (focus !== null && focus !== id) {
      const sw = opts.find((m) => m.t === 'swap' && ((m.a === focus && m.b === id) || (m.a === id && m.b === focus)));
      if (sw) return choose(sw);
    }
    const mine = optionsForPeg(opts, id);
    if (mine.length === 0) return setFocus(null);
    if (mine.every((m) => m.t === 'swap')) return setFocus(id);
    if (mine.length === 1) return choose(mine[0]!);
    setFocus(id);
  };

  // Auswählbare Kugeln: nach dem ersten Tauschpartner nur noch dessen Partner
  let selectable = myTurn && sel.card ? movablePegs(opts) : new Set<number>();
  if (focus !== null) {
    const partners = new Set<number>();
    for (const m of optionsForPeg(opts, focus)) if (m.t === 'swap') partners.add(m.a === focus ? m.b : m.a);
    if (partners.size > 0) selectable = partners;
  }

  const markers: BoardMarker[] = [];
  if (myTurn && sel.card && focus !== null) {
    optionsForPeg(opts, focus).forEach((m, i) => {
      if (m.t !== 'start' && m.t !== 'move') return;
      const play = cands.find((p) => p.moves[k] && JSON.stringify(p.moves[k]) === JSON.stringify(m));
      const seven = play?.card === '7' || play?.as === '7';
      const after = applyMoveToPegs(view.pegs, layout, m, seven);
      const moved = after?.find((p) => p.id === m.peg);
      if (!moved) return;
      const pt = geo.peg(moved);
      markers.push({ id: String(i), x: pt.x, y: pt.y, label: m.t === 'start' ? 'Raus' : m.steps > 0 ? `+${m.steps}` : `${m.steps}` });
    });
  }
  const onMarker = (id: string) => {
    const m = optionsForPeg(opts, focus ?? -1).filter((x) => x.t === 'start' || x.t === 'move')[Number(id)];
    if (m) choose(m);
  };

  const stealOpts = opts.filter((m): m is Extract<Move, { t: 'steal' }> => m.t === 'steal');

  const playable = playableCards(legal);
  const clickCard = (c: Card) => {
    if (view.phase === 'exchange') return !view.exchangeDone[view.seat] && setXCard(c);
    if (!myTurn) return;
    setSel(sel.card === c ? emptySel : { card: c, prefix: [] });
    setFocus(null);
  };

  const prompt = (() => {
    if (view.phase === 'finished') return 'Spiel beendet';
    if (view.phase === 'exchange') return view.exchangeDone[view.seat] ? 'Warte auf die anderen Spieler …' : `Wähle eine Karte, die du an ${names[layout.giveTo[view.seat]!]} (${colorName(lobby.seats[layout.giveTo[view.seat]!]?.color ?? 0)}, Platz ${layout.giveTo[view.seat]! + 1}) abgibst.`;
    if (!myTurn) return `${names[view.current]} ist am Zug …`;
    if (!sel.card) return 'Du bist am Zug – wähle eine Karte.';
    if (stealOpts.length > 0) return 'Ziehe blind eine Karte eines Gegners.';
    if (sel.prefix.length > 0 && (sel.card === '7' || cands.some((p) => p.as === '7'))) return `7: noch ${sevenRemaining(sel.prefix)} Schritte verteilen – wähle die nächste Kugel.`;
    if (focus !== null && markers.length > 0) return 'Wähle das Ziel.';
    if (focus !== null) return 'Wähle die Kugel, mit der getauscht wird.';
    return selectable.size > 0 ? 'Wähle eine Kugel.' : 'Kein Zug mit dieser Karte.';
  })();

  const last = view.lastPlay;
  const finished = view.phase === 'finished';
  const winnerNames = view.winners?.map((p) => names[p]).join(' & ');
  const iWon = view.winners?.includes(view.seat);

  return (
    <div className="game">
      <div className="board-wrap">
        <Board
          layout={layout}
          geo={geo}
          pegs={view.pegs}
          segColors={segColors}
          segNames={segNames}
          activeSegs={activeSegs}
          selectable={selectable}
          focus={focus}
          markers={markers}
          onPeg={onPeg}
          onMarker={onMarker}
          centerLines={[`Runde ${view.round + 1}`, `Stapel: ${view.deckCount}`]}
        />
      </div>

      <aside className="side">
        <div className="card">
          <div className="row between">
            <b>Spiel {lobby.code}</b>
            <button onClick={() => confirm(isHost ? 'Spiel für alle beenden?' : 'Spiel verlassen? Ein Computer übernimmt deinen Platz.') && net.send({ t: 'leave' })}>
              {isHost ? 'Beenden' : 'Verlassen'}
            </button>
          </div>
          <ol className="players">
            {lobby.seats.map((s, p) => {
              const team = layout.teamOf[p]!;
              return (
                <li key={p} className={`player${view.current === p && view.phase === 'playing' ? ' turn' : ''}`}>
                  <span className="swatch" style={{ background: colorHex(s.color) }} title={colorName(s.color)} />
                  <span className="pn">
                    {names[p]}
                    {s.kind === 'bot' && <small> · {LEVEL_LABEL[s.level ?? 'intermediate']}</small>}
                    {p === view.seat && ' (du)'}
                    {teams && <small> · Team {String.fromCharCode(65 + team)}</small>}
                    {!s.connected && s.kind === 'human' && <small className="warn"> · getrennt</small>}
                  </span>
                  <span className="hs" title="Karten auf der Hand">🂠 {view.handSizes[p]}{view.phase === 'exchange' && view.exchangeDone[p] ? ' ✓' : ''}</span>
                  {isHost && s.kind === 'human' && !s.connected && (
                    <button onClick={() => net.send({ t: 'setBot', seat: p, level: 'intermediate' })}>durch Computer ersetzen</button>
                  )}
                  {view.phase === 'playing' && stealOpts.some((m) => m.from === p) && (
                    <span className="backs">
                      {stealOpts.filter((m) => m.from === p).map((m) => (
                        <button key={m.idx} className="back" aria-label="Karte ziehen" onClick={() => choose(m)} />
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="card status" aria-live="polite">
          <p className={myTurn || (view.phase === 'exchange' && !view.exchangeDone[view.seat]) ? 'prompt on' : 'prompt'}>{prompt}</p>
          {last && (
            <p className="muted">
              Letzter Zug – {names[last.player]}: Karte <b>{CARD_TEXT[last.card]}</b>
              {last.as ? ` als ${CARD_TEXT[last.as]}` : ''}
              {last.moves.length > 0 ? ` – ${last.moves.map((m) => moveText(m, names)).join(', ')}` : ' – ohne Wirkung'}
            </p>
          )}
          <div className="row">
            {view.phase === 'exchange' && !view.exchangeDone[view.seat] && (
              <button className="primary" disabled={!xCard} onClick={() => xCard && net.send({ t: 'exchange', card: xCard })}>Karte abgeben</button>
            )}
            {onlyPlay && <button className="primary" onClick={() => submit(onlyPlay)}>Zug ausführen</button>}
            {voidPlay && voidPlay.moves.length === 0 && <button onClick={() => submit(voidPlay)}>Ohne Wirkung ablegen</button>}
            {sel.card && sel.prefix.length > 0 && <button onClick={() => { setSel({ ...sel, prefix: sel.prefix.slice(0, -1) }); setFocus(null); }}>Letzten Schritt zurück</button>}
            {sel.card && <button onClick={() => { setSel(emptySel); setFocus(null); }}>Abbrechen</button>}
          </div>
        </div>

        <div className="hand" role="list" aria-label="Deine Karten">
          {hand.map((c, i) => {
            const selected = view.phase === 'exchange' ? xCard === c && hand.indexOf(c) === i : sel.card === c && hand.indexOf(c) === i;
            const usable = view.phase === 'exchange' ? !view.exchangeDone[view.seat] : myTurn && playable.has(c);
            return (
              <button
                key={`${c}${i}`}
                role="listitem"
                className={`pcard${selected ? ' selected' : ''}${usable ? '' : ' dim'}${c === 'J' || c === 'Q' || c === 'K' ? ' face' : ''}${c === 'JOKER' ? ' joker' : ''}`}
                disabled={!usable}
                onClick={() => clickCard(c)}
                aria-pressed={selected}
              >
                <span className="rank">{CARD_TEXT[c]}</span>
                <span className="hint">{cardHint(c, teams)}</span>
              </button>
            );
          })}
          {hand.length === 0 && <p className="muted">Keine Karten auf der Hand.</p>}
        </div>
      </aside>

      {finished && (
        <div className="overlay" role="dialog" aria-label="Spielende">
          <div className="card center">
            <h2>{iWon ? '🏆 Gewonnen!' : 'Spiel beendet'}</h2>
            <p>{teams ? 'Es gewinnt das Team' : 'Es gewinnt'}: <b>{winnerNames}</b></p>
            <div className="row">
              {isHost && <button className="primary" onClick={() => net.send({ t: 'rematch' })}>Neues Spiel in der Lobby</button>}
              {!isHost && <p className="muted">Der Spielinitiator kann ein neues Spiel starten.</p>}
              <button onClick={() => net.send({ t: 'leave' })}>Verlassen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Nur für Typprüfung der Positionen in Markern
export type { Pos };

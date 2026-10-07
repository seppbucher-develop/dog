import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyMoveToPegs, layoutFor, sevenNext, tryMove, type Card, type Move, type Peg, type Play, type Pos } from '@dog/engine';
import type { GameView, LobbyView } from '@dog/protocol';
import { Board, type BoardMarker, type Flight, type PileView } from './Board';
import { SUITS, reconcileSuits, suitFromNumber, type Suit } from './cards';
import { timing } from './speed';
import { NEUTRAL, colorHex, colorName } from './colors';
import { hasOriginalShape, makeGeo, type BoardStyle } from './geometry';
import { CARD_TEXT, LEVEL_LABEL, cardHint, moveText } from './labels';
import { net } from './net';
import { candidates, completed, emptySel, jokerRanks, movablePegs, nextMoves, optionsForPeg, playableCards, sevenClick, sevenTargets, sevenUndo, type Selection, type SevenStep } from './play';

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
    s.kind === 'bot' ? [names[i]!, LEVEL_LABEL[s.level ?? 'expert']!] : [names[i]!.length > 14 ? `${names[i]!.slice(0, 13)}…` : names[i]!],
  );

  const seatOfColor: number[] = [];
  layout.colorsOf.forEach((cs, p) => cs.forEach((c) => (seatOfColor[c] = p)));
  const segColors = Array.from({ length: layout.colors }, (_, c) => (seatOfColor[c] !== undefined ? colorHex(lobby.seats[seatOfColor[c]!]?.color ?? 0) : NEUTRAL));
  const segNames = Array.from({ length: layout.colors }, (_, c) => (seatOfColor[c] !== undefined ? boardLines[seatOfColor[c]!]! : []));
  // Beim Kartentausch ist noch niemand am Zug: dann zeigt der Pfeil, wer die Runde beginnt
  const activeSeat = view.phase === 'playing' ? view.current : view.phase === 'exchange' ? (view.dealer + 1) % view.handSizes.length : -1;
  const activeSegs = new Set<number>(layout.colorsOf[activeSeat] ?? []);
  const [style, setStyleState] = useState<BoardStyle>(() => {
    try {
      return localStorage.getItem('dog.boardStyle') === 'circle' ? 'circle' : 'original';
    } catch {
      return 'original';
    }
  });
  const setStyle = (v: BoardStyle) => {
    setStyleState(v);
    try {
      localStorage.setItem('dog.boardStyle', v);
    } catch {
      /* ohne Speicher weiterarbeiten */
    }
  };
  const geo = useMemo(() => makeGeo(layout, layout.colorsOf[view.seat]![0]!, style), [layout, view.seat, style]);

  const [sel, setSel] = useState<Selection>(emptySel);
  const [focus, setFocus] = useState<number | null>(null);
  const [xCard, setXCard] = useState<Card | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Nach dem Abschicken bleiben die Kugeln am Ziel stehen, bis der Server den neuen Stand schickt
  const [sentPegs, setSentPegs] = useState<Peg[] | null>(null);

  const speed = layout.rules.turnSpeed;
  const tm = timing(speed);

  // Farben der Handkarten (rein optisch), nachgeführt solange die Karte auf der Hand liegt
  const suitsRef = useRef(new Map<Card, Suit[]>());
  const playedRef = useRef<{ card: Card; suit: Suit } | null>(null);
  const handLen = useRef(view.myHand.length);
  suitsRef.current = reconcileSuits(suitsRef.current, view.myHand, playedRef.current, view.round * 977 + view.deckCount);
  if (view.myHand.length !== handLen.current) {
    handLen.current = view.myHand.length;
    playedRef.current = null;
  }
  const suitMap = suitsRef.current;

  // Ablegen: Karte fliegt zum Stapel, Kugeln folgen (ab Stufe 2 erst danach)
  const lp = view.lastPlay;
  const suitOfPlay = useRef(new Map<number, Suit>());
  const pileSuit = (n: number | undefined, fallback: number): Suit => (n !== undefined && suitOfPlay.current.get(n)) || suitFromNumber(n ?? fallback);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [heldPile, setHeldPile] = useState<PileView | null>(null);
  const [heldPegs, setHeldPegs] = useState<Peg[] | null>(null);
  const seenPlay = useRef(lp?.n ?? 0);
  const prevPegs = useRef(view.pegs);
  const prevPile = useRef<PileView>({ top: view.discardTop, count: view.discardCount, suit: pileSuit(lp?.n, view.discardCount) });
  useLayoutEffect(() => {
    if (lp?.n === undefined || lp.n === seenPlay.current) return;
    seenPlay.current = lp.n;
    const own = lp.player === view.seat ? playedRef.current : null;
    const suit = own && own.card === lp.card ? own.suit : suitFromNumber(lp.n);
    suitOfPlay.current.set(lp.n, suit);
    const nst = geo.nest(layout.colorsOf[lp.player]?.[0] ?? 0);
    setFlight({ key: lp.n, from: { x: nst.cx, y: nst.cy }, card: lp.card, suit, ms: tm.flight });
    setHeldPile(prevPile.current);
    const timers = [setTimeout(() => setHeldPile(null), tm.flight)];
    if (tm.sequential && lp.player !== view.seat) {
      setHeldPegs(prevPegs.current);
      timers.push(setTimeout(() => setHeldPegs(null), tm.flight));
    }
    return () => timers.forEach(clearTimeout);
  }, [lp?.n]);
  useEffect(() => {
    prevPegs.current = view.pegs;
    prevPile.current = { top: view.discardTop, count: view.discardCount, suit: pileSuit(lp?.n, view.discardCount) };
  });

  // Neuer Spielstand vom Server: angefangene Auswahl verwerfen
  const stateKey = JSON.stringify([view.phase, view.current, view.myHand, view.pegs.map((p) => p.pos)]);
  useEffect(() => {
    setSel(emptySel);
    setFocus(null);
    setXCard(null);
    setNote(null);
    setSentPegs(null);
  }, [stateKey]);

  // Lehnt der Server den Zug ab, kommt kein neuer Stand: nach kurzer Zeit wieder den echten Stand zeigen
  useEffect(() => {
    if (!sentPegs) return;
    const t = setTimeout(() => setSentPegs(null), 4000);
    return () => clearTimeout(t);
  }, [sentPegs]);

  const myTurn = view.phase === 'playing' && view.current === view.seat && view.legal !== null;
  const legal = view.legal ?? [];
  const teams = layout.teams;
  const hand = sortHand(view.myHand);
  const suitOf = (c: Card, i: number): Suit => suitMap.get(c)?.[hand.slice(0, i).filter((x) => x === c).length] ?? SUITS[0];

  // 7: Teilzüge in beliebiger Reihenfolge, aus der Stellung berechnet (nicht aus der zusammengefassten Zugliste)
  const isSeven = sel.card === '7' || (sel.card === 'JOKER' && sel.as === '7');
  const seven = myTurn && isSeven ? sevenNext(view.pegs, layout, view.seat, sel.prefix, sel.card === 'JOKER') : null;
  const cands = seven ? [] : candidates(legal, sel);
  const k = sel.prefix.length;
  const opts = seven ? seven.next : nextMoves(cands, k);
  const onlyPlay = sel.card && cands.length === 1 && k === 0 ? cands[0]! : null;
  const voidPlay = sel.card && !seven ? completed(cands, k) : null;

  const submit = (p: Play) => {
    const after = p.card === '7' || p.as === '7' ? sevenNext(view.pegs, layout, view.seat, p.moves, p.card === 'JOKER').pegs : p.moves.reduce<Peg[] | null>((ps, m) => (ps ? applyMoveToPegs(ps, layout, m, false) : null), view.pegs);
    if (after) setSentPegs(after);
    const suit = p.card === 'JOKER' ? undefined : suitMap.get(p.card)?.[0];
    if (suit) playedRef.current = { card: p.card, suit };
    net.send({ t: 'play', card: p.card, ...(p.as ? { as: p.as } : {}), moves: p.moves });
    setSel(emptySel);
    setFocus(null);
  };

  const choose = (m: Move) => {
    setNote(null);
    const next: Selection = { ...sel, prefix: [...sel.prefix, m] };
    if (isSeven && sel.card) {
      const r = sevenNext(view.pegs, layout, view.seat, next.prefix, sel.card === 'JOKER');
      if (r.pegs && r.remaining === 0) return submit({ card: sel.card, ...(sel.as ? { as: sel.as } : {}), moves: next.prefix });
      setSel(next);
      setFocus(null);
      return;
    }
    const c = candidates(legal, next);
    const done = completed(c, next.prefix.length);
    if (done && !c.some((p) => p.moves.length > next.prefix.length)) submit(done);
    else {
      setSel(next);
      setFocus(null);
    }
  };

  const applySeven = (r: SevenStep) => {
    if (!sel.card) return;
    if (r.done) return submit({ card: sel.card, ...(sel.as ? { as: sel.as } : {}), moves: r.prefix });
    setSel({ ...sel, prefix: r.prefix });
    setFocus(null);
  };

  const onPeg = (id: number) => {
    if (!myTurn || !sel.card) return;
    if (isSeven) {
      // 7: Kugel wählen, dann das Zielfeld anklicken
      const r = sevenClick(view.pegs, layout, view.seat, sel.prefix, id, sel.card === 'JOKER', undefined, true);
      if ('reason' in r) return setNote(r.reason);
      if (!('targets' in r) || r.targets.length === 0) return setNote('Diese Kugel kann mit der 7 nicht ziehen.');
      setNote(null);
      setFocus(id);
      return;
    }
    if (focus !== null && focus !== id) {
      const sw = opts.find((m) => m.t === 'swap' && ((m.a === focus && m.b === id) || (m.a === id && m.b === focus)));
      if (sw) return choose(sw);
    }
    const mine = optionsForPeg(opts, id);
    if (mine.length === 0) return setFocus(null);
    if (mine.every((m) => m.t === 'swap')) return setFocus(id);
    if (mine.length === 1) {
      const only = mine[0]!;
      // Joker: das Haus ist für die letzte Kugel gesperrt, es bleibt nur "vorbei" – nicht sofort ziehen, sondern erklären und bestätigen lassen
      if (sel.card === 'JOKER' && only.t === 'move' && only.pass && tryMove(view.pegs, layout, id, only.steps, false)) {
        setNote('Mit dem Joker darf die letzte Kugel nicht ins Haus – nur am Haus vorbei.');
        return setFocus(id);
      }
      return choose(only);
    }
    setFocus(id);
  };

  // Auswählbare Kugeln: nach dem ersten Tauschpartner nur noch dessen Partner
  let selectable = myTurn && sel.card ? movablePegs(opts) : new Set<number>();
  const clickable = myTurn && isSeven ? new Set(view.pegs.map((p) => p.id)) : undefined;
  if (focus !== null) {
    const partners = new Set<number>();
    for (const m of optionsForPeg(opts, focus)) if (m.t === 'swap') partners.add(m.a === focus ? m.b : m.a);
    if (partners.size > 0) selectable = partners;
  }

  const markers: BoardMarker[] = [];
  const sevenMarks = seven && focus !== null ? sevenTargets(view.pegs, layout, view.seat, sel.prefix, focus, sel.card === 'JOKER') : [];
  sevenMarks.forEach((t, i) => {
    const pt = geo.peg(t.peg);
    markers.push({ id: String(i), x: pt.x, y: pt.y, label: `+${t.steps}${t.pass ? ' vorbei' : ''}` });
  });
  if (myTurn && sel.card && focus !== null && !isSeven) {
    optionsForPeg(opts, focus).forEach((m, i) => {
      if (m.t !== 'start' && m.t !== 'move') return;
      const after = applyMoveToPegs(view.pegs, layout, m, isSeven);
      const moved = after?.find((p) => p.id === m.peg);
      if (!moved) return;
      const pt = geo.peg(moved);
      markers.push({ id: String(i), x: pt.x, y: pt.y, label: m.t === 'start' ? 'Raus' : m.steps > 0 ? `+${m.steps}${m.pass ? ' vorbei' : ''}` : `${m.steps}` });
    });
  }
  const onMarker = (id: string) => {
    if (isSeven) {
      const t = sevenMarks[Number(id)];
      if (t) applySeven(t.step);
      return;
    }
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
    setNote(null);
  };

  const starter = (view.dealer + 1) % view.handSizes.length;
  const prompt = (() => {
    if (view.phase === 'finished') return 'Spiel beendet';
    if (view.phase === 'exchange') return view.exchangeDone[view.seat] ? `Warte auf die anderen Spieler … (${names[starter]} beginnt)` : `Wähle eine Karte, die du an ${names[layout.giveTo[view.seat]!]} (${colorName(lobby.seats[layout.giveTo[view.seat]!]?.color ?? 0)}, Platz ${layout.giveTo[view.seat]! + 1}) abgibst. ${names[starter]} beginnt.`;
    if (!myTurn) return `${names[view.current]} ist am Zug …`;
    if (!sel.card) return 'Du bist am Zug – wähle eine Karte.';
    if (sel.card === 'JOKER' && !sel.as) return 'Joker: wähle, als welche Karte er gespielt wird.';
    if (stealOpts.length > 0) return selectable.size > 0 ? 'Wähle eine Kugel (2 Felder) oder ziehe blind eine Karte eines Gegners.' : 'Ziehe blind eine Karte eines Gegners.';
    if (seven) return `${note ? `${note} ` : ''}7: noch ${seven.remaining} Schritte – ${focus !== null ? 'wähle das Zielfeld.' : 'wähle eine Kugel.'}`;
    if (focus !== null && markers.length > 0) return `${note ? `${note} ` : ''}Wähle das Ziel.`;
    if (focus !== null) return 'Wähle die Kugel, mit der getauscht wird.';
    return selectable.size > 0 ? 'Wähle eine Kugel.' : 'Kein Zug mit dieser Karte.';
  })();

  const nPlayers = view.handSizes.length;
  let nextPlayer = -1;
  if (view.phase === 'playing') {
    for (let i = 1; i < nPlayers; i++) {
      const q = (view.current + i) % nPlayers;
      if (view.handSizes[q]! > 0) {
        nextPlayer = q;
        break;
      }
    }
  }
  const last = view.lastPlay;
  const finished = view.phase === 'finished';
  const winnerNames = view.winners?.map((p) => names[p]).join(' & ');
  const iWon = view.winners?.includes(view.seat);

  return (
    <div className="game">
      <div className="board-wrap" style={{ '--peg-ms': `${tm.peg}ms` } as React.CSSProperties}>
        <Board
          layout={layout}
          geo={geo}
          pegs={heldPegs ?? sentPegs ?? seven?.pegs ?? view.pegs}
          segColors={segColors}
          segNames={segNames}
          activeSegs={activeSegs}
          selectable={selectable}
          clickable={clickable}
          focus={focus}
          markers={markers}
          onPeg={onPeg}
          onMarker={onMarker}
          centerLines={[`Runde ${view.round + 1}`, `Stapel: ${view.deckCount}`, `Geber: ${names[view.dealer]}`]}
          pile={heldPile ?? prevPile.current}
          flight={flight}
        />
      </div>

      <aside className="side">
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
                {c !== 'JOKER' && <span className={`suit${suitOf(c, i) === '♥' || suitOf(c, i) === '♦' ? ' red' : ''}`} aria-label="Farbe">{suitOf(c, i)}</span>}
                <span className="hint">{cardHint(c, teams, layout.rules.fourDirection === 'both')}</span>
              </button>
            );
          })}
          {hand.length === 0 && <p className="muted">Keine Karten auf der Hand.</p>}
        </div>

        <div className="card status" aria-live="polite">
          <div className="controls">
          {myTurn && sel.card === 'JOKER' && (
            <div className="row joker-pick" role="group" aria-label="Joker einsetzen als">
              {jokerRanks(legal).map((r) => (
                <button key={r} className={sel.as === r ? 'primary' : ''} aria-pressed={sel.as === r} onClick={() => { setSel(sel.as === r ? { card: 'JOKER', prefix: [] } : { card: 'JOKER', as: r, prefix: [] }); setFocus(null); }}>
                  {CARD_TEXT[r]}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            {view.phase === 'exchange' && !view.exchangeDone[view.seat] && (
              <button className="primary" disabled={!xCard} onClick={() => xCard && net.send({ t: 'exchange', card: xCard })}>Karte abgeben</button>
            )}
            {onlyPlay && <button className="primary" onClick={() => submit(onlyPlay)}>Zug ausführen</button>}
            {voidPlay && voidPlay.moves.length === 0 && <button onClick={() => submit(voidPlay)}>Ohne Wirkung ablegen</button>}
            {sel.card && sel.prefix.length > 0 && <button onClick={() => { setSel({ ...sel, prefix: isSeven ? sevenUndo(sel.prefix) : sel.prefix.slice(0, -1) }); setFocus(null); setNote(null); }}>Letzten Schritt zurück</button>}
            {sel.card && <button onClick={() => { setSel(emptySel); setFocus(null); }}>Abbrechen</button>}
          </div>
          </div>
          {myTurn && stealOpts.length > 0 && (
            <div className="steal" role="group" aria-label="Karte eines Gegners ziehen">
              {lobby.seats.map((_, p) =>
                stealOpts.some((m) => m.from === p) ? (
                  <div key={p} className="steal-from">
                    <span className="muted">{names[p]}:</span>
                    <span className="backs">
                      {stealOpts.filter((m) => m.from === p).map((m) => (
                        <button key={m.idx} className="back" aria-label={`Karte von ${names[p]} ziehen`} onClick={() => choose(m)} />
                      ))}
                    </span>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <p className="muted">Am Startfeld: 🔒 frisch herausgekommen (sperrt, muss erst eine Runde laufen) · 🏠 Runde gelaufen (sperrt nicht, kann geschlagen werden, darf ins Zielhaus)</p>
          <p className={myTurn || (view.phase === 'exchange' && !view.exchangeDone[view.seat]) ? 'prompt on' : 'prompt'}>{prompt}</p>
          {(view.passes ?? []).slice(-3).map((e) => (
            <p key={e.id} className="muted warn">
              {names[e.player]}{e.player === view.seat ? ' (du)' : ''}: kein Zug möglich – {e.cards} {e.cards === 1 ? 'Karte' : 'Karten'} abgeworfen
            </p>
          ))}
          {last && (
            <p className="muted">
              Letzter Zug – {names[last.player]}: Karte <b>{CARD_TEXT[last.card]}</b>
              {last.as ? ` als ${CARD_TEXT[last.as]}` : ''}
              {last.moves.length > 0 ? ` – ${last.moves.map((m) => moveText(m, names)).join(', ')}` : ' – ohne Wirkung'}
            </p>
          )}
        </div>

        <div className="card">
          <div className="row between">
            <b>Spiel {lobby.code}</b>
            <button onClick={() => confirm(isHost ? 'Spiel für alle beenden?' : 'Spiel verlassen? Ein Computer übernimmt deinen Platz.') && net.send({ t: 'leave' })}>
              {isHost ? 'Beenden' : 'Verlassen'}
            </button>
          </div>
          {hasOriginalShape(layout.colors) && (
            <div className="row style-switch" role="group" aria-label="Brettform">
              <span className="muted">Brett:</span>
              <button aria-pressed={geo.style === 'original'} className={geo.style === 'original' ? 'primary' : ''} onClick={() => setStyle('original')}>Original</button>
              <button aria-pressed={geo.style === 'circle'} className={geo.style === 'circle' ? 'primary' : ''} onClick={() => setStyle('circle')}>Kreis</button>
            </div>
          )}
          <ol className="players">
            {lobby.seats.map((s, p) => {
              const team = layout.teamOf[p]!;
              return (
                <li key={p} className={`player${view.current === p && view.phase === 'playing' ? ' turn' : ''}`}>
                  <span className="swatch" style={{ background: colorHex(s.color) }} title={colorName(s.color)} />
                  <span className="pn">
                    {names[p]}
                    {s.kind === 'bot' && <small> · {LEVEL_LABEL[s.level ?? 'expert']}</small>}
                    {p === view.seat && ' (du)'}
                    {teams && <small> · Team {String.fromCharCode(65 + team)}</small>}
                    {!s.connected && s.kind === 'human' && <small className="warn"> · getrennt</small>}
                  </span>
                  {view.phase === 'playing' && view.current === p && <span className="tag now">am Zug</span>}
                  {view.dealer === p && view.phase !== 'finished' && <span className="tag" title="hat die Karten gegeben">Geber</span>}
                  {view.phase === 'exchange' && starter === p && <span className="tag now">beginnt</span>}
                  {nextPlayer === p && <span className="tag">als Nächster</span>}
                  <span className="hs" title="Karten auf der Hand">🂠 {view.handSizes[p]}{view.phase === 'exchange' && view.exchangeDone[p] ? ' ✓' : ''}</span>
                  {isHost && s.kind === 'human' && !s.connected && (
                    <button onClick={() => net.send({ t: 'setBot', seat: p, level: 'expert' })}>durch Computer ersetzen</button>
                  )}
                </li>
              );
            })}
          </ol>
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

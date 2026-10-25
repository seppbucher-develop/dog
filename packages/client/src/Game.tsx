import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMoveToPegs, layoutFor, sevenNext, tryMove, type Card, type Move, type Peg, type Play, type Pos } from '@dog/engine';
import type { GameView, LobbyView } from '@dog/protocol';
import { Board, type BoardMarker } from './Board';
import type { Spots } from './anim';
import { useAnimatedView } from './useAnimatedView';
import { isRedSuit, suitOf } from './cards';
import { timing } from './speed';
import { NEUTRAL, colorHex, colorName } from './colors';
import { hasOriginalShape, makeGeo, type BoardStyle } from './geometry';
import { CARD_TEXT, LEVEL_LABEL, cardHint, moveText } from './labels';
import { net } from './net';
import { candidates, completed, emptySel, jokerRanks, movablePegs, nextMoves, optionsForPeg, playableCards, sevenClick, sevenTargets, sevenUndo, type Selection, type SevenStep } from './play';

const ORDER: Card[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'JOKER'];

export function Game({ lobby, view }: { lobby: LobbyView; view: GameView | null }) {
  if (!view) return <div className="card center">Spiel wird geladen …</div>;
  return <GameInner lobby={lobby} view={view} />;
}

function GameInner({ lobby, view: live }: { lobby: LobbyView; view: GameView }) {
  const layout = useMemo(() => layoutFor(live.config), [live.config]);
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
  const geo = useMemo(() => makeGeo(layout, layout.colorsOf[live.seat]![0]!, style), [layout, live.seat, style]);

  const speed = layout.rules.turnSpeed;
  const tm = timing(speed);

  // Karten fliegen nacheinander (Spielen, Übergeben, Abwerfen, Austeilen); Hand, Stapel und Kugeln folgen erst bei der Ankunft
  const boardRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const spots: Spots = useMemo(
    () => ({
      nest: (seat) => {
        const n = geo.nest(layout.colorsOf[seat]?.[0] ?? 0);
        return { x: n.cx, y: n.cy };
      },
      pile: { x: geo.centre.x, y: geo.centre.y - 44 },
      deck: { x: geo.centre.x, y: geo.centre.y + 75 },
      // Mitte der Handkarte im Brett-Koordinatensystem, damit eigene Karten aus der Hand fliegen
      hand: (card, suit) => {
        const svg = boardRef.current?.querySelector('svg');
        const el = handRef.current?.querySelector<HTMLElement>(`[data-card="${card}"][data-suit="${card === 'JOKER' ? 0 : suit}"]`) ?? handRef.current?.querySelector<HTMLElement>(`[data-card="${card}"]`);
        const m = svg?.getScreenCTM();
        if (!svg || !el || !m) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0) return null;
        const pt = svg.createSVGPoint();
        pt.x = r.left + r.width / 2;
        pt.y = r.top + r.height / 2;
        const p = pt.matrixTransform(m.inverse());
        return { x: p.x, y: p.y };
      },
    }),
    [geo, layout],
  );
  const { view, flights, busy } = useAnimatedView(live, tm, spots);

  // Beim Kartentausch ist noch niemand am Zug: dann zeigt der Pfeil, wer die Runde beginnt
  const activeSeat = view.phase === 'playing' ? view.current : view.phase === 'exchange' ? (view.dealer + 1) % view.handSizes.length : -1;
  const activeSegs = new Set<number>(layout.colorsOf[activeSeat] ?? []);

  const [sel, setSel] = useState<Selection>(emptySel);
  const [focus, setFocus] = useState<number | null>(null);
  const [xCard, setXCard] = useState<Card | null>(null);
  /** Farbe der angeklickten Handkarte (bei mehreren Karten gleichen Werts) */
  const [pick, setPick] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Stufe 1 (Karte und Kugeln gleichzeitig): nach dem Abschicken bleiben die Kugeln am Ziel stehen, bis der Server den neuen Stand schickt
  const [sentPegs, setSentPegs] = useState<Peg[] | null>(null);
  // Zug abgeschickt, Antwort des Servers steht noch aus: keine zweite Eingabe
  const [sent, setSent] = useState(false);

  // Neuer Spielstand vom Server: angefangene Auswahl verwerfen
  const stateKey = JSON.stringify([view.phase, view.current, view.myHand, view.pegs.map((p) => p.pos)]);
  useEffect(() => {
    setSel(emptySel);
    setFocus(null);
    setXCard(null);
    setPick(null);
    setNote(null);
  }, [stateKey]);
  // Die Vorschau der 7 bleibt stehen, bis der Anzeigestand die Kugeln selbst am Ziel zeigt (sonst springen sie vorher auf die Ausgangsfelder zurück)
  const shownPegs = JSON.stringify(view.pegs.map((p) => p.pos));
  const sentFrom = useRef('');
  useEffect(() => {
    if (!sentPegs) return;
    // Stufe 1: Kugeln stehen schon am Ziel; ab Stufe 2: Anzeigestand zieht die Kugeln erst nach dem Kartenflug nach
    if (shownPegs === JSON.stringify(sentPegs.map((p) => p.pos)) || (tm.sequential && shownPegs !== sentFrom.current)) setSentPegs(null);
  }, [shownPegs, sentPegs]);
  useEffect(() => setSent(false), [live]);

  // Lehnt der Server den Zug ab, kommt kein neuer Stand: nach kurzer Zeit wieder den echten Stand zeigen
  useEffect(() => {
    if (!sentPegs && !sent) return;
    const t = setTimeout(() => {
      setSentPegs(null);
      setSent(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [sentPegs, sent]);

  const myTurn = view.phase === 'playing' && view.current === view.seat && view.legal !== null && !busy && !sent;
  const legal = view.legal ?? [];
  const teams = layout.teams;
  // Handkarten mit Farbe; eine fliegende Karte erscheint erst bei der Ankunft (Anzeigestand `view`)
  const hand = useMemo(() => {
    const cards = view.myHand.map((card, i) => ({ card, suit: view.mySuits[i] ?? 0 }));
    return cards.sort((a, b) => ORDER.indexOf(a.card) - ORDER.indexOf(b.card) || a.suit - b.suit);
  }, [view.myHand, view.mySuits]);
  /** Farbe der gewählten Karte dieses Rangs: die angeklickte, sonst die erste auf der Hand */
  const suitFor = (c: Card): number | undefined => {
    if (c === 'JOKER') return undefined;
    const ofRank = hand.filter((h) => h.card === c);
    return ofRank.some((h) => h.suit === pick) ? pick! : ofRank[0]?.suit;
  };

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
    const seven7 = p.card === '7' || p.as === '7';
    // Ab Stufe 2 ziehen die Kugeln erst nach dem Kartenflug: bis dahin bleibt die zuletzt gezeigte Vorschau der 7 (ohne den letzten Klick) stehen (kein Rücksprung auf die Ausgangsfelder)
    const hold = !tm.sequential ? after : seven7 ? seven?.pegs ?? null : null;
    sentFrom.current = shownPegs;
    if (hold) setSentPegs(hold);
    setSent(true);
    const suit = suitFor(p.card);
    net.send({ t: 'play', card: p.card, ...(suit !== undefined ? { suit } : {}), ...(p.as ? { as: p.as } : {}), moves: p.moves });
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

  // Einzelspiel, Kartentausch: blind eine Karte vom rechten Nachbarn (nächster Spieler) ziehen
  const drawing = view.phase === 'exchange' && !layout.teams && !busy;
  const rightSeat = (view.seat + 1) % view.handSizes.length;
  const stealOpts = opts.filter((m): m is Extract<Move, { t: 'steal' }> => m.t === 'steal');

  const playable = playableCards(legal);
  const clickCard = (c: Card, suit: number) => {
    if (view.phase === 'exchange') {
      if (view.exchangeDone[view.seat] || drawing || busy) return;
      setXCard(c);
      return setPick(suit);
    }
    if (!myTurn) return;
    const same = sel.card === c && (c === 'JOKER' || suitFor(c) === suit);
    if (same) setSel(emptySel);
    else if (sel.card !== c) setSel({ card: c, prefix: [] });
    setPick(suit);
    setFocus(null);
    setNote(null);
  };

  const starter = (view.dealer + 1) % view.handSizes.length;
  const prompt = (() => {
    if (view.phase === 'finished') return 'Spiel beendet';
    if (drawing) return view.exchangeDone[view.seat] ? `Warte auf die anderen Spieler … (${names[starter]} beginnt)` : `Ziehe blind eine Karte von ${names[rightSeat]} (rechter Nachbar). ${names[starter]} beginnt.`;
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
      <div className="board-wrap" ref={boardRef} style={{ '--peg-ms': `${tm.peg}ms` } as React.CSSProperties}>
        <Board
          layout={layout}
          geo={geo}
          pegs={seven?.pegs ?? sentPegs ?? view.pegs}
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
          handCounts={lobby.seats.map((s, p) => ({ name: names[p]!, color: colorHex(s.color), n: view.handSizes[p] ?? 0, turn: view.phase === 'playing' && view.current === p }))}
          pile={{ top: view.discardTop, count: view.discardCount, suit: suitOf(view.discardSuit) }}
          flights={flights}
        />
      </div>

      <aside className="side">
        <div className="hand" role="list" aria-label="Deine Karten" ref={handRef}>
          {hand.map(({ card: c, suit }, i) => {
            const mark = view.phase === 'exchange' ? xCard : sel.card;
            const selected = mark === c && (c === 'JOKER' || suitFor(c) === suit) && hand.findIndex((h) => h.card === c && h.suit === suit) === i;
            const usable = view.phase === 'exchange' ? !view.exchangeDone[view.seat] && !drawing && !busy : myTurn && playable.has(c);
            const sym = suitOf(suit);
            return (
              <button
                key={`${c}${suit}${i}`}
                role="listitem"
                data-card={c}
                data-suit={suit}
                className={`pcard${selected ? ' selected' : ''}${usable ? '' : ' dim'}${c === 'J' || c === 'Q' || c === 'K' ? ' face' : ''}${c === 'JOKER' ? ' joker' : ''}`}
                disabled={!usable}
                onClick={() => clickCard(c, suit)}
                aria-pressed={selected}
              >
                <span className="rank">{CARD_TEXT[c]}</span>
                {c !== 'JOKER' && <span className={`suit${isRedSuit(sym) ? ' red' : ''}`} aria-label="Farbe">{sym}</span>}
                <span className="hint">{cardHint(c, teams, layout.rules.fourDirection === 'both')}</span>
              </button>
            );
          })}
          {hand.length === 0 && <p className="muted">Keine Karten auf der Hand.</p>}
        </div>

        {view.gave.length > 0 && (
          <div className="card gave" aria-label="Abgegebene Karten">
            <strong>Von dir abgegeben</strong>
            <ul>
              {view.gave.map((g) => {
                const sym = suitOf(g.suit);
                return (
                  <li key={g.id} className={g.held ? 'held' : 'gone'}>
                    <span className="gcard">
                      <span className={g.card !== 'JOKER' && isRedSuit(sym) ? 'red' : ''}>{CARD_TEXT[g.card]}{g.card !== 'JOKER' && sym}</span>
                    </span>
                    <span>an {names[g.to]}: {g.held ? 'noch auf der Hand' : 'schon gespielt'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

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
              <button className="primary" disabled={!xCard} onClick={() => xCard && net.send({ t: 'exchange', card: xCard, ...(suitFor(xCard) !== undefined ? { suit: suitFor(xCard)! } : {}) })}>Karte abgeben</button>
            )}
            {onlyPlay && <button className="primary" onClick={() => submit(onlyPlay)}>Zug ausführen</button>}
            {voidPlay && voidPlay.moves.length === 0 && <button onClick={() => submit(voidPlay)}>Ohne Wirkung ablegen</button>}
            {sel.card && sel.prefix.length > 0 && <button onClick={() => { setSel({ ...sel, prefix: isSeven ? sevenUndo(sel.prefix) : sel.prefix.slice(0, -1) }); setFocus(null); setNote(null); }}>Letzten Schritt zurück</button>}
            {sel.card && <button onClick={() => { setSel(emptySel); setFocus(null); }}>Abbrechen</button>}
          </div>
          </div>
          {drawing && !view.exchangeDone[view.seat] && (
            <div className="steal" role="group" aria-label="Karte vom rechten Nachbarn ziehen">
              <div className="steal-from">
                <span className="muted">{names[rightSeat]}:</span>
                <span className="backs">
                  {Array.from({ length: view.handSizes[rightSeat] ?? 0 }, (_, idx) => (
                    <button key={idx} className="back" aria-label={`Karte von ${names[rightSeat]} ziehen`} onClick={() => net.send({ t: 'draw', idx })} />
                  ))}
                </span>
              </div>
            </div>
          )}
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

import { useEffect, useRef, useState } from 'react';
import type { Opening as OpeningData } from '@dog/engine';
import { isRedSuit, suitOf } from './cards';
import { CARD_TEXT } from './labels';

/** Zeit zwischen zwei Karten, Pause nach einer Ziehrunde und nach dem Sieger (ms) */
const DEAL_STEP = 450;
const ROUND_PAUSE = 1600;
const WINNER_PAUSE = 2400;

/**
 * Zu Spielbeginn: Der Stapel wird gemischt und jeder Spieler bekommt eine offene Karte. Die höchste Karte
 * beginnt; bei Gleichstand wird alles wiederholt.
 */
export function OpeningDraw({ opening, names, me, onDone }: { opening: OpeningData; names: string[]; me: number; onDone: () => void }) {
  const [round, setRound] = useState(0);
  const [shown, setShown] = useState(0);
  const [resolved, setResolved] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  const last = round === opening.rounds.length - 1;
  const cards = opening.rounds[round] ?? [];

  useEffect(() => {
    setShown(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    cards.forEach((_, p) => timers.push(setTimeout(() => setShown(p + 1), p * DEAL_STEP + 150)));
    const dealt = cards.length * DEAL_STEP + 150;
    if (last) {
      timers.push(setTimeout(() => setResolved(true), dealt + 400));
      timers.push(setTimeout(() => done.current(), dealt + 400 + WINNER_PAUSE));
    } else {
      timers.push(setTimeout(() => setRound((r) => r + 1), dealt + ROUND_PAUSE));
    }
    return () => timers.forEach(clearTimeout);
  }, [round]);

  const tied = !last;
  const best = cards.length ? Math.max(...cards.map((_, p) => strength(cards[p]!.card))) : 0;
  return (
    <div className="card opening" role="dialog" aria-label="Ziehen um den ersten Spieler">
      <h2>Wer beginnt?</h2>
      <p className="muted">
        {opening.rounds.length > 1 ? `Gleichstand – Ziehung ${round + 1} von ${opening.rounds.length}. ` : ''}
        Jeder zieht eine Karte, die höchste beginnt.
      </p>
      <div className="opening-seats">
        {cards.map((c, p) => {
          const visible = p < shown;
          const sym = suitOf(c.suit);
          const top = visible && strength(c.card) === best;
          const win = resolved && p === opening.winner;
          return (
            <div key={`${round}-${p}`} className={`opening-seat${win ? ' winner' : ''}${tied && top && shown >= cards.length ? ' tie' : ''}`}>
              <div className={`ocard${visible ? ' dealt' : ''}${c.card === 'JOKER' ? ' joker' : ''}`}>
                <span className="rank">{CARD_TEXT[c.card]}</span>
                {c.card !== 'JOKER' && <span className={`suit${isRedSuit(sym) ? ' red' : ''}`}>{sym}</span>}
              </div>
              <span className="oname">{names[p]}{p === me ? ' (du)' : ''}</span>
            </div>
          );
        })}
      </div>
      <p className="opening-result">{resolved ? `${names[opening.winner]} beginnt!` : tied && shown >= cards.length ? 'Gleichstand – es wird neu gezogen …' : ' '}</p>
      <button onClick={() => done.current()}>Überspringen</button>
    </div>
  );
}

const ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', 'JOKER'];
const strength = (c: string) => ORDER.indexOf(c);

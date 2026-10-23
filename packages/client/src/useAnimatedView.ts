import { useEffect, useRef, useState } from 'react';
import type { GameView } from '@dog/protocol';
import { beforeFirstDeal, isFreshGame, planTransition, type Spots } from './anim';
import type { Flight } from './Board';
import type { Timing } from './speed';

/** Stehen so viele Stände an (Tab im Hintergrund, Verbindungsabriss), wird nicht mehr animiert, sondern aufgeholt */
const MAX_QUEUE = 3;

export interface Animated {
  /** Spielstand, wie er gerade angezeigt wird (Hand, Stapel, Kugeln folgen den Kartenflügen) */
  view: GameView;
  flights: Flight[];
  /** Eine Animation läuft oder steht an: keine Eingaben annehmen */
  busy: boolean;
}

/**
 * Zeigt Spielstände vom Server nacheinander: zuerst fliegen die Karten, erst bei der Ankunft ändern sich Hand, Stapel
 * und Kartenzahlen, danach laufen die Kugeln. Der echte Stand (Zug, Phase, erlaubte Züge) gilt erst nach dem letzten Schritt.
 */
export function useAnimatedView(live: GameView, tm: Timing, spots: Spots): Animated {
  const initial = isFreshGame(live) ? beforeFirstDeal(live) : live;
  const [shown, setShown] = useState<GameView>(initial);
  const [patch, setPatch] = useState<Partial<GameView>>({});
  const [flights, setFlights] = useState<Flight[]>([]);
  const [busy, setBusy] = useState(false);
  const shownRef = useRef(initial);
  const queue = useRef<GameView[]>([]);
  const running = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const keys = useRef(0);
  const cfg = useRef({ tm, spots });
  cfg.current = { tm, spots };

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const commit = (v: GameView) => {
    shownRef.current = v;
    setShown(v);
    setPatch({});
    setFlights([]);
  };
  const later = (ms: number, fn: () => void) => {
    if (ms <= 0) fn();
    else timers.current.push(setTimeout(fn, ms));
  };

  const start = (next: GameView) => {
    const plan = planTransition(shownRef.current, next, cfg.current.tm, cfg.current.spots);
    if (plan.total === 0) {
      commit(next);
      return;
    }
    running.current = true;
    setBusy(true);
    for (const f of plan.frames) later(f.at, () => setPatch(f.patch));
    for (const { at, spec } of plan.flights) {
      const flight: Flight = { ...spec, key: ++keys.current };
      later(at, () => setFlights((cur) => [...cur, flight]));
      later(at + spec.ms + (spec.delay ?? 0), () => setFlights((cur) => cur.filter((x) => x !== flight)));
    }
    later(Math.max(plan.total, 1), () => {
      commit(next);
      const following = queue.current.shift();
      if (following) return start(following);
      running.current = false;
      setBusy(false);
    });
  };

  useEffect(() => {
    if (live === shownRef.current) return;
    if (running.current) {
      queue.current.push(live);
      if (queue.current.length > MAX_QUEUE) {
        clear();
        queue.current = [];
        running.current = false;
        commit(live);
        setBusy(false);
      }
      return;
    }
    start(live);
  }, [live]);
  useEffect(
    () => () => {
      clear();
      running.current = false;
      queue.current = [];
    },
    [],
  );

  return { view: { ...shown, ...patch }, flights, busy };
}

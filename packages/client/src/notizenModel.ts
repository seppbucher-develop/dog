/** Notizen: Liste von Zeilen, jede wahlweise Text oder Todo mit Checkbox. Reine Logik, ohne React. */
export interface Zeile {
  id: string;
  todo: boolean;
  erledigt: boolean;
  text: string;
}

export const NOTIZEN_KEY = 'dog.notizen';

let zaehler = 0;
export function neueZeile(todo = false, text = ''): Zeile {
  zaehler += 1;
  return { id: `${Date.now().toString(36)}${zaehler.toString(36)}${Math.random().toString(36).slice(2, 6)}`, todo, erledigt: false, text };
}

export function ladeNotizen(): Zeile[] {
  try {
    const roh = JSON.parse(localStorage.getItem(NOTIZEN_KEY) ?? '[]') as unknown;
    if (!Array.isArray(roh)) return [];
    return roh
      .filter((z): z is Zeile => !!z && typeof z.id === 'string' && typeof z.text === 'string')
      .map((z) => ({ id: z.id, todo: !!z.todo, erledigt: !!z.todo && !!z.erledigt, text: z.text }));
  } catch {
    return [];
  }
}

export function speichereNotizen(liste: Zeile[]): void {
  try {
    localStorage.setItem(NOTIZEN_KEY, JSON.stringify(liste));
  } catch {
    /* Speicher gesperrt (privater Modus): Notizen gelten nur bis zum Neuladen */
  }
}

const ersetze = (l: Zeile[], id: string, f: (z: Zeile) => Zeile): Zeile[] => l.map((z) => (z.id === id ? f(z) : z));

export const setzeText = (l: Zeile[], id: string, text: string) => ersetze(l, id, (z) => ({ ...z, text }));
export const setzeErledigt = (l: Zeile[], id: string, erledigt: boolean) => ersetze(l, id, (z) => ({ ...z, erledigt }));
export const schalteTodo = (l: Zeile[], id: string) => ersetze(l, id, (z) => ({ ...z, todo: !z.todo, erledigt: false }));

/** Enter: neue Zeile darunter (Todos bleiben Todos). */
export function fuegeDarunterEin(l: Zeile[], id: string, neu: Zeile): Zeile[] {
  const i = l.findIndex((z) => z.id === id);
  return [...l.slice(0, i + 1), neu, ...l.slice(i + 1)];
}

export const entferneZeile = (l: Zeile[], id: string) => l.filter((z) => z.id !== id);
export const raeumeAuf = (l: Zeile[]) => l.filter((z) => !(z.todo && z.erledigt));
export const hatErledigte = (l: Zeile[]) => l.some((z) => z.todo && z.erledigt);

/**
 * Mehrzeiliger Text wird auf mehrere Zeilen verteilt; "- [ ] " / "- [x] " am Zeilenanfang ergibt Todos.
 * `vorne`/`hinten` ist der Text links/rechts der Einfügestelle in der aktuellen Zeile.
 */
export function fuegeTextEin(l: Zeile[], id: string, vorne: string, text: string, hinten: string): { liste: Zeile[]; letzte: string } {
  const z = l.find((x) => x.id === id);
  const teile = text.replace(/\r/g, '').split('\n').filter((t, i, a) => t !== '' || i < a.length - 1);
  const neue = teile.map((t, i) => {
    const k = neueZeile(!!z?.todo);
    const m = /^\s*[-*]\s\[( |x|X)\]\s?(.*)$/.exec(t);
    if (m) {
      k.todo = true;
      k.erledigt = m[1] !== ' ';
      k.text = m[2] ?? '';
    } else k.text = t;
    if (i === 0) k.text = vorne + k.text;
    if (i === teile.length - 1) k.text += hinten;
    return k;
  });
  const i = l.findIndex((x) => x.id === id);
  return { liste: [...l.slice(0, i), ...neue, ...l.slice(i + 1)], letzte: neue[neue.length - 1]!.id };
}

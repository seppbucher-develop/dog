import { beforeEach, describe, expect, it } from 'vitest';
import {
  NOTIZEN_KEY, fuegeDarunterEin, fuegeTextEin, hatErledigte, ladeNotizen, neueZeile, raeumeAuf, schalteTodo,
  setzeErledigt, speichereNotizen,
} from '../src/notizenModel';

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
  };
});

describe('Notizen', () => {
  it('speichert und lädt; kaputte Daten ergeben eine leere Liste', () => {
    const l = [neueZeile(true, 'a'), neueZeile(false, 'b')];
    speichereNotizen(l);
    expect(ladeNotizen()).toEqual(l);
    mem.set(NOTIZEN_KEY, '{kaputt');
    expect(ladeNotizen()).toEqual([]);
  });

  it('Todo umschalten setzt erledigt zurück; Aufräumen entfernt nur erledigte Todos', () => {
    let l = [neueZeile(true, 'a'), neueZeile(true, 'b'), neueZeile(false, 'c')];
    l = setzeErledigt(l, l[0]!.id, true);
    expect(hatErledigte(l)).toBe(true);
    expect(raeumeAuf(l).map((z) => z.text)).toEqual(['b', 'c']);
    expect(schalteTodo(l, l[0]!.id)[0]!).toMatchObject({ todo: false, erledigt: false });
  });

  it('Enter fügt darunter ein', () => {
    const l = [neueZeile(false, 'a'), neueZeile(false, 'b')];
    const neu = neueZeile();
    expect(fuegeDarunterEin(l, l[0]!.id, neu).map((z) => z.id)).toEqual([l[0]!.id, neu.id, l[1]!.id]);
  });

  it('Einfügen verteilt Zeilen und erkennt "- [x]" als erledigtes Todo', () => {
    const l = [neueZeile(false, 'xy')];
    const r = fuegeTextEin(l, l[0]!.id, 'x', 'eins\n- [x] zwei', 'y');
    expect(r.liste.map((z) => [z.todo, z.erledigt, z.text])).toEqual([[false, false, 'xeins'], [true, true, 'zweiy']]);
    expect(r.letzte).toBe(r.liste[1]!.id);
  });
});

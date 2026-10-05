import { useEffect, useRef, useState } from 'react';
import {
  NOTIZEN_KEY, entferneZeile, fuegeDarunterEin, fuegeTextEin, hatErledigte, ladeNotizen, neueZeile, raeumeAuf,
  schalteTodo, setzeErledigt, setzeText, speichereNotizen, type Zeile,
} from './notizenModel';

/** Textfeld wächst mit dem Inhalt (lange Notizen brechen um statt abzuschneiden). */
function passeHoeheAn(el: HTMLTextAreaElement) {
  if (!el.scrollHeight) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** Notizen auf der Startseite; gespeichert nur im Browser (localStorage). */
export function Notizen() {
  const [liste, setListe] = useState<Zeile[]>(ladeNotizen);
  const [platzhalter, setPlatzhalter] = useState(() => neueZeile());
  const aktiv = useRef<string | null>(null);
  const fokus = useRef<{ id: string; ende: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Änderungen aus einem anderen Tab übernehmen.
  useEffect(() => {
    const f = (e: StorageEvent) => { if (e.key === NOTIZEN_KEY || e.key === null) setListe(ladeNotizen()); };
    window.addEventListener('storage', f);
    return () => window.removeEventListener('storage', f);
  }, []);

  useEffect(() => {
    if (!fokus.current) return;
    const input = root.current?.querySelector<HTMLTextAreaElement>(`[data-id="${fokus.current.id}"] .notizen-text`);
    if (input) {
      input.focus();
      if (fokus.current.ende) input.setSelectionRange(input.value.length, input.value.length);
    }
    fokus.current = null;
  });

  // Leere Notiz: die Platzhalterzeile wird erst beim ersten Tippen übernommen.
  const aendere = (f: (l: Zeile[]) => Zeile[]) => {
    let basis = liste;
    if (basis.length === 0) {
      basis = [platzhalter];
      setPlatzhalter(neueZeile());
    }
    const neu = f(basis);
    setListe(neu);
    speichereNotizen(neu);
  };

  const anzeige = liste.length ? liste : [platzhalter];
  const nachbar = (id: string, d: -1 | 1) => anzeige[anzeige.findIndex((z) => z.id === id) + d]?.id;

  const taste = (e: React.KeyboardEvent<HTMLTextAreaElement>, z: Zeile) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const neu = neueZeile(z.todo);
      aendere((l) => fuegeDarunterEin(l, z.id, neu));
      fokus.current = { id: neu.id, ende: true };
    } else if (e.key === 'Backspace' && e.currentTarget.value === '') {
      if (z.todo) {
        e.preventDefault();
        aendere((l) => schalteTodo(l, z.id));
        fokus.current = { id: z.id, ende: true };
      } else if (liste.length > 1) {
        e.preventDefault();
        fokus.current = { id: nachbar(z.id, -1) ?? nachbar(z.id, 1)!, ende: true };
        aendere((l) => entferneZeile(l, z.id));
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const id = nachbar(z.id, e.key === 'ArrowUp' ? -1 : 1);
      if (id) {
        e.preventDefault();
        fokus.current = { id, ende: true };
        setListe((l) => [...l]);
      }
    }
  };

  const einfuegen = (e: React.ClipboardEvent<HTMLTextAreaElement>, z: Zeile) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    const inp = e.currentTarget;
    const vorne = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
    const hinten = inp.value.slice(inp.selectionEnd ?? inp.value.length);
    aendere((l) => {
      const r = fuegeTextEin(l, z.id, vorne, text, hinten);
      fokus.current = { id: r.letzte, ende: true };
      return r.liste;
    });
  };

  const todoUmschalten = () => {
    const id = anzeige.some((z) => z.id === aktiv.current) ? aktiv.current! : anzeige[anzeige.length - 1]!.id;
    aendere((l) => schalteTodo(l, id));
    fokus.current = { id, ende: true };
  };

  return (
    <details className="card notizen">
      <summary><h2>📝 Notizen</h2></summary>
      <p className="muted">
        Freie Notizen, zum Beispiel für Hausregeln. „☑ Todo“ macht die aktuelle Zeile zu einem Todo (nochmals klicken = wieder Text).
        Enter = neue Zeile, Rückschritt in leerer Zeile = Zeile entfernen. Nur in diesem Browser gespeichert.
      </p>
      <div className="row">
        <button type="button" onClick={todoUmschalten}>☑ Todo</button>
        <button
          type="button"
          disabled={!hatErledigte(liste)}
          onClick={() => { if (confirm('Alle erledigten Todos entfernen?')) aendere(raeumeAuf); }}
        >
          Erledigte entfernen
        </button>
      </div>
      <div className="notizen-editor" ref={root}>
        {anzeige.map((z) => (
          <div key={z.id} data-id={z.id} className={`notizen-row${z.todo && z.erledigt ? ' notizen-erledigt' : ''}`}>
            {z.todo && (
              <input
                type="checkbox"
                className="notizen-check"
                aria-label="Erledigt"
                checked={z.erledigt}
                onChange={(e) => aendere((l) => setzeErledigt(l, z.id, e.target.checked))}
              />
            )}
            <textarea
              rows={1}
              className="notizen-text"
              value={z.text}
              placeholder={anzeige.length <= 1 ? 'Notiz schreiben …' : ''}
              onFocus={() => { aktiv.current = z.id; }}
              onChange={(e) => { passeHoeheAn(e.target); aendere((l) => setzeText(l, z.id, e.target.value)); }}
              ref={(el) => { if (el) passeHoeheAn(el); }}
              onKeyDown={(e) => taste(e, z)}
              onPaste={(e) => einfuegen(e, z)}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

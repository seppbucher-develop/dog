import { useState } from 'react';
import { net, saveName, savedName } from './net';

export function Landing() {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(new URLSearchParams(location.search).get('code')?.toUpperCase() ?? '');
  const ok = name.trim().length > 0;

  const create = () => {
    saveName(name.trim());
    net.send({ t: 'create', name: name.trim() });
  };
  const join = () => {
    saveName(name.trim());
    net.send({ t: 'join', code: code.trim().toUpperCase(), name: name.trim() });
    history.replaceState(null, '', location.pathname);
  };

  return (
    <div className="landing">
      <h1>Dog</h1>
      <p className="lead">Das Kartenbrettspiel für 2 bis 6 Spieler – online mit Freunden und Computerspielern.</p>
      <div className="card">
        <label>
          Dein Name
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="z. B. Sepp" autoFocus />
        </label>
        <div className="split">
          <div>
            <h3>Neues Spiel</h3>
            <p className="muted">Du bist Initiator: du legst Plätze, Computerspieler und Regeln fest und bewilligst Mitspieler.</p>
            <button className="primary" disabled={!ok} onClick={create}>Spiel erstellen</button>
          </div>
          <div>
            <h3>Beitreten</h3>
            <p className="muted">Gib den Code ein, den du vom Initiator bekommen hast.</p>
            <label>
              Spielcode
              <input className="code" value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE" />
            </label>
            <button className="primary" disabled={!ok || code.trim().length < 3} onClick={join}>Beitreten</button>
          </div>
        </div>
      </div>
    </div>
  );
}

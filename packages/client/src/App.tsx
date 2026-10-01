import { net, useNet } from './net';
import { Landing } from './Landing';
import { Lobby } from './Lobby';
import { Game } from './Game';
import { isOutdated, useVersion } from './version';

export function App() {
  const s = useNet();
  const { lobby } = s;
  const ver = useVersion();

  let body;
  if (s.closed) {
    body = (
      <div className="card center">
        <h2>Spiel beendet</h2>
        <p>{s.closed}</p>
        <button className="primary" onClick={() => net.dismissClosed()}>OK</button>
      </div>
    );
  } else if (!lobby) {
    body = <Landing />;
  } else if (lobby.you.status === 'pending') {
    body = (
      <div className="card center">
        <h2>Anfrage gesendet</h2>
        <p>Spiel <b>{lobby.code}</b> – warte auf die Bewilligung durch den Spielinitiator …</p>
        <button onClick={() => net.send({ t: 'leave' })}>Abbrechen</button>
      </div>
    );
  } else if (lobby.you.status === 'rejected') {
    body = (
      <div className="card center">
        <h2>Abgelehnt</h2>
        <p>Der Spielinitiator hat deine Anfrage nicht bewilligt.</p>
        <button className="primary" onClick={() => net.send({ t: 'leave' })}>Zurück</button>
      </div>
    );
  } else if (lobby.phase === 'lobby') {
    body = <Lobby lobby={lobby} />;
  } else {
    body = <Game lobby={lobby} view={s.game} />;
  }

  return (
    <div className="app">
      {s.conn !== 'open' && <div className="banner">{s.conn === 'connecting' ? 'Verbinde …' : 'Verbindung unterbrochen – versuche erneut …'}</div>}
      {isOutdated(ver) && (
        <div className="banner update" role="status">
          Es gibt eine neue Version. <button onClick={() => location.reload()}>Neu laden</button>
        </div>
      )}
      {s.error && (
        <div className="toast" role="alert" onClick={() => net.clearError()}>
          {s.error}
        </div>
      )}
      {body}
      {ver.current && <footer className="version">Version {ver.current}</footer>}
    </div>
  );
}

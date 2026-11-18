import { useEffect } from 'react';

/** Hilfe zur Spiellobby und zu den Kurzregeln (Overlay, schliesst mit Esc oder Klick daneben). */
export function Help({ isHost, onClose }: { isHost: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Hilfe" onClick={onClose}>
      <div className="card help" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Hilfe</h2>
          <button onClick={onClose} aria-label="Hilfe schliessen">✕</button>
        </div>

        <h3>Die Spiellobby</h3>
        {isHost ? (
          <ul>
            <li><b>Einladen:</b> Gib den Code weiter oder kopiere den Einladungslink. Wer beitritt, erscheint unter «Beitrittsanfragen» – dort <b>Bewilligen</b> (mit Platz und Farbe) oder <b>Ablehnen</b>.</li>
            <li><b>Spieler und Plätze:</b> Wähle die Anzahl (2–6), je Platz «Mensch (online)» oder einen Computer (Anfänger bis Experte), die Kugelfarbe und mit ↑ ↓ die Sitzordnung. ✕ entfernt einen Mitspieler.</li>
            <li><b>Teams:</b> Bei 4 und 6 Spielern sitzen Partner gegenüber; bei 2, 3 und 5 spielt jeder für sich. Bei 2 Spielern gibt es optional 8 Kugeln.</li>
            <li><b>Einstellungen:</b> Hausregeln und Zuggeschwindigkeit; sie gelten für alle.</li>
            <li><b>Spiel starten</b> geht erst, wenn alle Plätze besetzt sind (Computer zählen als besetzt). <b>Spiel beenden</b> schliesst die Lobby für alle.</li>
          </ul>
        ) : (
          <ul>
            <li>Der Spielinitiator legt Plätze, Farben und Regeln fest und startet das Spiel – bis dahin wartest du in der Lobby.</li>
            <li>Die Einstellungen kannst du ansehen, aber nicht ändern.</li>
            <li><b>Verlassen</b> bringt dich zurück zur Startseite. Läuft das Spiel schon, übernimmt ein Computer deinen Platz.</li>
          </ul>
        )}

        <h3>Spielziel</h3>
        <p>Jeder hat 4 Kugeln. Sie laufen gegen den Uhrzeigersinn einmal um das Brett und müssen exakt ins Zielhaus. Wer zuerst alle Kugeln im Ziel hat, gewinnt – im Teamspiel das Team, sobald alle seine Kugeln im Ziel sind (ist man fertig, zieht man für den Partner).</p>

        <h3>Karten</h3>
        <ul className="cardhelp">
          <li><b>Ass</b> herauskommen, 1 oder 11 Felder</li>
          <li><b>König</b> herauskommen oder 13 Felder</li>
          <li><b>Dame</b> 12 Felder</li>
          <li><b>4</b> vorwärts oder rückwärts (je nach Einstellung)</li>
          <li><b>7</b> auf mehrere Kugeln aufteilbar; übersprungene Kugeln fliegen heim</li>
          <li><b>Bube (B)</b> zwei Kugeln tauschen</li>
          <li><b>Joker ★</b> ersetzt jede Karte (nicht für die letzte Kugel ins Haus)</li>
          <li><b>2</b> 2 Felder; bei 2, 3 und 5 Spielern alternativ blind eine Karte eines Gegners ziehen</li>
          <li><b>3, 5, 6, 8, 9, 10</b> so viele Felder vorwärts</li>
        </ul>
        <p>Pro Runde gibt es 6, 5, 4, 3, 2 Karten. Wer nicht ziehen kann, wirft alle Karten ab. Auf Gegner (auch eigene Kugeln) darf man schlagen; die geschlagene Kugel geht zurück. Eine Kugel, die gerade herausgekommen ist, blockiert auf dem Startfeld das Überspringen.</p>

        <h3>Im Spiel</h3>
        <ul>
          <li>Zu Beginn zieht jeder eine offene Karte; die höchste beginnt.</li>
          <li>Kartentausch zu Rundenbeginn: im Team mit dem Partner, sonst blind eine Karte vom rechten Nachbarn ziehen.</li>
          <li>Wähle deine Karte, dann die Kugel bzw. das Zielfeld auf dem Brett. Bei mehreren Möglichkeiten erscheint eine Auswahl.</li>
          <li>Das Brett kannst du zwischen «Original» und «Kreis» umschalten (bei 3, 4 und 6 Spielern).</li>
        </ul>
        <p className="muted">Alle Details stehen in der README des Projekts.</p>

        <div className="row"><button className="primary" onClick={onClose}>Verstanden</button></div>
      </div>
    </div>
  );
}

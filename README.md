# Dog

Das Schweizer Kartenbrettspiel **Dog** für **2 bis 6 Spieler** im Browser – mit Freunden online und mit
Computerspielern in vier Stärken.

- **Online spielen:** Ein Spielinitiator erstellt ein Spiel, Mitspieler treten per Code oder Link bei und werden vom
  Initiator **bewilligt**. Bis zu 5 der Plätze können Computerspieler sein.
- **Plätze und Farben:** Der Initiator legt fest, wer wo sitzt und mit welcher Kugelfarbe spielt.
- **Original-Bretter** bei 3, 4 und 6 Spielern in Kreuzform (jeder Spieler hat einen Arm: Löcher hinaus, über das Ende und zurück, Startfeld in der rechten Ecke des Armendes, Zielhaus von dort nach innen; je Arm vier Abschnitte zu 4 Löchern, abgeschrägte Ecken) oder als Kreis; wechselbar im Spiel.
- **Einstellungen und Regeln wählbar** (siehe unten), damit jede Runde nach ihren Hausregeln spielen kann.
- **Notizen** auf der Startseite (Textzeilen, wahlweise Todos mit Checkbox), nur im eigenen Browser gespeichert.
- Läuft auf dem eigenen NAS: [Anleitung für Synology](docs/NAS-Anleitung.md).

## Spielvarianten

| Spieler | Spiel | Kartentausch | 2 |
|---|---|---|---|
| 4 | 2 Teams, Partner gegenüber | ja | nur Felder |
| 6 | 3 Teams zu 2 (oder 2 Teams zu 3) | ja | nur Felder |
| 3, 5 | jeder für sich | nein | 2 Felder oder blind eine Karte eines Gegners ziehen |
| 2 | 4 Kugeln, oder 8 Kugeln (eigene + gegenüberliegende Farbe) | nein | 2 Felder oder blind eine Karte des Gegners ziehen |

Bei 2, 3 und 5 Spielern steht die erste Kugel jeder Farbe schon auf dem Startfeld. Das Brett passt sich an die
Spielerzahl an (16 Felder pro Abschnitt, kein „leerer“ Spieler).

### Kurzregeln

Gespielt wird gegen den Uhrzeigersinn. Jeder hat 4 Kugeln, die einmal um das Brett ziehen und exakt ins Zielhaus
müssen. Das Startfeld liegt in der Ecke des eigenen Abschnitts (Kreuzbrett: Eckloch am Armende); von dort zweigt das Zielhaus ab. Ins Haus kommt man also
nur über das eigene Startfeld (Zählung: Startfeld = ein Schritt, dahinter folgen die vier Hausplätze); eine Kugel, die
gerade erst herausgekommen ist, muss zuerst eine ganze Runde laufen. Gespielt werden 110 Karten
(inklusive 6 Joker), pro Runde 6, 5, 4, 3, 2 Karten. Wer nicht ziehen kann, wirft alle Karten ab.

| Karte | Wirkung |
|---|---|
| Ass | herauskommen, 1 oder 11 Felder |
| König | herauskommen, 13 Felder |
| Dame | 12 Felder |
| 4 | 4 Felder vorwärts oder rückwärts (einstellbar; rückwärts nie ins Haus) |
| 7 | beliebig auf mehrere Kugeln aufteilbar (eigene; im Teamspiel die des Partners, wenn man fertig ist; einstellbar: alle Kugeln); alle übersprungenen Kugeln fliegen heim |
| Bube | immer: zwei Kugeln tauschen |
| Joker | ersetzt jede Karte, aber nicht für die letzte Kugel ins Haus |
| 2 | 2 Felder vor; bei 2, 3 und 5 Spielern alternativ blind eine Karte eines Gegners ziehen (zählt als Zug) |
| 3, 5, 6, 8, 9, 10 | so viele Felder vor |

Auf dem eigenen Startfeld blockiert eine Kugel das Überspringen. Im Zielhaus kann man nicht überspringen. Ist ein
Spieler fertig, zieht er im Teamspiel für den Partner weiter; das Team gewinnt, wenn alle Kugeln im Ziel sind.

### Einstellungen und Regeln (in der Lobby)

| Einstellung | Standard |
|---|---|
| Erste Kugel schon auf dem Startfeld | automatisch (bei 2, 3, 5 Spielern) |
| Kartentausch | automatisch (nur Teamspiel) |
| Eigene und Team-Kugeln dürfen geschlagen werden | ja |
| Bube: Tausch mit Kugeln des Partners | ja |
| Bube: Tausch zweier eigener Kugeln (verhindert den Abwurf der Hand) | ja |
| 7: auf alle Kugeln aufteilbar | nein (nur eigene, bzw. Partner wenn fertig) |
| 4 spielen | vorwärts oder rückwärts |
| 7: dieselbe Kugel mehrfach aufteilen | nein (ändert die Stellungen praktisch nie) |
| Brett bei 2 Spielern (4 Kugeln) | klein (2 Abschnitte) |
| Teams bei 6 Spielern | 3 Teams zu 2 |
| Karten pro Runde | 6, 5, 4, 3, 2 |
| Zuggeschwindigkeit (1 schnell – 5 langsam, ca. 2,5 s je Computerzug) | 1 |

## Computerspieler

Vier Stufen: **Anfänger** (zufälliger Zug), **Mittel**, **Fortgeschritten** und **Experte**. Höhere Stufen bewerten
die Stellung nach jedem möglichen Zug (Fortschritt, Schlagen, Zielhaus), berücksichtigen die Gefahr, geschlagen zu
werden, und gehen sparsamer mit Startkarten und Jokern um. In 30 Testspielen (Team 2:2) gewinnt Mittel gegen Anfänger
30:0, Fortgeschritten gegen Mittel 19:11 und Experte gegen Fortgeschritten 18:12.

## Aufbau

```
packages/
  engine/    Spiellogik ohne Oberfläche: Brett, Karten, Regeln, Züge, Computerspieler (TypeScript)
  protocol/  Nachrichten zwischen Client und Server, strenge Prüfung aller Eingaben
  server/    Node.js: Lobby, Spielräume, WebSocket, Speichern der Spiele, liefert den Client aus
  client/    Web-Oberfläche (React, Vite)
deploy/      Docker-Compose-Dateien für das NAS
docs/        Anleitungen
```

Der Server ist maßgeblich: Er prüft jeden Zug mit der Engine und schickt jedem Spieler nur die eigene Hand.

## Entwickeln

Voraussetzung: Node.js 22.

```bash
npm install
npm test                 # alle Tests (Engine, Server, Client)
npm run typecheck

# Server (Port 3000) und Client-Entwicklungsserver (Port 5173, leitet /ws an den Server)
npm start -w @dog/server
npm run dev -w @dog/client

# Fertiger Bau: Client nach packages/client/dist, Server als eine Datei nach packages/server/dist/server.js
npm run build -w @dog/client && npm run build -w @dog/server
STATIC_DIR=packages/client/dist node packages/server/dist/server.js
```

Docker: `docker build -t dog .` und `docker run -p 3000:3000 -v dog-data:/data dog`. Die Version (`APP_VERSION`, wird beim Bau
auf GitHub aus Datum und Commit gesetzt) steht unter `/version` und unten auf der Startseite.

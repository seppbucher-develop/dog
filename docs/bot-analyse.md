# Bot-Analyse (Selbstspiele)

Runner: `packages/engine/sim/run.ts`, Auswertung: `packages/engine/sim/agg.mjs`. Sitzbelegung rotiert pro Spiel.
Rund 6000 Spiele, Stufen gegeneinander. Siegquote pro Sitz.

| Spieler | Paarung | Ergebnis |
|---|---|---|
| 2 | Experte – Fortgeschritten | 50,2 % – 49,8 % (kein Unterschied) |
| 2 | Experte – Mittel | 60,5 % – 39,5 % |
| 2 | Fortgeschritten – Mittel | 54,5 % – 45,5 % |
| 3 | Experte / Fortgeschritten / Mittel | 39,0 / 36,7 / 24,3 % |
| 4 (Teams) | Experte – Fortgeschritten | 68,8 % – 31,2 % |
| 4 (Teams) | Fortgeschritten – Mittel | 64,6 % – 35,4 % |
| 5 | Experte / Fortgeschritten / Mittel / Anfänger | 26,5 / 30,0 / 17,0 / 0 % (nur 100 Spiele) |
| 6 (Teams) | Experte / Fortgeschritten / Mittel | 54,6 / 26,5 / 18,9 % (355 Spiele) |

Anfänger verliert immer gegen Mittel (0 %).
Handabwurf mangels Zug: ca. 3–5 pro Spieler und Spiel, in 80–90 % der Fälle ohne eigene Kugel im Spiel.

## Neuer Experte (Kartenzählung)

Der Experte zählt mit, welche Karten die Gegner noch halten können (alles außer Ablagestapel und eigener Hand),
und schätzt daraus pro eigener Kugel die Wahrscheinlichkeit, im nächsten Zug geschlagen zu werden (`risk`, `buildRisk` in `bot.ts`).
Dazu höherer Bonus fürs Kartenziehen mit der 2 (`steal` 60).

Vergleich mit `packages/engine/sim/match.ts` (Sitze rotieren, A = neuer Experte):

| Spieler | Gegner | Siegquote A (fair) |
|---|---|---|
| 2 | alter Experte | 60,1 % ±2,8 (50 %), n=1200 |
| 2 | Fortgeschritten | 58,9 % ±3,4 (50 %), n=800 |
| 3 | alter Experte | 35,2 % ±3,8 (33,3 %), n=600 |
| 3 | Fortgeschritten | 45,3 % ±4,9 (33,3 %), n=400 |
| 5 | alter Experte | 15,8 % ±6,5 (20 %), n=120 (zu wenig Spiele) |
| 4 (Teams) | Fortgeschritten | 72,5 % ±3,1 (vorher 68,8 %) |
| 6 (Teams) | Fortgeschritten/Mittel | 55,3 % (vorher 54,6 %) |

Gewichte: `risk` 1–2 ist ein Plateau, 3 ist schlechter. `threat`, `enemy`, `noise` allein bringen im Rauschen nichts.
Offen: 3 und 5 Spieler (Gewinn klein bzw. nicht nachweisbar), im Team etwas mehr Eigenbeschuss (0,14 → 0,26 pro Spiel).

## Eigenbeschuss im Team

Im Teamspiel schickt der Experte Partnerkugeln heim (4 Spieler: 0,35 pro Spiel, 6 Spieler: 0,77). Etwa die Hälfte ist erzwungen
(kein anderer legaler Zug, vor allem die 7, die alle übersprungenen Kugeln schlägt), der Rest wäre vermeidbar.
Ein Zusatzwert für Kugeln außerhalb des Heims (`out`) half nicht (Experte verliert ab +200 deutlich) und wurde wieder entfernt.

Lösung: Parameter `friendlyFire` (Abzug 500 pro heimgeschickter Teamkugel, nur im Teamspiel, Experte).

| Spieler | Eigenbeschuss vorher → nachher | Siegquote gegen Experte ohne Abzug |
|---|---|---|
| 4 (Teams) | 0,35 → 0,20 | 49,2 % ±2,8 (600 Spiele, praktisch gleich) |
| 6 (Teams) | 0,77 → 0,28 | 44,0 % ±3,4 gegen 32,5 % (400 Spiele, leicht besser) |

Im Einzelspiel schadet die Strafe (2 Spieler: Siegquote sinkt), deshalb dort ausgeschaltet.
Mehr als 500 ändert nichts mehr (Rest ist erzwungen).

## Vorausschau im Einzelspiel (2, 3, 5 Spieler)

Für die besten 4 Kandidatenzüge (nach der bisherigen Bewertung) zieht der Experte 6-mal mögliche Gegnerhände aus den unbekannten
Karten, spielt den Zug, lässt die Gegner mit einfacher Strategie antworten und zieht dann selbst seinen besten Folgezug.
Bewertet wird die Stellung danach (Mittelwert über die Stichproben, gleiche Stichproben für alle Kandidaten). Nur im Einzelspiel.
Parameter `lookahead` in `bot.ts`; für Teamspiel ausgeschaltet.

Tempo: In simulierten Zügen wird die 7 nicht aufgeteilt (`legalPlays(..., fast)`) und die Zugprüfung übersprungen
(`applyAction(..., trusted)`). Dadurch pro Zug im Median 4–14 ms, p95 17–72 ms, max 200 ms (vorher bis 3 s).

Ergebnis gegen den Experten ohne Vorausschau (Sitze rotiert):

| Spieler | Siegquote (fair) |
|---|---|
| 2 | 60,5 % ±3,4 (50 %), n=800 |
| 3 | 45,3 % ±4,9 (33,3 %), n=400 |
| 5 | 38,0 % ±9,5 (20 %), n=100 (Variante Gewicht 0,5) |

Mehr Stichproben (12) oder mehr Kandidaten (8) bringen im Rauschen nichts.

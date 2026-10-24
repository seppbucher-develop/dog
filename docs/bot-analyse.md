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

## Vorausschau im Teamspiel

Gleiche Vorausschau wie im Einzelspiel (4 Kandidaten, 6 Stichproben, Gewicht 1). Der Partner wird in der Simulation wie die Gegner
mit einfacher Strategie gespielt; die beim Tausch an ihn abgegebene Karte ist bekannt und steckt in seiner gezogenen Hand.

Vergleich gegen den Experten ohne Vorausschau (Partner jeweils gleiche Stufe, Sitze rotiert):

| Spieler | Siegquote (fair) | Eigenbeschuss pro Spiel |
|---|---|---|
| 4 (Teams) | 63,3 % ±2,7 (50 %), n=600 | 0,09 (ohne: 0,15) |
| 6 (Teams) | 65,5 % ±3,3 (33,3 %), n=400, 3 Teams | 0,12 (ohne: 0,20) |

Gewicht 0,5 statt 1: gleich stark (63,8 % bzw. 64,8 %). Zeit pro Zug: Median 8 ms (4 Spieler) bzw. 17 ms (6 Spieler), max 65 ms.

## 5 Spieler, größere Stichprobe

Neuer Experte (A, ein Sitz, rotiert) gegen vier Bots der Vergleichsstufe, fair wären 20 %:

| Gegner | Siegquote A | Spiele |
|---|---|---|
| Experte ohne Vorausschau | 27,6 % ±3,9 | 500 |
| alter Experte (ohne Kartenzählung, `steal` 25, ohne Vorausschau) | 24,3 % ±4,9 | 300 |

Die frühere Zahl (38 % bei 100 Spielen) war zu optimistisch. Die Vorausschau bringt bei 5 Spielern nachweisbar etwas (+7,6 Punkte über fair),
aber deutlich weniger als bei 2 oder 3 Spielern. Gegen den alten Experten liegt A zwar über fair, das Intervall reicht aber knapp an 20 % heran.
Mögliche Gründe: mit vier Gegnern ist der Einfluss eines einzelnen Zuges auf den Ausgang kleiner, und die Gegnerantworten werden nur einmal
reihum simuliert.

## Sperre (Startfeld) als Bewertungsterm

Parameter `block` in `bot.ts`: Bonus je gegnerische Kugel, die auf eine eigene frische Startfeld-Kugel zuläuft (1–13 Felder dahinter voll,
14–26 mit Faktor 0,3), Abzug je eigene oder Partnerkugel, die dahinter aufgehalten wird. Der Term hängt auch an der Vorausschau.

4 Spieler (Teams), A (mit Partner, Experte + `block`) gegen Experten ohne `block`, Sitze rotiert, n=600:

| `block` | Siegquote A (fair 50 %) |
|---|---|
| 15 | 50,0 % ±4,0 |
| 40 | 51,0 % ±4,0 |
| 100 | 50,3 % ±4,0 |

Kein messbarer Effekt, deshalb bleibt `block` in allen Stufen ungesetzt (aus). Nicht gemessen: Einzelspiel und 6 Spieler.
`sim/match.ts` lässt im Teamspiel A mit seinem Partner spielen (Bündeln mit esbuild, sonst finden die Worker `src` nicht).

## Abwurf, Kartentausch und Schlag (Teamspiel)

Gemessen wird immer A (Experte mit Zusatzterm, mit Partner) gegen den Experten ohne Term, Sitze rotiert, 4 Spieler (Teams), fair = 50 %.

- `forceDump` (Parameter in `bot.ts`): Bonus je Karte, die ein Gegner mangels legalem Zug abwerfen muss, Abzug beim Partner. Wahrscheinlichkeit aus Kartenzählung (je Rang: spielbar auf dem Brett nach dem Zug?), getauschte Partnerkarte ist bekannt. Nur im Teamspiel aktiv.
- `giftPlayable`: beim Tausch Zusatzwert für eine Karte, die der Partner spielen kann, wenn er sonst seine Hand abwerfen müsste.
- `giftTactic`: beim Tausch Zusatzwert für den Wertverlust gegnerischer Kugeln, den der Partner mit der Karte durch Schlagen oder Tauschen erreichen kann (nah am Haus am höchsten).

| Einstellung | Siegquote A |
|---|---|
| `forceDump` 15 / 30 / 60 | 51,0 / 51,8 / 53,5 % (±4,0, n=600) |
| `giftPlayable` 50 | 51,1 % ±3,5 (n=800) |
| `giftTactic` 0,3 | 53,0 % ±3,5 (n=800) |
| `forceDump` 30 + `giftPlayable` 50 + `giftTactic` 0,3 | 53,9 % ±3,5 (n=800) |
| `forceDump` 60 + `giftPlayable` 50 + `giftTactic` 0,3 | **53,7 % ±2,4 (n=1600)** |
| dieselbe Kombination, 6 Spieler (3 Teams zu 2), fair 33,3 % | 32,0 % ±4,6 (n=400, kein Effekt) |

Einzeln liegt jeder Term im Rauschen, die Kombination ist im 4er-Team klar über 50 %. Im 6er-Team ist kein Effekt nachweisbar.
Die Kombination ist für den Experten eingeschaltet. Einzelspiel (2, 3, 5 Spieler) bleibt unverändert, `forceDump` ist dort aus.
Nicht gemessen: Mehr Gewicht als 60, die Terme in anderen Stufen.

### `forceDump` im Einzelspiel

Experte mit `forceDump` 60 (Beschränkung auf Teamspiel testweise aufgehoben) gegen Experte ohne, Sitze rotiert:

| Spieler | Siegquote A | fair |
|---|---|---|
| 2 | 49,6 % ±3,5 (n=800) | 50 % |
| 3 | 31,0 % ±3,7 (n=600) | 33,3 % |

Kein Vorteil, bei 3 Spielern eher leicht darunter. `forceDump` bleibt deshalb im Einzelspiel aus (`layout.teams` in `chooseAction`).
5 Spieler nicht gemessen: 300 Spiele sind mit Vorausschau in 30 Minuten nicht durchgelaufen.

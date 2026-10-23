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

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

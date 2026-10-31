# Evaluation: Bot-Strategie per KI erlernen

Frage: Ist es sinnvoll, die Spielstrategie der Bots per KI aus Selbstspiel zu lernen (Start: Zufallsspieler), und wie gross ist der Aufwand?

**Ergebnis:** Sinnvoll, aber als Ergänzung zum bestehenden Experten, nicht als Ersatz. Prototyp ca. 1–2 Wochen. Ein Bot, der den heutigen Experten sicher schlägt, ca. 4–8 Wochen, mit dem Risiko, ihn nicht zu übertreffen.

## Ausgangslage

- Engine (`packages/engine`): reines TypeScript ohne UI, deterministisch (Seed-RNG), 2–6 Spieler inkl. Teams.
- Selbstspiel-Pipeline vorhanden: `sim/run.ts`, `sim/match.ts`, `sim/agg.mjs`.
- Experte heute: handgebaute Bewertung, Kartenzählung, Schlagrisiko, Vorausschau über Stichproben der Gegnerhände; Gewichte von Hand getunt (siehe `docs/bot-analyse.md`).
- Messung (4 Spieler, 20 Spiele, 1 Kern, ca. 140 Züge pro Spiel):
  - Mittel: 2 s, also ca. 10 Spiele/s
  - Experte: 46 s, also ca. 0,4 Spiele/s (Vorausschau ist teuer)

## Schwierigkeit des Problems

- Verborgene Information (fremde Handkarten) und Zufall (Mischen).
- Variable Spielerzahl (2–6), Teams, mehrere Bretter und Varianten.
- Variable Zugmenge: 7 aufteilbar, Bube tauscht, Joker ersetzt jede Karte.
- Langer Horizont (ca. 140 Züge) mit nur einem Ergebnis am Ende: schwaches Lernsignal.
- Teamspiel: Partner muss mitgedacht werden, Eigenbeschuss.

## Ansätze

| Ansatz | Idee | Aufwand | Erwartung |
|---|---|---|---|
| A. Gewichte lernen | ca. 15 Parameter des Experten per Selbstspiel optimieren (evolutionär/CMA-ES) | ca. 1 Woche | Sicher, aber kleiner Gewinn; viele Gewichte liegen schon auf einem Plateau |
| B. Wertfunktion lernen (TD/RL) | Kleines Netz bewertet Stellungen, ersetzt die Handbewertung, Vorausschau bleibt | ca. 3–6 Wochen | Grösstes realistisches Potenzial |
| C. Reines Policy-RL ab Zufall | z. B. PPO ohne Vorwissen | 6–12+ Wochen | Hohes Risiko, oft unter dem Experten |
| D. ISMCTS + Netz (AlphaZero-ähnlich) | Suche bei verdeckter Information plus gelerntes Netz | 8–12+ Wochen | Stärkster Ansatz, aufwendigster |

## Rechenaufwand

- Engine ca. 10 Spiele/s und Kern; für RL die Engine schlank halten (`applyAction(..., trusted)` existiert).
- Grössenordnung: 1–10 Mio. Spiele, also 1–10 Tage auf einem Kern, ca. 1 Tag oder weniger mit 8 Kernen oder GPU-Batching.
- Realistisch ein Netz für Einzelspiel (2/3/5) und eins für Team (4/6), also doppelter Lernaufwand.
- Einsatz: kleines Netz (z. B. MLP 2×128) läuft in Millisekunden in TypeScript auf dem Server oder im Browser, keine zusätzliche Infrastruktur.

## Evaluation

- Massstab: Siegquote gegen den heutigen Experten, Sitze rotiert, wie in `docs/bot-analyse.md`.
- Für ±3 Prozentpunkte ca. 800 Spiele pro Paarung, beim Experten rund 30 Minuten.

## Empfehlung

1. Schritt 1 (ca. 1 Woche, geringes Risiko): Ansatz A als Machbarkeitstest; baut die Trainingsinfrastruktur (paralleles Selbstspiel, Auswertung), die B wiederverwendet.
2. Schritt 2 (ca. 3–6 Wochen): Ansatz B zuerst nur für 2 Spieler (einfachster Zustand); danach entscheiden, ob Ausweitung auf 3–6 Spieler und Teams lohnt.
3. C/D erst, wenn B klar besser als der Experte ist.

## Offene Punkte

- Wie wichtig ist «kein Vorwissen»? Für einen stärkeren Bot ist B besser als C; für «von null lernen» ist C das Ziel, mit mehr Aufwand und Risiko.
- Steht GPU oder genügend CPU-Kapazität fürs Training zur Verfügung?

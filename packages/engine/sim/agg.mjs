// node sim/agg.mjs file.jsonl [...]  -> Gewinnraten pro Stufe (Sitz-rotiert) und Spielkennzahlen
import { readFileSync } from 'node:fs';
const recs = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
const by = {};
for (const r of recs) {
  const k = r.players + 'p ' + [...new Set(r.seatLevel)].sort().join('/');
  (by[k] ??= []).push(r);
}
for (const [k, rs] of Object.entries(by)) {
  const n = rs.length, fin = rs.filter((r) => r.finished);
  const lv = {}; // Level -> {seats, wins}
  for (const r of fin) {
    const wl = new Set(r.winners);
    r.seatLevel.forEach((l, i) => { const e = (lv[l] ??= { seats: 0, wins: 0, passes: 0, passedCards: 0, captures: 0, loss: 0, ff: 0 });
      e.seats++; if (wl.has(i)) e.wins++; const s = r.seats[i]; e.passes += s.passes; e.passedCards += s.passedCards; e.captures += s.captures; e.loss += s.ownLosses; e.ff += s.friendlyFire; });
  }
  const avg = (f) => (fin.reduce((a, r) => a + f(r), 0) / fin.length).toFixed(1);
  console.log(`\n${k}: ${n} Spiele (${fin.length} beendet), Züge ${avg((r) => r.turns)}, Runden ${avg((r) => r.rounds)}`);
  for (const [l, e] of Object.entries(lv)) {
    const share = e.wins / e.seats, se = Math.sqrt(share * (1 - share) / (e.seats / 1));
    console.log(`  ${l.padEnd(13)} Siegquote/Sitz ${(100 * share).toFixed(1)}% ±${(196 * se).toFixed(1)}  Abwurf ${(e.passes / e.seats).toFixed(2)}/Spiel (${(e.passedCards / e.seats).toFixed(1)} Karten)  Schläge ${(e.captures / e.seats).toFixed(1)}  verloren ${(e.loss / e.seats).toFixed(1)}  Eigenbeschuss ${(e.ff / e.seats).toFixed(2)}`);
  }
}

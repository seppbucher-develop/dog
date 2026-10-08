import { describe, expect, it } from 'vitest';
import type { ClientMessage, GameView, LobbyView, ServerMessage } from '@dog/protocol';
import { Hub } from '../src/hub';
import { turnDelay, type Connection } from '../src/room';

let counter = 0;
class FakeConn implements Connection {
  id = `c${++counter}`;
  msgs: ServerMessage[] = [];
  closedReason: string | null = null;
  send(m: ServerMessage) {
    this.msgs.push(JSON.parse(JSON.stringify(m)));
  }
  close(reason: string) {
    this.closedReason = reason;
  }
  lobby(): LobbyView {
    return [...this.msgs].reverse().find((m): m is Extract<ServerMessage, { t: 'lobby' }> => m.t === 'lobby')!.lobby;
  }
  game(): GameView | null {
    const m = [...this.msgs].reverse().find((x): x is Extract<ServerMessage, { t: 'game' }> => x.t === 'game');
    return m ? m.view : null;
  }
  lastError(): string | undefined {
    return [...this.msgs].reverse().find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error')?.message;
  }
  token(): string {
    return [...this.msgs].reverse().find((m): m is Extract<ServerMessage, { t: 'welcome' }> => m.t === 'welcome')!.token;
  }
}

function setup() {
  const queue: (() => void)[] = [];
  const hub = new Hub({ schedule: (fn) => void queue.push(fn), botDelayMs: 0 });
  const flush = () => {
    let n = 0;
    while (queue.length && n++ < 10000) queue.shift()!();
  };
  const send = (c: Connection, m: ClientMessage) => hub.handle(c, m);
  return { hub, flush, send, queue };
}

function hostRoom(send: ReturnType<typeof setup>['send'], name = 'Sepp') {
  const host = new FakeConn();
  send(host, { t: 'create', name });
  return host;
}

/** Host spielt jeweils den ersten legalen Zug, bis das Spiel endet. */
function playAsHost(env: ReturnType<typeof setup>, host: FakeConn, maxSteps = 20000) {
  for (let i = 0; i < maxSteps; i++) {
    env.flush();
    const v = host.game();
    if (!v || v.phase === 'finished') return v;
    if (v.phase === 'exchange') {
      if (!v.exchangeDone[v.seat]) env.send(host, { t: 'exchange', card: v.myHand[0]! });
    } else if (v.legal && v.legal.length > 0) {
      const p = v.legal[i % v.legal.length]!;
      env.send(host, { t: 'play', card: p.card, moves: p.moves, ...(p.as ? { as: p.as } : {}) });
    }
  }
  throw new Error('Spiel nicht beendet');
}

describe('Lobby', () => {
  it('Erstellen liefert Code, Token und Standard-Sitzplätze', () => {
    const { send } = setup();
    const host = hostRoom(send);
    expect(host.token().length).toBeGreaterThan(20);
    const l = host.lobby();
    expect(l.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(l.you).toMatchObject({ status: 'host', seat: 0, name: 'Sepp' });
    expect(l.seats.map((s) => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(l.teams).toEqual([[0, 2], [1, 3]]);
  });

  it('Beitritt braucht Bewilligung durch den Initiator', () => {
    const { send } = setup();
    const host = hostRoom(send);
    const guest = new FakeConn();
    send(guest, { t: 'join', code: host.lobby().code.toLowerCase(), name: 'Anna' });
    expect(guest.lobby().you.status).toBe('pending');
    expect(guest.game()).toBeNull();
    const req = host.lobby().requests!;
    expect(req.map((r) => r.name)).toEqual(['Anna']);
    // Gäste sehen keine Anfragen
    expect(guest.lobby().requests).toBeUndefined();

    // Kein freier Menschenplatz -> Fehler
    send(host, { t: 'approve', requestId: req[0]!.id });
    expect(host.lastError()).toMatch(/Kein freier Platz/);

    send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'bot', level: 'expert' }, { kind: 'bot', level: 'expert' }], eightPegs: false, rules: {} });
    send(host, { t: 'approve', requestId: req[0]!.id });
    expect(guest.lobby().you).toMatchObject({ status: 'player', seat: 1 });
    expect(host.lobby().seats[1]).toMatchObject({ kind: 'human', name: 'Anna', filled: true, connected: true });
    expect(host.lobby().requests).toEqual([]);
  });

  it('Ablehnen, unbekannter Code und Nicht-Host-Rechte', () => {
    const { send } = setup();
    const host = hostRoom(send);
    const guest = new FakeConn();
    send(guest, { t: 'join', code: 'ZZZZZ', name: 'Anna' });
    expect(guest.lastError()).toMatch(/nicht gefunden/);
    send(guest, { t: 'join', code: host.lobby().code, name: 'Anna' });
    send(guest, { t: 'start' });
    expect(guest.lastError()).toMatch(/Nur der Spielinitiator/);
    send(guest, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }], eightPegs: false, rules: {} });
    expect(guest.lastError()).toMatch(/Nur der Spielinitiator/);
    send(host, { t: 'reject', requestId: host.lobby().requests![0]!.id });
    expect(guest.lobby().you.status).toBe('rejected');
  });

  it('Start nur, wenn alle Menschenplätze besetzt sind', () => {
    const { send } = setup();
    const host = hostRoom(send);
    send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }], eightPegs: false, rules: {} });
    send(host, { t: 'start' });
    expect(host.lastError()).toMatch(/Platz 2 ist noch frei/);
    expect(host.lobby().phase).toBe('lobby');
  });

  it('Konfiguration prüft Regeln und schützt besetzte Plätze', () => {
    const { send } = setup();
    const host = hostRoom(send);
    send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'beginner' }], eightPegs: true, rules: { firstPegOnStart: 'off' } });
    expect(host.lobby().seats).toHaveLength(2);
    expect(host.lobby().eightPegs).toBe(true);
    expect(host.lobby().rules.firstPegOnStart).toBe('off');
    send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'beginner' }, { kind: 'bot', level: 'beginner' }], eightPegs: true, rules: {} });
    expect(host.lobby().eightPegs).toBe(false); // 8 Kugeln nur bei 2 Spielern
    send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'beginner' }], eightPegs: false, rules: { handSizes: [99] } });
    expect(host.lastError()).toMatch(/handSizes/);
    send(host, { t: 'configure', seats: [{ kind: 'bot', level: 'beginner' }, { kind: 'human' }], eightPegs: false, rules: {} });
    expect(host.lastError()).toMatch(/Platz 1/);
  });

  it('Ungültige Nachrichten werden abgelehnt', () => {
    const { hub } = setup();
    const c = new FakeConn();
    hub.handle(c, { t: 'nope' });
    expect(c.lastError()).toBeDefined();
    hub.handle(c, { t: 'create', name: '' });
    expect(c.lastError()).toMatch(/Name/);
    hub.handle(c, { t: 'create', name: 'x'.repeat(50) });
    expect(c.lastError()).toMatch(/Name/);
    hub.handle(c, 'text');
    hub.handle(c, { t: 'start' });
    expect(c.lastError()).toMatch(/zuerst erstellen/);
    hub.handle(c, { t: 'play', card: 'X', moves: [] });
    expect(c.lastError()).toMatch(/Karte/);
    expect(hub.roomCount).toBe(0);
  });
});

describe('Spiel', () => {
  it('Host mit drei Bots spielt ein Teamspiel bis zum Ende; Sicht enthält nur die eigene Hand', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'start' });
    let v = host.game()!;
    expect(v.phase).toBe('exchange');
    expect(v.exchangeDone).toEqual([false, true, true, true]); // Bots haben schon gewählt
    expect(v.myHand).toHaveLength(6);
    expect(Array.isArray(v.passes)).toBe(true);
    for (const m of host.msgs) {
      const s = JSON.stringify(m);
      expect(s).not.toMatch(/"hands"|"deck"|"discard"/);
    }
    // Kartentausch: Host sieht nur die eigene abgegebene/erhaltene Karte offen
    env.send(host, { t: 'exchange', card: v.myHand[0]! });
    const tr = host.game()!.transfers;
    expect(tr).toHaveLength(4);
    expect(tr.filter((t) => t.card !== null).map((t) => t.from === 0 || t.to === 0)).toEqual([true, true]);
    v = playAsHost(env, host)!;
    expect(v.phase).toBe('finished');
    expect(v.winners).not.toBeNull();
    expect(host.lobby().phase).toBe('finished');
  });

  it('Einzelspiel mit 3 Spielern: erste Kugel steht schon auf dem Startfeld', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'advanced' }, { kind: 'bot', level: 'expert' }], eightPegs: false, rules: {} });
    env.send(host, { t: 'start' });
    const v = host.game()!;
    expect(v.phase).toBe('playing');
    expect(v.pegs.filter((p) => p.pos.t === 'ring')).toHaveLength(3);
    playAsHost(env, host);
    expect(host.game()!.phase).toBe('finished');
  });

  it('Zwei Menschen: Gast sieht nur seine Hand und kann nicht für den Host ziehen', () => {
    const env = setup();
    const host = hostRoom(env.send);
    const guest = new FakeConn();
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'bot', level: 'beginner' }], eightPegs: false, rules: {} });
    env.send(guest, { t: 'join', code: host.lobby().code, name: 'Anna' });
    env.send(host, { t: 'approve', requestId: host.lobby().requests![0]!.id });
    env.send(host, { t: 'start' });
    env.flush();
    const hv = host.game()!;
    const gv = guest.game()!;
    expect(hv.seat).toBe(0);
    expect(gv.seat).toBe(1);
    expect(hv.handSizes).toEqual(gv.handSizes);
    expect(hv.myHand).not.toEqual(gv.myHand);
    // Nur der Spieler am Zug bekommt legale Züge
    expect(hv.current === 0 ? hv.legal !== null : hv.legal === null).toBe(true);
    expect(gv.current === 1 ? gv.legal !== null : gv.legal === null).toBe(true);
    // Zug vom falschen Spieler
    const other = hv.current === 0 ? guest : host;
    env.send(other, { t: 'play', card: '2', moves: [{ t: 'move', peg: 0, steps: 2 }] });
    expect(other.lastError()).toMatch(/Nicht am Zug|Unzulässig/);
  });

  it('Unzulässige Züge werden abgelehnt, der Zustand bleibt', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'beginner' }], eightPegs: false, rules: {} });
    env.send(host, { t: 'start' });
    env.flush();
    const before = JSON.stringify(host.game());
    env.send(host, { t: 'play', card: 'K', moves: [{ t: 'move', peg: 3, steps: 13 }] });
    expect(host.lastError()).toBeDefined();
    expect(JSON.stringify(host.game())).toBe(before);
  });
  it('Tauschkarten-Wissen der Computerspieler (given) wird nie an Clients gesendet', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'start' });
    let serverKnew = false;
    for (let i = 0; i < 20000; i++) {
      env.flush();
      serverKnew ||= JSON.stringify(env.hub.snapshot()).includes('"given":[{');
      const v = host.game()!;
      if (v.phase === 'finished') break;
      if (v.phase === 'exchange') {
        if (!v.exchangeDone[v.seat]) env.send(host, { t: 'exchange', card: v.myHand[0]! });
      } else if (v.legal && v.legal.length > 0) {
        const p = v.legal[i % v.legal.length]!;
        env.send(host, { t: 'play', card: p.card, moves: p.moves, ...(p.as ? { as: p.as } : {}) });
      }
    }
    expect(serverKnew).toBe(true); // serverseitig ist der Tausch gemerkt ...
    for (const m of host.msgs) expect(JSON.stringify(m)).not.toMatch(/"given"/); // ... aber nie an Clients gesendet
  });
});

describe('Verbindung, Ersetzen, Wiederholung, Speichern', () => {
  it('Wiederverbinden mit dem Token stellt Lobby und Spiel wieder her', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'start' });
    env.flush();
    const token = host.token();
    env.hub.disconnect(host);
    const again = new FakeConn();
    env.send(again, { t: 'resume', token });
    expect(again.lobby().you.status).toBe('host');
    expect(again.game()!.seat).toBe(0);
    expect(again.game()!.myHand).toEqual(host.game()!.myHand);
    const bad = new FakeConn();
    env.send(bad, { t: 'resume', token: 'gibtsnicht' });
    expect(bad.lastError()).toMatch(/nicht mehr vorhanden/);
  });

  it('Neue Verbindung mit demselben Token verdrängt die alte', () => {
    const env = setup();
    const host = hostRoom(env.send);
    const token = host.token();
    const second = new FakeConn();
    env.send(second, { t: 'resume', token });
    expect(host.closedReason).toBeTruthy();
    expect(second.lobby().you.status).toBe('host');
  });

  it('Host ersetzt getrennten Spieler durch einen Bot; Spiel läuft weiter', () => {
    const env = setup();
    const host = hostRoom(env.send);
    const guest = new FakeConn();
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'bot', level: 'intermediate' }], eightPegs: false, rules: {} });
    env.send(guest, { t: 'join', code: host.lobby().code, name: 'Anna' });
    env.send(host, { t: 'approve', requestId: host.lobby().requests![0]!.id });
    env.send(host, { t: 'start' });
    env.hub.disconnect(guest);
    expect(host.lobby().seats[1]!.connected).toBe(false);
    env.send(host, { t: 'setBot', seat: 1, level: 'expert' });
    expect(host.lobby().seats[1]).toMatchObject({ kind: 'bot', level: 'expert' });
    // Der ersetzte Spieler kann sich nicht mehr mit seinem alten Token verbinden
    const comeback = new FakeConn();
    env.send(comeback, { t: 'resume', token: guest.token() });
    expect(comeback.lastError()).toMatch(/nicht mehr vorhanden/);
    playAsHost(env, host);
    expect(host.game()!.phase).toBe('finished');
  });

  it('Spiel kann nach dem Ende neu gestartet werden (Lobby)', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'bot', level: 'expert' }, { kind: 'bot', level: 'expert' }], eightPegs: false, rules: {} });
    env.send(host, { t: 'rematch' });
    expect(host.lastError()).toMatch(/noch nicht beendet/);
    env.send(host, { t: 'start' });
    playAsHost(env, host);
    env.send(host, { t: 'rematch' });
    expect(host.lobby().phase).toBe('lobby');
    expect(host.game()).toBeNull();
    env.send(host, { t: 'start' });
    expect(host.game()!.phase).toBe('playing');
  });

  it('Host verlässt: Raum wird geschlossen; Gast verlässt in der Lobby: Platz wird frei', () => {
    const env = setup();
    const host = hostRoom(env.send);
    const guest = new FakeConn();
    env.send(host, { t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }], eightPegs: false, rules: {} });
    env.send(guest, { t: 'join', code: host.lobby().code, name: 'Anna' });
    env.send(host, { t: 'approve', requestId: host.lobby().requests![0]!.id });
    env.send(guest, { t: 'leave' });
    expect(host.lobby().seats[1]).toMatchObject({ filled: false });
    env.send(host, { t: 'leave' });
    expect(env.hub.roomCount).toBe(0);
    expect(host.msgs.some((m) => m.t === 'closed')).toBe(true);
  });

  it('Snapshot und Wiederherstellung (Serverneustart) behalten Sitzungen und Spielstand', () => {
    const env = setup();
    const host = hostRoom(env.send);
    env.send(host, { t: 'start' });
    env.flush();
    const token = host.token();
    const view = host.game()!;
    const snap = JSON.parse(JSON.stringify(env.hub.snapshot()));

    const env2 = setup();
    env2.hub.restore(snap);
    const back = new FakeConn();
    env2.send(back, { t: 'resume', token });
    expect(back.game()!.myHand).toEqual(view.myHand);
    expect(back.game()!.pegs).toEqual(view.pegs);
    playAsHost(env2, back);
    expect(back.game()!.phase).toBe('finished');
  });

  it('Inaktive Räume werden aufgeräumt', () => {
    let now = 1_000_000;
    const hub = new Hub({ now: () => now, schedule: () => {}, botDelayMs: 0 });
    const host = new FakeConn();
    hub.handle(host, { t: 'create', name: 'Sepp' });
    hub.disconnect(host);
    now += 25 * 60 * 60 * 1000;
    expect(hub.sweep()).toBe(1);
    expect(hub.roomCount).toBe(0);
  });
});

describe('Platz und Kugelfarbe der Menschen', () => {
  const twoHumans = () => {
    const env = setup();
    const host = hostRoom(env.send);
    const guest = new FakeConn();
    env.send(host, {
      t: 'configure',
      seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'bot', level: 'expert' }, { kind: 'bot', level: 'expert' }],
      eightPegs: false,
      rules: {},
    });
    env.send(guest, { t: 'join', code: host.lobby().code, name: 'Anna' });
    return { env, host, guest, reqId: () => host.lobby().requests![0]!.id };
  };

  it('Standardfarben: jeder Platz hat eine eigene Farbe', () => {
    const { host } = twoHumans();
    expect(host.lobby().seats.map((s) => s.color)).toEqual([0, 1, 2, 3]);
  });

  it('Bewilligen mit Wunschplatz und Wunschfarbe', () => {
    const { env, host, guest, reqId } = twoHumans();
    // Platz 2 (Index 2) ist ein Bot -> kein Menschenplatz
    env.send(host, { t: 'approve', requestId: reqId(), seat: 2 });
    expect(host.lastError()).toMatch(/Kein freier Platz/);
    env.send(host, {
      t: 'configure',
      seats: [{ kind: 'human' }, { kind: 'bot', level: 'expert' }, { kind: 'human' }, { kind: 'bot', level: 'expert' }],
      eightPegs: false,
      rules: {},
    });
    env.send(host, { t: 'approve', requestId: reqId(), seat: 2, color: 4 });
    expect(guest.lobby().you).toMatchObject({ status: 'player', seat: 2 });
    expect(host.lobby().seats[2]).toMatchObject({ kind: 'human', name: 'Anna', color: 4 });
    expect(host.lobby().seats.map((s) => s.color)).toEqual([0, 1, 4, 3]);
  });

  it('Vergebene Farbe wird getauscht statt doppelt vergeben', () => {
    const { env, host, guest, reqId } = twoHumans();
    env.send(host, { t: 'approve', requestId: reqId(), seat: 1, color: 0 }); // Farbe 0 hat der Host
    expect(guest.lobby().seats[1]!.color).toBe(0);
    expect(host.lobby().seats[0]!.color).toBe(1); // Host bekommt Annas bisherige Farbe
    const colors = host.lobby().seats.map((s) => s.color);
    expect(new Set(colors).size).toBe(4);
    env.send(host, { t: 'setColor', seat: 3, color: 5 });
    expect(host.lobby().seats[3]!.color).toBe(5);
    env.send(host, { t: 'setColor', seat: 3, color: 9 });
    expect(host.lastError()).toBeDefined();
  });

  it('Konfiguration: doppelte Farben abgelehnt, fehlende ergänzt', () => {
    const { env, host } = twoHumans();
    env.send(host, {
      t: 'configure',
      seats: [{ kind: 'human', color: 2 }, { kind: 'human', color: 2 }],
      eightPegs: false,
      rules: {},
    });
    expect(host.lastError()).toMatch(/nur einmal/);
    env.send(host, {
      t: 'configure',
      seats: [{ kind: 'human', color: 3 }, { kind: 'human' }, { kind: 'bot', level: 'beginner' }],
      eightPegs: false,
      rules: {},
    });
    const c = host.lobby().seats.map((s) => s.color);
    expect(c[0]).toBe(3);
    expect(new Set(c).size).toBe(3);
  });

  it('Plätze tauschen: Spieler wechselt Position samt Farbe, auch der Initiator', () => {
    const { env, host, guest, reqId } = twoHumans();
    env.send(host, { t: 'approve', requestId: reqId(), color: 5 }); // Platz 1, Farbe 5
    env.send(host, { t: 'move', seat: 1, to: 3 });
    expect(guest.lobby().you.seat).toBe(3);
    expect(host.lobby().seats[3]).toMatchObject({ kind: 'human', name: 'Anna', color: 5 });
    expect(host.lobby().seats[1]).toMatchObject({ kind: 'bot', level: 'expert' }); // der Bot von Platz 4 rückt nach
    // Initiator setzt sich auf Platz 2 (Index 2) – dort saß ein Bot, der nach Platz 1 wandert
    env.send(host, { t: 'move', seat: 0, to: 2 });
    expect(host.lobby().you.seat).toBe(2);
    expect(host.lobby().seats[0]).toMatchObject({ kind: 'bot', level: 'expert' });
    env.send(host, { t: 'move', seat: 0, to: 0 });
    expect(host.lastError()).toMatch(/Ungültig/);
    env.send(guest, { t: 'move', seat: 3, to: 0 });
    expect(guest.lastError()).toMatch(/Nur der Spielinitiator/);
  });

  it('Im Spiel gilt die gewählte Position: Sitzplatz im Spiel = Platz in der Lobby', () => {
    const { env, host, guest, reqId } = twoHumans();
    env.send(host, { t: 'approve', requestId: reqId() });
    env.send(host, { t: 'move', seat: 0, to: 3 });
    env.send(host, { t: 'start' });
    env.flush();
    expect(host.game()!.seat).toBe(3);
    expect(guest.game()!.seat).toBe(1);
    // Farben/Plätze sind nach dem Start fix
    env.send(host, { t: 'move', seat: 0, to: 1 });
    expect(host.lastError()).toMatch(/nur in der Lobby/);
    env.send(host, { t: 'setColor', seat: 0, color: 5 });
    expect(host.lastError()).toMatch(/nur in der Lobby/);
    expect(host.lobby().seats[3]).toMatchObject({ name: 'Sepp' });
  });

  it('Der Initiator kann sich auch von einem anderen Platz aus nicht selbst entfernen', () => {
    const { env, host, reqId } = twoHumans();
    env.send(host, { t: 'approve', requestId: reqId() });
    env.send(host, { t: 'move', seat: 0, to: 2 });
    env.send(host, { t: 'kick', seat: 2 });
    expect(host.lastError()).toMatch(/nicht entfernt/);
    env.send(host, { t: 'start' });
    env.send(host, { t: 'setBot', seat: host.lobby().you.seat!, level: 'expert' });
    expect(host.lastError()).toMatch(/nicht ersetzt/);
  });

  it('Alte Snapshots ohne Farben bekommen Standardfarben', () => {
    const env = setup();
    const host = hostRoom(env.send);
    const snap = JSON.parse(JSON.stringify(env.hub.snapshot()));
    for (const s of snap[0].seats) delete s.color;
    const env2 = setup();
    env2.hub.restore(snap);
    const back = new FakeConn();
    env2.send(back, { t: 'resume', token: host.token() });
    expect(back.lobby().seats.map((s) => s.color)).toEqual([0, 1, 2, 3]);
  });
});

describe('Zuggeschwindigkeit', () => {
  it('skaliert den Takt der Computerzüge von 900 ms (Stufe 1) auf 2,5 s (Stufe 5)', () => {
    expect([1, 2, 3, 4, 5].map((s) => turnDelay(900, s))).toEqual([900, 1300, 1700, 2100, 2500]);
    expect(turnDelay(0, 5)).toBe(0);
  });
});

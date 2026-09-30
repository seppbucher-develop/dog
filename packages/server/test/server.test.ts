import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, GameView, LobbyView, ServerMessage } from '@dog/protocol';
import { startServer, type RunningServer } from '../src/server';

let srv: RunningServer;
let base: string;
const dir = mkdtempSync(join(tmpdir(), 'dog-test-'));
const dataDir = join(dir, 'data');

beforeAll(async () => {
  mkdirSync(join(dir, 'www'));
  writeFileSync(join(dir, 'www', 'index.html'), '<h1>Dog</h1>');
  writeFileSync(join(dir, 'secret.txt'), 'geheim');
  srv = await startServer({ port: 0, host: '127.0.0.1', staticDir: join(dir, 'www'), dataDir, botDelayMs: 0 });
  base = `127.0.0.1:${srv.port}`;
});
afterAll(async () => srv.close());

function client(headers: Record<string, string> = {}, port?: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port ?? srv.port}/ws`, { headers });
  const msgs: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    msgs.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  const open = new Promise<void>((ok, fail) => {
    ws.on('open', ok);
    ws.on('error', fail);
  });
  return {
    ws,
    msgs,
    open,
    send: (m: ClientMessage | object) => ws.send(JSON.stringify(m)),
    until: async (pred: () => boolean, ms = 15000) => {
      const end = Date.now() + ms;
      while (!pred()) {
        if (Date.now() > end) throw new Error('Timeout');
        await new Promise<void>((ok) => {
          waiters.push(ok);
          setTimeout(ok, 50);
        });
      }
    },
    lobby: () => [...msgs].reverse().find((m): m is Extract<ServerMessage, { t: 'lobby' }> => m.t === 'lobby')?.lobby as LobbyView | undefined,
    game: () => [...msgs].reverse().find((m): m is Extract<ServerMessage, { t: 'game' }> => m.t === 'game')?.view as GameView | null | undefined,
  };
}

describe('HTTP', () => {
  it('Healthcheck und statische Dateien; kein Zugriff außerhalb des Ordners', async () => {
    expect(await (await fetch(`http://${base}/healthz`)).text()).toBe('ok');
    const index = await fetch(`http://${base}/`);
    expect(await index.text()).toContain('Dog');
    expect(index.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await fetch(`http://${base}/irgendein/pfad`)).status).toBe(200); // SPA-Fallback
    expect((await fetch(`http://${base}/nope.js`)).status).toBe(404);
    // Pfad-Trick über rohen Socket, da fetch "../" normalisiert
    const raw = await new Promise<string>((ok) => {
      import('node:net').then(({ connect }) => {
        const s = connect(srv.port, '127.0.0.1', () => s.write('GET /../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
        let out = '';
        s.on('data', (d) => (out += d));
        s.on('close', () => ok(out));
      });
    });
    expect(raw).not.toContain('geheim');
    const enc = await fetch(`http://${base}/%2e%2e/secret.txt`);
    expect(await enc.text()).not.toContain('geheim');
  });
});

describe('WebSocket', () => {
  it('Fremde Origin wird abgewiesen, gleiche Origin erlaubt', async () => {
    const bad = client({ Origin: 'http://evil.example' });
    await expect(bad.open).rejects.toBeDefined();
    const ok = client({ Origin: `http://${base}` });
    await ok.open;
    ok.ws.close();
  });

  it('Komplettes Spiel über echte WebSockets: Host + Gast', async () => {
    // Test-Clients antworten mit Höchstgeschwindigkeit; Menschen brauchen das Standardlimit
    const fast = await startServer({ port: 0, host: '127.0.0.1', botDelayMs: 0, rateLimit: { burst: 100000, perSec: 100000 } });
    const host = client({}, fast.port);
    const guest = client({}, fast.port);
    await Promise.all([host.open, guest.open]);
    host.send({ t: 'create', name: 'Sepp' });
    await host.until(() => !!host.lobby());
    const code = host.lobby()!.code;
    host.send({ t: 'configure', seats: [{ kind: 'human' }, { kind: 'human' }], eightPegs: false, rules: { handSizes: [5] } });
    guest.send({ t: 'join', code, name: 'Anna' });
    await host.until(() => (host.lobby()?.requests?.length ?? 0) === 1);
    host.send({ t: 'approve', requestId: host.lobby()!.requests![0]!.id });
    await guest.until(() => guest.lobby()?.you.status === 'player');
    // Ereignisgesteuert: auf jede neue Spielansicht höchstens einen Zug senden
    const autoplay = (c: ReturnType<typeof client>) =>
      c.ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as ServerMessage;
        if (m.t !== 'game' || !m.view) return;
        const v = m.view;
        if (v.phase === 'exchange' && !v.exchangeDone[v.seat]) c.send({ t: 'exchange', card: v.myHand[0]! });
        else if (v.legal?.length) {
          // Sinnvoller als "erster Zug": Herauskommen zuerst, sonst möglichst weit vorwärts
          const gain = (pl: (typeof v.legal & object)[number]) =>
            pl.moves.reduce((n, m) => n + (m.t === 'start' ? 100 : m.t === 'move' && m.steps > 0 ? m.steps : 0), 0);
          const p = [...v.legal].sort((a, b) => gain(b) - gain(a))[0]!;
          c.send({ t: 'play', card: p.card, moves: p.moves, ...(p.as ? { as: p.as } : {}) });
        }
      });
    autoplay(host);
    autoplay(guest);
    host.send({ t: 'start' });
    await host.until(() => host.game()?.phase === 'finished', 30000);
    await guest.until(() => guest.game()?.phase === 'finished', 5000);
    expect(host.game()!.phase).toBe('finished');
    expect(guest.game()!.phase).toBe('finished');
    host.ws.close();
    guest.ws.close();
    await fast.close();
  }, 40000);

  it('Ungültiges JSON, Binärdaten und zu große Nachrichten', async () => {
    const c = client();
    await c.open;
    c.ws.send('kein json');
    await c.until(() => c.msgs.some((m) => m.t === 'error'));
    const big = client();
    await big.open;
    const closed = new Promise<number>((ok) => big.ws.on('close', (code) => ok(code)));
    big.ws.send('x'.repeat(100 * 1024));
    expect(await closed).toBe(1009);
    const flood = client();
    await flood.open;
    const fc = new Promise<number>((ok) => flood.ws.on('close', (code) => ok(code)));
    for (let i = 0; i < 60; i++) flood.ws.send('{}');
    expect(await fc).toBe(1008);
    c.ws.close();
  });

  it('Spiele überleben einen Serverneustart (gespeicherte Datei)', async () => {
    const c = client();
    await c.open;
    c.send({ t: 'create', name: 'Restart' });
    await c.until(() => c.msgs.some((m) => m.t === 'welcome'));
    const token = (c.msgs.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }>).token;
    c.ws.close();
    await srv.close(); // speichert
    srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, botDelayMs: 0 });
    base = `127.0.0.1:${srv.port}`;
    const again = client();
    await again.open;
    again.send({ t: 'resume', token });
    await again.until(() => !!again.lobby());
    expect(again.lobby()!.you.name).toBe('Restart');
    again.ws.close();
  });
});

describe('Robustheit', () => {
  it('Nicht beschreibbarer Datenordner bringt den Server nicht zum Absturz', async () => {
    const blocker = join(dir, 'kein-ordner');
    writeFileSync(blocker, 'x'); // Datei statt Ordner: Anlegen von rooms.json schlägt fehl
    const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: blocker, botDelayMs: 0 });
    const c = client({}, s.port);
    await c.open;
    c.send({ t: 'create', name: 'Test' });
    await c.until(() => !!c.lobby());
    await s.close(); // speichert erneut, darf nicht werfen
    expect(c.lobby()!.you.status).toBe('host');
  });
});

import { randomUUID } from 'node:crypto';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Hub } from './hub';
import type { Connection } from './room';
import { loadRooms, saveRooms } from './store';

export interface ServerOptions {
  port: number;
  host?: string;
  /** Ordner mit dem gebauten Web-Client (optional) */
  staticDir?: string;
  /** Ordner zum Speichern der Spiele (optional) */
  dataDir?: string;
  botDelayMs?: number;
  /** Zusätzlich erlaubte Origins für WebSockets (sonst nur gleicher Host) */
  allowedOrigins?: string[];
  /** Nachrichten pro Verbindung: erlaubter Stoß und dauerhafte Rate pro Sekunde */
  rateLimit?: { burst: number; perSec: number };
}

export interface RunningServer {
  port: number;
  hub: Hub;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

const MAX_CONNECTIONS = 500;
const MAX_MESSAGE_BYTES = 64 * 1024;
const DEFAULT_RATE = { burst: 20, perSec: 10 };

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, SECURITY_HEADERS).end('Bad request');
    return;
  }
  const abs = resolve(join(root, normalize(rel)));
  if (abs !== root && !abs.startsWith(root + sep)) {
    res.writeHead(403, SECURITY_HEADERS).end('Forbidden');
    return;
  }
  let file = abs;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Einzelseiten-App: Pfade ohne Dateiendung liefern index.html
    file = extname(rel) === '' ? join(root, 'index.html') : '';
  }
  if (!file || !existsSync(file)) {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;
  const dataFile = opts.dataDir ? join(resolve(opts.dataDir), 'rooms.json') : null;

  let saveTimer: NodeJS.Timeout | null = null;
  const saveNow = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (dataFile) saveRooms(dataFile, hub.snapshot());
  };
  const scheduleSave = () => {
    if (!dataFile || saveTimer) return;
    saveTimer = setTimeout(saveNow, 500);
    saveTimer.unref();
  };

  const hub = new Hub({ botDelayMs: opts.botDelayMs ?? 900, changed: scheduleSave });
  if (dataFile) hub.restore(loadRooms(dataFile));

  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (staticRoot && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(staticRoot, req, res);
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
  });

  const rate = opts.rateLimit ?? DEFAULT_RATE;
  const alive = new WeakMap<WebSocket, boolean>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const origin = req.headers.origin;
    let originOk = true;
    if (origin) {
      try {
        originOk = new URL(origin).host === req.headers.host || (opts.allowedOrigins ?? []).includes(origin);
      } catch {
        originOk = false;
      }
    }
    if (path !== '/ws' || !originOk || wss.clients.size >= MAX_CONNECTIONS) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const conn: Connection = {
      id: randomUUID(),
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (reason) => ws.close(1000, reason.slice(0, 100)),
    };
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));
    let tokens = rate.burst;
    let last = Date.now();

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      tokens = Math.min(rate.burst, tokens + ((now - last) / 1000) * rate.perSec);
      last = now;
      if (--tokens < 0) return ws.close(1008, 'Zu viele Nachrichten');
      if (isBinary) return conn.send({ t: 'error', message: 'Nur Text-Nachrichten' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return conn.send({ t: 'error', message: 'Kein gültiges JSON' });
      }
      hub.handle(conn, parsed);
    });
    ws.on('close', () => hub.disconnect(conn));
    ws.on('error', () => ws.terminate());
  });

  // Tote Verbindungen erkennen (z. B. WLAN weg) und Räume aufräumen
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false); // das pong der Gegenseite setzt es wieder auf true
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  const sweeper = setInterval(() => hub.sweep(), 10 * 60_000);
  sweeper.unref();

  await new Promise<void>((ok) => http.listen(opts.port, opts.host ?? '0.0.0.0', ok));
  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  return {
    port,
    hub,
    async close() {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      saveNow();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}

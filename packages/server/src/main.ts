import { existsSync } from 'node:fs';
import { startServer } from './server';

const env = process.env;
const port = Number(env.PORT ?? 3000);
const server = await startServer({
  port,
  host: env.HOST ?? '0.0.0.0',
  // Ohne Angabe: gebauten Client suchen (aus dem Projektordner oder aus packages/server gestartet)
  staticDir: env.STATIC_DIR ?? ['packages/client/dist', '../client/dist'].find((d) => existsSync(d)),
  dataDir: env.DATA_DIR ?? 'data',
  botDelayMs: Number(env.BOT_DELAY_MS ?? 900),
  version: env.APP_VERSION || 'dev',
  allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : [],
});
console.log(`Dog-Server läuft auf Port ${server.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => process.exit(0));
  });
}

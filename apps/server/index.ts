import { startServer } from './server';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync('.env')) process.loadEnvFile('.env');
const originSetting = process.env.ALLOWED_ORIGINS ?? process.env.RENDER_EXTERNAL_URL;
const origins = originSetting
  ?.split(',')
  .map((x) => x.trim())
  .filter(Boolean);
if (
  origins?.some((origin) => {
    try {
      const url = new URL(origin);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin;
    } catch {
      return true;
    }
  })
)
  throw Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins');
if (process.env.NODE_ENV === 'production' && !origins?.length)
  throw Error('ALLOWED_ORIGINS required in production');
const port = Number(process.env.PORT ?? 8080),
  maxRooms = Number(process.env.MAX_ROOMS ?? 10);
if (
  !Number.isInteger(port) ||
  port < 0 ||
  port > 65535 ||
  !Number.isInteger(maxRooms) ||
  maxRooms < 1
)
  throw Error('Invalid server configuration');
const staticDir = process.env.NODE_ENV === 'production' ? resolve('dist') : undefined;
if (staticDir && !existsSync(resolve(staticDir, 'index.html')))
  throw Error('Production build missing: run npm run build');
const server = await startServer({ port, maxRooms, origins, staticDir });
console.log('V3Dario server listening on port ' + server.port);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void server
      .drain()
      .then(() => server.close())
      .then(() => process.exit(0));
  });

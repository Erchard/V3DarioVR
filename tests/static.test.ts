import { afterEach, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { startServer } from '../apps/server/server';
let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});
async function boot() {
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: resolve('tests/fixtures/site'),
  });
  return 'http://127.0.0.1:' + server.port;
}
it('production serves built index and assets with appropriate caching', async () => {
  const base = await boot(),
    index = await fetch(base),
    asset = await fetch(base + '/assets/test.js');
  expect(await index.text()).toContain('Built game');
  expect(index.headers.get('cache-control')).toBe('no-cache');
  expect(asset.headers.get('cache-control')).toContain('immutable');
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await asset.text()).toContain('fixture');
});
it('missing assets remain 404 and do not return an HTML fallback', async () => {
  const base = await boot(),
    response = await fetch(base + '/missing.js');
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain('<html');
});
it('path traversal cannot expose project files', async () => {
  const base = await boot();
  for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e%5cpackage.json', '/.env']) {
    const response = await fetch(base + path);
    expect(response.status).toBe(404);
  }
});
it('health and readiness are available on the same server', async () => {
  const base = await boot();
  expect((await (await fetch(base + '/healthz')).json()).ok).toBe(true);
  expect((await (await fetch(base + '/readyz')).json()).ok).toBe(true);
});

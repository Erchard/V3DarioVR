import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const child = spawn(process.execPath, ['dist-server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: '0',
    ALLOWED_ORIGINS: 'http://production.test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let socket;
try {
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Production startup timed out')), 30000);
    let output = '';
    child.on('error', reject);
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.stdout.on('data', (data) => {
      output += data;
      const match = output.match(/listening on port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(Error('Server exited: ' + code));
    });
  });
  const base = 'http://127.0.0.1:' + port;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /V3Dario/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset);
  const response = await fetch(base + asset);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal((await (await fetch(base + '/readyz')).json()).ok, true);
  socket = new WebSocket('ws://127.0.0.1:' + port + '/socket', {
    origin: 'http://production.test',
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Production WebSocket timed out')), 10000);
    socket.on('error', reject);
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          protocolVersion: 1,
          type: 'hello',
          buildId: 'production-smoke',
          rulesVersion: 1,
          platform: 'desktop',
        }),
      );
      socket.send(
        JSON.stringify({
          protocolVersion: 1,
          type: 'createRoom',
          requestId: 'create',
          displayName: 'Smoke',
        }),
      );
    });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'welcome') {
        assert.match(message.roomCode, /^[A-Z2-9]{8}$/);
        clearTimeout(timeout);
        resolve();
      }
      if (message.type === 'error') {
        clearTimeout(timeout);
        reject(Error(message.code));
      }
    });
  });
  console.log('PASS: production HTML, JavaScript, readiness and WebSocket room on one port.');
} finally {
  socket?.terminate();
  child.kill();
}

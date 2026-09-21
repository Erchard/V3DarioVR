import { WebSocket } from 'ws';
import { startServer } from '../apps/server/server';
import { performance } from 'node:perf_hooks';
const count = Number(process.env.LOAD_ROOMS ?? 3),
  seconds = Number(process.env.LOAD_SECONDS ?? 30);
if (!Number.isInteger(count) || count < 1 || count > 10 || seconds < 1 || seconds > 3600)
  throw Error('LOAD_ROOMS 1..10, LOAD_SECONDS 1..3600');
const server = await startServer({
  port: 0,
  host: '127.0.0.1',
  origins: ['http://load'],
  maxRooms: 10,
  maxRoomsPerIP: 10,
  createLimitPerMinute: 20,
  countdownMs: 100,
});
const clients: { ws: WebSocket; seq: number; playerId: string; code: string }[] = [];
let bytes = 0,
  snapshots = 0,
  failures = 0;
async function connect(code?: string) {
  const ws = new WebSocket('ws://127.0.0.1:' + server.port + '/socket', { origin: 'http://load' });
  const peer = { ws, seq: 0, playerId: '', code: '' };
  clients.push(peer);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('welcome timeout')), 5000);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          protocolVersion: 1,
          type: 'hello',
          buildId: 'load',
          rulesVersion: 1,
          platform: 'desktop',
        }),
      );
      ws.send(
        JSON.stringify({
          protocolVersion: 1,
          type: code ? 'joinRoom' : 'createRoom',
          requestId: 'j',
          displayName: 'Load',
          ...(code ? { roomCode: code } : {}),
        }),
      );
    });
    ws.on('message', (raw) => {
      bytes += Buffer.byteLength(raw.toString());
      const m = JSON.parse(raw.toString());
      if (m.type === 'welcome') {
        peer.playerId = m.playerId;
        peer.code = m.roomCode;
        clearTimeout(timeout);
        resolve();
      }
      if (m.type === 'snapshot') snapshots++;
      if (m.type === 'error') {
        failures++;
        console.error(m.code);
      }
    });
    ws.on('error', reject);
  });
  return peer;
}
try {
  for (let i = 0; i < count; i++) {
    const owner = await connect();
    for (let j = 0; j < 7; j++) await connect(owner.code);
  }
  for (const p of clients)
    p.ws.send(
      JSON.stringify({ protocolVersion: 1, type: 'ready', requestId: 'ready', ready: true }),
    );
  const tickDurations: number[] = [];
  let start = performance.now(),
    last = start;
  const rssStart = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const now = performance.now();
    tickDurations.push(now - last);
    last = now;
    for (const p of clients)
      if (p.ws.readyState === WebSocket.OPEN)
        p.ws.send(
          JSON.stringify({
            protocolVersion: 1,
            type: 'input',
            seq: p.seq++,
            direction: { x: Math.sin(now / 10000), y: 0.1, z: Math.cos(now / 10000) },
          }),
        );
  }, 1000 / 30);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(timer);
  const duration = (performance.now() - start) / 1000,
    sorted = tickDurations.sort((a, b) => a - b);
  const result = {
    rooms: count,
    clients: clients.length,
    seconds: duration,
    snapshots,
    failures,
    megabytesReceived: bytes / 1048576,
    averageKiBPerClientSecond: bytes / 1024 / clients.length / duration,
    rssStartMiB: rssStart / 1048576,
    rssEndMiB: process.memoryUsage().rss / 1048576,
    loadDriverIntervalP95ms: sorted[Math.floor(sorted.length * 0.95)],
    note: 'Local smoke load, not production capacity certification.',
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures || snapshots < clients.length) process.exitCode = 1;
} finally {
  for (const p of clients) p.ws.terminate();
  await server.close();
}

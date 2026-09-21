import { afterEach, describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/server';
import { getCell, zero } from '../packages/core';
type Running = Awaited<ReturnType<typeof startServer>>;
const servers: Running[] = [],
  sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of servers.splice(0)) await s.close();
});
async function boot(extra: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({
    port: 0,
    host: '127.0.0.1',
    origins: ['http://test'],
    countdownMs: 20,
    ...extra,
  });
  servers.push(s);
  return s;
}
async function client(s: Running) {
  const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/socket', { origin: 'http://test' });
  sockets.push(ws);
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise<void>((r, j) => {
    ws.on('open', r);
    ws.on('error', j);
  });
  const send = (data: Record<string, unknown>) =>
    ws.send(JSON.stringify({ protocolVersion: 1, ...data }));
  send({ type: 'hello', buildId: 'test', rulesVersion: 1, platform: 'desktop' });
  return {
    ws,
    messages,
    send,
    async wait(type: string, predicate = (_m: any) => true) {
      for (let i = 0; i < 300; i++) {
        const m = messages.find((m) => m.type === type && predicate(m));
        if (m) return m;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw Error('Timeout ' + type);
    },
  };
}
async function create(s: Running) {
  const c = await client(s);
  c.send({ type: 'createRoom', requestId: 'create', displayName: 'One' });
  const welcome = await c.wait('welcome');
  return { ...c, welcome };
}
describe('authoritative server', () => {
  it('T-301 desktop and VR share room', async () => {
    const s = await boot(),
      a = await create(s),
      b = await client(s);
    b.send({
      type: 'joinRoom',
      requestId: 'join',
      displayName: 'Two',
      roomCode: a.welcome.roomCode,
    });
    await b.wait('welcome');
    a.send({ type: 'ready', requestId: 'ready', ready: true });
    b.send({ type: 'ready', requestId: 'ready', ready: true });
    const m = await b.wait('snapshot', (m) => m.phase === 'playing');
    expect(m.state.actors.filter((a: any) => a.kind === 'human')).toHaveLength(2);
    expect(m.state.actors).toHaveLength(8);
  });
  it('T-302 full room and missing room', async () => {
    const s = await boot(),
      a = await create(s);
    for (let i = 0; i < 7; i++) {
      const c = await client(s);
      c.send({
        type: 'joinRoom',
        requestId: 'j',
        displayName: 'P' + i,
        roomCode: a.welcome.roomCode,
      });
      await c.wait('welcome');
    }
    const c = await client(s);
    c.send({
      type: 'joinRoom',
      requestId: 'j',
      displayName: 'extra',
      roomCode: a.welcome.roomCode,
    });
    expect((await c.wait('error')).code).toBe('ROOM_FULL');
  });
  it('T-303 mass injection rejected', async () => {
    const s = await boot(),
      c = await create(s);
    c.send({ type: 'input', seq: 0, direction: zero(), mass: 2000 });
    expect((await c.wait('error')).code).toBe('INVALID_MESSAGE');
    expect(getCell(s.rooms.get(c.welcome.roomCode)!.world, c.welcome.playerId)?.mass).toBe(20);
  });
  it('T-307 reconnect preserves actor and rotates token', async () => {
    const s = await boot(),
      a = await create(s);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const b = await client(s);
    b.send({ type: 'resume', requestId: 'resume', resumeToken: a.welcome.resumeToken });
    const m = await b.wait('welcome');
    expect(m.playerId).toBe(a.welcome.playerId);
    expect(m.resumeToken).not.toBe(a.welcome.resumeToken);
  });
  it('T-308 expiry rejects resume', async () => {
    const s = await boot({ reconnectMs: 30 }),
      a = await create(s);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const b = await client(s);
    b.send({ type: 'resume', requestId: 'r', resumeToken: a.welcome.resumeToken });
    expect((await b.wait('error')).code).toBe('RECONNECT_EXPIRED');
  });
  it('T-309 session replacement revokes old socket', async () => {
    const s = await boot(),
      a = await create(s),
      b = await client(s);
    const closed = new Promise<number>((r) => a.ws.on('close', (code) => r(code)));
    b.send({ type: 'resume', requestId: 'r', resumeToken: a.welcome.resumeToken });
    await b.wait('welcome');
    expect(await closed).toBe(4001);
  });
  it('T-311 malformed packet does not kill server', async () => {
    const s = await boot(),
      a = await create(s);
    a.ws.send('not-json');
    expect((await a.wait('error')).code).toBe('INVALID_MESSAGE');
    const b = await client(s);
    b.send({ type: 'ping', nonce: 7 });
    expect((await b.wait('pong')).nonce).toBe(7);
  });
  it('T-312 origin rejected', async () => {
    const s = await boot();
    const ws = new WebSocket('ws://127.0.0.1:' + s.port + '/socket', {
      origin: 'https://evil.invalid',
    });
    sockets.push(ws);
    await expect(
      new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      }),
    ).rejects.toThrow('403');
  });
  it('T-313 duplicate request does not create another room', async () => {
    const s = await boot(),
      a = await create(s);
    a.send({ type: 'createRoom', requestId: 'create', displayName: 'One' });
    await a.wait('ack');
    await new Promise((r) => setTimeout(r, 30));
    expect(s.rooms.size).toBe(1);
  });
  it('T-317 leaving creator keeps other player and fills bots', async () => {
    const s = await boot(),
      a = await create(s),
      b = await client(s);
    b.send({ type: 'joinRoom', requestId: 'j', displayName: 'Two', roomCode: a.welcome.roomCode });
    await b.wait('welcome');
    a.send({ type: 'leave', requestId: 'leave' });
    await a.wait('ack', (m) => m.requestId === 'leave');
    const room = s.rooms.get(a.welcome.roomCode)!;
    expect(room.peers.size).toBe(1);
    expect(room.world.actors).toHaveLength(8);
  });
  it('T-318 early respawn rejected', async () => {
    const s = await boot(),
      a = await create(s);
    a.send({ type: 'respawn', requestId: 'r' });
    expect((await a.wait('error')).code).toBe('NOT_READY');
  });
  it('timer result returns to fresh lobby', async () => {
    const s = await boot({ durationTicks: 12, resultMs: 150 }),
      a = await create(s);
    a.send({ type: 'ready', requestId: 'ready', ready: true });
    await a.wait('snapshot', (m) => m.phase === 'result');
    const m = await a.wait(
      'snapshot',
      (m) =>
        m.phase === 'lobby' &&
        m.state.tick === 0 &&
        m.roster[0].ready === false &&
        a.messages.some((x) => x.type === 'snapshot' && x.phase === 'result'),
    );
    expect(m.state.cells).toHaveLength(8);
  });
});

it('stationary food is sent once and then as changes', async () => {
  const s = await boot(),
    a = await create(s);
  const first = await a.wait('snapshot', (m) => m.foodMode === 'replace');
  expect(first.state.food.length).toBe(800);
  const idle = await a.wait('snapshot', (m) => m.foodMode === 'patch');
  expect(idle.state.food).toHaveLength(0);
  expect(idle.removedFood).toHaveLength(0);
  const room = s.rooms.get(a.welcome.roomCode)!;
  const food = room.world.food[0];
  getCell(room.world, a.welcome.playerId)!.position = { ...food.position };
  room.phase = 'playing';
  const update = await a.wait('snapshot', (m) => m.removedFood.includes(food.id));
  expect(update.foodMode).toBe('patch');
  expect(room.world.food.some((f) => f.id === food.id)).toBe(false);
});

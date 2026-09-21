import { createServer } from 'node:http';
import { staticHandler } from './static';
import { randomBytes, createHash } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createWorld,
  addActor,
  removeActor,
  spawn,
  step,
  snapshot,
  normalize,
  zero,
  RULES_VERSION,
  type World,
  type Vec3,
} from '../../packages/core';
import {
  parseMessage,
  cleanName,
  type ServerMessage,
  type RoomPhase,
} from '../../packages/protocol';
type Peer = {
  cache: Client['cache'];
  id: string;
  name: string;
  socket: WebSocket | null;
  hash: string;
  expires: number;
  ready: boolean;
  seq: number;
  processedSeq: number;
  direction: Vec3;
  lastInput: number;
};
type Room = {
  code: string;
  world: World;
  peers: Map<string, Peer>;
  phase: RoomPhase;
  deadline: number;
  emptySince: number;
  creatorIP: string;
};
type Client = {
  socket: WebSocket;
  ip: string;
  hello: boolean;
  room?: Room;
  peer?: Peer;
  inputTokens: number;
  otherTokens: number;
  refill: number;
  violations: number;
  slowSince: number;
  lastPong: number;
  opened: number;
  knownFood: Set<string>;
  lastWorld?: World;
  cache: Map<string, { time: number; message: ServerMessage }>;
};
export type ServerOptions = {
  port?: number;
  host?: string;
  origins?: string[];
  maxRooms?: number;
  durationTicks?: number;
  countdownMs?: number;
  reconnectMs?: number;
  resultMs?: number;
  maxRoomsPerIP?: number;
  createLimitPerMinute?: number;
  staticDir?: string;
};
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const errorText: Record<string, string> = {
  ROOM_NOT_FOUND: 'Кімнату не знайдено.',
  ROOM_FULL: 'У кімнаті вже 8 гравців.',
  VERSION_MISMATCH: 'Оновіть сторінку: версія гри змінилася.',
  INVALID_MESSAGE: 'Некоректне повідомлення.',
  RATE_LIMITED: 'Забагато запитів. Спробуйте пізніше.',
  RECONNECT_EXPIRED: 'Час перепідключення минув.',
  SERVER_OVERLOAD: 'Сервер перевантажений.',
  SERVER_RESTART: 'Сервер перезапускається.',
  NOT_READY: 'Зачекайте перед відродженням.',
};
export async function startServer(options: ServerOptions = {}) {
  const origins = options.origins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const rooms = new Map<string, Room>(),
    clients = new Set<Client>(),
    ipCreates = new Map<string, number[]>();
  let accepting = true,
    overloadSince = 0,
    ticks = 0,
    maxTickMs = 0;
  const serveFiles = options.staticDir ? staticHandler(options.staticDir) : undefined;
  const http = createServer((req, res) => {
    const ready = req.url === '/readyz';
    if (req.url === '/healthz' || ready) {
      res.writeHead(ready && !accepting ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: !ready || accepting,
          rooms: rooms.size,
          clients: clients.size,
          ticks,
          maxTickMs,
        }),
      );
    } else if (serveFiles) {
      serveFiles(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  http.on('upgrade', (req, socket, head) => {
    if (
      req.url !== '/socket' ||
      !origins.includes(req.headers.origin ?? '') ||
      !accepting ||
      clients.size >= Math.max(100, (options.maxRooms ?? 10) * 16)
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  function send(socket: WebSocket | null, message: ServerMessage) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function error(c: Client, code: string, requestId?: string) {
    send(c.socket, {
      type: 'error',
      protocolVersion: 1,
      code,
      message: errorText[code] ?? code,
      requestId,
    });
  }
  function ack(c: Client, requestId: string, status = 'ok') {
    const message: ServerMessage = { type: 'ack', protocolVersion: 1, requestId, status };
    c.cache.set(requestId, { time: Date.now(), message });
    if (c.cache.size > 128) c.cache.delete(c.cache.keys().next().value!);
    send(c.socket, message);
  }
  function refillBots(room: Room) {
    const wanted = 8 - room.peers.size;
    const bots = room.world.actors.filter((a) => a.kind === 'bot');
    for (const a of bots.slice(wanted)) removeActor(room.world, a.id);
    for (let i = bots.length; i < wanted; i++)
      addActor(
        room.world,
        ['NOVA', 'ORBIT', 'LYRA', 'PULSE', 'ECHO', 'ATLAS', 'ION', 'VEGA'][i % 8],
        'bot',
      );
  }
  function reset(room: Room) {
    room.world = createWorld(
      randomBytes(4).readUInt32LE(),
      { bots: 0, durationTicks: options.durationTicks ?? 18000 },
      true,
    );
    for (const p of room.peers.values()) {
      addActor(room.world, p.name, 'human', p.id);
      p.ready = false;
      p.direction = zero();
    }
    refillBots(room);
    room.phase = 'lobby';
    room.deadline = 0;
  }
  function disconnect(c: Client, leave = false) {
    if (c.peer && c.room && c.peer.socket === c.socket) {
      const p = c.peer;
      p.socket = null;
      p.direction = zero();
      p.expires = Date.now() + (leave ? 0 : (options.reconnectMs ?? 15000));
      if (leave) {
        c.room.peers.delete(p.id);
        removeActor(c.room.world, p.id);
        refillBots(c.room);
      }
    }
    c.room = undefined;
    c.peer = undefined;
  }
  function welcome(c: Client, p: Peer, room: Room) {
    const token = randomBytes(24).toString('hex');
    p.hash = digest(token);
    p.socket = c.socket;
    p.expires = 0;
    p.seq = -1;
    p.processedSeq = -1;
    p.direction = zero();
    p.lastInput = 0;
    c.peer = p;
    c.cache = p.cache;
    c.room = room;
    send(c.socket, {
      type: 'welcome',
      protocolVersion: 1,
      playerId: p.id,
      roomCode: room.code,
      resumeToken: token,
      rulesVersion: RULES_VERSION,
    });
    publish(c);
  }
  function publish(c: Client) {
    const room = c.room,
      p = c.peer;
    if (!room || !p) return;
    if (c.socket.bufferedAmount > 1024 * 1024) {
      c.slowSince ||= Date.now();
      if (Date.now() - c.slowSince > 5000) c.socket.close(1008, 'slow consumer');
      return;
    }
    c.slowSince = 0;
    const replace = c.lastWorld !== room.world;
    if (replace) c.knownFood.clear();
    const ids = new Set(room.world.food.map((f) => f.id)),
      removedFood = [...c.knownFood].filter((id) => !ids.has(id));
    const state = snapshot(room.world, false);
    state.food = room.world.food.filter((f) => !c.knownFood.has(f.id));
    send(c.socket, {
      type: 'snapshot',
      protocolVersion: 1,
      state,
      foodMode: replace ? 'replace' : 'patch',
      removedFood,
      phase: room.phase,
      countdown: Math.max(0, (room.deadline - Date.now()) / 1000),
      lastProcessedSeq: p.processedSeq,
      roster: [...room.peers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        connected: !!p.socket,
      })),
    });
    c.knownFood = ids;
    c.lastWorld = room.world;
  }
  wss.on('connection', (socket, req) => {
    const c: Client = {
      socket,
      ip: req.socket.remoteAddress ?? 'unknown',
      hello: false,
      inputTokens: 15,
      otherTokens: 10,
      refill: Date.now(),
      violations: 0,
      slowSince: 0,
      lastPong: Date.now(),
      opened: Date.now(),
      knownFood: new Set(),
      cache: new Map(),
    };
    clients.add(c);
    socket.on('pong', () => (c.lastPong = Date.now()));
    socket.on('error', () => {});
    socket.on('close', () => {
      disconnect(c);
      clients.delete(c);
    });
    socket.on('message', (data, isBinary) => {
      let requestId: string | undefined;
      try {
        if (isBinary) throw Error('INVALID_MESSAGE');
        const m = parseMessage(data.toString());
        if ('requestId' in m) requestId = m.requestId;
        const now = Date.now(),
          elapsed = (now - c.refill) / 1000;
        c.refill = now;
        c.inputTokens = Math.min(15, c.inputTokens + elapsed * 60);
        c.otherTokens = Math.min(10, c.otherTokens + elapsed * 10);
        if (m.type === 'input') {
          if (c.inputTokens < 1) throw Error('RATE_LIMITED');
          c.inputTokens--;
        } else {
          if (c.otherTokens < 1) throw Error('RATE_LIMITED');
          c.otherTokens--;
        }
        if (requestId) {
          const cached = c.cache.get(requestId);
          if (cached && now - cached.time < 60000) {
            send(socket, cached.message);
            return;
          }
        }
        if (m.type === 'hello') {
          c.hello = true;
          return;
        }
        if (!c.hello) throw Error('VERSION_MISMATCH');
        if (m.type === 'ping') {
          send(socket, { type: 'pong', protocolVersion: 1, nonce: m.nonce });
          return;
        }
        if (m.type === 'resume') {
          if (c.peer) throw Error('INVALID_MESSAGE');
          const hash = digest(m.resumeToken);
          let found = false;
          for (const room of rooms.values())
            for (const p of room.peers.values())
              if (p.hash === hash && (p.socket || p.expires > now)) {
                if (p.socket) {
                  const old = p.socket;
                  p.socket = null;
                  old.close(4001, 'SESSION_REPLACED');
                }
                welcome(c, p, room);
                ack(c, m.requestId);
                found = true;
                break;
              }
          if (!found) throw Error('RECONNECT_EXPIRED');
          return;
        }
        if (m.type === 'createRoom' || m.type === 'joinRoom') {
          if (c.peer) throw Error('INVALID_MESSAGE');
          if (!accepting) throw Error('SERVER_OVERLOAD');
          let room: Room;
          if (m.type === 'createRoom') {
            const history = (ipCreates.get(c.ip) ?? []).filter((t) => now - t < 60000);
            if (
              history.length >= (options.createLimitPerMinute ?? 5) ||
              [...rooms.values()].filter((r) => r.creatorIP === c.ip).length >=
                (options.maxRoomsPerIP ?? 2)
            )
              throw Error('RATE_LIMITED');
            if (rooms.size >= (options.maxRooms ?? 10)) throw Error('SERVER_OVERLOAD');
            history.push(now);
            ipCreates.set(c.ip, history);
            const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let code: string;
            do {
              code = Array.from(randomBytes(8), (b) => alphabet[b % 32]).join('');
            } while (rooms.has(code));
            room = {
              code,
              world: createWorld(
                randomBytes(4).readUInt32LE(),
                { bots: 0, durationTicks: options.durationTicks ?? 18000 },
                true,
              ),
              peers: new Map(),
              phase: 'lobby',
              deadline: 0,
              emptySince: 0,
              creatorIP: c.ip,
            };
            rooms.set(code, room);
          } else {
            const existing = rooms.get(m.roomCode);
            if (!existing) throw Error('ROOM_NOT_FOUND');
            room = existing;
          }
          if (room.peers.size >= 8) throw Error('ROOM_FULL');
          const p: Peer = {
            cache: new Map(),
            id: randomBytes(8).toString('hex'),
            name: cleanName(m.displayName),
            socket,
            hash: '',
            expires: 0,
            ready: false,
            seq: -1,
            processedSeq: -1,
            direction: zero(),
            lastInput: 0,
          };
          const bot = room.world.actors.find((a) => a.kind === 'bot');
          if (bot) removeActor(room.world, bot.id);
          room.peers.set(p.id, p);
          addActor(room.world, p.name, 'human', p.id);
          refillBots(room);
          welcome(c, p, room);
          ack(c, m.requestId);
          return;
        }
        const p = c.peer,
          room = c.room;
        if (!p || !room || p.socket !== socket) throw Error('INVALID_MESSAGE');
        if (m.type === 'input') {
          if (m.seq <= p.seq) return;
          p.seq = m.seq;
          p.direction = normalize(m.direction);
          p.lastInput = now;
          return;
        }
        if (m.type === 'ready') {
          if (room.phase === 'lobby') p.ready = m.ready;
          ack(c, m.requestId);
          return;
        }
        if (m.type === 'respawn') {
          const a = room.world.actors.find((a) => a.id === p.id)!;
          if (
            room.phase !== 'playing' ||
            a.cellId ||
            a.respawnAt === null ||
            a.respawnAt > room.world.tick
          )
            throw Error('NOT_READY');
          spawn(room.world, a);
          ack(c, m.requestId);
          return;
        }
        if (m.type === 'leave') {
          disconnect(c, true);
          ack(c, m.requestId);
          return;
        }
      } catch (e) {
        if (!(e instanceof SyntaxError) && !(e instanceof Error && errorText[e.message])) {
          console.error('Unhandled room command failure', e);
          socket.close(1011, 'Internal server error');
          return;
        }
        const code = e instanceof SyntaxError ? 'INVALID_MESSAGE' : (e as Error).message;
        error(c, code, requestId);
        if (
          ['INVALID_MESSAGE', 'RATE_LIMITED', 'VERSION_MISMATCH'].includes(code) &&
          ++c.violations >= 3
        )
          socket.close(1008, code);
      }
    });
  });
  let last = performance.now(),
    acc = 0,
    lastPublish = 0,
    lastHeartbeat = 0;
  const timer = setInterval(() => {
    const begin = performance.now(),
      now = Date.now();
    acc += (begin - last) / 1000;
    last = begin;
    if (![...rooms.values()].some((r) => r.phase === 'playing')) {
      acc = 0;
      overloadSince = 0;
    }
    if (acc > 0.25) {
      overloadSince ||= now;
      if (now - overloadSince > 5000) {
        accepting = false;
        for (const room of rooms.values())
          if (room.phase === 'playing') {
            room.phase = 'result';
            room.world.phase = 'result';
            room.world.reason = 'SERVER_OVERLOAD';
            room.deadline = now + (options.resultMs ?? 15000);
          }
        for (const c of clients) error(c, 'SERVER_OVERLOAD');
        acc = 0;
      }
    } else overloadSince = 0;
    let count = 0;
    while (acc >= 1 / 60 && count++ < 5) {
      for (const room of rooms.values())
        if (room.phase === 'playing') {
          const commands: Record<string, Vec3> = {};
          for (const p of room.peers.values())
            commands[p.id] = p.socket && now - p.lastInput <= 250 ? p.direction : zero();
          step(room.world, commands);
          for (const p of room.peers.values()) p.processedSeq = p.seq;
          if (room.world.phase === 'result') {
            room.phase = 'result';
            room.deadline = now + (options.resultMs ?? 15000);
          }
        }
      ticks++;
      acc -= 1 / 60;
    }
    for (const room of rooms.values()) {
      for (const p of room.peers.values())
        if (!p.socket && p.expires <= now) {
          room.peers.delete(p.id);
          removeActor(room.world, p.id);
          refillBots(room);
        }
      if (!room.peers.size) {
        room.emptySince ||= now;
        if (now - room.emptySince >= 60000) rooms.delete(room.code);
      } else room.emptySince = 0;
      const live = [...room.peers.values()].filter((p) => p.socket);
      if (room.phase === 'lobby' && live.length && live.every((p) => p.ready)) {
        room.phase = 'countdown';
        room.deadline = now + (options.countdownMs ?? 3000);
      }
      if (room.phase === 'countdown' && room.deadline <= now) {
        room.phase = 'playing';
        room.deadline = 0;
      }
      if (room.phase === 'result' && room.deadline <= now) reset(room);
    }
    if (now - lastPublish >= 100) {
      lastPublish = now;
      for (const c of clients) publish(c);
    }
    if (now - lastHeartbeat >= 5000) {
      lastHeartbeat = now;
      for (const c of clients) {
        if ((!c.hello && now - c.opened > 5000) || now - c.lastPong > 15000) c.socket.terminate();
        else c.socket.ping();
      }
      for (const [ip, h] of ipCreates) if (h.every((t) => now - t > 60000)) ipCreates.delete(ip);
    }
    maxTickMs = Math.max(maxTickMs, performance.now() - begin);
  }, 8);
  await new Promise<void>((resolve) =>
    http.listen(options.port ?? 8080, options.host ?? '0.0.0.0', resolve),
  );
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 8080;
  return {
    port,
    rooms,
    http,
    async close() {
      accepting = false;
      clearInterval(timer);
      for (const c of clients) {
        error(c, 'SERVER_RESTART');
        c.socket.terminate();
      }
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
    },
    drain() {
      accepting = false;
      return new Promise<void>((resolve) => {
        const started = Date.now();
        const t = setInterval(() => {
          if (
            ![...rooms.values()].some((r) => r.phase === 'playing' || r.phase === 'countdown') ||
            Date.now() - started > 330000
          ) {
            clearInterval(t);
            resolve();
          }
        }, 250);
      });
    },
  };
}

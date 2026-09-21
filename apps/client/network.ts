import {
  getCell,
  speed,
  normalize,
  clampCell,
  zero,
  type Food,
  type Snapshot,
  type Vec3,
} from '../../packages/core';
import {
  parseServerMessage,
  type ServerMessage,
  type RoomPhase,
  type Roster,
} from '../../packages/protocol';
type Pending = { seq: number; direction: Vec3; dt: number };
export class NetworkSession {
  socket?: WebSocket;
  connected = false;
  playerId = '';
  roomCode = '';
  phase: RoomPhase = 'lobby';
  roster: Roster = [];
  countdown = 0;
  rtt = 0;
  food = new Map<string, Food>();
  state?: Snapshot;
  token = '';
  seq = 0;
  request = 0;
  closed = false;
  sendTime = 0;
  pingTime = 0;
  lastReceive = 0;
  predicted?: Vec3;
  pending: Pending[] = [];
  frames: { time: number; state: Snapshot }[] = [];
  retryStart = 0;
  retryCount = 0;
  retryTimer?: ReturnType<typeof setTimeout>;
  correction = 0;
  offset = zero();
  bufferMs = 150;
  arrivalGap = 100;
  lastArrival = 0;
  constructor(
    private receive: (s: Snapshot, id: string) => void,
    private notify: (s: string) => void,
  ) {}
  url() {
    return (
      import.meta.env.VITE_SERVER_URL ||
      (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/socket'
    );
  }
  connect(action: 'createRoom' | 'joinRoom', name: string, roomCode: string) {
    return this.open({
      type: action,
      requestId: this.next(),
      displayName: name,
      ...(action === 'joinRoom' ? { roomCode } : {}),
    });
  }
  next() {
    return 'r' + ++this.request;
  }
  send(data: Record<string, unknown>) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ protocolVersion: 1, ...data }));
  }
  private open(action: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = (this.socket = new WebSocket(this.url()));
      let accepted = false,
        settled = false;
      const timer = setTimeout(() => {
        if (!accepted) {
          settled = true;
          reject(Error('Сервер не відповідає. Спробуйте ще раз за хвилину.'));
          ws.close();
        }
      }, 7000);
      ws.onopen = () => {
        this.send({
          type: 'hello',
          buildId: '0.1.0',
          rulesVersion: 1,
          platform: navigator.xr ? 'vr' : 'desktop',
        });
        this.send(action);
      };
      ws.onmessage = (e) => {
        if (ws !== this.socket || this.closed) return;
        let m: ServerMessage;
        try {
          m = parseServerMessage(String(e.data));
          if (m.protocolVersion !== 1) throw Error();
        } catch {
          this.notify('Некоректна відповідь сервера. Оновіть сторінку.');
          this.closed = true;
          ws.close(1002, 'Invalid server protocol');
          return;
        }
        if (m.type === 'welcome') {
          accepted = true;
          settled = true;
          clearTimeout(timer);
          this.connected = true;
          this.playerId = m.playerId;
          this.roomCode = m.roomCode;
          this.token = m.resumeToken;
          this.seq = 0;
          this.pending = [];
          this.frames = [];
          this.food.clear();
          this.offset = zero();
          this.predicted = undefined;
          this.retryStart = 0;
          this.retryCount = 0;
          resolve();
        }
        if (m.type === 'snapshot') {
          if (m.foodMode === 'replace') this.food.clear();
          for (const id of m.removedFood) this.food.delete(id);
          for (const food of m.state.food) this.food.set(food.id, food);
          m.state.food = [...this.food.values()];
          const now = performance.now();
          if (this.lastArrival) {
            const gap = now - this.lastArrival;
            this.arrivalGap = this.arrivalGap * 0.9 + gap * 0.1;
            this.bufferMs = Math.max(100, Math.min(250, 100 + Math.abs(gap - this.arrivalGap) * 2));
          }
          this.lastArrival = now;
          this.lastReceive = now;
          this.state = m.state;
          this.phase = m.phase;
          this.roster = m.roster;
          this.countdown = m.countdown;
          this.frames.push({ time: now, state: m.state });
          while (this.frames.length > 12) this.frames.shift();
          this.pending = this.pending.filter((p) => p.seq > m.lastProcessedSeq);
          const cell = getCell(m.state, this.playerId);
          if (cell) {
            const p = { ...cell.position };
            for (const command of this.pending) {
              const v = speed(cell.mass, m.state.config) * command.dt;
              p.x += command.direction.x * v;
              p.y += command.direction.y * v;
              p.z += command.direction.z * v;
            }
            const copy = { ...cell, position: p };
            clampCell(copy, m.state.config);
            if (this.predicted) {
              this.correction = Math.hypot(
                this.predicted.x - p.x,
                this.predicted.y - p.y,
                this.predicted.z - p.z,
              );
              this.offset = {
                x: this.offset.x + this.predicted.x - p.x,
                y: this.offset.y + this.predicted.y - p.y,
                z: this.offset.z + this.predicted.z - p.z,
              };
              if (this.correction > 1) this.offset = zero();
            }
            this.predicted = p;
          } else this.predicted = undefined;
          this.receive(m.state, this.playerId);
        }
        if (m.type === 'pong') this.rtt = Math.round(performance.now() - m.nonce);
        if (m.type === 'error') {
          if (!accepted && !settled) {
            settled = true;
            clearTimeout(timer);
            reject(Error(m.message));
            ws.close();
            return;
          }
          this.notify(m.message);
          if (
            ['RECONNECT_EXPIRED', 'VERSION_MISMATCH', 'SERVER_RESTART', 'SERVER_OVERLOAD'].includes(
              m.code,
            )
          ) {
            this.token = '';
            this.closed = true;
            ws.close();
          }
        }
      };
      ws.onerror = () => {
        if (!accepted && !settled) {
          settled = true;
          clearTimeout(timer);
          reject(Error('Немає з’єднання з сервером. Спробуйте ще раз.'));
        }
      };
      ws.onclose = (e) => {
        clearTimeout(timer);
        if (ws !== this.socket) return;
        this.connected = false;
        if (!accepted && !settled) {
          settled = true;
          reject(Error('Сервер відхилив з’єднання.'));
        }
        if (this.closed) return;
        if (e.code === 4001) {
          this.token = '';
          this.notify('Сесію відкрито в іншому вікні.');
          return;
        }
        if (this.token) this.scheduleRetry();
      };
    });
  }
  private scheduleRetry() {
    if (this.closed || !this.token || this.retryTimer) return;
    this.retryStart ||= Date.now();
    if (Date.now() - this.retryStart > 15000) {
      this.notify('Не вдалося перепідключитися. Поверніться в меню та приєднайтесь знову.');
      this.token = '';
      return;
    }
    const delay =
      Math.min(4000, 500 * Math.pow(2, this.retryCount++)) * (0.9 + Math.random() * 0.2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.open({ type: 'resume', requestId: this.next(), resumeToken: this.token }).catch(
        () => this.scheduleRetry(),
      );
    }, delay);
  }
  ready() {
    this.send({ type: 'ready', requestId: this.next(), ready: true });
  }
  respawn() {
    this.send({ type: 'respawn', requestId: this.next() });
  }
  update(dt: number, direction: Vec3) {
    const u = normalize(direction);
    const cell = this.state && getCell(this.state, this.playerId);
    if (this.predicted && cell && this.connected && this.phase === 'playing') {
      const v = speed(cell.mass, this.state!.config) * dt;
      this.predicted.x += u.x * v;
      this.predicted.y += u.y * v;
      this.predicted.z += u.z * v;
      clampCell({ ...cell, position: this.predicted }, this.state!.config);
    }
    this.sendTime += dt;
    this.pingTime += dt;
    this.countdown = Math.max(0, this.countdown - dt);
    this.correction *= Math.exp(-dt * 12);
    const decay = Math.exp(-dt * 10);
    this.offset.x *= decay;
    this.offset.y *= decay;
    this.offset.z *= decay;
    if (this.sendTime >= 1 / 30 && this.connected) {
      const elapsed = Math.min(0.1, this.sendTime);
      this.sendTime = 0;
      const seq = this.seq++;
      const command = { seq, direction: this.phase === 'playing' ? u : zero(), dt: elapsed };
      this.pending.push(command);
      if (this.pending.length > 60) this.pending.shift();
      this.send({ type: 'input', seq, direction: command.direction });
    }
    if (this.pingTime > 2 && this.connected) {
      this.pingTime = 0;
      this.send({ type: 'ping', nonce: performance.now() });
    }
  }
  renderState(): Snapshot {
    if (!this.state) throw Error('No snapshot');
    const target = performance.now() - this.bufferMs;
    let a = this.frames[0],
      b = this.frames[this.frames.length - 1];
    for (let i = 1; i < this.frames.length; i++)
      if (this.frames[i].time >= target) {
        a = this.frames[i - 1];
        b = this.frames[i];
        break;
      }
    const t =
      a && b ? Math.max(0, Math.min(1, (target - a.time) / Math.max(1, b.time - a.time))) : 1;
    return {
      ...this.state,
      cells: this.state.cells.map((c) => {
        if (c.actorId === this.playerId && this.predicted)
          return {
            ...c,
            position: {
              x: this.predicted.x + this.offset.x,
              y: this.predicted.y + this.offset.y,
              z: this.predicted.z + this.offset.z,
            },
          };
        const ca = a?.state.cells.find((x) => x.id === c.id),
          cb = b?.state.cells.find((x) => x.id === c.id);
        if (!ca || !cb) return c;
        if (target > b.time && b.time > a.time && this.phase === 'playing') {
          const extra = Math.min(100, target - b.time) / (b.time - a.time);
          return {
            ...c,
            position: {
              x: cb.position.x + (cb.position.x - ca.position.x) * extra,
              y: cb.position.y + (cb.position.y - ca.position.y) * extra,
              z: cb.position.z + (cb.position.z - ca.position.z) * extra,
            },
          };
        }
        return {
          ...c,
          position: {
            x: ca.position.x + (cb.position.x - ca.position.x) * t,
            y: ca.position.y + (cb.position.y - ca.position.y) * t,
            z: ca.position.z + (cb.position.z - ca.position.z) * t,
          },
        };
      }),
    };
  }
  close() {
    this.closed = true;
    this.connected = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.send({ type: 'leave', requestId: this.next() });
    this.socket?.close();
    this.token = '';
  }
}

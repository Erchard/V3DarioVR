export type Vec3 = { x: number; y: number; z: number };
export type Config = {
  halfSize: number;
  foodTarget: number;
  bots: number;
  startMass: number;
  maxMass: number;
  speed: number;
  minSpeed: number;
  durationTicks: number;
  protectionTicks: number;
};
export const DEFAULT: Readonly<Config> = Object.freeze({
  halfSize: 40,
  foodTarget: 800,
  bots: 8,
  startMass: 20,
  maxMass: 2000,
  speed: 5,
  minSpeed: 1.5,
  durationTicks: 18000,
  protectionTicks: 180,
});
export const DT = 1 / 60;
export const RULES_VERSION = 1;
export const zero = (): Vec3 => ({ x: 0, y: 0, z: 0 });
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export function normalize(v: Vec3): Vec3 {
  if (![v.x, v.y, v.z].every(Number.isFinite)) throw Error('Direction must be finite');
  const scale = Math.max(1, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
  const x = v.x / scale,
    y = v.y / scale,
    z = v.z / scale;
  const divisor = Math.max(1 / scale, Math.hypot(x, y, z));
  return { x: x / divisor, y: y / divisor, z: z / divisor };
}
export function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z);
  return n ? { x: v.x / n, y: v.y / n, z: v.z / n } : zero();
}
export const radius = (mass: number) => Math.cbrt(mass / 20);
export const speed = (mass: number, c: Config = DEFAULT) =>
  Math.max(c.minSpeed, Math.min(c.speed, c.speed * Math.pow(20 / mass, 0.15)));
export type Stats = {
  peakMass: number;
  lastMass: number;
  foodEaten: number;
  cellsEaten: number;
  deaths: number;
  aliveTicks: number;
};
export type Actor = {
  id: string;
  name: string;
  kind: 'human' | 'bot';
  color: number;
  cellId: string | null;
  respawnAt: number | null;
  stats: Stats;
};
export type Cell = {
  id: string;
  actorId: string;
  position: Vec3;
  mass: number;
  protectedUntil: number;
};
export type Food = { id: string; position: Vec3; color: number };
export type Event = {
  id: string;
  tick: number;
  type: 'consume' | 'death' | 'spawn' | 'end';
  actorId: string;
  targetId?: string;
};
export type Phase = 'playing' | 'result';
export type World = {
  tick: number;
  seed: number;
  rng: number;
  serial: number;
  config: Config;
  online: boolean;
  phase: Phase;
  actors: Actor[];
  cells: Cell[];
  food: Food[];
  events: Event[];
  humanId: string | null;
  reason: string;
  botDirections: Record<string, Vec3>;
  wander: Record<string, { target: Vec3; until: number }>;
};
export type Snapshot = Pick<
  World,
  'tick' | 'config' | 'phase' | 'actors' | 'cells' | 'food' | 'humanId' | 'reason'
>;
export const PALETTE = [
  0x63efd0, 0xff8c70, 0x9d8cff, 0xffd16d, 0x69bbff, 0xff78bc, 0xb4f275, 0xd6dfff, 0x83e9ff,
];
export function validateConfig(c: Config) {
  if (
    !Object.keys(DEFAULT).every((key) => Number.isFinite(c[key as keyof Config])) ||
    c.halfSize <= 0 ||
    c.startMass <= 0 ||
    c.maxMass < c.startMass ||
    radius(c.maxMass) >= c.halfSize ||
    c.speed <= 0 ||
    c.minSpeed <= 0 ||
    c.minSpeed > c.speed ||
    c.protectionTicks < 0 ||
    c.foodTarget < 0 ||
    c.bots < 0 ||
    c.durationTicks < 1 ||
    ![c.foodTarget, c.bots, c.durationTicks, c.protectionTicks].every(Number.isInteger)
  )
    throw new Error('Некоректна конфігурація гри');
}
export function random(w: World): number {
  w.rng = (w.rng + 0x6d2b79f5) >>> 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const id = (w: World, prefix: string) => prefix + (++w.serial).toString().padStart(8, '0');
const point = (w: World, margin: number): Vec3 => {
  const s = w.config.halfSize - margin;
  return { x: (random(w) * 2 - 1) * s, y: (random(w) * 2 - 1) * s, z: (random(w) * 2 - 1) * s };
};
export function clampCell(cell: Cell, c: Config) {
  const edge = c.halfSize - radius(cell.mass);
  for (const a of ['x', 'y', 'z'] as const)
    cell.position[a] = Math.max(-edge, Math.min(edge, cell.position[a]));
}
function emit(w: World, type: Event['type'], actorId: string, targetId?: string) {
  w.events.push({ id: id(w, 'e'), tick: w.tick, type, actorId, targetId });
}
export function spawn(w: World, a: Actor) {
  if (a.cellId) return;
  let best = point(w, radius(w.config.startMass)),
    bestScore = -Infinity;
  for (let i = 0; i < 32; i++) {
    const p = i === 0 ? best : point(w, radius(w.config.startMass));
    const score = Math.min(
      ...w.cells.map((c) => distance(p, c.position) - radius(c.mass) - radius(w.config.startMass)),
    );
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
    if (score >= 4) {
      best = p;
      break;
    }
  }
  const cell: Cell = {
    id: id(w, 'c'),
    actorId: a.id,
    position: best,
    mass: w.config.startMass,
    protectedUntil: w.tick + w.config.protectionTicks,
  };
  w.cells.push(cell);
  a.cellId = cell.id;
  a.respawnAt = null;
  a.stats.lastMass = cell.mass;
  a.stats.peakMass = Math.max(a.stats.peakMass, cell.mass);
  emit(w, 'spawn', a.id);
}
export function addActor(
  w: World,
  name: string,
  kind: Actor['kind'] = 'human',
  actorId?: string,
): Actor {
  const a: Actor = {
    id: actorId ?? id(w, 'a'),
    name,
    kind,
    color: PALETTE[w.actors.length % PALETTE.length],
    cellId: null,
    respawnAt: null,
    stats: { peakMass: 0, lastMass: 0, foodEaten: 0, cellsEaten: 0, deaths: 0, aliveTicks: 0 },
  };
  if (w.actors.some((x) => x.id === a.id)) throw new Error('Duplicate actor');
  w.actors.push(a);
  spawn(w, a);
  return a;
}
export function removeActor(w: World, actorId: string) {
  w.cells = w.cells.filter((c) => c.actorId !== actorId);
  w.actors = w.actors.filter((a) => a.id !== actorId);
  delete w.botDirections[actorId];
  delete w.wander[actorId];
}
export function replenish(w: World, count: number) {
  for (let i = 0; i < count && w.food.length < w.config.foodTarget; i++) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const position = point(w, 0.2);
      if (w.cells.every((c) => distance(position, c.position) > radius(c.mass))) {
        w.food.push({ id: id(w, 'f'), position, color: Math.floor(random(w) * PALETTE.length) });
        break;
      }
    }
  }
}
export function createWorld(seed = 42, override: Partial<Config> = {}, online = false): World {
  const config = { ...DEFAULT, ...override };
  validateConfig(config);
  const w: World = {
    tick: 0,
    seed,
    rng: seed >>> 0,
    serial: 0,
    config,
    online,
    phase: 'playing',
    actors: [],
    cells: [],
    food: [],
    events: [],
    humanId: null,
    reason: '',
    botDirections: {},
    wander: {},
  };
  if (!online) w.humanId = addActor(w, 'Ви').id;
  for (let i = 0; i < config.bots; i++)
    addActor(w, ['NOVA', 'ORBIT', 'LYRA', 'PULSE', 'ECHO', 'ATLAS', 'ION', 'VEGA'][i % 8], 'bot');
  replenish(w, config.foodTarget);
  w.events = [];
  return w;
}
export const getCell = (w: Snapshot, actorId: string | null) =>
  w.cells.find((c) => c.actorId === actorId);
export function leaderboard(w: Snapshot) {
  return [...w.actors].sort(
    (a, b) =>
      (getCell(w, b.id)?.mass ?? 0) - (getCell(w, a.id)?.mass ?? 0) ||
      b.stats.cellsEaten - a.stats.cellsEaten ||
      a.id.localeCompare(b.id),
  );
}
export function place(w: Snapshot, actorId: string, atDeath = false): number {
  const score = (a: Actor) =>
    getCell(w, a.id)?.mass ?? (atDeath && a.id === actorId ? a.stats.lastMass : 0);
  return (
    [...w.actors]
      .sort(
        (a, b) =>
          score(b) - score(a) ||
          b.stats.cellsEaten - a.stats.cellsEaten ||
          a.id.localeCompare(b.id),
      )
      .findIndex((a) => a.id === actorId) + 1
  );
}
export function canEat(a: Cell, b: Cell, tick: number) {
  return (
    a.id !== b.id &&
    a.protectedUntil <= tick &&
    b.protectedUntil <= tick &&
    a.mass >= 1.15 * b.mass &&
    distance(a.position, b.position) + 0.5 * radius(b.mass) <= radius(a.mass)
  );
}
export function botDirection(w: World, c: Cell): Vec3 {
  const nearest = <T extends { id: string; position: Vec3 }>(items: T[]) => {
    let best: T | undefined,
      bestDistance = 25;
    for (const item of items) {
      const d = distance(item.position, c.position);
      if (
        d < bestDistance ||
        (d === bestDistance && (!best || item.id.localeCompare(best.id) < 0))
      ) {
        best = item;
        bestDistance = d;
      }
    }
    return best;
  };
  const threat = nearest(
    w.cells.filter((b) => b.id !== c.id && b.protectedUntil <= w.tick && b.mass >= c.mass * 1.15),
  );
  const prey =
    c.protectedUntil <= w.tick
      ? nearest(
          w.cells.filter(
            (b) => b.id !== c.id && b.protectedUntil <= w.tick && c.mass >= b.mass * 1.15,
          ),
        )
      : undefined;
  let direction: Vec3;
  if (threat) direction = subtract(c.position, threat.position);
  else if (prey) direction = subtract(prey.position, c.position);
  else {
    const food = nearest(w.food);
    if (food) direction = subtract(food.position, c.position);
    else {
      let target = w.wander[c.actorId];
      if (!target || target.until <= w.tick || distance(target.target, c.position) < 1)
        target = w.wander[c.actorId] = { target: point(w, radius(c.mass)), until: w.tick + 120 };
      direction = subtract(target.target, c.position);
    }
  }
  const edge = w.config.halfSize - radius(c.mass) - 0.2;
  for (const axis of ['x', 'y', 'z'] as const)
    if (
      Math.abs(c.position[axis]) >= edge &&
      Math.sign(direction[axis]) === Math.sign(c.position[axis])
    )
      direction[axis] = 0;
  if (Math.hypot(direction.x, direction.y, direction.z) < 0.001)
    direction = subtract(point(w, 2), c.position);
  return unit(direction);
}
// Rebuild once each tick: food is static between consumption/refills.
export class FoodIndex {
  buckets = new Map<string, Food[]>();
  size = 8;
  key(x: number, y: number, z: number) {
    return x + ',' + y + ',' + z;
  }
  constructor(food: Food[]) {
    for (const f of food) {
      const k = this.key(
        Math.floor(f.position.x / this.size),
        Math.floor(f.position.y / this.size),
        Math.floor(f.position.z / this.size),
      );
      const bucket = this.buckets.get(k);
      if (bucket) bucket.push(f);
      else this.buckets.set(k, [f]);
    }
  }
  query(p: Vec3, r: number) {
    const out: Food[] = [];
    for (let x = Math.floor((p.x - r) / this.size); x <= Math.floor((p.x + r) / this.size); x++)
      for (let y = Math.floor((p.y - r) / this.size); y <= Math.floor((p.y + r) / this.size); y++)
        for (let z = Math.floor((p.z - r) / this.size); z <= Math.floor((p.z + r) / this.size); z++)
          out.push(...(this.buckets.get(this.key(x, y, z)) ?? []));
    return out;
  }
}
export function step(w: World, commands: Record<string, Vec3> = {}) {
  w.events = [];
  if (w.phase !== 'playing') return;
  w.tick++;
  for (const a of w.actors)
    if (a.kind === 'bot' && !a.cellId && a.respawnAt !== null && a.respawnAt <= w.tick) spawn(w, a);
  for (const c of w.cells) {
    const a = w.actors.find((a) => a.id === c.actorId)!;
    if (a.kind === 'bot' && (w.tick % 6 === 0 || !w.botDirections[a.id]))
      w.botDirections[a.id] = botDirection(w, c);
    const dir = normalize(a.kind === 'bot' ? w.botDirections[a.id] : (commands[a.id] ?? zero()));
    const v = speed(c.mass, w.config) * DT;
    c.position = {
      x: c.position.x + dir.x * v,
      y: c.position.y + dir.y * v,
      z: c.position.z + dir.z * v,
    };
    clampCell(c, w.config);
    a.stats.aliveTicks++;
  }
  const copy = w.cells.map((c) => ({ ...c, position: { ...c.position } }));
  const predators = [...copy].sort((a, b) => b.mass - a.mass || a.id.localeCompare(b.id));
  const dead = new Set<string>(),
    gain = new Map<string, number>();
  for (const a of predators) {
    if (dead.has(a.id)) continue;
    for (const b of [...copy].sort((x, y) => x.id.localeCompare(y.id))) {
      if (dead.has(a.id) || dead.has(b.id) || !canEat(a, b, w.tick)) continue;
      dead.add(b.id);
      gain.set(a.id, (gain.get(a.id) ?? 0) + b.mass);
      const winner = w.actors.find((x) => x.id === a.actorId)!,
        loser = w.actors.find((x) => x.id === b.actorId)!;
      winner.stats.cellsEaten++;
      loser.stats.lastMass = b.mass;
      loser.stats.deaths++;
      loser.cellId = null;
      loser.respawnAt = w.tick + 180;
      emit(w, 'consume', winner.id, b.id);
      emit(w, 'death', loser.id, a.id);
    }
  }
  const eaten = new Set<string>();
  const index = new FoodIndex(w.food);
  for (const c of predators) {
    if (dead.has(c.id)) continue;
    for (const f of index.query(c.position, radius(c.mass))) {
      if (eaten.has(f.id) || distance(c.position, f.position) > radius(c.mass)) continue;
      eaten.add(f.id);
      gain.set(c.id, (gain.get(c.id) ?? 0) + 1);
      w.actors.find((a) => a.id === c.actorId)!.stats.foodEaten++;
    }
  }
  w.cells = w.cells.filter((c) => !dead.has(c.id));
  w.food = w.food.filter((f) => !eaten.has(f.id));
  for (const c of w.cells) {
    c.mass = Math.min(w.config.maxMass, c.mass + (gain.get(c.id) ?? 0));
    clampCell(c, w.config);
    const a = w.actors.find((a) => a.id === c.actorId)!;
    a.stats.lastMass = c.mass;
    a.stats.peakMass = Math.max(a.stats.peakMass, c.mass);
  }
  if (w.tick % 60 === 0) replenish(w, 20);
  if (!w.online && !getCell(w, w.humanId)) {
    w.phase = 'result';
    w.reason = 'death';
  } else if (w.tick >= w.config.durationTicks) {
    w.phase = 'result';
    w.reason = 'time';
  }
  if (w.phase === 'result') emit(w, 'end', w.humanId ?? '');
}
export function snapshot(w: World, includeFood = true): Snapshot {
  return {
    tick: w.tick,
    config: { ...w.config },
    phase: w.phase,
    reason: w.reason,
    humanId: w.humanId,
    cells: w.cells.map((c) => ({ ...c, position: { ...c.position } })),
    food: includeFood ? w.food.map((f) => ({ ...f, position: { ...f.position } })) : [],
    actors: w.actors.map((a) => ({ ...a, stats: { ...a.stats } })),
  };
}

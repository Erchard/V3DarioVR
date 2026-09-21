import { describe, it, expect } from 'vitest';
import {
  createWorld,
  step,
  addActor,
  getCell,
  spawn,
  snapshot,
  canEat,
  radius,
  speed,
  distance,
  normalize,
  zero,
  FoodIndex,
  botDirection,
  place,
  validateConfig,
  DEFAULT,
} from '../packages/core';
function fixture() {
  const w = createWorld(42, { bots: 0, foodTarget: 0, protectionTicks: 0 });
  const a = getCell(w, w.humanId)!;
  a.position = zero();
  return { w, a };
}
describe('3D rules', () => {
  it('T-001 reproducible seed and inputs', () => {
    const a = createWorld(42, { foodTarget: 100, bots: 3 }),
      b = createWorld(42, { foodTarget: 100, bots: 3 });
    for (let i = 0; i < 1200; i++) {
      const d = { x: Math.sin(i), y: 0.2, z: 0.3 };
      step(a, { [a.humanId!]: d });
      step(b, { [b.humanId!]: d });
    }
    expect(a).toEqual(b);
  });
  it('T-003 diagonal does not accelerate', () => {
    const { w, a } = fixture();
    for (let i = 0; i < 60; i++) step(w, { [w.humanId!]: { x: 1, y: 1, z: 1 } });
    expect(distance(a.position, zero())).toBeCloseTo(5, 8);
    expect(a.position.y).toBeGreaterThan(0);
  });
  it('T-004 volume and speed', () => {
    expect(radius(20)).toBe(1);
    expect(radius(160)).toBe(2);
    expect(radius(2000)).toBeCloseTo(Math.cbrt(100));
    expect(speed(2000)).toBeLessThan(speed(20));
  });
  for (const axis of ['x', 'y', 'z'] as const)
    for (const sign of [-1, 1])
      it('T-005 boundary ' + axis + sign, () => {
        const { w, a } = fixture();
        a.position[axis] = 39;
        const u = zero();
        u[axis] = sign;
        a.position[axis] = 39 * sign;
        step(w, { [w.humanId!]: u });
        expect(a.position[axis]).toBe(39 * sign);
      });
  it('T-006 mass threshold inclusive', () => {
    const { w, a } = fixture();
    const b = getCell(w, addActor(w, 'other').id)!;
    b.position = zero();
    a.mass = 23;
    expect(canEat(a, b, 1)).toBe(true);
    a.mass = 22.999;
    expect(canEat(a, b, 1)).toBe(false);
  });
  it('T-007 geometry threshold inclusive', () => {
    const { w, a } = fixture();
    a.mass = 160;
    const b = getCell(w, addActor(w, 'other').id)!;
    b.position = { x: 1.5, y: 0, z: 0 };
    expect(canEat(a, b, 1)).toBe(true);
    b.position.x += 0.00001;
    expect(canEat(a, b, 1)).toBe(false);
  });
  it('T-008 food once with priority', () => {
    const { w, a } = fixture();
    const actor = addActor(w, 'other');
    const b = getCell(w, actor.id)!;
    b.position = zero();
    w.food = [{ id: 'food', position: zero(), color: 0 }];
    step(w);
    expect(a.mass).toBe(21);
    expect(b.mass).toBe(20);
    expect(w.food).toHaveLength(0);
  });
  it('T-009 dead predator cannot eat, stable priority', () => {
    const { w, a } = fixture();
    a.mass = 160;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.mass = 80;
    b.position = zero();
    const c = getCell(w, addActor(w, 'c').id)!;
    c.position = zero();
    step(w);
    expect(w.cells).toHaveLength(1);
    expect(a.mass).toBe(260);
    expect(w.actors[1].stats.cellsEaten).toBe(0);
  });
  it('T-010 growth applied next tick', () => {
    const { w, a } = fixture();
    a.mass = 22;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.position = zero();
    w.food = [{ id: 'f', position: zero(), color: 0 }];
    step(w);
    expect(w.cells).toHaveLength(2);
    expect(a.mass).toBe(23);
    step(w);
    expect(w.cells).toHaveLength(1);
  });
  it('T-011 cap and clamp after growth', () => {
    const { w, a } = fixture();
    a.mass = 1999;
    a.position.x = 35.36;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.position = { ...a.position };
    step(w);
    expect(a.mass).toBe(2000);
    expect(a.position.x).toBeLessThanOrEqual(40 - radius(2000));
  });
  it('T-012 protection expires exactly', () => {
    const { w, a } = fixture();
    a.mass = 160;
    a.protectedUntil = 2;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.position = zero();
    step(w);
    expect(w.cells).toHaveLength(2);
    step(w);
    expect(w.cells).toHaveLength(1);
  });
  it('T-013 crowded spawn bounded', () => {
    const w = createWorld(42, { halfSize: 5, maxMass: 1000, bots: 20, foodTarget: 0 });
    expect(w.cells).toHaveLength(21);
    for (const c of w.cells) expect(Math.abs(c.position.x)).toBeLessThanOrEqual(4);
  });
  it('T-014 flee before forage', () => {
    const { w, a } = fixture();
    a.mass = 160;
    a.position = { x: 5, y: 0, z: 0 };
    const b = getCell(w, addActor(w, 'bot', 'bot').id)!;
    b.position = zero();
    w.food = [{ id: 'f', position: { x: 2, y: 0, z: 0 }, color: 0 }];
    expect(botDirection(w, b).x).toBeLessThan(0);
  });
  it('T-014 no omniscience', () => {
    const { w, a } = fixture();
    const b = getCell(w, addActor(w, 'b', 'bot').id)!;
    b.position = { x: 30, y: 0, z: 0 };
    w.wander[b.actorId] = { target: { x: 30, y: 5, z: 0 }, until: 100 };
    a.mass = 2000;
    a.position = zero();
    expect(botDirection(w, b).y).toBe(1);
  });
  it('T-015 wall movement finite', () => {
    const { w, a } = fixture();
    a.position = { x: 39, y: 39, z: 39 };
    for (let i = 0; i < 10; i++) {
      const u = botDirection(w, a);
      expect(Object.values(u).every(Number.isFinite)).toBe(true);
    }
  });
  it('T-017 death wins over timer', () => {
    const { w } = fixture();
    w.tick = w.config.durationTicks - 1;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.mass = 160;
    b.position = zero();
    step(w);
    expect(w.reason).toBe('death');
    expect(w.events.filter((e) => e.type === 'end')).toHaveLength(1);
    step(w);
    expect(w.tick).toBe(18000);
  });
  it('T-017 timer result', () => {
    const { w } = fixture();
    w.tick = 17999;
    step(w);
    expect(w.phase).toBe('result');
    expect(w.reason).toBe('time');
  });
  it('T-018 snapshots isolated', () => {
    const { w, a } = fixture();
    const s = snapshot(w);
    s.cells[0].position.y = 90;
    s.actors[0].stats.peakMass = 900;
    expect(a.position.y).toBe(0);
    expect(w.actors[0].stats.peakMass).toBe(20);
  });
  it('T-019 invalid configuration and direction', () => {
    expect(() => validateConfig({ ...DEFAULT, speed: NaN })).toThrow();
    expect(() => createWorld(1, { minSpeed: 10 })).toThrow();
    expect(() => normalize({ x: Infinity, y: 0, z: 0 })).toThrow('Direction must be finite');
  });
  it('T-020 spatial food query equals brute force', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld(seed, { foodTarget: 100, bots: 0 });
      const index = new FoodIndex(w.food);
      for (const r of [1, 2, 4.65]) {
        const p = getCell(w, w.humanId)!.position;
        const found = index
          .query(p, r)
          .filter((f) => distance(f.position, p) <= r)
          .map((f) => f.id)
          .sort();
        expect(found).toEqual(
          w.food
            .filter((f) => distance(f.position, p) <= r)
            .map((f) => f.id)
            .sort(),
        );
      }
    }
  });
  it('T-021 vertical separation counts', () => {
    const { w, a } = fixture();
    a.mass = 160;
    const b = getCell(w, addActor(w, 'b').id)!;
    b.position = { x: 0, y: 5, z: 0 };
    step(w);
    expect(w.cells).toHaveLength(2);
    b.position.y = 1;
    step(w);
    expect(w.cells).toHaveLength(1);
  });
  it('T-022 refill bounded', () => {
    const w = createWorld(42, { bots: 0, foodTarget: 35 });
    w.food = [];
    for (let i = 0; i < 60; i++) step(w);
    expect(w.food).toHaveLength(20);
    for (let i = 0; i < 60; i++) step(w);
    expect(w.food).toHaveLength(35);
  });
  it('T-023 bot respawn boundary and fresh entity', () => {
    const { w, a } = fixture();
    a.mass = 160;
    const actor = addActor(w, 'bot', 'bot'),
      b = getCell(w, actor.id)!;
    b.position = zero();
    step(w);
    const died = w.tick;
    expect(actor.cellId).toBeNull();
    a.position = { x: 35, y: 35, z: 35 };
    for (let i = 0; i < 179; i++) step(w);
    expect(actor.cellId).toBeNull();
    step(w);
    expect(w.tick).toBe(died + 180);
    expect(actor.cellId).not.toBe(b.id);
    expect(getCell(w, actor.id)?.mass).toBe(20);
  });
  it('actor ranking and death rank', () => {
    const { w, a } = fixture();
    const other = addActor(w, 'b');
    const b = getCell(w, other.id)!;
    b.mass = 160;
    expect(place(w, w.humanId!)).toBe(2);
    w.cells = w.cells.filter((c) => c !== a);
    expect(place(w, w.humanId!, true)).toBe(2);
  });
  it('spawn idempotent', () => {
    const { w } = fixture();
    spawn(w, w.actors[0]);
    expect(w.cells).toHaveLength(1);
  });
  it('invariants under seeded play', () => {
    let checkedTicks = 0;
    for (let seed = 0; seed < 12; seed++) {
      const w = createWorld(seed, { bots: 3, foodTarget: 100 }, true);
      for (let tick = 0; tick < 1000; tick++) {
        step(w);
        const ids = new Set([...w.cells, ...w.food].map((entity) => entity.id));
        if (ids.size !== w.cells.length + w.food.length)
          throw Error('Duplicate entity: seed ' + seed + ', tick ' + tick);
        for (const cell of w.cells) {
          const finite = Object.values(cell.position).every(Number.isFinite);
          const inside = Object.values(cell.position).every(
            (value) => Math.abs(value) <= 40 - radius(cell.mass) + 1e-8,
          );
          if (!(cell.mass > 0 && cell.mass <= 2000 && finite && inside))
            throw Error('Broken invariant: seed ' + seed + ', tick ' + tick + ', cell ' + cell.id);
        }
        checkedTicks++;
      }
    }
    expect(checkedTicks).toBe(12000);
  });
});
it('finite extreme vectors normalize without overflow', () => {
  const d = normalize({ x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE });
  expect(distance(d, zero())).toBeCloseTo(1);
  expect(d.x).toBeGreaterThan(0);
});
it('configuration cannot omit required numeric fields', () => {
  const incomplete = { ...DEFAULT };
  delete (incomplete as { minSpeed?: number }).minSpeed;
  expect(() => validateConfig(incomplete)).toThrow();
});

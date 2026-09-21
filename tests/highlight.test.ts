import { expect, it } from 'vitest';
import { canEat, radius, type Cell } from '../packages/core';
import { cellHighlight, HIGHLIGHT_DISTANCE } from '../apps/client/highlight';

const cell = (id: string, mass: number, x = 0, protectedUntil = 0): Cell => ({
  id,
  actorId: id,
  mass,
  position: { x, y: 0, z: 0 },
  protectedUntil,
});

it('identifies prey before contact, while consumption still requires overlap', () => {
  const a = cell('a', 30),
    b = cell('b', 20, 8);
  expect(cellHighlight(a, b, 0)).toEqual({ kind: 'prey', intensity: 1 });
  expect(canEat(a, b, 0)).toBe(false);
  expect(cellHighlight(b, a, 0)).toEqual({ kind: 'danger', intensity: 1 });
});
it('uses the exact mass threshold and leaves evenly matched cells neutral', () => {
  const b = cell('b', 20);
  expect(cellHighlight(cell('a', 1.15 * 20), b, 0).kind).toBe('prey');
  expect(cellHighlight(cell('a', 1.15 * 20 - 0.001), b, 0).intensity).toBe(0);
});
it('respects protection of either participant, including its expiry tick', () => {
  const a = cell('a', 40, 0, 180),
    b = cell('b', 20);
  expect(cellHighlight(a, b, 179).intensity).toBe(0);
  expect(cellHighlight(b, a, 179).intensity).toBe(0);
  expect(cellHighlight(a, b, 180).kind).toBe('prey');
});
it('fades by the distance between surfaces and vanishes outside the radius', () => {
  const a = cell('a', 40),
    b = cell('b', 20);
  const radii = radius(a.mass) + radius(b.mass);
  b.position.x = radii + 14;
  expect(cellHighlight(a, b, 0).intensity).toBeCloseTo(0.5);
  b.position.x = radii + HIGHLIGHT_DISTANCE;
  expect(cellHighlight(a, b, 0).intensity).toBeCloseTo(0);
  b.position.x += 1;
  expect(cellHighlight(a, b, 0).intensity).toBe(0);
});
it('has no relationship glow for self or absent player', () => {
  const a = cell('a', 40);
  expect(cellHighlight(a, a, 0).intensity).toBe(0);
  expect(cellHighlight(undefined, a, 0).intensity).toBe(0);
});

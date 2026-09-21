import { it, expect } from 'vitest';
import { desktopDirection, xrDirection, deadZone, snapTurn } from '../apps/client/control-math';
import { distance, zero } from '../packages/core';
it('desktop forward follows pitch in 3D', () =>
  expect(desktopDirection(0, Math.PI / 4, 1, 0, 0)).toEqual({
    x: 0,
    y: Math.sin(Math.PI / 4),
    z: -Math.cos(Math.PI / 4),
  }));
it('diagonal desktop movement normalized', () =>
  expect(distance(desktopDirection(0.4, 0.5, 1, 1, 1), zero())).toBeCloseTo(1));
it('XR and desktop share equivalent forward command', () =>
  expect(xrDirection({ x: 0, y: 0, z: -1 }, 0, -1, 0, 0, 1).direction).toEqual(
    desktopDirection(0, 0, 1, 0, 0),
  ));
it('XR diagonal and vertical movement cannot accelerate', () =>
  expect(
    distance(xrDirection({ x: 0, y: 0, z: -1 }, 1, -1, -1, 0, 1).direction, zero()),
  ).toBeCloseTo(1));
it('XR controller vertical aim remains finite', () =>
  expect(
    Object.values(xrDirection({ x: 0, y: 1, z: 0 }, 1, -1, 0, 0.2, 1).direction).every(
      Number.isFinite,
    ),
  ).toBe(true));
it('comfort only reduces the command', () =>
  expect(
    distance(xrDirection({ x: 0, y: 0, z: -1 }, 0, -1, 0, 0, 0.6).direction, zero()),
  ).toBeCloseTo(0.6));
it('dead zone removes drift', () => {
  expect(deadZone(0.14)).toBe(0);
  expect(deadZone(1)).toBe(1);
  expect(deadZone(-1)).toBe(-1);
});
it('snap requires stick release before next turn', () => {
  const first = snapTurn(1, true);
  expect(first.angle).toBeCloseTo(-Math.PI / 6);
  expect(snapTurn(1, first.armed).angle).toBe(0);
  expect(snapTurn(0, false).armed).toBe(true);
});

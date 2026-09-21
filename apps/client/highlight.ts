import { canPreyOn, distance, radius, type Cell } from '../../packages/core';

export const HIGHLIGHT_DISTANCE = 18;
const FULL_DISTANCE = 10;
export function cellHighlight(own: Cell | undefined, other: Cell, tick: number) {
  const none = { kind: 'none' as const, intensity: 0 };
  if (!own) return none;
  const kind = canPreyOn(own, other, tick)
    ? 'prey'
    : canPreyOn(other, own, tick)
      ? 'danger'
      : 'none';
  if (kind === 'none') return none;
  const gap = Math.max(
    0,
    distance(own.position, other.position) - radius(own.mass) - radius(other.mass),
  );
  const t = Math.max(
    0,
    Math.min(1, (HIGHLIGHT_DISTANCE - gap) / (HIGHLIGHT_DISTANCE - FULL_DISTANCE)),
  );
  return { kind, intensity: t * t * (3 - 2 * t) };
}

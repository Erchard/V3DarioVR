import { normalize, type Vec3 } from '../../packages/core';
export const deadZone = (n: number, zone = 0.15) =>
  Math.abs(n) <= zone ? 0 : (Math.sign(n) * (Math.min(1, Math.abs(n)) - zone)) / (1 - zone);
export function desktopDirection(
  yaw: number,
  pitch: number,
  forward: number,
  sideways: number,
  up: number,
): Vec3 {
  return normalize({
    x: -Math.sin(yaw) * Math.cos(pitch) * forward + Math.cos(yaw) * sideways,
    y: Math.sin(pitch) * forward + up,
    z: -Math.cos(yaw) * Math.cos(pitch) * forward - Math.sin(yaw) * sideways,
  });
}
export function xrDirection(
  forward: Vec3,
  leftX: number,
  leftY: number,
  rightY: number,
  lastYaw: number,
  comfort: number,
): { direction: Vec3; yaw: number } {
  const yaw =
    Math.hypot(forward.x, forward.z) > 0.01 ? Math.atan2(-forward.x, -forward.z) : lastYaw;
  const x = deadZone(leftX),
    y = deadZone(leftY),
    u = normalize({
      x: -y * forward.x + x * Math.cos(yaw),
      y: -y * forward.y - deadZone(rightY),
      z: -y * forward.z - x * Math.sin(yaw),
    });
  const cap = Math.max(0.3, Math.min(1, comfort));
  return { direction: { x: u.x * cap, y: u.y * cap, z: u.z * cap }, yaw };
}
export function snapTurn(axis: number, armed: boolean) {
  if (Math.abs(axis) < 0.3) return { armed: true, angle: 0 };
  if (armed && Math.abs(axis) > 0.7)
    return { armed: false, angle: (-Math.sign(axis) * Math.PI) / 6 };
  return { armed, angle: 0 };
}

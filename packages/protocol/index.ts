import { validateConfig } from '../core';
import type { Vec3, Snapshot } from '../core';
export const PROTOCOL = 1;
export type ClientMessage =
  | {
      type: 'hello';
      protocolVersion: 1;
      buildId: string;
      rulesVersion: number;
      platform: 'desktop' | 'vr';
    }
  | { type: 'createRoom'; protocolVersion: 1; requestId: string; displayName: string }
  | {
      type: 'joinRoom';
      protocolVersion: 1;
      requestId: string;
      displayName: string;
      roomCode: string;
    }
  | { type: 'ready'; protocolVersion: 1; requestId: string; ready: boolean }
  | { type: 'input'; protocolVersion: 1; seq: number; direction: Vec3 }
  | { type: 'respawn' | 'leave'; protocolVersion: 1; requestId: string }
  | { type: 'resume'; protocolVersion: 1; requestId: string; resumeToken: string }
  | { type: 'ping'; protocolVersion: 1; nonce: number };
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'result';
export type Roster = { id: string; name: string; ready: boolean; connected: boolean }[];
export type ServerMessage =
  | {
      type: 'welcome';
      protocolVersion: 1;
      playerId: string;
      roomCode: string;
      resumeToken: string;
      rulesVersion: number;
    }
  | {
      type: 'snapshot';
      protocolVersion: 1;
      state: Snapshot;
      phase: RoomPhase;
      countdown: number;
      roster: Roster;
      lastProcessedSeq: number;
      foodMode: 'replace' | 'patch';
      removedFood: string[];
    }
  | { type: 'error'; protocolVersion: 1; code: string; message: string; requestId?: string }
  | { type: 'ack'; protocolVersion: 1; requestId: string; status: string }
  | { type: 'pong'; protocolVersion: 1; nonce: number };
export function parseMessage(raw: string): ClientMessage {
  const m: unknown = JSON.parse(raw);
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw Error('INVALID_MESSAGE');
  const p = m as Record<string, unknown>;
  if (p.protocolVersion !== 1) throw Error('VERSION_MISMATCH');
  const fields: Record<string, string[]> = {
    hello: ['buildId', 'rulesVersion', 'platform'],
    createRoom: ['requestId', 'displayName'],
    joinRoom: ['requestId', 'displayName', 'roomCode'],
    ready: ['requestId', 'ready'],
    input: ['seq', 'direction'],
    respawn: ['requestId'],
    resume: ['requestId', 'resumeToken'],
    leave: ['requestId'],
    ping: ['nonce'],
  };
  if (typeof p.type !== 'string' || !Object.hasOwn(fields, p.type)) throw Error('INVALID_MESSAGE');
  const allowed = ['type', 'protocolVersion', ...fields[p.type]];
  if (Object.keys(p).some((k) => !allowed.includes(k)) || allowed.some((k) => !(k in p)))
    throw Error('INVALID_MESSAGE');
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if ('requestId' in p && !str(p.requestId, 64)) throw Error('INVALID_MESSAGE');
  if (
    'displayName' in p &&
    (!str(p.displayName, 80) || [...(p.displayName as string).trim()].length > 20)
  )
    throw Error('INVALID_MESSAGE');
  if ('roomCode' in p && (typeof p.roomCode !== 'string' || !/^[A-Z2-9]{8}$/.test(p.roomCode)))
    throw Error('ROOM_NOT_FOUND');
  if (
    p.type === 'hello' &&
    (!str(p.buildId, 64) || p.rulesVersion !== 1 || !['desktop', 'vr'].includes(String(p.platform)))
  )
    throw Error('VERSION_MISMATCH');
  if (p.type === 'ready' && typeof p.ready !== 'boolean') throw Error('INVALID_MESSAGE');
  if (
    p.type === 'resume' &&
    (!str(p.resumeToken, 128) || !/^[a-f0-9]{48}$/.test(String(p.resumeToken)))
  )
    throw Error('RECONNECT_EXPIRED');
  if (p.type === 'ping' && (typeof p.nonce !== 'number' || !Number.isFinite(p.nonce)))
    throw Error('INVALID_MESSAGE');
  if (p.type === 'input') {
    if (!Number.isInteger(p.seq) || Number(p.seq) < 0 || Number(p.seq) > 2147483647)
      throw Error('INVALID_MESSAGE');
    const v = p.direction as Record<string, unknown>;
    if (
      !v ||
      typeof v !== 'object' ||
      Object.keys(v).sort().join(',') !== 'x,y,z' ||
      ![v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      throw Error('INVALID_MESSAGE');
  }
  return p as ClientMessage;
}
export const cleanName = (s: string) =>
  [...s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, 20).join('') || 'Мандрівник';

/** Validate the rendering boundary; invalid server data is fatal, never silently repaired. */
export function parseServerMessage(raw: string): ServerMessage {
  if (raw.length > 262144) throw Error('Server message too large');
  const message = JSON.parse(raw) as ServerMessage;
  if (!message || message.protocolVersion !== 1) throw Error('Server protocol mismatch');
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
  if (message.type === 'welcome') {
    if (
      !text(message.playerId) ||
      !text(message.roomCode) ||
      !text(message.resumeToken) ||
      message.rulesVersion !== 1
    )
      throw Error('Invalid welcome');
  } else if (message.type === 'snapshot') {
    const state = message.state;
    if (
      !state ||
      !finite(state.tick) ||
      !state.config ||
      !finite(state.config.halfSize) ||
      !finite(state.config.durationTicks) ||
      !finite(state.config.speed) ||
      !['playing', 'result'].includes(state.phase) ||
      !['lobby', 'countdown', 'playing', 'result'].includes(message.phase) ||
      !['replace', 'patch'].includes(message.foodMode) ||
      !Array.isArray(message.removedFood) ||
      !message.removedFood.every(text) ||
      !Array.isArray(message.roster) ||
      !message.roster.every(
        (p) =>
          text(p.id) &&
          text(p.name) &&
          typeof p.ready === 'boolean' &&
          typeof p.connected === 'boolean',
      ) ||
      !finite(message.countdown) ||
      !Number.isInteger(message.lastProcessedSeq) ||
      !Array.isArray(state.actors) ||
      !Array.isArray(state.cells) ||
      !Array.isArray(state.food)
    )
      throw Error('Invalid snapshot');
    validateConfig(state.config);
    const position = (p: Vec3) => p && [p.x, p.y, p.z].every(finite);
    if (
      state.cells.some(
        (c) =>
          !text(c.id) ||
          !text(c.actorId) ||
          !position(c.position) ||
          !finite(c.mass) ||
          c.mass <= 0 ||
          !finite(c.protectedUntil),
      ) ||
      state.food.some((f) => !text(f.id) || !position(f.position) || !Number.isInteger(f.color)) ||
      state.actors.some(
        (a) =>
          !text(a.id) ||
          !text(a.name) ||
          !finite(a.color) ||
          !a.stats ||
          !Object.values(a.stats).every(finite),
      ) ||
      state.cells.some((c) => !state.actors.some((a) => a.id === c.actorId))
    )
      throw Error('Invalid entity state');
  } else if (message.type === 'error') {
    if (!text(message.code) || !text(message.message)) throw Error('Invalid error response');
  } else if (message.type === 'ack') {
    if (!text(message.requestId) || !text(message.status)) throw Error('Invalid acknowledgement');
  } else if (message.type === 'pong') {
    if (!finite(message.nonce)) throw Error('Invalid pong');
  } else throw Error('Unknown server message');
  return message;
}

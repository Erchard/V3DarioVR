import { describe, it, expect } from 'vitest';
import { parseMessage, parseServerMessage, cleanName } from '../packages/protocol';
const message = (extra: Record<string, unknown>) =>
  JSON.stringify({ protocolVersion: 1, ...extra });
describe('protocol boundary', () => {
  it('valid movement', () =>
    expect(
      parseMessage(message({ type: 'input', seq: 1, direction: { x: 0, y: 1, z: 0 } })).type,
    ).toBe('input'));
  it.each([{ mass: 100 }, { position: { x: 0, y: 0, z: 0 } }, { dt: 10 }])(
    'reject authoritative field %j',
    (field) =>
      expect(() =>
        parseMessage(message({ type: 'input', seq: 1, direction: { x: 0, y: 0, z: 0 }, ...field })),
      ).toThrow(),
  );
  it.each([NaN, Infinity, -1, 1.5])('reject invalid sequence %s', (seq) =>
    expect(() =>
      parseMessage(message({ type: 'input', seq, direction: { x: 0, y: 0, z: 0 } })),
    ).toThrow(),
  );
  it('reject null, arrays and missing components', () => {
    for (const raw of ['null', '[]', '{}', message({ type: 'input', seq: 1, direction: { x: 0 } })])
      expect(() => parseMessage(raw)).toThrow();
  });
  it('reject protocol mismatch', () =>
    expect(() => parseMessage('{"protocolVersion":2,"type":"ping","nonce":0}')).toThrow(
      'VERSION_MISMATCH',
    ));
  it('clean names as plain text, strip controls', () => expect(cleanName('  A\nB  ')).toBe('AB'));
  it('Unicode length bounded', () => expect([...cleanName('😀'.repeat(30))]).toHaveLength(20));
});

it('prototype names are not protocol operations', () => {
  expect(() => parseMessage('{"protocolVersion":1,"type":"__proto__"}')).toThrow('INVALID_MESSAGE');
});
it('invalid server snapshots fail explicitly', () => {
  expect(() => parseServerMessage('{"protocolVersion":1,"type":"snapshot","state":null}')).toThrow(
    'Invalid snapshot',
  );
});
it('unknown server messages are rejected', () => {
  expect(() => parseServerMessage('{"protocolVersion":1,"type":"unexpected"}')).toThrow(
    'Unknown server message',
  );
});

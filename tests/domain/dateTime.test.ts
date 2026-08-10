import { describe, expect, it } from 'vitest';

import { compareIsoInstants } from '../../src/domain/dateTime.js';

describe('compareIsoInstants', () => {
  it.each([
    ['2026-08-04T17:00:00-05:00', '2026-08-04T17:00:00-05:00'],
    ['2026-08-04T17:00:00-05:00', '2026-08-04T22:00:00Z'],
    ['2026-08-04T22:00:00Z', '2026-08-04T22:00:00+00:00'],
    ['2026-08-04T22:00:00.000Z', '2026-08-04T22:00:00Z'],
  ])('treats %s and %s as the same instant', (left, right) => {
    expect(compareIsoInstants(left, right)).toEqual({ valid: true, order: 0 });
  });

  it('distinguishes times on the same calendar day and orders instants', () => {
    expect(compareIsoInstants('2026-08-04T09:00:00Z', '2026-08-04T17:00:00Z')).toEqual({ valid: true, order: -1 });
    expect(compareIsoInstants('2026-08-04T18:00:00Z', '2026-08-04T17:00:00Z')).toEqual({ valid: true, order: 1 });
  });

  it.each([
    ['invalid', '2026-08-04T17:00:00Z'],
    ['08/04/2026 17:00', '2026-08-04T17:00:00Z'],
    ['2026-08-04T17:00:00Z', 'invalid'],
    [null, '2026-08-04T17:00:00Z'],
  ])('fails closed for malformed values', (left, right) => {
    expect(compareIsoInstants(left, right)).toEqual({ valid: false });
  });

  it('is deterministic and does not mutate inputs', () => {
    const left = Object.freeze({ value: '2026-08-04T17:00:00-05:00' });
    const right = Object.freeze({ value: '2026-08-04T22:00:00Z' });
    expect(compareIsoInstants(left.value, right.value)).toEqual(compareIsoInstants(left.value, right.value));
    expect(left.value).toBe('2026-08-04T17:00:00-05:00');
    expect(right.value).toBe('2026-08-04T22:00:00Z');
  });
});

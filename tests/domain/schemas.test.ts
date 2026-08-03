import { describe, expect, it } from 'vitest';

import { case001Fixture } from '../../src/domain/case-001.fixture.js';
import { exceptionCaseSchema } from '../../src/domain/schemas.js';

const copyFixture = (): unknown => structuredClone(case001Fixture);

describe('exceptionCaseSchema', () => {
  it('accepts CASE-001', () => {
    expect(exceptionCaseSchema.parse(case001Fixture)).toEqual(case001Fixture);
  });

  it.each([
    ['role', (value: any) => (value.parties[0].role = 'observer')],
    ['status', (value: any) => (value.status = 'pending')],
    ['negative quantity', (value: any) => (value.items[0].requestedQuantity = -1)],
    ['decimal quantity', (value: any) => (value.items[0].availableQuantity = 1.5)],
    ['negative cost', (value: any) => (value.items[0].unitCost = -0.01)],
    ['empty case identifier', (value: any) => (value.id = '   ')],
    ['empty party identifier', (value: any) => (value.parties[0].id = '')],
    ['empty item identifier', (value: any) => (value.items[0].id = '')],
    ['invalid created date', (value: any) => (value.createdAt = 'not-a-date')],
    ['invalid required date', (value: any) => (value.requiredBy = '2026-02-30')],
    ['additional case field', (value: any) => (value.unexpected = true)],
    ['additional nested field', (value: any) => (value.items[0].unexpected = true)],
  ])('rejects an invalid %s', (_label, mutate) => {
    const candidate = copyFixture();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });
});


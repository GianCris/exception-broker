import { describe, expect, it } from 'vitest';

import { case001Fixture } from '../../src/domain/case-001.fixture.js';
import {
  exceptionCaseSchema,
  planSchema,
} from '../../src/domain/schemas.js';

type MutableRecord = Record<string, any>;

const fixtureCopy = (): MutableRecord => structuredClone(case001Fixture);

describe('official CASE-001 domain schemas', () => {
  it('accepts the official CASE-001 fixture', () => {
    expect(exceptionCaseSchema.parse(case001Fixture)).toEqual(case001Fixture);
  });

  it('contains exactly three actors with unique official roles', () => {
    expect(case001Fixture.actors).toHaveLength(3);
    expect(new Set(case001Fixture.actors.map(({ role }) => role))).toEqual(
      new Set(['supplier', 'production', 'client']),
    );
  });

  it('rejects an invalid actor role', () => {
    const candidate = fixtureCopy();
    candidate.actors[0].role = 'carrier';

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects an invalid case status', () => {
    const candidate = fixtureCopy();
    candidate.status = 'OPEN';

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects an invalid plan status', () => {
    expect(
      planSchema.safeParse({
        id: 'PLAN-001',
        caseId: 'CASE-001',
        status: 'GENERATED',
        version: 1,
        quantity: 400,
        deliveryDate: case001Fixture.deliveryDate,
        additionalCost: 0,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['negative case quantity', (value: MutableRecord) => (value.quantity = -1)],
    ['decimal case quantity', (value: MutableRecord) => (value.quantity = 1.5)],
    [
      'negative constraint quantity',
      (value: MutableRecord) => (value.actors[0].constraints[0].quantity = -1),
    ],
    [
      'decimal authorization quantity',
      (value: MutableRecord) => (value.actors[2].authorization.quantity = 50.5),
    ],
  ])('rejects %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['case cost', (value: MutableRecord) => (value.additionalCost = -1)],
    [
      'constraint cost',
      (value: MutableRecord) =>
        (value.actors[0].constraints[0].additionalCost = -1),
    ],
    [
      'authorization cost',
      (value: MutableRecord) =>
        (value.actors[1].authorization.additionalCost = -1),
    ],
  ])('rejects a negative %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['case ID', (value: MutableRecord) => (value.id = '  ')],
    ['actor ID', (value: MutableRecord) => (value.actors[0].id = '')],
  ])('rejects an empty %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['case date', (value: MutableRecord) => (value.deliveryDate = 'tomorrow')],
    [
      'constraint date',
      (value: MutableRecord) =>
        (value.actors[0].constraints[0].deliveryDate = '2026-02-30'),
    ],
    [
      'authorization date',
      (value: MutableRecord) =>
        (value.actors[0].authorization.deliveryDate = 'invalid'),
    ],
  ])('rejects an invalid %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ['case field', (value: MutableRecord) => (value.currency = 'USD')],
    ['actor field', (value: MutableRecord) => (value.actors[0].company = 'Acme')],
    [
      'constraint field',
      (value: MutableRecord) => (value.actors[0].constraints[0].sku = 'SKU-1'),
    ],
  ])('rejects an unknown %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects fewer or more than three actors', () => {
    const tooFew = fixtureCopy();
    tooFew.actors.pop();
    const tooMany = fixtureCopy();
    tooMany.actors.push(structuredClone(tooMany.actors[0]));

    expect(exceptionCaseSchema.safeParse(tooFew).success).toBe(false);
    expect(exceptionCaseSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects three actors with duplicated roles', () => {
    const candidate = fixtureCopy();
    candidate.actors[2].role = 'supplier';

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });
});

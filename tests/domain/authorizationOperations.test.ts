import { describe, expect, it } from 'vitest';

import {
  applyAuthorizationChanges,
  resolveAuthorizationValue,
  validateAuthorizationChanges,
} from '../../src/domain/authorizationOperations.js';
import { case001Fixture } from '../../src/domain/case-001.fixture.js';

const client = case001Fixture.actors.find(({ role }) => role === 'client');
const supplier = case001Fixture.actors.find(({ role }) => role === 'supplier');
if (client === undefined || supplier === undefined) throw new Error('CASE-001 actors are required');

const substituteChange = (overrides: Record<string, unknown> = {}) => ({
  actorId: client.id,
  field: 'maxSubstituteQuantity',
  expectedCurrentValue: 50,
  newValue: 100,
  reviewedAction: 'APPLY',
  ...overrides,
});

describe('domain authorization operations', () => {
  it.each([
    ['maxAbsorbableAdditionalCost', 0],
    ['maxSubstituteQuantity', 50],
    ['latestAcceptedDeliveryDate', client.authorization.latestAcceptedDeliveryDate],
  ] as const)('resolves recognized field %s explicitly', (field, value) => {
    expect(resolveAuthorizationValue(case001Fixture, client.id, field)).toEqual({
      success: true,
      value,
    });
  });

  it('rejects an unknown field and a missing actor', () => {
    expect(resolveAuthorizationValue(case001Fixture, client.id, 'quantity')).toEqual({
      success: false,
      reason: 'Unknown authorization field',
    });
    expect(resolveAuthorizationValue(case001Fixture, 'missing' as typeof client.id, 'maxSubstituteQuantity'))
      .toEqual({ success: false, reason: 'Authorization actor does not exist' });
  });

  it.each(['APPLY', 'DISCARD'] as const)('validates reviewed action %s', (reviewedAction) => {
    expect(validateAuthorizationChanges(case001Fixture, [substituteChange({ reviewedAction })]))
      .toMatchObject({ success: true });
  });

  it('rejects stale expectedCurrentValue', () => {
    expect(validateAuthorizationChanges(case001Fixture, [
      substituteChange({ expectedCurrentValue: 999 }),
    ])).toMatchObject({
      success: false,
      issues: ['changes.0.expectedCurrentValue: current value changed'],
    });
  });

  it.each([
    ['negative cost', { actorId: supplier.id, field: 'maxAbsorbableAdditionalCost', expectedCurrentValue: 60, newValue: -1, reviewedAction: 'APPLY' }],
    ['decimal quantity', substituteChange({ newValue: 10.5 })],
    ['invalid date', { actorId: client.id, field: 'latestAcceptedDeliveryDate', expectedCurrentValue: client.authorization.latestAcceptedDeliveryDate, newValue: 'Friday', reviewedAction: 'APPLY' }],
    ['unknown field', substituteChange({ field: 'quantity' })],
    ['unknown action', substituteChange({ reviewedAction: 'APPROVED' })],
    ['unknown property', substituteChange({ quantity: 100 })],
  ] as const)('rejects %s according to current authorization rules', (_name, change) => {
    expect(validateAuthorizationChanges(case001Fixture, [change]).success).toBe(false);
  });

  it('applies a validated change immutably', () => {
    const original = structuredClone(case001Fixture);
    const result = applyAuthorizationChanges(case001Fixture, [substituteChange()]);

    expect(result).toMatchObject({
      success: true,
      appliedChanges: [{ field: 'maxSubstituteQuantity', newValue: 100 }],
      discardedChanges: [],
    });
    if (result.success) {
      expect(result.updatedCase.actors.find(({ id }) => id === client.id)?.authorization.maxSubstituteQuantity)
        .toBe(100);
    }
    expect(case001Fixture).toEqual(original);
  });

  it('validates and applies multiple actors and fields atomically', () => {
    const changes = [
      substituteChange(),
      {
        actorId: supplier.id,
        field: 'maxAbsorbableAdditionalCost',
        expectedCurrentValue: 60,
        newValue: 75,
        reviewedAction: 'APPLY',
      },
      {
        actorId: client.id,
        field: 'latestAcceptedDeliveryDate',
        expectedCurrentValue: client.authorization.latestAcceptedDeliveryDate,
        newValue: '2026-08-08T17:00:00-05:00',
        reviewedAction: 'APPLY',
      },
    ];
    const result = applyAuthorizationChanges(case001Fixture, changes);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.appliedChanges).toHaveLength(3);
      expect(result.updatedCase.actors.find(({ id }) => id === supplier.id)?.authorization.maxAbsorbableAdditionalCost)
        .toBe(75);
      expect(result.updatedCase.actors.find(({ id }) => id === client.id)?.authorization.latestAcceptedDeliveryDate)
        .toBe('2026-08-08T17:00:00-05:00');
    }
  });

  it('does not apply a discarded change', () => {
    const result = applyAuthorizationChanges(case001Fixture, [
      substituteChange({ reviewedAction: 'DISCARD' }),
    ]);
    expect(result).toMatchObject({ success: true, appliedChanges: [], discardedChanges: [{ reviewedAction: 'DISCARD' }] });
    if (result.success) expect(result.updatedCase).toEqual(case001Fixture);
  });

  it('rolls back the entire list when any change is invalid', () => {
    const original = structuredClone(case001Fixture);
    const result = applyAuthorizationChanges(case001Fixture, [
      substituteChange(),
      {
        actorId: supplier.id,
        field: 'maxAbsorbableAdditionalCost',
        expectedCurrentValue: 999,
        newValue: 75,
        reviewedAction: 'APPLY',
      },
    ]);
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('updatedCase');
    expect(case001Fixture).toEqual(original);
  });

  it('rejects duplicate targets rather than applying an ambiguous last value', () => {
    expect(applyAuthorizationChanges(case001Fixture, [
      substituteChange(),
      substituteChange({ newValue: 120 }),
    ])).toMatchObject({ success: false });
  });

  it('does not trust TypeScript types and rejects malformed input', () => {
    expect(applyAuthorizationChanges(case001Fixture, null).success).toBe(false);
    expect(applyAuthorizationChanges(case001Fixture, [null]).success).toBe(false);
  });

  it('is deterministic and does not mutate frozen inputs', () => {
    const frozenCase = Object.freeze(structuredClone(case001Fixture));
    const frozenChanges = Object.freeze([Object.freeze(substituteChange())]);
    const first = applyAuthorizationChanges(frozenCase, frozenChanges);
    const second = applyAuthorizationChanges(frozenCase, frozenChanges);
    expect(first).toEqual(second);
    expect(frozenCase).toEqual(case001Fixture);
    expect(frozenChanges[0]).toEqual(substituteChange());
  });
});

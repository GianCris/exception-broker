import { describe, expect, it } from 'vitest';

import {
  case001Fixture,
  case001FridayAtFive,
  case001TomorrowAtFive,
} from '../../src/domain/case-001.fixture.js';
import {
  exceptionCaseSchema,
  planSchema,
  transitionSchema,
} from '../../src/domain/schemas.js';

type MutableRecord = Record<string, any>;

const fixtureCopy = (): MutableRecord => structuredClone(case001Fixture);

const validPlan = {
  id: 'PLAN-001',
  caseId: 'CASE-001',
  status: 'DRAFT',
  version: 1,
  originalQuantityTomorrow: 200,
  substituteQuantityTomorrow: 100,
  originalQuantityLater: 100,
  laterDeliveryDate: case001FridayAtFive,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 50,
  productionAbsorbedCost: 0,
} as const;

const validTransition = {
  caseId: 'CASE-001',
  fromStatus: 'CASE_CREATED',
  toStatus: 'COLLECTING_CONSTRAINTS',
  triggeredByActorId: 'supplier',
  reason: 'Supplier constraints collection started',
  planId: 'PLAN-001',
  createdAt: '2026-08-03T18:00:00-05:00',
} as const;

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

  it('represents original and substitute supplier quantities explicitly', () => {
    const supplier = case001Fixture.actors.find(({ role }) => role === 'supplier');

    expect(supplier?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalQuantity: 200,
          substituteQuantity: 0,
          deliveryDate: case001TomorrowAtFive,
        }),
        expect.objectContaining({
          originalQuantity: 200,
          substituteQuantity: 0,
          deliveryDate: case001FridayAtFive,
        }),
        expect.objectContaining({
          originalQuantity: 0,
          substituteQuantity: 200,
          substituteUnitAdditionalCost: 0.5,
          deliveryDate: case001TomorrowAtFive,
        }),
      ]),
    );
  });

  it('represents authorized margins and substitute maximums explicitly', () => {
    const supplier = case001Fixture.actors.find(({ role }) => role === 'supplier');
    const production = case001Fixture.actors.find(
      ({ role }) => role === 'production',
    );
    const client = case001Fixture.actors.find(({ role }) => role === 'client');

    expect(supplier?.authorization).toMatchObject({
      maxAbsorbableAdditionalCost: 60,
    });
    expect(production?.authorization).toMatchObject({
      maxAbsorbableAdditionalCost: 20,
    });
    expect(client?.authorization).toMatchObject({
      maxAbsorbableAdditionalCost: 0,
      maxSubstituteQuantity: 50,
    });
  });

  it('accepts a plan with a split delivery', () => {
    expect(planSchema.parse(validPlan)).toEqual(validPlan);
  });

  it('accepts a valid transition', () => {
    expect(transitionSchema.parse(validTransition)).toEqual(validTransition);
  });

  it('accepts a transition without optional actor or plan IDs', () => {
    const { triggeredByActorId: _actor, planId: _plan, ...transition } =
      validTransition;

    expect(transitionSchema.safeParse(transition).success).toBe(true);
  });

  it.each([
    ['empty case ID', { ...validTransition, caseId: '' }],
    ['invalid from status', { ...validTransition, fromStatus: 'OPEN' }],
    ['invalid to status', { ...validTransition, toStatus: 'DONE' }],
    ['empty actor ID', { ...validTransition, triggeredByActorId: '  ' }],
    ['empty reason', { ...validTransition, reason: '' }],
    ['empty plan ID', { ...validTransition, planId: '' }],
    ['invalid date', { ...validTransition, createdAt: 'today' }],
    ['unknown field', { ...validTransition, nextActor: 'client' }],
  ])('rejects transition with %s', (_label, transition) => {
    expect(transitionSchema.safeParse(transition).success).toBe(false);
  });

  it.each([
    ['invalid role', (value: MutableRecord) => (value.actors[0].role = 'carrier')],
    ['invalid status', (value: MutableRecord) => (value.status = 'OPEN')],
    ['negative requested quantity', (value: MutableRecord) => (value.requestedQuantity = -1)],
    ['decimal requested quantity', (value: MutableRecord) => (value.requestedQuantity = 1.5)],
    [
      'negative original quantity',
      (value: MutableRecord) => (value.actors[0].constraints[0].originalQuantity = -1),
    ],
    [
      'decimal substitute quantity',
      (value: MutableRecord) => (value.actors[0].constraints[2].substituteQuantity = 1.5),
    ],
    [
      'negative substitute unit cost',
      (value: MutableRecord) =>
        (value.actors[0].constraints[2].substituteUnitAdditionalCost = -0.5),
    ],
    [
      'negative authorized margin',
      (value: MutableRecord) =>
        (value.actors[0].authorization.maxAbsorbableAdditionalCost = -1),
    ],
    [
      'negative substitute maximum',
      (value: MutableRecord) =>
        (value.actors[2].authorization.maxSubstituteQuantity = -1),
    ],
    ['empty case ID', (value: MutableRecord) => (value.id = '')],
    ['empty actor ID', (value: MutableRecord) => (value.actors[0].id = '  ')],
    ['invalid target date', (value: MutableRecord) => (value.targetDeliveryDate = 'tomorrow')],
    [
      'invalid authorization date',
      (value: MutableRecord) =>
        (value.actors[0].authorization.latestAcceptedDeliveryDate = 'Friday'),
    ],
    ['unknown case field', (value: MutableRecord) => (value.quantity = 400)],
    [
      'ambiguous authorization field',
      (value: MutableRecord) => (value.actors[2].authorization.quantity = 50),
    ],
    [
      'ambiguous constraint field',
      (value: MutableRecord) => (value.actors[0].constraints[0].quantity = 200),
    ],
  ])('rejects case data with %s', (_label, mutate) => {
    const candidate = fixtureCopy();
    mutate(candidate);

    expect(exceptionCaseSchema.safeParse(candidate).success).toBe(false);
  });

  it('rejects actor counts other than three and duplicated roles', () => {
    const tooFew = fixtureCopy();
    tooFew.actors.pop();
    const duplicated = fixtureCopy();
    duplicated.actors[2].role = 'supplier';

    expect(exceptionCaseSchema.safeParse(tooFew).success).toBe(false);
    expect(exceptionCaseSchema.safeParse(duplicated).success).toBe(false);
  });

  it.each([
    ['negative split quantity', { ...validPlan, originalQuantityLater: -1 }],
    ['decimal split quantity', { ...validPlan, substituteQuantityTomorrow: 1.5 }],
    ['negative absorbed cost', { ...validPlan, supplierAbsorbedCost: -1 }],
    ['invalid later date', { ...validPlan, laterDeliveryDate: 'Friday' }],
    ['ambiguous quantity', { ...validPlan, quantity: 400 }],
    ['ambiguous cost', { ...validPlan, additionalCost: 50 }],
  ])('rejects plan with %s', (_label, plan) => {
    expect(planSchema.safeParse(plan).success).toBe(false);
  });
});

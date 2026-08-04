import { describe, expect, it } from 'vitest';

import {
  case001Fixture,
  case001FridayAtFive,
} from '../../src/domain/case-001.fixture.js';
import { planSchema } from '../../src/domain/schemas.js';
import type { Plan } from '../../src/domain/types.js';
import { validatePlan } from '../../src/domain/validator.js';

const validPlan = planSchema.parse({
  id: 'PLAN-W1-02',
  caseId: 'CASE-001',
  status: 'DRAFT',
  version: 1,
  originalQuantityTomorrow: 250,
  substituteQuantityTomorrow: 50,
  originalQuantityLater: 100,
  laterDeliveryDate: case001FridayAtFive,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 25,
  productionAbsorbedCost: 0,
});

const planWith = (changes: Partial<Plan>): Plan => ({
  ...validPlan,
  ...changes,
});

const ruleIds = (plan: Plan): string[] =>
  validatePlan(case001Fixture, plan).violations.map(({ ruleId }) => ruleId);

describe('validatePlan', () => {
  it('accepts a plan that satisfies every rule', () => {
    expect(validatePlan(case001Fixture, validPlan)).toEqual({
      valid: true,
      violations: [],
    });
  });

  it('rejects an incorrect total for R-01 and documents equivalent R-10', () => {
    const result = validatePlan(
      case001Fixture,
      planWith({ originalQuantityLater: 99 }),
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'R-01', expected: 400, actual: 399 }),
        expect.objectContaining({ ruleId: 'R-10', expected: 400, actual: 399 }),
      ]),
    );
  });

  it('reports an unmet production minimum', () => {
    expect(
      ruleIds(
        planWith({
          originalQuantityTomorrow: 249,
          originalQuantityLater: 101,
        }),
      ),
    ).toContain('R-02');
  });

  it('reports an unmet client minimum', () => {
    expect(
      ruleIds(
        planWith({
          originalQuantityTomorrow: 249,
          originalQuantityLater: 101,
        }),
      ),
    ).toContain('R-03');
  });

  it('rejects substitutes above the client maximum', () => {
    expect(
      ruleIds(
        planWith({
          originalQuantityTomorrow: 249,
          substituteQuantityTomorrow: 51,
        }),
      ),
    ).toContain('R-04');
  });

  it('rejects client cost above its authorization', () => {
    expect(ruleIds(planWith({ clientAdditionalCost: 0.01 }))).toContain('R-05');
  });

  it('rejects supplier absorbed cost above its authorization', () => {
    expect(ruleIds(planWith({ supplierAbsorbedCost: 60.01 }))).toContain('R-06');
  });

  it('rejects production absorbed cost above its authorization', () => {
    expect(ruleIds(planWith({ productionAbsorbedCost: 20.01 }))).toContain(
      'R-07',
    );
  });

  it('rejects a later delivery after the most restrictive date', () => {
    expect(
      ruleIds(planWith({ laterDeliveryDate: '2026-08-08T17:00:00-05:00' })),
    ).toContain('R-08');
  });

  it('accepts 50 substitutes when the supplier absorbs the full S/25 cost', () => {
    expect(ruleIds(validPlan)).not.toContain('R-09');
  });

  it('accepts 50 substitutes when supplier and production split S/25', () => {
    expect(
      ruleIds(
        planWith({
          supplierAbsorbedCost: 15,
          productionAbsorbedCost: 10,
        }),
      ),
    ).not.toContain('R-09');
  });

  it('rejects 50 substitutes when allocated cost totals S/24.98', () => {
    expect(ruleIds(planWith({ supplierAbsorbedCost: 24.98 }))).toContain('R-09');
  });

  it('accepts an R-09 difference of exactly S/0.01', () => {
    expect(ruleIds(planWith({ supplierAbsorbedCost: 24.99 }))).not.toContain(
      'R-09',
    );
  });

  it('returns all simultaneous violations without mutating its inputs', () => {
    const plan = planWith({
      originalQuantityTomorrow: 200,
      substituteQuantityTomorrow: 51,
      originalQuantityLater: 0,
      laterDeliveryDate: '2026-08-08T17:00:00-05:00',
      clientAdditionalCost: 1,
      supplierAbsorbedCost: 61,
      productionAbsorbedCost: 21,
    });
    const caseBefore = structuredClone(case001Fixture);
    const planBefore = structuredClone(plan);

    const result = validatePlan(case001Fixture, plan);

    expect(new Set(result.violations.map(({ ruleId }) => ruleId))).toEqual(
      new Set([
        'R-01',
        'R-02',
        'R-03',
        'R-04',
        'R-05',
        'R-06',
        'R-07',
        'R-08',
        'R-09',
        'R-10',
      ]),
    );
    expect(case001Fixture).toEqual(caseBefore);
    expect(plan).toEqual(planBefore);
  });
});

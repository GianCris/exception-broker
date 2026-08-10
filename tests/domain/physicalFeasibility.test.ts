import { describe, expect, it } from 'vitest';

import { case001Fixture, case001FridayAtFive, case001TomorrowAtFive } from '../../src/domain/case-001.fixture.js';
import { assessPhysicalFeasibility } from '../../src/domain/physicalFeasibility.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { Constraint, ExceptionCase, Plan } from '../../src/domain/types.js';

const supply = (originalQuantity: number, substituteQuantity: number, deliveryDate: string): Constraint => ({
  type: 'SUPPLY', originalQuantity, substituteQuantity, deliveryDate, substituteUnitAdditionalCost: substituteQuantity > 0 ? 0.5 : 0,
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const caseWithSupplies = (supplies: readonly Constraint[]): ExceptionCase => exceptionCaseSchema.parse({
  ...structuredClone(case001Fixture),
  actors: case001Fixture.actors.map((actor) => actor.role === 'supplier' ? { ...actor, constraints: supplies } : actor),
});

const physicalCase = caseWithSupplies([
  supply(420, 0, case001TomorrowAtFive),
  supply(0, 100, case001TomorrowAtFive),
  supply(200, 0, case001FridayAtFive),
]);

const physicalPlan = (changes: Partial<Plan> = {}): Plan => planSchema.parse({
  id: 'PHYSICAL-PLAN', caseId: physicalCase.id, status: 'PENDING_APPROVAL', version: 1,
  originalQuantityTomorrow: 420, substituteQuantityTomorrow: 100, originalQuantityLater: 80,
  laterDeliveryDate: case001FridayAtFive, clientAdditionalCost: 0,
  supplierAbsorbedCost: 50, productionAbsorbedCost: 0, ...changes,
});

describe('assessPhysicalFeasibility', () => {
  it('proves independently supported target original, target substitute, and later original', () => {
    const result = assessPhysicalFeasibility(physicalCase, physicalPlan());
    expect(result).toMatchObject({ outcome: 'PHYSICALLY_FEASIBLE' });
    if (result.outcome !== 'PHYSICALLY_FEASIBLE') return;
    expect(result.checks.map(({ planField }) => planField)).toEqual([
      'originalQuantityTomorrow', 'substituteQuantityTomorrow', 'originalQuantityLater',
    ]);
  });

  it('accepts a simplified single-supplier 350 original + 150 substitute plan', () => {
    const trusted = caseWithSupplies([supply(350, 150, case001TomorrowAtFive)]);
    const plan = physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 350, substituteQuantityTomorrow: 150, originalQuantityLater: 0 });
    expect(assessPhysicalFeasibility(trusted, plan)).toMatchObject({ outcome: 'PHYSICALLY_FEASIBLE' });
  });

  it.each([
    ['originalQuantityTomorrow', 500, 'ORIGINAL_SUPPLY_EXCEEDED'],
    ['substituteQuantityTomorrow', 180, 'SUBSTITUTE_SUPPLY_EXCEEDED'],
  ] as const)('proves %s exceeds its physical component', (field, quantity, code) => {
    const result = assessPhysicalFeasibility(physicalCase, physicalPlan({ [field]: quantity }));
    expect(result).toMatchObject({ outcome: 'PHYSICALLY_INFEASIBLE', violations: expect.arrayContaining([expect.objectContaining({ code, planField: field })]) });
  });

  it('does not let aggregate availability hide an original component violation', () => {
    const trusted = caseWithSupplies([supply(420, 100, case001TomorrowAtFive)]);
    const plan = physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 500, substituteQuantityTomorrow: 20, originalQuantityLater: 0 });
    expect(assessPhysicalFeasibility(trusted, plan)).toMatchObject({ outcome: 'PHYSICALLY_INFEASIBLE', violations: [expect.objectContaining({ code: 'ORIGINAL_SUPPLY_EXCEEDED' })] });
  });

  it('proves uniquely identified supply after the requirement is too late', () => {
    const trusted = caseWithSupplies([supply(0, 100, '2026-08-05T17:00:00-05:00')]);
    const result = assessPhysicalFeasibility(trusted, physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 0, substituteQuantityTomorrow: 80, originalQuantityLater: 0 }));
    expect(result).toMatchObject({ outcome: 'PHYSICALLY_INFEASIBLE', violations: [expect.objectContaining({ code: 'SUPPLY_AVAILABLE_TOO_LATE' })] });
  });

  it('does not carry earlier supply forward without reservation evidence', () => {
    const trusted = caseWithSupplies([supply(100, 0, case001TomorrowAtFive)]);
    const result = assessPhysicalFeasibility(trusted, physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 0, substituteQuantityTomorrow: 0, originalQuantityLater: 80 }));
    expect(result).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'EARLIER_SUPPLY_REQUIRES_RESERVATION_EVIDENCE' })] });
  });

  it('returns UNPROVEN for missing or ambiguous supply rather than summing records', () => {
    const missing = caseWithSupplies([supply(0, 0, case001TomorrowAtFive)]);
    expect(assessPhysicalFeasibility(missing, physicalPlan({ caseId: missing.id, substituteQuantityTomorrow: 0, originalQuantityLater: 0 }))).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'PHYSICAL_SUPPLY_MISSING' })] });
    const ambiguous = caseWithSupplies([supply(250, 0, case001TomorrowAtFive), supply(250, 0, case001TomorrowAtFive)]);
    expect(assessPhysicalFeasibility(ambiguous, physicalPlan({ caseId: ambiguous.id, substituteQuantityTomorrow: 0, originalQuantityLater: 0 }))).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'PHYSICAL_SUPPLY_AMBIGUOUS' })] });
  });

  it('does not require evidence for zero plan quantities', () => {
    const trusted = caseWithSupplies([supply(0, 0, case001TomorrowAtFive)]);
    expect(assessPhysicalFeasibility(trusted, physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 0, substituteQuantityTomorrow: 0, originalQuantityLater: 0 }))).toEqual({ outcome: 'PHYSICALLY_FEASIBLE', checks: [] });
  });

  it('matches the same instant across different UTC offsets', () => {
    const trusted = caseWithSupplies([supply(420, 100, '2026-08-04T22:00:00Z')]);
    const plan = physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 420, substituteQuantityTomorrow: 100, originalQuantityLater: 0 });
    expect(assessPhysicalFeasibility(trusted, plan)).toMatchObject({ outcome: 'PHYSICALLY_FEASIBLE' });
  });

  it('does not use one supply component for two plan date buckets', () => {
    const trusted = caseWithSupplies([supply(500, 0, case001TomorrowAtFive)]);
    const plan = physicalPlan({ caseId: trusted.id, originalQuantityTomorrow: 300, substituteQuantityTomorrow: 0, originalQuantityLater: 100, laterDeliveryDate: case001TomorrowAtFive });
    expect(assessPhysicalFeasibility(trusted, plan)).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'SUPPLY_COMPONENT_REUSE_REQUIRED' })] });
  });

  it('returns UNPROVEN for malformed trusted supply, case dates, and plan dates', () => {
    const malformedSupply = structuredClone(physicalCase) as ExceptionCase;
    (malformedSupply.actors.find(({ role }) => role === 'supplier')!.constraints[0] as { deliveryDate: string }).deliveryDate = 'invalid';
    expect(assessPhysicalFeasibility(malformedSupply, physicalPlan())).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_SUPPLY_STATE_INVALID' }] });
    expect(assessPhysicalFeasibility({ ...physicalCase, targetDeliveryDate: 'invalid' }, physicalPlan())).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN' });
    expect(assessPhysicalFeasibility(physicalCase, { ...physicalPlan(), laterDeliveryDate: 'invalid' })).toMatchObject({ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_PLAN_STATE_INVALID', caseId: physicalCase.id }] });
  });

  it('does not use authorization as availability', () => {
    const changed = structuredClone(physicalCase);
    const client = changed.actors.find(({ role }) => role === 'client')!;
    client.authorization.maxSubstituteQuantity = 10_000;
    const requested = physicalPlan({ substituteQuantityTomorrow: 180 });
    expect(assessPhysicalFeasibility(changed, requested)).toEqual(assessPhysicalFeasibility(physicalCase, requested));
  });

  it('is deterministic and does not mutate deeply frozen inputs', () => {
    const trusted = deepFreeze(structuredClone(physicalCase));
    const plan = deepFreeze(physicalPlan());
    const before = JSON.stringify({ trusted, plan });
    expect(assessPhysicalFeasibility(trusted, plan)).toEqual(assessPhysicalFeasibility(trusted, plan));
    expect(JSON.stringify({ trusted, plan })).toBe(before);
  });

  it('never produces a no-solution outcome for missing or infeasible supply', () => {
    for (const result of [
      assessPhysicalFeasibility(physicalCase, physicalPlan({ originalQuantityTomorrow: 500 })),
      assessPhysicalFeasibility(caseWithSupplies([supply(0, 0, case001TomorrowAtFive)]), physicalPlan()),
    ]) expect(JSON.stringify(result)).not.toContain('NO_SOLUTION_PROVEN');
  });
});

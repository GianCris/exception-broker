import { describe, expect, it } from 'vitest';

import { registerInitialPlanProposal } from '../../src/domain/planRegistration.js';
import { createPlanLineage, validatePlanLineageCollection, type PlanLineage } from '../../src/domain/planLineage.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ExceptionCase, Plan } from '../../src/domain/types.js';

const target = '2026-09-01T17:00:00-05:00';
const later = '2026-09-04T17:00:00-05:00';

const trustedCase = (includeLaterSupply = true): ExceptionCase => exceptionCaseSchema.parse({
  id: 'CASE-REGISTRATION', status: 'CASE_CREATED', requestedQuantity: 400, targetDeliveryDate: target,
  actors: [
    {
      id: 'SUPPLIER-REGISTRATION', role: 'supplier',
      constraints: [
        { type: 'SUPPLY', originalQuantity: 300, substituteQuantity: 0, deliveryDate: target, substituteUnitAdditionalCost: 0 },
        { type: 'SUPPLY', originalQuantity: 0, substituteQuantity: 200, deliveryDate: target, substituteUnitAdditionalCost: 0.5 },
        ...(includeLaterSupply ? [{ type: 'SUPPLY' as const, originalQuantity: 200, substituteQuantity: 0, deliveryDate: later, substituteUnitAdditionalCost: 0 }] : []),
      ],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 400, latestAcceptedDeliveryDate: later },
    },
    {
      id: 'PRODUCTION-REGISTRATION', role: 'production',
      constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 300, deliveryDate: target, allowsOriginalAndSubstituteMix: true }],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 400, latestAcceptedDeliveryDate: later },
    },
    {
      id: 'CLIENT-REGISTRATION', role: 'client',
      constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 300, deliveryDate: target, allowsOriginalAndSubstituteMix: true }],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 50, latestAcceptedDeliveryDate: later },
    },
  ],
});

const proposal = (changes: Partial<Plan> = {}): Plan => planSchema.parse({
  id: 'PLAN-REGISTRATION', caseId: 'CASE-REGISTRATION', status: 'PENDING_APPROVAL', version: 1,
  originalQuantityTomorrow: 250, substituteQuantityTomorrow: 50, originalQuantityLater: 100,
  laterDeliveryDate: later, clientAdditionalCost: 0, supplierAbsorbedCost: 25,
  productionAbsorbedCost: 0, ...changes,
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

describe('registerInitialPlanProposal', () => {
  it('atomically registers a valid and physically feasible proposal', () => {
    const result = registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-REGISTRATION', proposal());
    expect(result).toMatchObject({
      success: true,
      plan: { id: 'PLAN-REGISTRATION', version: 1 },
      lineage: { lineageId: 'LINEAGE-REGISTRATION', caseId: 'CASE-REGISTRATION', planIds: ['PLAN-REGISTRATION'] },
      assessment: {
        planAssessment: { outcome: 'PLAN_VALID' },
        physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
      },
    });
    if (!result.success) return;
    expect(result.plans.filter(({ id }) => id === result.plan.id)).toHaveLength(1);
    expect(result.lineages.filter(({ lineageId }) => lineageId === result.lineage.lineageId)).toHaveLength(1);
    expect(result.lineages[0]).toBe(result.lineage);
    expect(validatePlanLineageCollection(result.lineages, result.plans)).toEqual({ valid: true });
  });

  it('returns complete collections while preserving existing plans and lineages', () => {
    const existingPlan = proposal({ id: 'PLAN-EXISTING' as Plan['id'] });
    const existingLineage = createPlanLineage([], [existingPlan], 'LINEAGE-EXISTING', existingPlan.id);
    expect(existingLineage.success).toBe(true);
    if (!existingLineage.success) return;
    const newPlan = proposal({ id: 'PLAN-NEW' as Plan['id'] });
    const result = registerInitialPlanProposal(
      trustedCase(), existingLineage.lineages, [existingPlan], 'LINEAGE-NEW', newPlan,
    );
    expect(result).toMatchObject({ success: true });
    if (!result.success) return;
    expect(result.plans.map(({ id }) => id)).toEqual(['PLAN-EXISTING', 'PLAN-NEW']);
    expect(result.lineages.map(({ lineageId }) => lineageId)).toEqual(['LINEAGE-EXISTING', 'LINEAGE-NEW']);
    expect(result.lineages[0]).toBe(existingLineage.lineages[0]);
    expect(validatePlanLineageCollection(result.lineages, result.plans)).toEqual({ valid: true });
  });

  it('registers PLAN_INVALID as assessment metadata rather than rejecting it', () => {
    const invalid = proposal({ originalQuantityTomorrow: 200, substituteQuantityTomorrow: 100, supplierAbsorbedCost: 50 });
    const result = registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-INVALID', invalid);
    expect(result).toMatchObject({ success: true, assessment: { planAssessment: { outcome: 'PLAN_INVALID' } } });
  });

  it('registers PHYSICALLY_INFEASIBLE as assessment metadata rather than rejecting it', () => {
    const infeasible = proposal({ originalQuantityTomorrow: 350, originalQuantityLater: 0 });
    const result = registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-INFEASIBLE', infeasible);
    expect(result).toMatchObject({
      success: true,
      assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_INFEASIBLE' } },
    });
  });

  it('registers PHYSICAL_FEASIBILITY_UNPROVEN as assessment metadata rather than rejecting it', () => {
    const result = registerInitialPlanProposal(trustedCase(false), [], [], 'LINEAGE-UNPROVEN', proposal());
    expect(result).toMatchObject({
      success: true,
      assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN' } },
    });
  });

  it.each(['DRAFT', 'PENDING_APPROVAL'] as const)('allows initial %s lifecycle', (status) => {
    expect(registerInitialPlanProposal(trustedCase(), [], [], `LINEAGE-${status}`, proposal({ status })))
      .toMatchObject({ success: true, plan: { status } });
  });

  it.each(['REJECTED', 'NO_SOLUTION', 'INVALIDATED', 'APPROVED'] as const)(
    'rejects initial %s lifecycle without partial collections',
    (status) => {
      const result = registerInitialPlanProposal(trustedCase(), [], [], `LINEAGE-${status}`, proposal({ status }));
      expect(result).toEqual({ success: false, reason: 'INITIAL_PLAN_STATUS_UNSUPPORTED' });
      expect(result).not.toHaveProperty('plans');
      expect(result).not.toHaveProperty('lineages');
    },
  );

  it('rejects a malformed plan without normalizing external identity', () => {
    expect(registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-MALFORMED', { ...proposal(), id: ' PLAN-WHITESPACE ' }))
      .toMatchObject({ success: false, reason: 'PLAN_SCHEMA_INVALID' });
    expect(registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-MALFORMED', { ...proposal(), version: 0 }))
      .toMatchObject({ success: false, reason: 'PLAN_SCHEMA_INVALID' });
  });

  it('rejects a plan belonging to another case', () => {
    expect(registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-WRONG-CASE', proposal({ caseId: 'CASE-OTHER' as Plan['caseId'] })))
      .toEqual({ success: false, reason: 'PLAN_CASE_MISMATCH' });
  });

  it('rejects empty and duplicate lineage identities', () => {
    expect(registerInitialPlanProposal(trustedCase(), [], [], '', proposal())).toEqual({ success: false, reason: 'LINEAGE_ID_REQUIRED' });
    const existingPlan = proposal({ id: 'PLAN-EXISTING' as Plan['id'] });
    const created = createPlanLineage([], [existingPlan], 'LINEAGE-EXISTING', existingPlan.id);
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(registerInitialPlanProposal(trustedCase(), created.lineages, [existingPlan], 'LINEAGE-EXISTING', proposal()))
      .toEqual({ success: false, reason: 'LINEAGE_ID_ALREADY_EXISTS' });
  });

  it('distinguishes an assigned plan from an unused duplicate plan ID', () => {
    const registered = proposal();
    const created = createPlanLineage([], [registered], 'LINEAGE-ASSIGNED', registered.id);
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(registerInitialPlanProposal(trustedCase(), created.lineages, [registered], 'LINEAGE-NEW', registered))
      .toEqual({ success: false, reason: 'PLAN_ALREADY_ASSIGNED' });
    expect(registerInitialPlanProposal(trustedCase(), [], [registered], 'LINEAGE-NEW', registered))
      .toEqual({ success: false, reason: 'PLAN_ID_ALREADY_EXISTS' });
  });

  it('rejects duplicate plan records and invalid existing lineage state before registration', () => {
    const duplicate = proposal({ id: 'PLAN-DUPLICATE' as Plan['id'] });
    expect(registerInitialPlanProposal(trustedCase(), [], [duplicate, structuredClone(duplicate)], 'LINEAGE-NEW', proposal()))
      .toMatchObject({ success: false, reason: 'EXISTING_COLLECTION_INVALID', issues: [expect.stringContaining('DUPLICATE_PLAN_ID')] });
    const invalidLineage: PlanLineage = { lineageId: 'LINEAGE-BROKEN', caseId: trustedCase().id, planIds: ['PLAN-MISSING' as Plan['id']] };
    expect(registerInitialPlanProposal(trustedCase(), [invalidLineage], [], 'LINEAGE-NEW', proposal()))
      .toMatchObject({ success: false, reason: 'EXISTING_COLLECTION_INVALID' });
  });

  it('rejects initial versions other than one', () => {
    expect(registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-V2', proposal({ version: 2 })))
      .toEqual({ success: false, reason: 'INITIAL_PLAN_VERSION_UNSUPPORTED' });
  });

  it('returns assessments only as point-in-time metadata, never persisted in plan or lineage', () => {
    const result = registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-METADATA', proposal());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.plan).not.toHaveProperty('assessment');
    expect(result.plan).not.toHaveProperty('physicalFeasibilityAssessment');
    expect(result.lineage).not.toHaveProperty('assessment');
    expect(result.lineage).not.toHaveProperty('physicalFeasibilityAssessment');
  });

  it('is deterministic, generates no identity or timestamp, and leaves frozen inputs unchanged', () => {
    const exceptionCase = deepFreeze(trustedCase());
    const plans = deepFreeze([] as Plan[]);
    const lineages = deepFreeze([] as PlanLineage[]);
    const inputPlan = deepFreeze(proposal());
    const before = JSON.stringify({ exceptionCase, plans, lineages, inputPlan });
    const first = registerInitialPlanProposal(exceptionCase, lineages, plans, 'LINEAGE-EXPLICIT', inputPlan);
    const second = registerInitialPlanProposal(exceptionCase, lineages, plans, 'LINEAGE-EXPLICIT', inputPlan);
    expect(second).toEqual(first);
    expect(JSON.stringify({ exceptionCase, plans, lineages, inputPlan })).toBe(before);
    expect(first).toMatchObject({ success: true, plan: { id: inputPlan.id }, lineage: { lineageId: 'LINEAGE-EXPLICIT' } });
    if (!first.success) return;
    expect(first.plan).not.toHaveProperty('createdAt');
    expect(first.lineage).not.toHaveProperty('createdAt');
  });

  it('rejects repeated registration with the same returned identities', () => {
    const first = registerInitialPlanProposal(trustedCase(), [], [], 'LINEAGE-REPEAT', proposal());
    expect(first.success).toBe(true);
    if (!first.success) return;
    const repeated = registerInitialPlanProposal(trustedCase(), first.lineages, first.plans, 'LINEAGE-REPEAT', proposal());
    expect(repeated).toEqual({ success: false, reason: 'LINEAGE_ID_ALREADY_EXISTS' });
    expect(repeated).not.toHaveProperty('plans');
    expect(repeated).not.toHaveProperty('lineages');
  });
});

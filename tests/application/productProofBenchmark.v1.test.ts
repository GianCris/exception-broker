import { afterAll, describe, expect, it } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../src/application/adaptiveOrchestrator.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase, Plan, PlanId } from '../../src/domain/types.js';
import type { DecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';

const TARGET = '2027-09-10T17:00:00-05:00';
const LATER = '2027-09-12T17:00:00-05:00';

type SupplyRecord = Readonly<{ original: number; substitute: number; date?: string }>;
type FrozenFixture = Readonly<{
  namespace: string;
  exceptionCase: ExceptionCase;
  plan: Plan;
  lineageId: string;
}>;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const fixture = (input: Readonly<{
  namespace: string;
  requested: number;
  original: number;
  substitute: number;
  authorizedSubstitute: number;
  supplies?: readonly SupplyRecord[];
  laterOriginal?: number;
  planCosts?: readonly [number, number, number];
}>): FrozenFixture => {
  const supplies = input.supplies ?? [
    { original: input.original, substitute: 0 },
    { original: 0, substitute: input.substitute },
    ...(input.laterOriginal === undefined ? [] : [{ original: input.laterOriginal, substitute: 0, date: LATER }]),
  ];
  const substituteCost = input.substitute * 0.5;
  const costs = input.planCosts ?? [0, substituteCost, 0];
  return deepFreeze({
    namespace: input.namespace,
    exceptionCase: exceptionCaseSchema.parse({
      id: `BENCH-${input.namespace}`,
      status: 'CASE_CREATED',
      requestedQuantity: input.requested,
      targetDeliveryDate: TARGET,
      actors: [
        {
          id: `SUPPLIER-${input.namespace}`, role: 'supplier',
          constraints: supplies.map(({ original, substitute, date }) => ({
            type: 'SUPPLY', originalQuantity: original, substituteQuantity: substitute,
            deliveryDate: date ?? TARGET, substituteUnitAdditionalCost: substitute > 0 ? 0.5 : 0,
          })),
          authorization: { maxAbsorbableAdditionalCost: 500, maxSubstituteQuantity: input.requested, latestAcceptedDeliveryDate: LATER },
        },
        {
          id: `PRODUCTION-${input.namespace}`, role: 'production',
          constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: input.original + input.substitute, deliveryDate: TARGET, allowsOriginalAndSubstituteMix: true }],
          authorization: { maxAbsorbableAdditionalCost: 500, maxSubstituteQuantity: input.requested, latestAcceptedDeliveryDate: LATER },
        },
        {
          id: `CLIENT-${input.namespace}`, role: 'client',
          constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: input.original + input.substitute, deliveryDate: TARGET, allowsOriginalAndSubstituteMix: true }],
          authorization: { maxAbsorbableAdditionalCost: 500, maxSubstituteQuantity: input.authorizedSubstitute, latestAcceptedDeliveryDate: LATER },
        },
      ],
    }),
    plan: planSchema.parse({
      id: `PLAN-${input.namespace}-A`, caseId: `BENCH-${input.namespace}`,
      status: 'PENDING_APPROVAL', version: 1,
      originalQuantityTomorrow: input.original,
      substituteQuantityTomorrow: input.substitute,
      originalQuantityLater: input.laterOriginal ?? 0,
      laterDeliveryDate: LATER,
      clientAdditionalCost: costs[0], supplierAbsorbedCost: costs[1], productionAbsorbedCost: costs[2],
    }),
    lineageId: `LINEAGE-${input.namespace}`,
  });
};

const emptyState = (value: FrozenFixture): OrchestrationState => ({
  exceptionCase: value.exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [],
});

const executeAccepted = (state: OrchestrationState, action: OrchestrationAction) => {
  const result = executeOrchestrationAction(state, action);
  if (!result.accepted) throw new Error(`${result.failure.source}: ${result.failure.reason}`);
  return result;
};

const register = (value: FrozenFixture) => executeAccepted(emptyState(value), {
  type: 'REGISTER_PLAN_PROPOSAL', lineageId: value.lineageId, plan: value.plan,
});

const decision = (
  state: OrchestrationState,
  planId: string,
  role: ActorRole,
  token: string,
  overrides: Readonly<{ actorRole?: ActorRole; operationId?: string; approvalId?: string; eventId?: string }> = {},
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = state.exceptionCase.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`Missing benchmark actor ${role}`);
  const bridgeResult: DecisionBridgeResult = {
    ready: true,
    proposal: {
      operationType: 'PLAN_DECISION', requestId: `REQUEST-${token}`, caseId: state.exceptionCase.id,
      planId, actorId: actor.id, actorRole: overrides.actorRole ?? actor.role,
      decision: 'APPROVED', summary: 'Explicit benchmark decision', proposedAuthorizationChanges: [],
      evidence: ['Frozen benchmark evidence'], completionConfidence: { score: 1, label: 'high' },
      receivedAt: '2027-09-01T12:00:00Z', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED',
    },
  };
  return {
    type: 'APPLY_REVIEWED_DECISION', bridgeResult,
    review: {
      action: 'APPLY', operationId: overrides.operationId ?? `OPERATION-${token}`,
      reviewedBy: 'BENCHMARK-REVIEWER', reviewedAt: '2027-09-01T13:00:00Z',
      eventId: overrides.eventId ?? `EVENT-${token}`,
      approvalId: overrides.approvalId ?? `APPROVAL-${token}`, authorizationReviews: [],
    },
  };
};

const authorization = (
  state: OrchestrationState,
  current: number,
  next: number,
  token: string,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = state.exceptionCase.actors.find(({ role }) => role === 'client');
  if (actor === undefined) throw new Error('Missing benchmark client');
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult: {
      ready: true,
      proposal: {
        operationType: 'CASE_AUTHORIZATION', requestId: `REQUEST-${token}`, caseId: state.exceptionCase.id,
        actorId: actor.id, actorRole: 'client', decision: 'APPROVED', summary: 'Explicit authorization',
        proposedAuthorizationChanges: [{ field: 'maxSubstituteQuantity', currentInternalValue: current, proposedNewValue: next, requiresReview: true }],
        evidence: ['Frozen authorization evidence'], completionConfidence: { score: 1, label: 'high' },
        receivedAt: '2027-09-01T14:00:00Z', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED',
      },
    },
    review: {
      action: 'APPLY', operationId: `OPERATION-${token}`, reviewedBy: 'BENCHMARK-REVIEWER',
      reviewedAt: '2027-09-01T15:00:00Z', eventId: `EVENT-${token}`,
      authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
    },
  };
};

const approveAll = (state: OrchestrationState, planId: string, roles: readonly ActorRole[], prefix: string) => {
  const results = [];
  let current = state;
  for (const role of roles) {
    const result = executeAccepted(current, decision(current, planId, role, `${prefix}-${role.toUpperCase()}`));
    results.push(result);
    current = result.state;
  }
  return { state: current, results };
};

const passed = new Set<string>();
const mark = (id: string): void => { passed.add(id); };

describe.sequential('Product Proof Benchmark v1', () => {
  it('B01 — valid recovery proves liveness with immediate and later quantities', () => {
    const value = fixture({ namespace: 'B01', requested: 480, original: 280, substitute: 120, authorizedSubstitute: 150, laterOriginal: 80 });
    const snapshot = JSON.stringify(value);
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { planAssessment: { outcome: 'PLAN_VALID' }, physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' } } } });
    const approvals = approveAll(registration.state, value.plan.id, ['supplier', 'client', 'production'], 'B01');
    expect(approvals.results.slice(0, 2).map(({ disposition }) => disposition.type)).toEqual(['AWAITING_EXTERNAL_ACTION', 'AWAITING_EXTERNAL_ACTION']);
    expect(approvals.results[2]?.disposition).toEqual({ type: 'LINEAGE_RESOLVED', scope: { caseId: value.exceptionCase.id, lineageId: value.lineageId, planId: value.plan.id } });
    expect(approvals.state.plans[0]?.status).toBe('APPROVED');
    expect(approvals.state.approvals.every(({ planId }) => planId === value.plan.id)).toBe(true);
    expect(JSON.stringify(value)).toBe(snapshot);
    mark('B01');
  });

  it('B02 — insufficient authorization blocks an otherwise physically supported approval', () => {
    const value = fixture({ namespace: 'B02', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 100 });
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { planAssessment: { outcome: 'PLAN_INVALID', validation: { violations: [expect.objectContaining({ ruleId: 'R-04' })] } }, physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' } } } });
    const result = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'supplier', 'B02'));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW' } });
    expect(result.state).toBe(registration.state);
    expect(registration.state.approvals).toEqual([]); expect(registration.state.operationHistory).toEqual([]); expect(registration.state.events).toEqual([]);
    mark('B02');
  });

  it('B03 — insufficient physical supply blocks approval despite sufficient authorization', () => {
    const value = fixture({ namespace: 'B03', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 200, supplies: [{ original: 350, substitute: 0 }, { original: 0, substitute: 100 }] });
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { planAssessment: { outcome: 'PLAN_VALID' }, physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_INFEASIBLE', violations: [expect.objectContaining({ code: 'SUBSTITUTE_SUPPLY_EXCEEDED' })] } } } });
    const result = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'client', 'B03'));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'PLAN_PHYSICALLY_INFEASIBLE' } });
    expect(result.state).toBe(registration.state);
    expect(registration.state.approvals).toEqual([]); expect(registration.state.operationHistory).toEqual([]); expect(registration.state.events).toEqual([]);
    mark('B03');
  });

  it('B04 — missing physical evidence remains UNPROVEN and blocks approval', () => {
    const value = fixture({ namespace: 'B04', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 200, supplies: [{ original: 0, substitute: 150 }] });
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'PHYSICAL_SUPPLY_MISSING' })] } } } });
    expect(registration.step).not.toMatchObject({ assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_INFEASIBLE' } } });
    const result = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'production', 'B04'));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'PHYSICAL_FEASIBILITY_UNPROVEN' } });
    expect(result.state).toBe(registration.state);
    mark('B04');
  });

  it('B05 — ambiguous physical evidence is neither first-selected nor summed', () => {
    const value = fixture({ namespace: 'B05', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 200, supplies: [{ original: 350, substitute: 0 }, { original: 0, substitute: 80 }, { original: 0, substitute: 80 }] });
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [expect.objectContaining({ code: 'PHYSICAL_SUPPLY_AMBIGUOUS' })] } } } });
    const result = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'supplier', 'B05'));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'PHYSICAL_FEASIBILITY_UNPROVEN' } });
    expect(result.state).toBe(registration.state);
    mark('B05');
  });

  it('B06 — superseded decisions are side-effect free', () => {
    const value = fixture({ namespace: 'B06', requested: 400, original: 300, substitute: 100, authorizedSubstitute: 120 });
    const registration = register(value);
    const successor = executeAccepted(registration.state, { type: 'CREATE_SUCCESSOR', lineageId: value.lineageId, predecessorPlanId: value.plan.id, newPlanId: 'PLAN-B06-B' as PlanId, changes: {} });
    const result = executeOrchestrationAction(successor.state, decision(successor.state, value.plan.id, 'client', 'B06-DELAYED'));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'PLAN_SUPERSEDED' } });
    expect(result.state).toBe(successor.state);
    expect(successor.state.approvals).toEqual([]); expect(successor.state.operationHistory).toEqual([]); expect(successor.state.events).toEqual([]);
    mark('B06');
  });

  it('B07 — predecessor approval cannot finalize a successor', () => {
    const value = fixture({ namespace: 'B07', requested: 400, original: 300, substitute: 100, authorizedSubstitute: 120 });
    const registration = register(value);
    const oldApproval = executeAccepted(registration.state, decision(registration.state, value.plan.id, 'supplier', 'B07-OLD'));
    const successor = executeAccepted(oldApproval.state, { type: 'CREATE_SUCCESSOR', lineageId: value.lineageId, predecessorPlanId: value.plan.id, newPlanId: 'PLAN-B07-B' as PlanId, changes: {} });
    const production = executeAccepted(successor.state, decision(successor.state, 'PLAN-B07-B', 'production', 'B07-NEW-PRODUCTION'));
    const client = executeAccepted(production.state, decision(production.state, 'PLAN-B07-B', 'client', 'B07-NEW-CLIENT'));
    expect(client.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(client.state.plans.find(({ id }) => id === 'PLAN-B07-B')?.status).toBe('PENDING_APPROVAL');
    expect(client.state.approvals.filter(({ planId }) => planId === 'PLAN-B07-B')).toHaveLength(2);
    expect(client.state.approvals.filter(({ planId }) => planId === value.plan.id)).toHaveLength(1);
    const supplier = executeAccepted(client.state, decision(client.state, 'PLAN-B07-B', 'supplier', 'B07-NEW-SUPPLIER'));
    expect(supplier.disposition.type).toBe('LINEAGE_RESOLVED');
    mark('B07');
  });

  it('B08 — actor/role mismatch is rejected without effects', () => {
    const value = fixture({ namespace: 'B08', requested: 400, original: 300, substitute: 100, authorizedSubstitute: 120 });
    const registration = register(value);
    const result = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'supplier', 'B08', { actorRole: 'production' }));
    expect(result).toMatchObject({ accepted: false, failure: { reason: 'ACTOR_ROLE_MISMATCH' } });
    expect(result.state).toBe(registration.state);
    expect(registration.state.approvals).toEqual([]); expect(registration.state.operationHistory).toEqual([]); expect(registration.state.events).toEqual([]);
    mark('B08');
  });

  it('B09 — operation and approval replay protections prevent second effects', () => {
    const value = fixture({ namespace: 'B09', requested: 400, original: 300, substitute: 100, authorizedSubstitute: 120 });
    const registration = register(value);
    const first = executeAccepted(registration.state, decision(registration.state, value.plan.id, 'client', 'B09-FIRST'));
    const duplicateOperation = executeOrchestrationAction(first.state, decision(first.state, value.plan.id, 'supplier', 'B09-SECOND', { operationId: 'OPERATION-B09-FIRST' }));
    expect(duplicateOperation).toMatchObject({ accepted: false, failure: { reason: 'DUPLICATE_OPERATION' } });
    expect(duplicateOperation.state).toBe(first.state);
    const duplicateApproval = executeOrchestrationAction(first.state, decision(first.state, value.plan.id, 'supplier', 'B09-THIRD', { approvalId: 'APPROVAL-B09-FIRST' }));
    expect(duplicateApproval).toMatchObject({ accepted: false, failure: { reason: 'APPROVAL_RECORDING_FAILED' } });
    expect(duplicateApproval.state).toBe(first.state);
    expect(first.state.approvals).toHaveLength(1); expect(first.state.operationHistory).toHaveLength(1); expect(first.state.events).toHaveLength(1);
    mark('B09');
  });

  it('B10 — authorization changes permission without automatic execution', () => {
    const value = fixture({ namespace: 'B10', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 100 });
    const registration = register(value);
    const supplyBefore = structuredClone(registration.state.exceptionCase.actors.find(({ role }) => role === 'supplier')?.constraints);
    const result = executeAccepted(registration.state, authorization(registration.state, 100, 160, 'B10-AUTH'));
    expect(result.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(result.state.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(160);
    expect(result.state.exceptionCase.actors.find(({ role }) => role === 'supplier')?.constraints).toEqual(supplyBefore);
    expect(result.state.plans).toEqual(registration.state.plans); expect(result.state.planLineages).toEqual(registration.state.planLineages);
    expect(result.state.approvals).toEqual([]); expect(result.state.plans[0]?.status).toBe('PENDING_APPROVAL');
    mark('B10');
  });

  it('B11 — a distinct one-version direct path needs no legacy sequence', () => {
    const value = fixture({ namespace: 'B11', requested: 360, original: 240, substitute: 120, authorizedSubstitute: 180, planCosts: [20, 20, 20] });
    const registration = register(value);
    const approvals = approveAll(registration.state, value.plan.id, ['client', 'production', 'supplier'], 'B11');
    expect(approvals.results.map(({ step }) => step.actionType)).toEqual(['APPLY_REVIEWED_DECISION', 'APPLY_REVIEWED_DECISION', 'APPLY_REVIEWED_DECISION']);
    expect(approvals.results[2]?.disposition).toEqual({ type: 'LINEAGE_RESOLVED', scope: { caseId: value.exceptionCase.id, lineageId: value.lineageId, planId: value.plan.id } });
    expect(approvals.state.plans).toHaveLength(1); expect(approvals.state.planLineages[0]?.planIds).toEqual([value.plan.id]);
    expect(approvals.state.events.some(({ result }) => result === 'REJECTION_RECORDED' || result === 'CASE_AUTHORIZATION_APPLIED')).toBe(false);
    mark('B11');
  });

  it('B12 — independently reproduces the frozen unseen composition', () => {
    const value = fixture({ namespace: 'B12', requested: 500, original: 350, substitute: 150, authorizedSubstitute: 100, supplies: [{ original: 350, substitute: 0 }, { original: 0, substitute: 200 }], planCosts: [0, 75, 0] });
    const snapshot = JSON.stringify(value);
    const registration = register(value);
    expect(registration).toMatchObject({ step: { assessment: { planAssessment: { outcome: 'PLAN_INVALID', validation: { violations: [expect.objectContaining({ ruleId: 'R-04' })] } }, physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' } } } });
    const premature = executeOrchestrationAction(registration.state, decision(registration.state, value.plan.id, 'supplier', 'B12-PREMATURE'));
    expect(premature).toMatchObject({ accepted: false, failure: { reason: 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW' } }); expect(premature.state).toBe(registration.state);
    const authorized = executeAccepted(registration.state, authorization(registration.state, 100, 160, 'B12-AUTH'));
    expect(authorized.disposition.type).toBe('AWAITING_EXTERNAL_ACTION'); expect(authorized.state.approvals).toEqual([]); expect(authorized.state.plans).toHaveLength(1);
    const successor = executeAccepted(authorized.state, { type: 'CREATE_SUCCESSOR', lineageId: value.lineageId, predecessorPlanId: value.plan.id, newPlanId: 'PLAN-B12-B' as PlanId, changes: { status: 'PENDING_APPROVAL', clientAdditionalCost: 25, supplierAbsorbedCost: 25, productionAbsorbedCost: 25 } });
    const delayed = executeOrchestrationAction(successor.state, decision(successor.state, value.plan.id, 'client', 'B12-DELAYED'));
    expect(delayed).toMatchObject({ accepted: false, failure: { reason: 'PLAN_SUPERSEDED' } }); expect(delayed.state).toBe(successor.state);
    const approvals = approveAll(successor.state, 'PLAN-B12-B', ['production', 'client', 'supplier'], 'B12-NEW');
    expect(approvals.results.slice(0, 2).map(({ disposition }) => disposition.type)).toEqual(['AWAITING_EXTERNAL_ACTION', 'AWAITING_EXTERNAL_ACTION']);
    expect(approvals.results[2]?.disposition).toEqual({ type: 'LINEAGE_RESOLVED', scope: { caseId: value.exceptionCase.id, lineageId: value.lineageId, planId: 'PLAN-B12-B' } });
    expect(approvals.state.plans.find(({ id }) => id === 'PLAN-B12-B')?.status).toBe('APPROVED');
    expect(approvals.state.approvals.every(({ planId }) => planId === 'PLAN-B12-B')).toBe(true);
    expect(approvals.state.exceptionCase.actors.find(({ role }) => role === 'supplier')?.constraints).toEqual(value.exceptionCase.actors.find(({ role }) => role === 'supplier')?.constraints);
    expect(JSON.stringify(value)).toBe(snapshot);
    mark('B12');
  });

  afterAll(() => {
    const all = Array.from({ length: 12 }, (_, index) => `B${String(index + 1).padStart(2, '0')}`);
    expect([...passed].sort()).toEqual(all);
    const metric = (ids: readonly string[]) => ids.filter((id) => passed.has(id)).length;
    expect(metric(['B01', 'B11'])).toBe(2); // Safe recoveries allowed; false safety blocks = 0.
    expect(metric(['B02', 'B03'])).toBe(2); // Unsafe approvals blocked.
    expect(metric(['B04', 'B05'])).toBe(2); // Uncertain/ambiguous held fail-closed.
    expect(metric(['B06', 'B07'])).toBe(2); // Stale/version violations blocked.
    expect(metric(['B08', 'B09'])).toBe(2); // Identity/replay violations blocked.
    expect(metric(['B10'])).toBe(1); // Automatic execution prevented.
    expect(metric(['B11'])).toBe(1); // Adaptive direct path completed (overlaps safe recovery).
    expect(metric(['B12'])).toBe(1); // Frozen unseen challenge (composition overlaps other safety properties).
  });
});

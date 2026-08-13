import { describe, expect, it } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../src/application/adaptiveOrchestrator.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase, Plan } from '../../src/domain/types.js';
import type { DecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';

const target = '2026-10-01T17:00:00-05:00';
const later = '2026-10-04T17:00:00-05:00';

const trustedCase = (includeLaterSupply = true): ExceptionCase => exceptionCaseSchema.parse({
  id: 'CASE-ADAPTIVE', status: 'CASE_CREATED', requestedQuantity: 400, targetDeliveryDate: target,
  actors: [
    {
      id: 'SUPPLIER-ADAPTIVE', role: 'supplier',
      constraints: [
        { type: 'SUPPLY', originalQuantity: 300, substituteQuantity: 0, deliveryDate: target, substituteUnitAdditionalCost: 0 },
        { type: 'SUPPLY', originalQuantity: 0, substituteQuantity: 200, deliveryDate: target, substituteUnitAdditionalCost: 0.5 },
        ...(includeLaterSupply ? [{ type: 'SUPPLY' as const, originalQuantity: 200, substituteQuantity: 0, deliveryDate: later, substituteUnitAdditionalCost: 0 }] : []),
      ],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 400, latestAcceptedDeliveryDate: later },
    },
    {
      id: 'PRODUCTION-ADAPTIVE', role: 'production',
      constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 300, deliveryDate: target, allowsOriginalAndSubstituteMix: true }],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 400, latestAcceptedDeliveryDate: later },
    },
    {
      id: 'CLIENT-ADAPTIVE', role: 'client',
      constraints: [{ type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 300, deliveryDate: target, allowsOriginalAndSubstituteMix: true }],
      authorization: { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 50, latestAcceptedDeliveryDate: later },
    },
  ],
});

const proposal = (changes: Partial<Plan> = {}): Plan => planSchema.parse({
  id: 'PLAN-ADAPTIVE-1', caseId: 'CASE-ADAPTIVE', status: 'PENDING_APPROVAL', version: 1,
  originalQuantityTomorrow: 250, substituteQuantityTomorrow: 50, originalQuantityLater: 100,
  laterDeliveryDate: later, clientAdditionalCost: 0, supplierAbsorbedCost: 25,
  productionAbsorbedCost: 0, ...changes,
});

const emptyState = (exceptionCase = trustedCase()): OrchestrationState => ({
  exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [],
});

const register = (
  state = emptyState(),
  plan: unknown = proposal(),
  lineageId = 'LINEAGE-ADAPTIVE',
) => executeOrchestrationAction(state, { type: 'REGISTER_PLAN_PROPOSAL', lineageId, plan });

const planDecision = (
  role: ActorRole,
  decision: 'APPROVED' | 'REJECTED',
  sequence: number,
  planId = 'PLAN-ADAPTIVE-1',
  approvalId = `APPROVAL-${sequence}`,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actorId = `${role.toUpperCase()}-ADAPTIVE`;
  const bridgeResult: DecisionBridgeResult = {
    ready: true,
    proposal: {
      operationType: 'PLAN_DECISION', requestId: `REQUEST-${sequence}`, caseId: 'CASE-ADAPTIVE',
      planId, actorId, actorRole: role, decision, summary: `${role} ${decision}`,
      proposedAuthorizationChanges: [], evidence: ['Reviewed external decision'],
      completionConfidence: { score: 1, label: 'high' },
      receivedAt: `2026-09-${String(sequence).padStart(2, '0')}T12:00:00Z`,
      requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED',
    },
  };
  return {
    type: 'APPLY_REVIEWED_DECISION', bridgeResult,
    review: {
      action: 'APPLY', operationId: `OPERATION-${sequence}`, reviewedBy: 'REVIEWER-ADAPTIVE',
      reviewedAt: `2026-09-${String(sequence).padStart(2, '0')}T13:00:00Z`,
      eventId: `EVENT-${sequence}`, approvalId, authorizationReviews: [],
    },
  };
};

const authorizationDecision = (): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => ({
  type: 'APPLY_REVIEWED_DECISION',
  bridgeResult: {
    ready: true,
    proposal: {
      operationType: 'CASE_AUTHORIZATION', requestId: 'REQUEST-AUTHORIZATION', caseId: 'CASE-ADAPTIVE',
      actorId: 'CLIENT-ADAPTIVE', actorRole: 'client', decision: 'APPROVED', summary: 'Raise permission',
      proposedAuthorizationChanges: [{
        field: 'maxSubstituteQuantity', currentInternalValue: 50, proposedNewValue: 100,
        requiresReview: true,
      }],
      evidence: ['Client reviewed the permission'],
      completionConfidence: { score: 1, label: 'high' },
      receivedAt: '2026-09-20T12:00:00Z', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED',
    },
  },
  review: {
    action: 'APPLY', operationId: 'OPERATION-AUTHORIZATION', reviewedBy: 'REVIEWER-ADAPTIVE',
    reviewedAt: '2026-09-20T13:00:00Z', eventId: 'EVENT-AUTHORIZATION',
    authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
  },
});

const registeredState = (): OrchestrationState => {
  const result = register();
  if (!result.accepted) throw new Error(result.failure.reason);
  return result.state;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

describe('executeOrchestrationAction', () => {
  it('delegates valid registration and returns waiting without persisting assessments', () => {
    const result = register();
    expect(result).toMatchObject({
      accepted: true,
      disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: {
        actionType: 'REGISTER_PLAN_PROPOSAL', result: 'PLAN_PROPOSAL_REGISTERED',
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
        },
      },
    });
    if (!result.accepted) return;
    expect(result.state.plans[0]).not.toHaveProperty('assessment');
    expect(result.state.planLineages[0]).not.toHaveProperty('assessment');
    expect(result.state.approvals).toEqual([]);
    expect(result.state.events).toEqual([]);
  });

  it('registers invalid, infeasible, and unproven proposals as assessment metadata', () => {
    const invalid = register(emptyState(), proposal({ substituteQuantityTomorrow: 100, originalQuantityTomorrow: 200, supplierAbsorbedCost: 50 }), 'LINEAGE-INVALID');
    const infeasible = register(emptyState(), proposal({ id: 'PLAN-INFEASIBLE' as Plan['id'], originalQuantityTomorrow: 350, originalQuantityLater: 0 }), 'LINEAGE-INFEASIBLE');
    const unproven = register(emptyState(trustedCase(false)), proposal({ id: 'PLAN-UNPROVEN' as Plan['id'] }), 'LINEAGE-UNPROVEN');
    expect(invalid).toMatchObject({ accepted: true, step: { assessment: { planAssessment: { outcome: 'PLAN_INVALID' } } } });
    expect(infeasible).toMatchObject({ accepted: true, step: { assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_INFEASIBLE' } } } });
    expect(unproven).toMatchObject({ accepted: true, step: { assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN' } } } });
  });

  it('returns the exact original state after failed registration', () => {
    const state = emptyState();
    const result = register(state, { malformed: true });
    expect(result).toMatchObject({ accepted: false, failure: { source: 'PLAN_REGISTRATION', reason: 'PLAN_SCHEMA_INVALID' } });
    expect(result.state).toBe(state);
  });

  it('creates only the explicit successor and preserves historical approvals', () => {
    const initial = registeredState();
    const approvedOnce = executeOrchestrationAction(initial, planDecision('client', 'APPROVED', 1));
    expect(approvedOnce.accepted).toBe(true);
    if (!approvedOnce.accepted) return;
    const result = executeOrchestrationAction(approvedOnce.state, {
      type: 'CREATE_SUCCESSOR', lineageId: 'LINEAGE-ADAPTIVE', predecessorPlanId: proposal().id,
      newPlanId: 'PLAN-ADAPTIVE-2' as Plan['id'], changes: { status: 'PENDING_APPROVAL' },
    });
    expect(result).toMatchObject({
      accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: { result: 'SUCCESSOR_CREATED', affectedPlanId: 'PLAN-ADAPTIVE-2' },
    });
    if (!result.accepted) return;
    expect(result.state.plans).toHaveLength(2);
    expect(result.state.plans[0]?.status).toBe('INVALIDATED');
    expect(result.state.approvals).toBe(approvedOnce.state.approvals);
    expect(result.state.approvals).toHaveLength(1);
    expect(result.state.approvals[0]?.planId).toBe('PLAN-ADAPTIVE-1');
  });

  it('rejects a second successor from the superseded predecessor atomically', () => {
    const state = registeredState();
    const first = executeOrchestrationAction(state, {
      type: 'CREATE_SUCCESSOR', lineageId: 'LINEAGE-ADAPTIVE', predecessorPlanId: proposal().id,
      newPlanId: 'PLAN-ADAPTIVE-2' as Plan['id'], changes: {},
    });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const second = executeOrchestrationAction(first.state, {
      type: 'CREATE_SUCCESSOR', lineageId: 'LINEAGE-ADAPTIVE', predecessorPlanId: proposal().id,
      newPlanId: 'PLAN-ADAPTIVE-3' as Plan['id'], changes: {},
    });
    expect(second).toMatchObject({ accepted: false, failure: { source: 'PLAN_LINEAGE', reason: 'PLAN_SUPERSEDED' } });
    expect(second.state).toBe(first.state);
  });

  it('applies an explicit rejection, then waits without creating a successor', () => {
    const state = registeredState();
    const result = executeOrchestrationAction(state, planDecision('production', 'REJECTED', 2));
    expect(result).toMatchObject({
      accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: { applicationResolutionStatus: 'PLAN_REJECTED', applicationEventIds: ['EVENT-2'] },
    });
    if (!result.accepted) return;
    expect(result.state.plans).toHaveLength(1);
    expect(result.state.plans[0]?.status).toBe('REJECTED');
    expect(result.state.planLineages[0]?.planIds).toEqual(['PLAN-ADAPTIVE-1']);
  });

  it('applies CASE_AUTHORIZATION independently and neither creates plans nor supply', () => {
    const state = emptyState();
    const constraintsBefore = state.exceptionCase.actors.map(({ constraints }) => constraints);
    const result = executeOrchestrationAction(state, authorizationDecision());
    expect(result).toMatchObject({
      accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: { applicationResolutionStatus: 'CASE_AUTHORIZATION_APPLIED', applicationEventIds: ['EVENT-AUTHORIZATION'] },
    });
    if (!result.accepted) return;
    expect(result.state.plans).toBe(state.plans);
    expect(result.state.planLineages).toBe(state.planLineages);
    expect(result.state.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(100);
    expect(result.state.exceptionCase.actors.map(({ constraints }) => constraints)).toEqual(constraintsBefore);
  });

  it('accepts approvals in a non-CASE-001 order and resolves only on the causal final decision', () => {
    const state = registeredState();
    const client = executeOrchestrationAction(state, planDecision('client', 'APPROVED', 3));
    expect(client).toMatchObject({ accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' } });
    if (!client.accepted) return;
    const supplier = executeOrchestrationAction(client.state, planDecision('supplier', 'APPROVED', 4));
    expect(supplier).toMatchObject({ accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' } });
    if (!supplier.accepted) return;
    const production = executeOrchestrationAction(supplier.state, planDecision('production', 'APPROVED', 5));
    expect(production).toMatchObject({
      accepted: true,
      disposition: {
        type: 'LINEAGE_RESOLVED',
        scope: { caseId: 'CASE-ADAPTIVE', lineageId: 'LINEAGE-ADAPTIVE', planId: 'PLAN-ADAPTIVE-1' },
      },
      step: { applicationResolutionStatus: 'PLAN_APPROVED', applicationEventIds: ['EVENT-5'] },
    });
    if (!production.accepted) return;
    expect(production.state.plans[0]?.status).toBe('APPROVED');
    expect(production.state.approvals.map(({ actorRole }) => actorRole)).toEqual(['client', 'supplier', 'production']);
    expect(production).not.toHaveProperty('resolved');
  });

  it('never derives resolution while registering or creating a successor beside an approved lineage', () => {
    let state = registeredState();
    for (const [role, sequence] of [['client', 6], ['supplier', 7], ['production', 8]] as const) {
      const result = executeOrchestrationAction(state, planDecision(role, 'APPROVED', sequence));
      expect(result.accepted).toBe(true);
      if (!result.accepted) return;
      state = result.state;
    }
    const second = register(state, proposal({ id: 'PLAN-OTHER-1' as Plan['id'] }), 'LINEAGE-OTHER');
    expect(second).toMatchObject({ accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' } });
  });

  it('preserves the original state for superseded, infeasible, and invalid approvals', () => {
    const initial = registeredState();
    const successor = executeOrchestrationAction(initial, {
      type: 'CREATE_SUCCESSOR', lineageId: 'LINEAGE-ADAPTIVE', predecessorPlanId: proposal().id,
      newPlanId: 'PLAN-ADAPTIVE-2' as Plan['id'], changes: {},
    });
    expect(successor.accepted).toBe(true);
    if (!successor.accepted) return;
    const superseded = executeOrchestrationAction(successor.state, planDecision('client', 'APPROVED', 9));
    expect(superseded).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_SUPERSEDED' } });
    expect(superseded.state).toBe(successor.state);

    const infeasibleRegistration = register(emptyState(), proposal({ originalQuantityTomorrow: 350, originalQuantityLater: 0 }), 'LINEAGE-INFEASIBLE');
    expect(infeasibleRegistration.accepted).toBe(true);
    if (!infeasibleRegistration.accepted) return;
    const infeasible = executeOrchestrationAction(infeasibleRegistration.state, planDecision('client', 'APPROVED', 10));
    expect(infeasible).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_PHYSICALLY_INFEASIBLE' } });
    expect(infeasible.state).toBe(infeasibleRegistration.state);

    const invalidRegistration = register(emptyState(), proposal({ substituteQuantityTomorrow: 100, originalQuantityTomorrow: 200, supplierAbsorbedCost: 50 }), 'LINEAGE-INVALID');
    expect(invalidRegistration.accepted).toBe(true);
    if (!invalidRegistration.accepted) return;
    const invalid = executeOrchestrationAction(invalidRegistration.state, planDecision('client', 'APPROVED', 11));
    expect(invalid).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW' } });
    expect(invalid.state).toBe(invalidRegistration.state);

    const unprovenRegistration = register(emptyState(trustedCase(false)), proposal(), 'LINEAGE-UNPROVEN');
    expect(unprovenRegistration.accepted).toBe(true);
    if (!unprovenRegistration.accepted) return;
    const unproven = executeOrchestrationAction(unprovenRegistration.state, planDecision('client', 'APPROVED', 16));
    expect(unproven).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PHYSICAL_FEASIBILITY_UNPROVEN' } });
    expect(unproven.state).toBe(unprovenRegistration.state);
  });

  it('fails closed on ambiguous lineage state instead of selecting a lineage', () => {
    const state = registeredState();
    const ambiguous: OrchestrationState = {
      ...state,
      planLineages: [
        ...state.planLineages,
        { lineageId: 'LINEAGE-SECOND-CLAIM', caseId: state.exceptionCase.id, planIds: [state.plans[0]!.id] },
      ],
    };
    const result = executeOrchestrationAction(ambiguous, planDecision('client', 'APPROVED', 17));
    expect(result).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_LINEAGE_AMBIGUOUS' } });
    expect(result.state).toBe(ambiguous);
  });

  it('preserves Decision Application operation and approval identity protection', () => {
    const state = registeredState();
    const first = executeOrchestrationAction(state, planDecision('client', 'APPROVED', 12, undefined, 'APPROVAL-SHARED'));
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    const repeatedOperation = planDecision('supplier', 'APPROVED', 15);
    if (repeatedOperation.review.action !== 'APPLY') return;
    const duplicateOperation = executeOrchestrationAction(first.state, {
      ...repeatedOperation,
      review: { ...repeatedOperation.review, operationId: 'OPERATION-12' },
    });
    expect(duplicateOperation).toMatchObject({ accepted: false, failure: { reason: 'DUPLICATE_OPERATION' } });
    expect(duplicateOperation.state).toBe(first.state);
    const duplicateApproval = executeOrchestrationAction(first.state, planDecision('supplier', 'APPROVED', 13, undefined, 'APPROVAL-SHARED'));
    expect(duplicateApproval).toMatchObject({ accepted: false, failure: { reason: 'APPROVAL_RECORDING_FAILED' } });
    expect(duplicateApproval.state).toBe(first.state);
  });

  it('appends only authoritative events with their exact identities and contents', () => {
    const state = registeredState();
    const result = executeOrchestrationAction(state, planDecision('client', 'APPROVED', 14));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.state.events).toHaveLength(1);
    expect(result.state.events[0]).toMatchObject({
      eventId: 'EVENT-14', operationId: 'OPERATION-14', requestId: 'REQUEST-14',
      result: 'APPROVAL_RECORDED', planId: 'PLAN-ADAPTIVE-1',
    });
    expect(result.step).toMatchObject({ applicationEventIds: ['EVENT-14'] });
  });

  it('is deterministic and leaves frozen inputs and explicit actions unchanged', () => {
    const state = deepFreeze(emptyState());
    const action = deepFreeze<OrchestrationAction>({
      type: 'REGISTER_PLAN_PROPOSAL', lineageId: 'LINEAGE-EXPLICIT', plan: proposal(),
    });
    const before = JSON.stringify({ state, action });
    const first = executeOrchestrationAction(state, action);
    const second = executeOrchestrationAction(state, action);
    expect(second).toEqual(first);
    expect(JSON.stringify({ state, action })).toBe(before);
    expect(first).toMatchObject({
      accepted: true,
      step: { affectedPlanId: 'PLAN-ADAPTIVE-1', lineageId: 'LINEAGE-EXPLICIT' },
    });
    expect(first).not.toHaveProperty('nextAction');
    expect(first).not.toHaveProperty('recommendedAction');
  });

  it('rejects an unsupported runtime action without changing state', () => {
    const state = emptyState();
    const result = executeOrchestrationAction(state, { type: 'AUTO_APPROVE' } as unknown as OrchestrationAction);
    expect(result).toMatchObject({ accepted: false, failure: { source: 'STATE', reason: 'ACTION_TYPE_UNSUPPORTED' } });
    expect(result.state).toBe(state);
    const malformed = executeOrchestrationAction(state, {
      type: 'APPLY_REVIEWED_DECISION',
    } as unknown as OrchestrationAction);
    expect(malformed).toMatchObject({ accepted: false, failure: { source: 'STATE', reason: 'ACTION_NOT_ADMISSIBLE' } });
    expect(malformed.state).toBe(state);
  });
});

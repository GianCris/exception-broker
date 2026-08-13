import { describe, expect, it } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../src/application/adaptiveOrchestrator.js';
import { validatePlanDecisionFreshness } from '../../src/domain/planLineage.js';
import { assessPhysicalFeasibility } from '../../src/domain/physicalFeasibility.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase, Plan } from '../../src/domain/types.js';
import { validatePlan } from '../../src/domain/validator.js';
import type { DecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';

const TARGET = '2027-06-10T17:00:00-05:00';
const LATEST = '2027-06-12T17:00:00-05:00';

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

type FrozenChallenge = Readonly<{
  exceptionCase: ExceptionCase;
  planA: Plan;
  lineageId: string;
  successorId: Plan['id'];
  successorChanges: Readonly<{
    status: 'PENDING_APPROVAL';
    clientAdditionalCost: number;
    supplierAbsorbedCost: number;
    productionAbsorbedCost: number;
  }>;
}>;

// Frozen before the first orchestration action. The cost total is always
// 150 substitutes × 0.5 additional cost = 75.
const frozenChallenge = (): FrozenChallenge => deepFreeze({
  exceptionCase: exceptionCaseSchema.parse({
    id: 'CASE-005',
    status: 'CASE_CREATED',
    requestedQuantity: 500,
    targetDeliveryDate: TARGET,
    actors: [
      {
        id: 'SUPPLIER-005',
        role: 'supplier',
        constraints: [
          {
            type: 'SUPPLY', originalQuantity: 350, substituteQuantity: 0,
            deliveryDate: TARGET, substituteUnitAdditionalCost: 0,
          },
          {
            type: 'SUPPLY', originalQuantity: 0, substituteQuantity: 200,
            deliveryDate: TARGET, substituteUnitAdditionalCost: 0.5,
          },
        ],
        authorization: {
          maxAbsorbableAdditionalCost: 100,
          maxSubstituteQuantity: 500,
          latestAcceptedDeliveryDate: LATEST,
        },
      },
      {
        id: 'PRODUCTION-005',
        role: 'production',
        constraints: [{
          type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 500,
          deliveryDate: TARGET, allowsOriginalAndSubstituteMix: true,
        }],
        authorization: {
          maxAbsorbableAdditionalCost: 100,
          maxSubstituteQuantity: 500,
          latestAcceptedDeliveryDate: LATEST,
        },
      },
      {
        id: 'CLIENT-005',
        role: 'client',
        constraints: [{
          type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 500,
          deliveryDate: TARGET, allowsOriginalAndSubstituteMix: true,
        }],
        authorization: {
          maxAbsorbableAdditionalCost: 100,
          maxSubstituteQuantity: 100,
          latestAcceptedDeliveryDate: LATEST,
        },
      },
    ],
  }),
  planA: planSchema.parse({
    id: 'PLAN-005-A',
    caseId: 'CASE-005',
    status: 'PENDING_APPROVAL',
    version: 1,
    originalQuantityTomorrow: 350,
    substituteQuantityTomorrow: 150,
    originalQuantityLater: 0,
    laterDeliveryDate: LATEST,
    clientAdditionalCost: 0,
    supplierAbsorbedCost: 75,
    productionAbsorbedCost: 0,
  }),
  lineageId: 'LINEAGE-005',
  successorId: planSchema.parse({
    id: 'PLAN-005-B', caseId: 'CASE-005', status: 'PENDING_APPROVAL', version: 2,
    originalQuantityTomorrow: 350, substituteQuantityTomorrow: 150, originalQuantityLater: 0,
    laterDeliveryDate: LATEST, clientAdditionalCost: 25, supplierAbsorbedCost: 25,
    productionAbsorbedCost: 25,
  }).id,
  successorChanges: {
    status: 'PENDING_APPROVAL',
    clientAdditionalCost: 25,
    supplierAbsorbedCost: 25,
    productionAbsorbedCost: 25,
  },
});

const stateFor = (fixture: FrozenChallenge): OrchestrationState => ({
  exceptionCase: fixture.exceptionCase,
  plans: [],
  planLineages: [],
  approvals: [],
  operationHistory: [],
  events: [],
});

const actorFor = (state: OrchestrationState, role: ActorRole) => {
  const actor = state.exceptionCase.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`Missing frozen actor: ${role}`);
  return actor;
};

const approvalAction = (
  state: OrchestrationState,
  planId: string,
  role: ActorRole,
  token: string,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = actorFor(state, role);
  const bridgeResult: DecisionBridgeResult = {
    ready: true,
    proposal: {
      operationType: 'PLAN_DECISION',
      requestId: `REQUEST-${token}`,
      caseId: state.exceptionCase.id,
      planId,
      actorId: actor.id,
      actorRole: actor.role,
      decision: 'APPROVED',
      summary: 'Explicit frozen challenge approval',
      proposedAuthorizationChanges: [],
      evidence: ['Explicit reviewed decision'],
      completionConfidence: { score: 1, label: 'high' },
      receivedAt: '2027-06-01T12:00:00Z',
      requiresReview: true,
      reviewState: 'DECISION_REVIEW_REQUIRED',
    },
  };
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult,
    review: {
      action: 'APPLY',
      operationId: `OPERATION-${token}`,
      reviewedBy: 'REVIEWER-005',
      reviewedAt: '2027-06-01T13:00:00Z',
      eventId: `EVENT-${token}`,
      approvalId: `APPROVAL-${token}`,
      authorizationReviews: [],
    },
  };
};

const authorizationAction = (
  state: OrchestrationState,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const client = actorFor(state, 'client');
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult: {
      ready: true,
      proposal: {
        operationType: 'CASE_AUTHORIZATION',
        requestId: 'REQUEST-AUTHORIZATION-005',
        caseId: state.exceptionCase.id,
        actorId: client.id,
        actorRole: client.role,
        decision: 'APPROVED',
        summary: 'Explicitly authorize up to 160 substitute units',
        proposedAuthorizationChanges: [{
          field: 'maxSubstituteQuantity',
          currentInternalValue: 100,
          proposedNewValue: 160,
          requiresReview: true,
        }],
        evidence: ['Explicit client authorization'],
        completionConfidence: { score: 1, label: 'high' },
        receivedAt: '2027-06-01T14:00:00Z',
        requiresReview: true,
        reviewState: 'DECISION_REVIEW_REQUIRED',
      },
    },
    review: {
      action: 'APPLY',
      operationId: 'OPERATION-AUTHORIZATION-005',
      reviewedBy: 'REVIEWER-005',
      reviewedAt: '2027-06-01T15:00:00Z',
      eventId: 'EVENT-AUTHORIZATION-005',
      authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
    },
  };
};

const accepted = (
  state: OrchestrationState,
  action: OrchestrationAction,
): Extract<ReturnType<typeof executeOrchestrationAction>, { accepted: true }> => {
  const result = executeOrchestrationAction(state, action);
  if (!result.accepted) throw new Error(`${result.failure.source}: ${result.failure.reason}`);
  return result;
};

describe('Generalization MVP Block 5 frozen unseen challenge', () => {
  it('executes CASE-005 safely through the unchanged generalized public executor', () => {
    const fixture = frozenChallenge();
    const frozenSnapshot = JSON.stringify(fixture);

    // Pre-freeze representability evidence: schema parsing above succeeded and
    // both cost distributions total exactly 75 within every actor limit.
    expect(fixture.planA.clientAdditionalCost + fixture.planA.supplierAbsorbedCost + fixture.planA.productionAbsorbedCost).toBe(75);
    expect(Object.values(fixture.successorChanges).filter((value): value is number => typeof value === 'number')
      .reduce((sum, value) => sum + value, 0)).toBe(75);

    const registration = accepted(stateFor(fixture), {
      type: 'REGISTER_PLAN_PROPOSAL',
      lineageId: fixture.lineageId,
      plan: fixture.planA,
    });
    expect(registration).toMatchObject({
      disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: {
        assessment: {
          planAssessment: {
            outcome: 'PLAN_INVALID',
            validation: { violations: [expect.objectContaining({ ruleId: 'R-04', expected: 100, actual: 150 })] },
          },
          physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
        },
      },
    });
    expect(registration.state.approvals).toEqual([]);
    expect(registration.state.plans).toHaveLength(1);
    expect(actorFor(registration.state, 'client').authorization.maxSubstituteQuantity).toBe(100);

    const premature = executeOrchestrationAction(
      registration.state,
      approvalAction(registration.state, fixture.planA.id, 'supplier', 'PREMATURE-005'),
    );
    expect(premature).toMatchObject({
      accepted: false,
      failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW' },
    });
    expect(premature.state).toBe(registration.state);
    expect(registration.state.approvals).toEqual([]);
    expect(registration.state.operationHistory).toEqual([]);
    expect(registration.state.events).toEqual([]);
    expect(registration.state.plans[0]?.status).toBe('PENDING_APPROVAL');

    const supplyBefore = structuredClone(actorFor(registration.state, 'supplier').constraints);
    const authorization = accepted(registration.state, authorizationAction(registration.state));
    expect(authorization.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(actorFor(authorization.state, 'client').authorization.maxSubstituteQuantity).toBe(160);
    expect(actorFor(authorization.state, 'supplier').constraints).toEqual(supplyBefore);
    expect(authorization.state.plans).toEqual(registration.state.plans);
    expect(authorization.state.planLineages).toEqual(registration.state.planLineages);
    expect(authorization.state.approvals).toEqual([]);
    expect(authorization.state.plans[0]?.status).toBe('PENDING_APPROVAL');

    const successor = accepted(authorization.state, {
      type: 'CREATE_SUCCESSOR',
      lineageId: fixture.lineageId,
      predecessorPlanId: fixture.planA.id,
      newPlanId: fixture.successorId,
      changes: fixture.successorChanges,
    });
    expect(successor.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(successor.state.planLineages[0]?.planIds).toEqual(['PLAN-005-A', 'PLAN-005-B']);
    expect(successor.state.plans.find(({ id }) => id === 'PLAN-005-A')).toMatchObject({ version: 1, status: 'INVALIDATED' });
    expect(successor.state.plans.find(({ id }) => id === 'PLAN-005-B')).toMatchObject({
      version: 2,
      status: 'PENDING_APPROVAL',
      substituteQuantityTomorrow: 150,
      clientAdditionalCost: 25,
      supplierAbsorbedCost: 25,
      productionAbsorbedCost: 25,
    });
    expect(successor.state.approvals).toEqual([]);
    expect(actorFor(successor.state, 'client').authorization.maxSubstituteQuantity).toBe(160);
    expect(actorFor(successor.state, 'supplier').constraints).toEqual(supplyBefore);

    const delayed = executeOrchestrationAction(
      successor.state,
      approvalAction(successor.state, fixture.planA.id, 'client', 'DELAYED-005'),
    );
    expect(delayed).toMatchObject({
      accepted: false,
      failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_SUPERSEDED' },
    });
    expect(delayed.state).toBe(successor.state);

    const planB = successor.state.plans.find(({ id }) => id === fixture.successorId);
    if (planB === undefined) throw new Error('Frozen successor was not created');
    expect(validatePlan(successor.state.exceptionCase, planB)).toEqual({ valid: true, violations: [] });
    expect(assessPhysicalFeasibility(successor.state.exceptionCase, planB)).toMatchObject({ outcome: 'PHYSICALLY_FEASIBLE' });
    expect(validatePlanDecisionFreshness(
      successor.state.planLineages,
      successor.state.plans,
      successor.state.exceptionCase.id,
      planB.id,
    )).toMatchObject({ valid: true, plan: { id: 'PLAN-005-B' }, lineage: { lineageId: 'LINEAGE-005' } });

    const production = accepted(successor.state, approvalAction(successor.state, planB.id, 'production', 'B-PRODUCTION'));
    expect(production.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const client = accepted(production.state, approvalAction(production.state, planB.id, 'client', 'B-CLIENT'));
    expect(client.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const supplier = accepted(client.state, approvalAction(client.state, planB.id, 'supplier', 'B-SUPPLIER'));
    expect(supplier.disposition).toEqual({
      type: 'LINEAGE_RESOLVED',
      scope: { caseId: 'CASE-005', lineageId: 'LINEAGE-005', planId: 'PLAN-005-B' },
    });
    expect(supplier.state.plans.find(({ id }) => id === planB.id)?.status).toBe('APPROVED');
    expect(supplier.state.approvals.map(({ actorRole, planId }) => ({ actorRole, planId }))).toEqual([
      { actorRole: 'production', planId: 'PLAN-005-B' },
      { actorRole: 'client', planId: 'PLAN-005-B' },
      { actorRole: 'supplier', planId: 'PLAN-005-B' },
    ]);
    expect(supplier.state.approvals.some(({ planId }) => planId === 'PLAN-005-A')).toBe(false);
    expect(supplier.state.operationHistory.map(({ operationId }) => operationId)).toEqual([
      'OPERATION-AUTHORIZATION-005',
      'OPERATION-B-PRODUCTION',
      'OPERATION-B-CLIENT',
      'OPERATION-B-SUPPLIER',
    ]);
    expect(supplier.state.events.map(({ result }) => result)).toEqual([
      'CASE_AUTHORIZATION_APPLIED',
      'APPROVAL_RECORDED',
      'APPROVAL_RECORDED',
      'PLAN_APPROVED',
    ]);
    expect(supplier).not.toHaveProperty('noSolutionAssessment');
    expect(JSON.stringify(fixture)).toBe(frozenSnapshot);
  });

  it('is deterministic with independently frozen copies of the unseen fixture', () => {
    const firstFixture = frozenChallenge();
    const secondFixture = frozenChallenge();
    const first = executeOrchestrationAction(stateFor(firstFixture), {
      type: 'REGISTER_PLAN_PROPOSAL', lineageId: firstFixture.lineageId, plan: firstFixture.planA,
    });
    const second = executeOrchestrationAction(stateFor(secondFixture), {
      type: 'REGISTER_PLAN_PROPOSAL', lineageId: secondFixture.lineageId, plan: secondFixture.planA,
    });
    expect(second).toEqual(first);
    expect(firstFixture).toEqual(secondFixture);
    expect(firstFixture).not.toBe(secondFixture);
  });
});

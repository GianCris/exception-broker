import { describe, expect, it } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../src/application/adaptiveOrchestrator.js';
import { assessNoSolution } from '../../src/domain/outcomes.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase, Plan, PlanId } from '../../src/domain/types.js';
import { createReadyDecisionBridgeResult, type DecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../../src/integrations/calle/decisionApplication.js';

const target = '2027-03-01T17:00:00-05:00';
const later = '2027-03-04T17:00:00-05:00';

type Supply = Readonly<{ original?: number; substitute?: number }>;

const challengeCase = (
  namespace: string,
  requestedQuantity: number,
  supply: Supply,
  authorizedSubstitute: number,
): ExceptionCase => exceptionCaseSchema.parse({
  id: `CASE-${namespace}`,
  status: 'CASE_CREATED',
  requestedQuantity,
  targetDeliveryDate: target,
  actors: [
    {
      id: `SUPPLIER-${namespace}`,
      role: 'supplier',
      constraints: [
        ...(supply.original === undefined ? [] : [{
          type: 'SUPPLY' as const,
          originalQuantity: supply.original,
          substituteQuantity: 0,
          deliveryDate: target,
          substituteUnitAdditionalCost: 0,
        }]),
        ...(supply.substitute === undefined ? [] : [{
          type: 'SUPPLY' as const,
          originalQuantity: 0,
          substituteQuantity: supply.substitute,
          deliveryDate: target,
          substituteUnitAdditionalCost: 0.5,
        }]),
      ],
      authorization: {
        maxAbsorbableAdditionalCost: 500,
        maxSubstituteQuantity: requestedQuantity,
        latestAcceptedDeliveryDate: later,
      },
    },
    {
      id: `PRODUCTION-${namespace}`,
      role: 'production',
      constraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: requestedQuantity,
        deliveryDate: target,
        allowsOriginalAndSubstituteMix: true,
      }],
      authorization: {
        maxAbsorbableAdditionalCost: 500,
        maxSubstituteQuantity: requestedQuantity,
        latestAcceptedDeliveryDate: later,
      },
    },
    {
      id: `CLIENT-${namespace}`,
      role: 'client',
      constraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: requestedQuantity,
        deliveryDate: target,
        allowsOriginalAndSubstituteMix: true,
      }],
      authorization: {
        maxAbsorbableAdditionalCost: 500,
        maxSubstituteQuantity: authorizedSubstitute,
        latestAcceptedDeliveryDate: later,
      },
    },
  ],
});

const proposedPlan = (
  namespace: string,
  original: number,
  substitute: number,
  changes: Partial<Plan> = {},
): Plan => planSchema.parse({
  id: `PROPOSAL-${namespace}`,
  caseId: `CASE-${namespace}`,
  status: 'PENDING_APPROVAL',
  version: 1,
  originalQuantityTomorrow: original,
  substituteQuantityTomorrow: substitute,
  originalQuantityLater: 0,
  laterDeliveryDate: later,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: substitute * 0.5,
  productionAbsorbedCost: 0,
  ...changes,
});

const initialState = (exceptionCase: ExceptionCase): OrchestrationState => ({
  exceptionCase,
  plans: [],
  planLineages: [],
  approvals: [],
  operationHistory: [],
  events: [],
});

const registerAction = (
  lineageId: string,
  plan: Plan,
): OrchestrationAction => ({ type: 'REGISTER_PLAN_PROPOSAL', lineageId, plan });

const decisionAction = (
  state: OrchestrationState,
  planId: string,
  role: ActorRole,
  decision: 'APPROVED' | 'REJECTED',
  token: string,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = state.exceptionCase.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`Missing ${role}`);
  const bridgeResult: DecisionBridgeResult = createReadyDecisionBridgeResult({
      operationType: 'PLAN_DECISION',
      requestId: `REQUEST-${token}`,
      caseId: state.exceptionCase.id,
      planId,
      actorId: actor.id,
      actorRole: role,
      decision,
      summary: `Reviewed ${decision}`,
      proposedAuthorizationChanges: [],
      evidence: ['Explicit reviewed decision'],
      completionConfidence: { score: 1, label: 'high' },
      receivedAt: '2027-02-01T12:00:00Z',
      requiresReview: true,
      reviewState: 'DECISION_REVIEW_REQUIRED',
    });
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult,
    review: bindReviewCommand({
      action: 'APPLY',
      operationId: `OPERATION-${token}`,
      reviewedBy: 'REVIEWER-GENERAL',
      reviewedAt: '2027-02-01T13:00:00Z',
      eventId: `EVENT-${token}`,
      approvalId: `APPROVAL-${token}`,
      authorizationReviews: [],
    }, bridgeResult.reviewTarget),
  };
};

const register = (
  state: OrchestrationState,
  lineageId: string,
  plan: Plan,
): Extract<ReturnType<typeof executeOrchestrationAction>, { accepted: true }> => {
  const result = executeOrchestrationAction(state, registerAction(lineageId, plan));
  if (!result.accepted) throw new Error(`${result.failure.source}: ${result.failure.reason}`);
  return result;
};

const apply = (
  state: OrchestrationState,
  action: OrchestrationAction,
): Extract<ReturnType<typeof executeOrchestrationAction>, { accepted: true }> => {
  const result = executeOrchestrationAction(state, action);
  if (!result.accepted) throw new Error(`${result.failure.source}: ${result.failure.reason}`);
  return result;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

describe('adaptive orchestrator generalization challenges', () => {
  it('Challenge A: resolves a direct valid recovery without rejection, authorization, no-solution, or successor', () => {
    const exceptionCase = challengeCase('DIRECT', 500, { original: 350, substitute: 150 }, 200);
    const authorizationBefore = structuredClone(exceptionCase.actors.map(({ authorization }) => authorization));
    const registration = register(
      initialState(exceptionCase),
      'LINEAGE-DIRECT',
      proposedPlan('DIRECT', 350, 150),
    );
    expect(registration).toMatchObject({
      disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: {
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
        },
      },
    });

    const client = apply(registration.state, decisionAction(registration.state, 'PROPOSAL-DIRECT', 'client', 'APPROVED', 'DIRECT-CLIENT'));
    expect(client.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const supplier = apply(client.state, decisionAction(client.state, 'PROPOSAL-DIRECT', 'supplier', 'APPROVED', 'DIRECT-SUPPLIER'));
    expect(supplier.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const production = apply(supplier.state, decisionAction(supplier.state, 'PROPOSAL-DIRECT', 'production', 'APPROVED', 'DIRECT-PRODUCTION'));

    expect(production.disposition).toEqual({
      type: 'LINEAGE_RESOLVED',
      scope: { caseId: 'CASE-DIRECT', lineageId: 'LINEAGE-DIRECT', planId: 'PROPOSAL-DIRECT' },
    });
    expect(production.state.approvals).toHaveLength(3);
    expect(production.state.approvals.every(({ planId }) => planId === 'PROPOSAL-DIRECT')).toBe(true);
    expect(production.state.approvals.map(({ actorRole }) => actorRole)).toEqual(['client', 'supplier', 'production']);
    expect(production.state.exceptionCase.actors.map(({ authorization }) => authorization)).toEqual(authorizationBefore);
    expect(production.state.plans).toHaveLength(1);
    expect(production.state.planLineages[0]?.planIds).toEqual(['PROPOSAL-DIRECT']);
    expect(production.state.events.map(({ result }) => result)).toEqual([
      'APPROVAL_RECORDED', 'APPROVAL_RECORDED', 'PLAN_APPROVED',
    ]);
  });

  it('Challenge B: preserves rejection history and requires an explicit successor with fresh approvals', () => {
    const exceptionCase = challengeCase('REVISION', 500, { original: 350, substitute: 150 }, 200);
    const registration = register(
      initialState(exceptionCase),
      'LINEAGE-REVISION',
      proposedPlan('REVISION', 350, 150),
    );
    const firstApproval = apply(
      registration.state,
      decisionAction(registration.state, 'PROPOSAL-REVISION', 'supplier', 'APPROVED', 'OLD-SUPPLIER'),
    );
    expect(firstApproval.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const rejection = apply(
      firstApproval.state,
      decisionAction(firstApproval.state, 'PROPOSAL-REVISION', 'production', 'REJECTED', 'OLD-PRODUCTION'),
    );
    expect(rejection.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(rejection.state.plans).toHaveLength(1);
    expect(rejection.state.plans[0]?.status).toBe('REJECTED');
    expect(rejection.state.planLineages[0]?.planIds).toEqual(['PROPOSAL-REVISION']);

    const successor = apply(rejection.state, {
      type: 'CREATE_SUCCESSOR',
      lineageId: 'LINEAGE-REVISION',
      predecessorPlanId: 'PROPOSAL-REVISION' as PlanId,
      newPlanId: 'REVISION-BETA' as PlanId,
      changes: {
        status: 'PENDING_APPROVAL',
        supplierAbsorbedCost: 0,
        productionAbsorbedCost: 75,
      },
    });
    expect(successor.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    expect(successor.state.plans).toHaveLength(2);
    expect(successor.state.plans.find(({ id }) => id === 'PROPOSAL-REVISION')).toMatchObject({ status: 'REJECTED', version: 1 });
    expect(successor.state.plans.find(({ id }) => id === 'REVISION-BETA')).toMatchObject({ status: 'PENDING_APPROVAL', version: 2 });
    expect(successor.state.planLineages[0]?.planIds).toEqual(['PROPOSAL-REVISION', 'REVISION-BETA']);
    expect(successor.state.approvals.filter(({ planId }) => planId === 'REVISION-BETA')).toEqual([]);

    const delayed = executeOrchestrationAction(
      successor.state,
      decisionAction(successor.state, 'PROPOSAL-REVISION', 'client', 'APPROVED', 'DELAYED-CLIENT'),
    );
    expect(delayed).toMatchObject({
      accepted: false,
      failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_SUPERSEDED' },
    });
    expect(delayed.state).toBe(successor.state);

    const production = apply(successor.state, decisionAction(successor.state, 'REVISION-BETA', 'production', 'APPROVED', 'NEW-PRODUCTION'));
    expect(production.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const supplier = apply(production.state, decisionAction(production.state, 'REVISION-BETA', 'supplier', 'APPROVED', 'NEW-SUPPLIER'));
    expect(supplier.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
    const client = apply(supplier.state, decisionAction(supplier.state, 'REVISION-BETA', 'client', 'APPROVED', 'NEW-CLIENT'));
    expect(client.disposition).toEqual({
      type: 'LINEAGE_RESOLVED',
      scope: { caseId: 'CASE-REVISION', lineageId: 'LINEAGE-REVISION', planId: 'REVISION-BETA' },
    });
    expect(client.state.approvals.filter(({ planId }) => planId === 'PROPOSAL-REVISION').map(({ decision }) => decision))
      .toEqual(['APPROVED', 'REJECTED']);
    expect(client.state.approvals.filter(({ planId }) => planId === 'REVISION-BETA').map(({ actorRole }) => actorRole))
      .toEqual(['production', 'supplier', 'client']);
    expect(new Set(client.state.approvals.map(({ approvalId }) => approvalId).values()).size).toBe(5);
    expect(new Set(client.state.operationHistory.map(({ operationId }) => operationId).values()).size).toBe(5);
    expect(client.state.events.some(({ result }) => result === 'CASE_AUTHORIZATION_APPLIED')).toBe(false);
  });

  it('Challenge C: registers a physically impossible proposal but blocks APPROVED atomically', () => {
    const exceptionCase = challengeCase('SHORTFALL', 600, { original: 420, substitute: 100 }, 200);
    const registration = register(
      initialState(exceptionCase),
      'LINEAGE-SHORTFALL',
      proposedPlan('SHORTFALL', 420, 180),
    );
    expect(registration).toMatchObject({
      step: {
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: {
            outcome: 'PHYSICALLY_INFEASIBLE',
            violations: [expect.objectContaining({ code: 'SUBSTITUTE_SUPPLY_EXCEEDED' })],
          },
        },
      },
    });

    const approval = executeOrchestrationAction(
      registration.state,
      decisionAction(registration.state, 'PROPOSAL-SHORTFALL', 'client', 'APPROVED', 'SHORTFALL-CLIENT'),
    );
    expect(approval).toMatchObject({
      accepted: false,
      failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_PHYSICALLY_INFEASIBLE' },
    });
    expect(approval.state).toBe(registration.state);
    expect(registration.state.approvals).toEqual([]);
    expect(registration.state.operationHistory).toEqual([]);
    expect(registration.state.events).toEqual([]);
    expect(registration.state.plans).toHaveLength(1);
    expect(registration.state.plans[0]?.status).toBe('PENDING_APPROVAL');
  });

  it('Challenge D: preserves unknown versus impossible when physical evidence is missing', () => {
    const exceptionCase = challengeCase('UNKNOWN', 600, { substitute: 100 }, 150);
    const registration = register(
      initialState(exceptionCase),
      'LINEAGE-UNKNOWN',
      proposedPlan('UNKNOWN', 500, 100),
    );
    expect(registration).toMatchObject({
      step: {
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: {
            outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN',
            issues: [expect.objectContaining({ code: 'PHYSICAL_SUPPLY_MISSING' })],
          },
        },
      },
    });

    const approval = executeOrchestrationAction(
      registration.state,
      decisionAction(registration.state, 'PROPOSAL-UNKNOWN', 'supplier', 'APPROVED', 'UNKNOWN-SUPPLIER'),
    );
    expect(approval).toMatchObject({
      accepted: false,
      failure: { source: 'DECISION_APPLICATION', reason: 'PHYSICAL_FEASIBILITY_UNPROVEN' },
    });
    expect(approval.state).toBe(registration.state);
    expect(registration.step).not.toMatchObject({
      assessment: { physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_INFEASIBLE' } },
    });
    expect(registration.state.plans).toHaveLength(1);
    expect(registration.state.approvals).toEqual([]);
    expect(registration.state.operationHistory).toEqual([]);
    expect(registration.state.events).toEqual([]);
  });

  it('keeps no-solution assessment a pure UNPROVEN query outside orchestration state', () => {
    const state = initialState(challengeCase('EVIDENCE', 600, { original: 420, substitute: 100 }, 150));
    const before = structuredClone(state);
    const assessment = assessNoSolution({
      proofType: 'NUMERIC_SHORTFALL',
      facts: { available: 520, required: 600 },
    });
    expect(assessment).toMatchObject({ outcome: 'NO_SOLUTION_UNPROVEN', reason: 'UNSUPPORTED_PROOF_TYPE' });
    expect(state).toEqual(before);
    expect(state).not.toHaveProperty('noSolutionAssessment');
  });

  it('preserves authoritative actor, operation, approval, and event identity protections', () => {
    const registration = register(
      initialState(challengeCase('IDENTITY', 500, { original: 350, substitute: 150 }, 200)),
      'LINEAGE-IDENTITY',
      proposedPlan('IDENTITY', 350, 150),
    );
    const clientAction = decisionAction(registration.state, 'PROPOSAL-IDENTITY', 'client', 'APPROVED', 'IDENTITY-CLIENT');
    const client = apply(registration.state, clientAction);

    const wrongRoleAction = decisionAction(client.state, 'PROPOSAL-IDENTITY', 'supplier', 'APPROVED', 'WRONG-ROLE');
    if (!wrongRoleAction.bridgeResult.ready) throw new Error('Unexpected bridge result');
    const wrongRoleBridge = createReadyDecisionBridgeResult({ ...wrongRoleAction.bridgeResult.proposal, actorRole: 'production' });
    const wrongRole = executeOrchestrationAction(client.state, {
      ...wrongRoleAction,
      bridgeResult: wrongRoleBridge,
      review: { ...wrongRoleAction.review, reviewTarget: wrongRoleBridge.reviewTarget },
    });
    expect(wrongRole).toMatchObject({ accepted: false, failure: { reason: 'ACTOR_ROLE_MISMATCH' } });
    expect(wrongRole.state).toBe(client.state);

    const repeatedOperationAction = decisionAction(client.state, 'PROPOSAL-IDENTITY', 'supplier', 'APPROVED', 'OTHER');
    if (repeatedOperationAction.review.action !== 'APPLY') throw new Error('Unexpected review');
    const repeatedOperation = executeOrchestrationAction(client.state, {
      ...repeatedOperationAction,
      review: { ...repeatedOperationAction.review, operationId: 'OPERATION-IDENTITY-CLIENT' },
    });
    expect(repeatedOperation).toMatchObject({ accepted: false, failure: { reason: 'DUPLICATE_OPERATION' } });
    expect(repeatedOperation.state).toBe(client.state);

    const repeatedApprovalAction = decisionAction(client.state, 'PROPOSAL-IDENTITY', 'supplier', 'APPROVED', 'REUSED-APPROVAL');
    if (repeatedApprovalAction.review.action !== 'APPLY' || clientAction.review.action !== 'APPLY') throw new Error('Unexpected review');
    const reusedApprovalId = clientAction.review.approvalId;
    if (reusedApprovalId === undefined) throw new Error('Missing explicit approval ID');
    const repeatedApproval = executeOrchestrationAction(client.state, {
      ...repeatedApprovalAction,
      review: { ...repeatedApprovalAction.review, approvalId: reusedApprovalId },
    });
    expect(repeatedApproval).toMatchObject({ accepted: false, failure: { reason: 'APPROVAL_RECORDING_FAILED' } });
    expect(repeatedApproval.state).toBe(client.state);

    const repeatedEventAction = decisionAction(client.state, 'PROPOSAL-IDENTITY', 'supplier', 'APPROVED', 'REUSED-EVENT');
    if (repeatedEventAction.review.action !== 'APPLY') throw new Error('Unexpected review');
    const repeatedEvent = executeOrchestrationAction(client.state, {
      ...repeatedEventAction,
      review: { ...repeatedEventAction.review, eventId: 'EVENT-IDENTITY-CLIENT' },
    });
    expect(repeatedEvent).toMatchObject({ accepted: false, failure: { reason: 'EVENT_HISTORY_INVALID_OR_DUPLICATE' } });
    expect(repeatedEvent.state).toBe(client.state);
  });

  it('is immutable and deterministic across a generic challenge input', () => {
    const state = deepFreeze(initialState(challengeCase('DETERMINISTIC', 500, { original: 350, substitute: 150 }, 200)));
    const action = deepFreeze(registerAction('LINEAGE-DETERMINISTIC', proposedPlan('DETERMINISTIC', 350, 150)));
    const before = JSON.stringify({ state, action });
    const first = executeOrchestrationAction(state, action);
    const second = executeOrchestrationAction(state, action);
    expect(second).toEqual(first);
    expect(JSON.stringify({ state, action })).toBe(before);
  });
});

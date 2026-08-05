import { case001Fixture, case001FridayAtFive } from '../../domain/case-001.fixture.js';
import { case001Plan001 } from '../../domain/case-001.simulation.js';
import { planIdSchema } from '../../domain/schemas.js';
import type { Actor, ActorRole } from '../../domain/types.js';
import { MockProvider } from './mockProvider.js';
import { callRequestSchema } from './schemas.js';
import type { FlowCallStep, ThreePartyFlowConfig } from './threePartyFlow.js';

const PLAN_002_ID = planIdSchema.parse('PLAN-002');
const PLAN_003_ID = planIdSchema.parse('PLAN-003');

const actorByRole = (role: ActorRole): Actor => {
  const actor = case001Fixture.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`CASE-001 actor is missing: ${role}`);
  return actor;
};

const response = (
  actor: Actor,
  planId: string,
  decision: 'APPROVED' | 'REJECTED',
  authorizationChanges: readonly unknown[] = [],
): unknown => ({
  status: 'completed',
  structuredResult: {
    decision,
    actorId: actor.id,
    actorRole: actor.role,
    caseId: case001Fixture.id,
    planId,
    summary: decision === 'APPROVED' ? 'The actor explicitly approved.' : 'The actor explicitly rejected.',
    authorizationChanges,
    clarificationNeeded: false,
  },
  taskCompleted: true,
  completionConfidence: { score: 0.95, label: 'high' },
  evidence: ['Explicit deterministic mock response'],
});

type StepInput = Readonly<{
  stepId: string;
  requestId: string;
  operationId: string;
  eventId: string;
  approvalId?: string;
  actor: Actor;
  planId?: string;
  externalPlanId: string;
  decision: 'APPROVED' | 'REJECTED';
  createdAt: string;
  receivedAt: string;
  reviewedAt: string;
  authorizationChanges?: readonly unknown[];
  operationType: 'PLAN_DECISION' | 'CASE_AUTHORIZATION';
}>;

const requiredPlanId = (planId: string | undefined): string => {
  if (planId === undefined) throw new Error('PLAN_DECISION requires planId');
  return planId;
};

const step = (input: StepInput): FlowCallStep => ({
  stepId: input.stepId,
  provider: new MockProvider({
    type: 'response',
    payload: response(input.actor, input.externalPlanId, input.decision, input.authorizationChanges),
  }),
  request: callRequestSchema.parse({
    requestId: input.requestId,
    caseId: case001Fixture.id,
    ...(input.planId === undefined ? {} : { planId: input.planId }),
    actorId: input.actor.id,
    actorRole: input.actor.role,
    phoneNumber: '+12025550123',
    objective: 'Capture one explicit deterministic decision.',
    context: 'CASE-001 integration flow using simulated providers only.',
    expectedDecisionSchema: { name: 'exception-broker-phone-decision', version: 1 },
    createdAt: input.createdAt,
  }),
  receivedAt: input.receivedAt,
  expected: input.operationType === 'PLAN_DECISION'
    ? {
        operationType: 'PLAN_DECISION', caseId: case001Fixture.id,
        planId: requiredPlanId(input.planId),
        actorId: input.actor.id, actorRole: input.actor.role,
      }
    : {
        operationType: 'CASE_AUTHORIZATION', caseId: case001Fixture.id,
        actorId: input.actor.id, actorRole: input.actor.role,
      },
  review: {
    action: 'APPLY', operationId: input.operationId, reviewedBy: 'reviewer-case-001',
    reviewedAt: input.reviewedAt, eventId: input.eventId,
    ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
    authorizationReviews: input.operationType === 'CASE_AUTHORIZATION'
      ? [{ field: 'maxSubstituteQuantity', action: 'APPLY' }]
      : [],
  },
});

export const createCase001ThreePartyFlowConfig = (): ThreePartyFlowConfig => {
  const client = actorByRole('client');
  const supplier = actorByRole('supplier');
  const production = actorByRole('production');

  return {
    initialCase: structuredClone(case001Fixture),
    initialPlan: structuredClone(case001Plan001),
    plan002: {
      id: PLAN_002_ID, createdAt: '2026-08-04T09:00:00-05:00',
      changes: {
        status: 'NO_SOLUTION', originalQuantityTomorrow: 200,
        substituteQuantityTomorrow: 50, originalQuantityLater: 150,
        laterDeliveryDate: case001FridayAtFive, clientAdditionalCost: 0,
        supplierAbsorbedCost: 25, productionAbsorbedCost: 0,
      },
    },
    plan003: {
      id: PLAN_003_ID,
      createdAt: '2026-08-04T10:01:00-05:00',
      changes: {
        status: 'PENDING_APPROVAL', originalQuantityTomorrow: 200,
        substituteQuantityTomorrow: 100, originalQuantityLater: 100,
        laterDeliveryDate: case001FridayAtFive, clientAdditionalCost: 0,
        supplierAbsorbedCost: 50, productionAbsorbedCost: 0,
      },
    },
    noSolutionEvidence: {
      availableUnitsTomorrow: 250,
      requiredMinimumUnitsTomorrow: 300,
      compatible: false,
    },
    plan001Rejection: step({
      stepId: 'PLAN_001_REJECTION', requestId: 'REQUEST-001', operationId: 'OPERATION-001',
      eventId: 'FLOW-EVENT-001', approvalId: 'FLOW-APPROVAL-001', actor: client,
      planId: case001Plan001.id, externalPlanId: case001Plan001.id, decision: 'REJECTED',
      createdAt: '2026-08-04T08:00:00-05:00', receivedAt: '2026-08-04T08:01:00-05:00',
      reviewedAt: '2026-08-04T08:02:00-05:00', operationType: 'PLAN_DECISION',
    }),
    caseAuthorization: step({
      stepId: 'CLIENT_CASE_AUTHORIZATION', requestId: 'REQUEST-002', operationId: 'OPERATION-002',
      eventId: 'FLOW-EVENT-002', actor: client, externalPlanId: PLAN_002_ID,
      decision: 'APPROVED', createdAt: '2026-08-04T09:55:00-05:00',
      receivedAt: '2026-08-04T09:56:00-05:00', reviewedAt: '2026-08-04T10:00:00-05:00',
      authorizationChanges: [{
        field: 'maxSubstituteQuantity', previousValue: 50, newValue: 100,
        reason: 'Client authorizes up to 100 substitute units to preserve the minimum delivery',
      }],
      operationType: 'CASE_AUTHORIZATION',
    }),
    finalApprovals: [
      step({
        stepId: 'SUPPLIER_APPROVAL', requestId: 'REQUEST-003', operationId: 'OPERATION-003',
        eventId: 'FLOW-EVENT-003', approvalId: 'FLOW-APPROVAL-002', actor: supplier,
        planId: PLAN_003_ID, externalPlanId: PLAN_003_ID, decision: 'APPROVED',
        createdAt: '2026-08-04T10:55:00-05:00', receivedAt: '2026-08-04T10:56:00-05:00',
        reviewedAt: '2026-08-04T11:00:00-05:00', operationType: 'PLAN_DECISION',
      }),
      step({
        stepId: 'PRODUCTION_APPROVAL', requestId: 'REQUEST-004', operationId: 'OPERATION-004',
        eventId: 'FLOW-EVENT-004', approvalId: 'FLOW-APPROVAL-003', actor: production,
        planId: PLAN_003_ID, externalPlanId: PLAN_003_ID, decision: 'APPROVED',
        createdAt: '2026-08-04T11:55:00-05:00', receivedAt: '2026-08-04T11:56:00-05:00',
        reviewedAt: '2026-08-04T12:00:00-05:00', operationType: 'PLAN_DECISION',
      }),
      step({
        stepId: 'CLIENT_APPROVAL', requestId: 'REQUEST-005', operationId: 'OPERATION-005',
        eventId: 'FLOW-EVENT-005', approvalId: 'FLOW-APPROVAL-004', actor: client,
        planId: PLAN_003_ID, externalPlanId: PLAN_003_ID, decision: 'APPROVED',
        createdAt: '2026-08-04T12:55:00-05:00', receivedAt: '2026-08-04T12:56:00-05:00',
        reviewedAt: '2026-08-04T13:00:00-05:00', operationType: 'PLAN_DECISION',
      }),
    ],
  };
};

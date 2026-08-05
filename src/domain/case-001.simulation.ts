import {
  finalizePlanApproval,
  recordApproval,
  recordRejection,
} from './approvals.js';
import { applyAuthorizationChanges } from './authorizationOperations.js';
import {
  case001Fixture,
  case001FridayAtFive,
} from './case-001.fixture.js';
import { planIdSchema, planSchema } from './schemas.js';
import type {
  ApprovalAttempt,
  AuthorizationChange,
  Case001SimulationResult,
  NoSolutionEvidence,
  SimulationEvent,
} from './simulation.js';
import type {
  Actor,
  ActorRole,
  Approval,
  ExceptionCase,
  Plan,
} from './types.js';
import { validatePlan } from './validator.js';
import { createNextPlanVersion } from './versioning.js';

const PLAN_002_ID = planIdSchema.parse('PLAN-002');
const PLAN_003_ID = planIdSchema.parse('PLAN-003');

export const case001Plan001 = planSchema.parse({
  id: 'PLAN-001',
  caseId: 'CASE-001',
  status: 'PENDING_APPROVAL',
  version: 1,
  originalQuantityTomorrow: 200,
  substituteQuantityTomorrow: 100,
  originalQuantityLater: 100,
  laterDeliveryDate: case001FridayAtFive,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 50,
  productionAbsorbedCost: 0,
});

const actorByRole = (exceptionCase: ExceptionCase, role: ActorRole): Actor => {
  const actor = exceptionCase.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`CASE-001 is missing actor ${role}`);
  return actor;
};

const noSolutionEvidence = (
  exceptionCase: ExceptionCase,
): NoSolutionEvidence => {
  const supplier = actorByRole(exceptionCase, 'supplier');
  const client = actorByRole(exceptionCase, 'client');
  const production = actorByRole(exceptionCase, 'production');
  const originalUnitsTomorrow = supplier.constraints
    .filter((constraint) => constraint.type === 'SUPPLY')
    .filter(
      (constraint) =>
        constraint.deliveryDate === exceptionCase.targetDeliveryDate,
    )
    .reduce((total, constraint) => total + constraint.originalQuantity, 0);
  const substituteSuppliesTomorrow = supplier.constraints
    .filter((constraint) => constraint.type === 'SUPPLY')
    .filter(
      (constraint) =>
        constraint.deliveryDate === exceptionCase.targetDeliveryDate &&
        constraint.substituteQuantity > 0,
    );
  const supplierSubstituteCapacityTomorrow = substituteSuppliesTomorrow.reduce(
    (total, constraint) => total + constraint.substituteQuantity,
    0,
  );
  const substituteUnitAdditionalCost = Math.max(
    ...substituteSuppliesTomorrow.map(
      (constraint) => constraint.substituteUnitAdditionalCost,
    ),
  );
  const authorizedSubstituteUnitsTomorrow =
    Math.min(
      client.authorization.maxSubstituteQuantity,
      supplierSubstituteCapacityTomorrow,
    );
  const availableUnitsTomorrow =
    originalUnitsTomorrow + authorizedSubstituteUnitsTomorrow;
  const requiredMinimumUnitsTomorrow = Math.max(
    ...production.constraints
      .filter((constraint) => constraint.type === 'MINIMUM_DELIVERY')
      .filter(
        (constraint) =>
          constraint.deliveryDate === exceptionCase.targetDeliveryDate,
      )
      .map((constraint) => constraint.minimumRequiredQuantity),
    ...client.constraints
      .filter((constraint) => constraint.type === 'MINIMUM_DELIVERY')
      .filter(
        (constraint) =>
          constraint.deliveryDate === exceptionCase.targetDeliveryDate,
      )
      .map((constraint) => constraint.minimumRequiredQuantity),
  );

  return {
    originalUnitsTomorrow,
    supplierSubstituteCapacityTomorrow,
    authorizedSubstituteUnitsTomorrow,
    substituteUnitAdditionalCost,
    availableUnitsTomorrow,
    requiredMinimumUnitsTomorrow,
    compatible: availableUnitsTomorrow >= requiredMinimumUnitsTomorrow,
  };
};

const applyOfficialClientAuthorization = (
  exceptionCase: ExceptionCase,
): Readonly<{
  updatedCase: ExceptionCase;
  change: AuthorizationChange;
}> => {
  const client = actorByRole(exceptionCase, 'client');
  const change: AuthorizationChange = {
    actorRole: 'client',
    field: 'maxSubstituteQuantity',
    previousValue: client.authorization.maxSubstituteQuantity,
    newValue: 100,
    reason:
      'Client authorizes up to 100 substitute units to preserve the minimum delivery',
    createdAt: '2026-08-04T10:00:00-05:00',
  };
  const applied = applyAuthorizationChanges(exceptionCase, [{
    actorId: client.id,
    field: change.field,
    expectedCurrentValue: change.previousValue,
    newValue: change.newValue,
    reviewedAction: 'APPLY',
  }]);
  if (!applied.success) throw new Error(applied.reason);

  return { updatedCase: applied.updatedCase, change };
};

const approvalAttempt = (
  plan: Plan,
  approvalCount: number,
  result: ReturnType<typeof finalizePlanApproval>,
): ApprovalAttempt =>
  result.success
    ? { planId: plan.id, approvalCount, success: true }
    : {
        planId: plan.id,
        approvalCount,
        success: false,
        reason: result.reason,
      };

export const simulateCase001 = (
  sourceCase: ExceptionCase = case001Fixture,
): Case001SimulationResult => {
  const plan001Validation = validatePlan(sourceCase, case001Plan001);
  const client = actorByRole(sourceCase, 'client');
  const rejected = recordRejection(case001Plan001, [], {
    approvalId: 'APPROVAL-001',
    caseId: sourceCase.id,
    planId: case001Plan001.id,
    actorId: client.id,
    actorRole: client.role,
    createdAt: '2026-08-04T08:02:00-05:00',
  });

  if (!rejected.success) {
    throw new Error(rejected.reason);
  }

  const evidence = noSolutionEvidence(sourceCase);
  const plan002Creation = createNextPlanVersion(
    rejected.plan,
    PLAN_002_ID,
    '2026-08-04T09:00:00-05:00',
    {
      status: 'NO_SOLUTION',
      originalQuantityTomorrow: evidence.originalUnitsTomorrow,
      substituteQuantityTomorrow: evidence.authorizedSubstituteUnitsTomorrow,
      originalQuantityLater:
        sourceCase.requestedQuantity - evidence.availableUnitsTomorrow,
      supplierAbsorbedCost:
        evidence.authorizedSubstituteUnitsTomorrow *
        evidence.substituteUnitAdditionalCost,
    },
  );

  if (!plan002Creation.success) {
    throw new Error(plan002Creation.reason);
  }

  const plan002 = plan002Creation.plan;
  const plan002Validation = validatePlan(sourceCase, plan002);
  const authorizationUpdate = applyOfficialClientAuthorization(sourceCase);
  // No prior version is invalidated here: PLAN-001 is already REJECTED and
  // the official audit history requires PLAN-002 to remain NO_SOLUTION.
  const plan003Creation = createNextPlanVersion(
    plan002,
    PLAN_003_ID,
    '2026-08-04T10:01:00-05:00',
    {
      status: 'PENDING_APPROVAL',
      originalQuantityTomorrow: 200,
      substituteQuantityTomorrow: 100,
      originalQuantityLater: 100,
      laterDeliveryDate: case001FridayAtFive,
      clientAdditionalCost: 0,
      supplierAbsorbedCost: 50,
      productionAbsorbedCost: 0,
    },
  );

  if (!plan003Creation.success) {
    throw new Error(plan003Creation.reason);
  }

  const plan003 = plan003Creation.plan;
  const plan003Validation = validatePlan(
    authorizationUpdate.updatedCase,
    plan003,
  );
  const approvalDefinitions = [
    ['supplier', '2026-08-04T11:00:00-05:00', 'EVENT-010', 'APPROVAL-002'],
    ['production', '2026-08-04T12:00:00-05:00', 'EVENT-011', 'APPROVAL-003'],
    ['client', '2026-08-04T13:00:00-05:00', 'EVENT-012', 'APPROVAL-004'],
  ] as const;
  let approvals: readonly Approval[] = rejected.approvals;
  const plan003Approvals: Approval[] = [];
  const approvalEvents: SimulationEvent[] = [];

  for (const [role, createdAt, eventId, approvalId] of approvalDefinitions) {
    const actor = actorByRole(authorizationUpdate.updatedCase, role);
    const recorded = recordApproval(approvals, {
      approvalId,
      caseId: authorizationUpdate.updatedCase.id,
      planId: plan003.id,
      actorId: actor.id,
      actorRole: actor.role,
      decision: 'APPROVED',
      createdAt,
    });
    if (!recorded.success) throw new Error(recorded.reason);
    approvals = recorded.approvals;
    plan003Approvals.push(recorded.approval);
    approvalEvents.push({
      eventId,
      caseId: sourceCase.id,
      type: 'APPROVAL_RECORDED',
      planId: plan003.id,
      actorId: recorded.approval.actorId,
      message: `${recorded.approval.actorRole} approved PLAN-003`,
      createdAt: recorded.approval.createdAt,
    });
  }

  const beforeThird = finalizePlanApproval(
    authorizationUpdate.updatedCase,
    plan003,
    [...rejected.approvals, ...plan003Approvals.slice(0, 2)],
  );
  const finalized = finalizePlanApproval(
    authorizationUpdate.updatedCase,
    plan003,
    approvals,
  );

  if (!finalized.success) {
    throw new Error(finalized.reason);
  }

  const events: readonly SimulationEvent[] = [
    {
      eventId: 'EVENT-001',
      caseId: sourceCase.id,
      type: 'PLAN_CREATED',
      planId: case001Plan001.id,
      message: 'PLAN-001 created for approval',
      createdAt: '2026-08-04T08:00:00-05:00',
    },
    {
      eventId: 'EVENT-002',
      caseId: sourceCase.id,
      type: 'PLAN_VALIDATED',
      planId: case001Plan001.id,
      message: 'PLAN-001 validated with R-04 violation',
      createdAt: '2026-08-04T08:01:00-05:00',
    },
    {
      eventId: 'EVENT-003',
      caseId: sourceCase.id,
      type: 'APPROVAL_RECORDED',
      planId: case001Plan001.id,
      actorId: client.id,
      message: 'Client rejection recorded for PLAN-001',
      createdAt: '2026-08-04T08:02:00-05:00',
    },
    {
      eventId: 'EVENT-004',
      caseId: sourceCase.id,
      type: 'PLAN_REJECTED',
      planId: case001Plan001.id,
      actorId: client.id,
      message: 'PLAN-001 rejected by Client',
      createdAt: '2026-08-04T08:03:00-05:00',
    },
    {
      eventId: 'EVENT-005',
      caseId: sourceCase.id,
      type: 'PLAN_CREATED',
      planId: plan002.id,
      message: 'PLAN-002 created as the next plan version',
      createdAt: plan002Creation.createdAt,
    },
    {
      eventId: 'EVENT-006',
      caseId: sourceCase.id,
      type: 'NO_SOLUTION_DETECTED',
      planId: plan002.id,
      message:
        'With the current limit of 50 substitute units, only 250 units can be delivered tomorrow, below the required minimum of 300.',
      createdAt: '2026-08-04T09:02:00-05:00',
    },
    {
      eventId: 'EVENT-007',
      caseId: sourceCase.id,
      type: 'AUTHORIZATION_UPDATED',
      actorId: client.id,
      message: authorizationUpdate.change.reason,
      createdAt: authorizationUpdate.change.createdAt,
    },
    {
      eventId: 'EVENT-008',
      caseId: sourceCase.id,
      type: 'PLAN_CREATED',
      planId: plan003.id,
      message: 'PLAN-003 created after the client authorization update',
      createdAt: plan003Creation.createdAt,
    },
    {
      eventId: 'EVENT-009',
      caseId: sourceCase.id,
      type: 'PLAN_VALIDATED',
      planId: plan003.id,
      message: 'PLAN-003 satisfies R-01 through R-10',
      createdAt: '2026-08-04T10:02:00-05:00',
    },
    ...approvalEvents,
    {
      eventId: 'EVENT-013',
      caseId: sourceCase.id,
      type: 'PLAN_APPROVED',
      planId: plan003.id,
      message: 'PLAN-003 approved by Supplier, Production, and Client',
      createdAt: '2026-08-04T13:01:00-05:00',
    },
  ];
  const approvalAttempts: readonly ApprovalAttempt[] = [
    approvalAttempt(plan003, 2, beforeThird),
    approvalAttempt(plan003, 3, finalized),
  ];

  return {
    caseId: sourceCase.id,
    status: 'APPROVED',
    plans: [rejected.plan, plan002, finalized.plan],
    approvals,
    events,
    authorizationChanges: [authorizationUpdate.change],
    validations: [
      { planId: case001Plan001.id, result: plan001Validation },
      { planId: plan002.id, result: plan002Validation },
      { planId: plan003.id, result: plan003Validation },
    ],
    noSolutionEvidence: evidence,
    approvalAttempts,
    updatedCase: authorizationUpdate.updatedCase,
    finalPlanId: finalized.plan.id,
    success: true,
  };
};

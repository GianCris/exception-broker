import { describe, expect, it } from 'vitest';

import {
  case001Fixture,
  case001FridayAtFive,
} from '../../src/domain/case-001.fixture.js';
import {
  approvalsForPlan,
  canApprovePlan,
  finalizePlanApproval,
  hasAllRequiredApprovals,
  recordApproval,
  recordRejection,
} from '../../src/domain/approvals.js';
import { approvalSchema, planSchema } from '../../src/domain/schemas.js';
import type {
  ActorRole,
  Approval,
  ApprovalDecision,
  Plan,
} from '../../src/domain/types.js';

const validPlan = planSchema.parse({
  id: 'PLAN-003',
  caseId: 'CASE-001',
  status: 'PENDING_APPROVAL',
  version: 3,
  originalQuantityTomorrow: 250,
  substituteQuantityTomorrow: 50,
  originalQuantityLater: 100,
  laterDeliveryDate: case001FridayAtFive,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 15,
  productionAbsorbedCost: 10,
});

const plan002 = planSchema.parse({ ...validPlan, id: 'PLAN-002', version: 2 });

const actorId = (role: ActorRole): Approval['actorId'] => {
  const actor = case001Fixture.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`Missing fixture actor: ${role}`);
  return actor.id;
};

const decision = (
  plan: Plan,
  role: ActorRole,
  value: ApprovalDecision,
  createdAt = '2026-08-04T12:00:00-05:00',
): Approval =>
  recordApproval([], {
    caseId: plan.caseId,
    planId: plan.id,
    actorId: actorId(role),
    actorRole: role,
    decision: value,
    createdAt,
  }).approval;

const allApproved = (plan: Plan): readonly Approval[] => [
  decision(plan, 'supplier', 'APPROVED'),
  decision(plan, 'production', 'APPROVED'),
  decision(plan, 'client', 'APPROVED'),
];

describe('approval decisions', () => {
  it('rejects invalid decisions and the former approved boolean', () => {
    const base = {
      caseId: 'CASE-001',
      planId: 'PLAN-003',
      actorId: 'supplier',
      actorRole: 'supplier',
      createdAt: '2026-08-04T12:00:00-05:00',
    };

    expect(
      approvalSchema.safeParse({ ...base, decision: 'ACCEPTED' }).success,
    ).toBe(false);
    expect(
      approvalSchema.safeParse({
        ...base,
        decision: 'APPROVED',
        approved: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    'APPROVED',
    'REJECTED',
    'PENDING',
    'NEEDS_CLARIFICATION',
  ] as const)('records decision %s with explicit plan and actor data', (value) => {
    const result = recordApproval([], {
      caseId: validPlan.caseId,
      planId: validPlan.id,
      actorId: actorId('supplier'),
      actorRole: 'supplier',
      decision: value,
      createdAt: '2026-08-04T12:00:00-05:00',
    });

    expect(result).toMatchObject({
      success: true,
      approval: {
        caseId: 'CASE-001',
        planId: 'PLAN-003',
        actorRole: 'supplier',
        decision: value,
      },
    });
    expect(result.approvals).toEqual([result.approval]);
  });

  it('appends a decision without mutating approval history', () => {
    const history = [decision(plan002, 'client', 'REJECTED')];
    const before = structuredClone(history);

    const result = recordApproval(history, {
      caseId: validPlan.caseId,
      planId: validPlan.id,
      actorId: actorId('supplier'),
      actorRole: 'supplier',
      decision: 'PENDING',
      createdAt: '2026-08-04T12:00:00-05:00',
    });

    expect(history).toEqual(before);
    expect(result.approvals).toHaveLength(2);
  });

  it('filters approvals by exact planId', () => {
    const history = [
      decision(plan002, 'supplier', 'APPROVED'),
      decision(validPlan, 'supplier', 'PENDING'),
    ];

    expect(approvalsForPlan(history, validPlan.id)).toEqual([history[1]]);
  });

  it('does not inherit approvals from PLAN-002 into PLAN-003', () => {
    expect(hasAllRequiredApprovals(allApproved(plan002), validPlan.id)).toBe(
      false,
    );
  });

  it('does not count PENDING or NEEDS_CLARIFICATION as approval', () => {
    const pending = [
      decision(validPlan, 'supplier', 'APPROVED'),
      decision(validPlan, 'production', 'PENDING'),
      decision(validPlan, 'client', 'NEEDS_CLARIFICATION'),
    ];

    expect(hasAllRequiredApprovals(pending, validPlan.id)).toBe(false);
  });

  it('uses the latest active decision for each role', () => {
    const history = [
      ...allApproved(validPlan),
      decision(
        validPlan,
        'client',
        'NEEDS_CLARIFICATION',
        '2026-08-04T13:00:00-05:00',
      ),
    ];

    expect(hasAllRequiredApprovals(history, validPlan.id)).toBe(false);
  });

  it('requires all three actors to approve the same planId', () => {
    const twoForPlan003 = allApproved(validPlan).slice(0, 2);
    const clientForPlan002 = decision(plan002, 'client', 'APPROVED');

    expect(
      hasAllRequiredApprovals(
        [...twoForPlan003, clientForPlan002],
        validPlan.id,
      ),
    ).toBe(false);
  });

  it('records a client rejection and returns a rejected plan', () => {
    const history = allApproved(plan002);
    const beforePlan = structuredClone(validPlan);
    const beforeHistory = structuredClone(history);

    const result = recordRejection(validPlan, history, {
      caseId: validPlan.caseId,
      planId: validPlan.id,
      actorId: actorId('client'),
      actorRole: 'client',
      createdAt: '2026-08-04T13:00:00-05:00',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.plan.status).toBe('REJECTED');
    expect(result.approval.decision).toBe('REJECTED');
    expect(result.approvals.slice(0, history.length)).toEqual(history);
    expect(validPlan).toEqual(beforePlan);
    expect(history).toEqual(beforeHistory);
  });

  it('does not record a rejection against another planId', () => {
    expect(
      recordRejection(validPlan, [], {
        caseId: validPlan.caseId,
        planId: plan002.id,
        actorId: actorId('client'),
        actorRole: 'client',
        createdAt: '2026-08-04T13:00:00-05:00',
      }),
    ).toEqual({
      success: false,
      reason: 'The rejection must reference the rejected plan and case',
    });
  });

  it('approves a valid plan when all roles approved that exact planId', () => {
    const approvals = allApproved(validPlan);
    const before = structuredClone(validPlan);

    expect(canApprovePlan(case001Fixture, validPlan, approvals).success).toBe(
      true,
    );
    expect(finalizePlanApproval(case001Fixture, validPlan, approvals)).toEqual({
      success: true,
      plan: { ...validPlan, status: 'APPROVED' },
    });
    expect(validPlan).toEqual(before);
  });

  it('does not approve with only two actor approvals', () => {
    expect(
      canApprovePlan(case001Fixture, validPlan, allApproved(validPlan).slice(0, 2))
        .success,
    ).toBe(false);
  });

  it('does not approve an invalid deterministic plan', () => {
    const invalidPlan = planSchema.parse({
      ...validPlan,
      originalQuantityTomorrow: 249,
      originalQuantityLater: 101,
    });

    expect(
      canApprovePlan(case001Fixture, invalidPlan, allApproved(invalidPlan)),
    ).toEqual({
      success: false,
      reason: 'The plan violates active constraints',
    });
  });

  it.each(['REJECTED', 'INVALIDATED'] as const)(
    'does not approve a plan with status %s',
    (status) => {
      const plan = { ...validPlan, status };

      expect(
        canApprovePlan(case001Fixture, plan, allApproved(plan)).success,
      ).toBe(false);
      expect(
        finalizePlanApproval(case001Fixture, plan, allApproved(plan)).success,
      ).toBe(false);
    },
  );

  it('never approves a plan with a recorded rejection', () => {
    const approvals = [
      ...allApproved(validPlan),
      decision(validPlan, 'client', 'REJECTED'),
      decision(validPlan, 'client', 'APPROVED', '2026-08-04T14:00:00-05:00'),
    ];

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'The plan has a recorded rejection',
    });
  });
});

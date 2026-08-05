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
  type ApprovalInput,
} from '../../src/domain/approvals.js';
import {
  approvalSchema,
  approvalIdSchema,
  caseIdSchema,
  planSchema,
} from '../../src/domain/schemas.js';
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
  approvalId: string,
  createdAt = '2026-08-04T12:00:00-05:00',
): Approval =>
  approvalSchema.parse({
    approvalId,
    caseId: plan.caseId,
    planId: plan.id,
    actorId: actorId(role),
    actorRole: role,
    decision: value,
    createdAt,
  });

const allApproved = (plan: Plan): readonly Approval[] => [
  decision(plan, 'supplier', 'APPROVED', 'APPROVAL-ALL-SUPPLIER'),
  decision(plan, 'production', 'APPROVED', 'APPROVAL-ALL-PRODUCTION'),
  decision(plan, 'client', 'APPROVED', 'APPROVAL-ALL-CLIENT'),
];

const alteredApproval = (
  approval: Approval,
  changes: Readonly<Record<string, unknown>>,
): Approval => approvalSchema.parse({ ...approval, ...changes });

describe('approval decisions', () => {
  it('requires one explicit non-empty approvalId and never generates it', () => {
    const valid = {
      approvalId: 'APPROVAL-MODEL-001', caseId: 'CASE-001', planId: 'PLAN-003',
      actorId: 'supplier', actorRole: 'supplier', decision: 'APPROVED',
      createdAt: '2026-08-04T12:00:00-05:00',
    };
    const { approvalId: _approvalId, ...withoutApprovalId } = valid;
    expect(approvalSchema.parse(valid).approvalId).toBe('APPROVAL-MODEL-001');
    expect(approvalSchema.safeParse(withoutApprovalId).success).toBe(false);
    expect(approvalSchema.safeParse({ ...valid, approvalId: '' }).success).toBe(false);
    expect(approvalSchema.safeParse({ ...valid, approvalId: '   ' }).success).toBe(false);
    expect(approvalSchema.safeParse({ ...valid, id: 'SECOND-ID' }).success).toBe(false);
  });

  it('rejects invalid decisions and the former approved boolean', () => {
    const base = {
      approvalId: 'APPROVAL-BASE',
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
    ['APPROVED', 'APPROVAL-RECORD-001'],
    ['REJECTED', 'APPROVAL-RECORD-002'],
    ['PENDING', 'APPROVAL-RECORD-003'],
    ['NEEDS_CLARIFICATION', 'APPROVAL-RECORD-004'],
  ] as const)('records decision %s with explicit plan and actor data', (value, approvalId) => {
    const result = recordApproval([], {
      approvalId,
      caseId: validPlan.caseId,
      planId: validPlan.id,
      actorId: actorId('supplier'),
      actorRole: 'supplier',
      decision: value,
      createdAt: '2026-08-04T12:00:00-05:00',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result).toMatchObject({
      success: true,
      approval: {
        approvalId,
        caseId: 'CASE-001',
        planId: 'PLAN-003',
        actorRole: 'supplier',
        decision: value,
      },
    });
    expect(result.approvals).toEqual([result.approval]);
  });

  it('appends a decision without mutating approval history', () => {
    const history = [decision(plan002, 'client', 'REJECTED', 'APPROVAL-HISTORY-001')];
    const before = structuredClone(history);

    const result = recordApproval(history, {
      approvalId: 'APPROVAL-HISTORY-002',
      caseId: validPlan.caseId,
      planId: validPlan.id,
      actorId: actorId('supplier'),
      actorRole: 'supplier',
      decision: 'PENDING',
      createdAt: '2026-08-04T12:00:00-05:00',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(history).toEqual(before);
    expect(result.approvals).toHaveLength(2);
  });

  it.each([
    ['same actor', {}],
    ['another actor', { actorId: actorId('production'), actorRole: 'production' }],
    ['another plan', { planId: plan002.id }],
    ['another case', { caseId: caseIdSchema.parse('CASE-OTHER') }],
  ])('rejects a reused approvalId for %s without overwriting history', (_label, changes) => {
    const existing = decision(validPlan, 'supplier', 'APPROVED', 'APPROVAL-UNIQUE-001');
    const history = [existing];
    const before = structuredClone(history);
    const result = recordApproval(history, {
      approvalId: existing.approvalId,
      caseId: validPlan.caseId, planId: validPlan.id,
      actorId: actorId('supplier'), actorRole: 'supplier', decision: 'PENDING',
      createdAt: '2026-08-04T13:00:00-05:00', ...(changes as Partial<ApprovalInput>),
    });
    expect(result).toEqual({ success: false, reason: 'approvalId has already been recorded' });
    expect(history).toEqual(before);
  });

  it('allows distinct approvalId values for historical decisions', () => {
    const first = decision(validPlan, 'supplier', 'PENDING', 'APPROVAL-HISTORY-DISTINCT-001');
    const result = recordApproval([first], {
      approvalId: 'APPROVAL-HISTORY-DISTINCT-002', caseId: validPlan.caseId,
      planId: validPlan.id, actorId: actorId('supplier'), actorRole: 'supplier',
      decision: 'APPROVED', createdAt: '2026-08-04T13:00:00-05:00',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.approvals.map(({ approvalId }) => approvalId)).toEqual([
      'APPROVAL-HISTORY-DISTINCT-001', 'APPROVAL-HISTORY-DISTINCT-002',
    ]);
  });

  it('filters approvals by exact planId', () => {
    const history = [
      decision(plan002, 'supplier', 'APPROVED', 'APPROVAL-FILTER-001'),
      decision(validPlan, 'supplier', 'PENDING', 'APPROVAL-FILTER-002'),
    ];

    expect(approvalsForPlan(history, validPlan.id)).toEqual([history[1]]);
  });

  it('rejects a plan whose caseId differs from exceptionCase.id', () => {
    const otherCase = {
      ...case001Fixture,
      id: caseIdSchema.parse('CASE-OTHER'),
    };

    expect(canApprovePlan(otherCase, validPlan, allApproved(validPlan))).toEqual({
      success: false,
      reason: 'Plan caseId does not match the case',
    });
  });

  it('rejects an approval whose caseId differs from exceptionCase.id', () => {
    const approvals = [...allApproved(validPlan)];
    approvals[0] = alteredApproval(approvals[0]!, { caseId: 'CASE-OTHER' });

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'Approval caseId does not match the case',
    });
  });

  it('does not count an approval whose planId differs from the plan', () => {
    const approvals = [
      decision(plan002, 'supplier', 'APPROVED', 'APPROVAL-PLAN-MISMATCH-001'),
      decision(validPlan, 'production', 'APPROVED', 'APPROVAL-PLAN-MISMATCH-002'),
      decision(validPlan, 'client', 'APPROVED', 'APPROVAL-PLAN-MISMATCH-003'),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, approvals),
    ).toBe(false);
    expect(canApprovePlan(case001Fixture, validPlan, approvals).success).toBe(
      false,
    );
  });

  it('rejects an approval from an actorId absent from the case', () => {
    const approvals = [...allApproved(validPlan)];
    approvals[0] = alteredApproval(approvals[0]!, { actorId: 'unknown-actor' });

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'Approval actorId does not exist',
    });
  });

  it('rejects a client actorId declared as supplier', () => {
    const approvals = [...allApproved(validPlan)];
    approvals[0] = alteredApproval(approvals[0]!, {
      actorId: actorId('client'),
      actorRole: 'supplier',
    });

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'Approval actorRole does not match the actor identity',
    });
  });

  it('rejects a supplier actorId declared as client', () => {
    const approvals = [...allApproved(validPlan)];
    approvals[2] = alteredApproval(approvals[2]!, {
      actorId: actorId('supplier'),
      actorRole: 'client',
    });

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'Approval actorRole does not match the actor identity',
    });
  });

  it('does not allow one actorId to cover three declared roles', () => {
    const supplierId = actorId('supplier');
    const approvals = allApproved(validPlan).map((approval) =>
      alteredApproval(approval, { actorId: supplierId }),
    );

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, approvals),
    ).toBe(false);
    expect(canApprovePlan(case001Fixture, validPlan, approvals).success).toBe(
      false,
    );
  });

  it('uses the newest decision by createdAt even when history is unordered', () => {
    const history = [
      decision(
        validPlan,
        'supplier',
        'APPROVED',
        'APPROVAL-UNORDERED-NEW',
        '2026-08-04T14:00:00-05:00',
      ),
      decision(
        validPlan,
        'supplier',
        'PENDING',
        'APPROVAL-UNORDERED-OLD',
        '2026-08-04T13:00:00-05:00',
      ),
      decision(validPlan, 'production', 'APPROVED', 'APPROVAL-UNORDERED-PRODUCTION'),
      decision(validPlan, 'client', 'APPROVED', 'APPROVAL-UNORDERED-CLIENT'),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(true);
  });

  it('does not count an old approval followed by a newer pending decision', () => {
    const history = [
      ...allApproved(validPlan),
      decision(
        validPlan,
        'supplier',
        'PENDING',
        'APPROVAL-NEWER-PENDING',
        '2026-08-04T14:00:00-05:00',
      ),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(false);
  });

  it('counts a newer approval after an older pending decision', () => {
    const history = [
      decision(
        validPlan,
        'supplier',
        'PENDING',
        'APPROVAL-OLDER-PENDING',
        '2026-08-04T11:00:00-05:00',
      ),
      ...allApproved(validPlan),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(true);
  });

  it('does not count an old approval followed by clarification', () => {
    const history = [
      ...allApproved(validPlan),
      decision(
        validPlan,
        'client',
        'NEEDS_CLARIFICATION',
        'APPROVAL-NEWER-CLARIFICATION',
        '2026-08-04T14:00:00-05:00',
      ),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(false);
  });

  it('rejects different decisions sharing the latest timestamp', () => {
    const history = [
      ...allApproved(validPlan),
      decision(validPlan, 'supplier', 'PENDING', 'APPROVAL-CONFLICT-PENDING'),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(false);
    expect(canApprovePlan(case001Fixture, validPlan, history)).toEqual({
      success: false,
      reason: 'Conflicting decisions share the same timestamp',
    });
  });

  it('treats identical decisions at the same timestamp as duplicates', () => {
    const supplierApproval = decision(validPlan, 'supplier', 'APPROVED', 'APPROVAL-DUPLICATE-SUPPLIER');
    const history = [
      supplierApproval,
      { ...structuredClone(supplierApproval), approvalId: approvalIdSchema.parse('APPROVAL-DUPLICATE-SUPPLIER-COPY') },
      decision(validPlan, 'production', 'APPROVED', 'APPROVAL-DUPLICATE-PRODUCTION'),
      decision(validPlan, 'client', 'APPROVED', 'APPROVAL-DUPLICATE-CLIENT'),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(true);
    expect(canApprovePlan(case001Fixture, validPlan, history).success).toBe(true);
  });

  it('does not inherit approvals from PLAN-002 into PLAN-003', () => {
    expect(
      hasAllRequiredApprovals(
        case001Fixture,
        validPlan,
        allApproved(plan002),
      ),
    ).toBe(false);
  });

  it('does not count PENDING or NEEDS_CLARIFICATION as approval', () => {
    const pending = [
      decision(validPlan, 'supplier', 'APPROVED', 'APPROVAL-MIXED-SUPPLIER'),
      decision(validPlan, 'production', 'PENDING', 'APPROVAL-MIXED-PRODUCTION'),
      decision(validPlan, 'client', 'NEEDS_CLARIFICATION', 'APPROVAL-MIXED-CLIENT'),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, pending),
    ).toBe(false);
  });

  it('uses the latest active decision for each role', () => {
    const history = [
      ...allApproved(validPlan),
      decision(
        validPlan,
        'client',
        'NEEDS_CLARIFICATION',
        'APPROVAL-LATEST-CLARIFICATION',
        '2026-08-04T13:00:00-05:00',
      ),
    ];

    expect(
      hasAllRequiredApprovals(case001Fixture, validPlan, history),
    ).toBe(false);
  });

  it('requires all three actors to approve the same planId', () => {
    const twoForPlan003 = allApproved(validPlan).slice(0, 2);
    const clientForPlan002 = decision(plan002, 'client', 'APPROVED', 'APPROVAL-PLAN002-CLIENT');

    expect(
      hasAllRequiredApprovals(
        case001Fixture,
        validPlan,
        [...twoForPlan003, clientForPlan002],
      ),
    ).toBe(false);
  });

  it('records a client rejection and returns a rejected plan', () => {
    const history = allApproved(plan002);
    const beforePlan = structuredClone(validPlan);
    const beforeHistory = structuredClone(history);

    const result = recordRejection(validPlan, history, {
      approvalId: 'APPROVAL-REJECTION-001',
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
    expect(result.approval.approvalId).toBe('APPROVAL-REJECTION-001');
    expect(result.approvals.slice(0, history.length)).toEqual(history);
    expect(validPlan).toEqual(beforePlan);
    expect(history).toEqual(beforeHistory);
  });

  it('does not record a rejection against another planId', () => {
    expect(
      recordRejection(validPlan, [], {
        approvalId: 'APPROVAL-REJECTION-WRONG-PLAN',
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

  it.each([
    'DRAFT',
    'REJECTED',
    'NO_SOLUTION',
    'INVALIDATED',
    'APPROVED',
  ] as const)(
    'does not approve a plan with status %s',
    (status) => {
      const plan = { ...validPlan, status };

      expect(
        canApprovePlan(case001Fixture, plan, allApproved(plan)).success,
      ).toBe(false);
      expect(
        finalizePlanApproval(case001Fixture, plan, allApproved(plan)).success,
      ).toBe(false);
      expect(canApprovePlan(case001Fixture, plan, allApproved(plan))).toEqual({
        success: false,
        reason: `Plan status ${status} does not allow approval`,
      });
    },
  );

  it('never approves a plan with a recorded rejection', () => {
    const approvals = [
      ...allApproved(validPlan),
      decision(validPlan, 'client', 'REJECTED', 'APPROVAL-HISTORICAL-REJECTION'),
      decision(validPlan, 'client', 'APPROVED', 'APPROVAL-AFTER-REJECTION', '2026-08-04T14:00:00-05:00'),
    ];

    expect(canApprovePlan(case001Fixture, validPlan, approvals)).toEqual({
      success: false,
      reason: 'The plan has a recorded rejection',
    });
  });

  it('does not mutate the case, plan, approvals, or historical decisions', () => {
    const approvals = [
      decision(
        validPlan,
        'supplier',
        'PENDING',
        'APPROVAL-IMMUTABILITY-PENDING',
        '2026-08-04T11:00:00-05:00',
      ),
      ...allApproved(validPlan),
    ];
    const caseBefore = structuredClone(case001Fixture);
    const planBefore = structuredClone(validPlan);
    const approvalsBefore = structuredClone(approvals);

    hasAllRequiredApprovals(case001Fixture, validPlan, approvals);
    canApprovePlan(case001Fixture, validPlan, approvals);
    finalizePlanApproval(case001Fixture, validPlan, approvals);

    expect(case001Fixture).toEqual(caseBefore);
    expect(validPlan).toEqual(planBefore);
    expect(approvals).toEqual(approvalsBefore);
  });
});

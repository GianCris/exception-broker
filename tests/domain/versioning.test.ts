import { describe, expect, it } from 'vitest';

import { case001FridayAtFive } from '../../src/domain/case-001.fixture.js';
import { planIdSchema, planSchema } from '../../src/domain/schemas.js';
import type { Approval } from '../../src/domain/types.js';
import {
  createNextPlanVersion,
  invalidatePreviousPlan,
} from '../../src/domain/versioning.js';

const plan001 = planSchema.parse({
  id: 'PLAN-001',
  caseId: 'CASE-001',
  status: 'REJECTED',
  version: 1,
  originalQuantityTomorrow: 250,
  substituteQuantityTomorrow: 50,
  originalQuantityLater: 100,
  laterDeliveryDate: case001FridayAtFive,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 25,
  productionAbsorbedCost: 0,
});

const historicalApproval: Approval = {
  approvalId: 'APPROVAL-HISTORICAL-001' as Approval['approvalId'],
  caseId: plan001.caseId,
  planId: plan001.id,
  actorId: 'client' as Approval['actorId'],
  actorRole: 'client',
  decision: 'REJECTED',
  createdAt: '2026-08-04T09:00:00-05:00',
};

describe('plan versioning', () => {
  it('creates PLAN-002 from PLAN-001 with the next consecutive version', () => {
    const result = createNextPlanVersion(
      plan001,
      planIdSchema.parse('PLAN-002'),
      '2026-08-04T10:00:00-05:00',
      {
        status: 'PENDING_APPROVAL',
        supplierAbsorbedCost: 15,
        productionAbsorbedCost: 10,
      },
    );

    expect(result).toMatchObject({
      success: true,
      createdAt: '2026-08-04T10:00:00-05:00',
      plan: {
        id: 'PLAN-002',
        caseId: 'CASE-001',
        version: 2,
        status: 'PENDING_APPROVAL',
        supplierAbsorbedCost: 15,
        productionAbsorbedCost: 10,
      },
    });
  });

  it('increments versions consecutively without modifying prior plans', () => {
    const plan001Before = structuredClone(plan001);
    const second = createNextPlanVersion(
      plan001,
      planIdSchema.parse('PLAN-002'),
      '2026-08-04T10:00:00-05:00',
      { status: 'NO_SOLUTION' },
    );
    expect(second.success).toBe(true);
    if (!second.success) return;

    const plan002Before = structuredClone(second.plan);
    const third = createNextPlanVersion(
      second.plan,
      planIdSchema.parse('PLAN-003'),
      '2026-08-04T11:00:00-05:00',
      { status: 'PENDING_APPROVAL' },
    );

    expect(third.success && third.plan.version).toBe(3);
    expect(plan001).toEqual(plan001Before);
    expect(second.plan).toEqual(plan002Before);
  });

  it('requires a new planId for a new version', () => {
    expect(
      createNextPlanVersion(
        plan001,
        plan001.id,
        '2026-08-04T10:00:00-05:00',
        {},
      ),
    ).toEqual({
      success: false,
      reason: 'A new plan version requires a new planId',
    });
  });

  it('invalidates a previous plan without mutating it', () => {
    const pendingPlan = { ...plan001, status: 'PENDING_APPROVAL' as const };
    const before = structuredClone(pendingPlan);

    const invalidated = invalidatePreviousPlan(pendingPlan);

    expect(invalidated).toEqual({ ...pendingPlan, status: 'INVALIDATED' });
    expect(invalidated).not.toBe(pendingPlan);
    expect(pendingPlan).toEqual(before);
  });

  it('keeps historical approvals intact while versioning and invalidating', () => {
    const approvals = [historicalApproval] as const;
    const approvalsBefore = structuredClone(approvals);

    createNextPlanVersion(
      plan001,
      planIdSchema.parse('PLAN-002'),
      '2026-08-04T10:00:00-05:00',
      { status: 'PENDING_APPROVAL' },
    );
    invalidatePreviousPlan(plan001);

    expect(approvals).toEqual(approvalsBefore);
  });
});

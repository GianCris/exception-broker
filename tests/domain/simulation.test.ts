import { describe, expect, it } from 'vitest';

import {
  approvalsForPlan,
  canApprovePlan,
  finalizePlanApproval,
  recordApproval,
} from '../../src/domain/approvals.js';
import {
  case001Plan001,
  simulateCase001,
} from '../../src/domain/case-001.simulation.js';
import { case001Fixture } from '../../src/domain/case-001.fixture.js';
import type { Approval, Plan } from '../../src/domain/types.js';

const simulation = simulateCase001();
const planById = (id: string): Plan => {
  const plan = simulation.plans.find((candidate) => candidate.id === id);
  if (plan === undefined) throw new Error(`Missing simulated plan ${id}`);
  return plan;
};
const validationFor = (id: string) => {
  const audit = simulation.validations.find(({ planId }) => planId === id);
  if (audit === undefined) throw new Error(`Missing validation for ${id}`);
  return audit.result;
};

const threeApprovalsFor = (plan: Plan): readonly Approval[] => {
  let history: readonly Approval[] = [];

  for (const [role, createdAt] of [
    ['supplier', '2026-08-04T14:00:00-05:00'],
    ['production', '2026-08-04T14:01:00-05:00'],
    ['client', '2026-08-04T14:02:00-05:00'],
  ] as const) {
    const actor = case001Fixture.actors.find(
      (candidate) => candidate.role === role,
    );
    if (actor === undefined) throw new Error(`Missing actor ${role}`);

    history = recordApproval(history, {
      caseId: case001Fixture.id,
      planId: plan.id,
      actorId: actor.id,
      actorRole: actor.role,
      decision: 'APPROVED',
      createdAt,
    }).approvals;
  }

  return history;
};

describe('official CASE-001 simulation', () => {
  it('shows PLAN-001 violates only R-04', () => {
    const validation = validationFor('PLAN-001');

    expect(validation.valid).toBe(false);
    expect(validation.violations.map(({ ruleId }) => ruleId)).toEqual(['R-04']);
  });

  it('records the Client rejection and keeps PLAN-001 rejected in history', () => {
    const plan001 = planById('PLAN-001');
    const rejection = simulation.approvals.find(
      ({ planId, decision }) =>
        planId === plan001.id && decision === 'REJECTED',
    );

    expect(plan001.status).toBe('REJECTED');
    expect(rejection).toMatchObject({
      actorId: 'client',
      actorRole: 'client',
      decision: 'REJECTED',
    });
    expect(case001Plan001.status).toBe('PENDING_APPROVAL');
  });

  it('proves only 250 units are available against a minimum of 300', () => {
    expect(simulation.noSolutionEvidence).toMatchObject({
      originalUnitsTomorrow: 200,
      supplierSubstituteCapacityTomorrow: 200,
      authorizedSubstituteUnitsTomorrow: 50,
      availableUnitsTomorrow: 250,
      requiredMinimumUnitsTomorrow: 300,
      compatible: false,
    });
  });

  it('keeps PLAN-002 as NO_SOLUTION with deterministic violations', () => {
    const plan002 = planById('PLAN-002');
    const rules = validationFor('PLAN-002').violations.map(({ ruleId }) => ruleId);

    expect(plan002.status).toBe('NO_SOLUTION');
    expect(rules).toEqual(expect.arrayContaining(['R-02', 'R-03']));
    expect(
      simulation.events.find(({ type }) => type === 'NO_SOLUTION_DETECTED'),
    ).toMatchObject({
      planId: 'PLAN-002',
      message:
        'With the current limit of 50 substitute units, only 250 units can be delivered tomorrow, below the required minimum of 300.',
    });
  });

  it('does not inherit approvals into PLAN-002', () => {
    expect(approvalsForPlan(simulation.approvals, planById('PLAN-002').id)).toEqual(
      [],
    );
  });

  it('does not approve PLAN-002 even with three artificial valid approvals', () => {
    const plan002 = planById('PLAN-002');
    const approvals = threeApprovalsFor(plan002);

    expect(canApprovePlan(case001Fixture, plan002, approvals)).toEqual({
      success: false,
      reason: 'Plan status NO_SOLUTION does not allow approval',
    });
    expect(finalizePlanApproval(case001Fixture, plan002, approvals)).toEqual({
      success: false,
      reason: 'Plan status NO_SOLUTION does not allow approval',
    });
    expect(validationFor('PLAN-002').valid).toBe(false);
  });

  it('records the exact Client authorization update', () => {
    expect(simulation.authorizationChanges).toEqual([
      {
        actorRole: 'client',
        field: 'maxSubstituteQuantity',
        previousValue: 50,
        newValue: 100,
        reason:
          'Client authorizes up to 100 substitute units to preserve the minimum delivery',
        createdAt: '2026-08-04T10:00:00-05:00',
      },
    ]);
  });

  it('changes only the Client substitute authorization on a copied case', () => {
    const originalSupplier = case001Fixture.actors.find(
      ({ role }) => role === 'supplier',
    );
    const originalProduction = case001Fixture.actors.find(
      ({ role }) => role === 'production',
    );
    const updatedSupplier = simulation.updatedCase.actors.find(
      ({ role }) => role === 'supplier',
    );
    const updatedProduction = simulation.updatedCase.actors.find(
      ({ role }) => role === 'production',
    );
    const updatedClient = simulation.updatedCase.actors.find(
      ({ role }) => role === 'client',
    );

    expect(updatedSupplier).toEqual(originalSupplier);
    expect(updatedProduction).toEqual(originalProduction);
    expect(updatedClient?.authorization.maxSubstituteQuantity).toBe(100);
    expect(
      case001Fixture.actors.find(({ role }) => role === 'client')?.authorization
        .maxSubstituteQuantity,
    ).toBe(50);
  });

  it('creates PLAN-003 with a new ID, version 3, and valid conditions', () => {
    const plan003 = planById('PLAN-003');

    expect(plan003).toMatchObject({
      id: 'PLAN-003',
      version: 3,
      status: 'APPROVED',
      originalQuantityTomorrow: 200,
      substituteQuantityTomorrow: 100,
      originalQuantityLater: 100,
      clientAdditionalCost: 0,
      supplierAbsorbedCost: 50,
      productionAbsorbedCost: 0,
    });
    expect(validationFor('PLAN-003')).toEqual({ valid: true, violations: [] });
  });

  it('records three real actors approving the same PLAN-003 without inheritance', () => {
    const plan003Approvals = approvalsForPlan(
      simulation.approvals,
      planById('PLAN-003').id,
    );

    expect(plan003Approvals).toHaveLength(3);
    expect(plan003Approvals.map(({ actorId, actorRole, decision }) => ({
      actorId,
      actorRole,
      decision,
    }))).toEqual([
      { actorId: 'supplier', actorRole: 'supplier', decision: 'APPROVED' },
      { actorId: 'production', actorRole: 'production', decision: 'APPROVED' },
      { actorId: 'client', actorRole: 'client', decision: 'APPROVED' },
    ]);
  });

  it('cannot finalize PLAN-003 with two approvals but does with three', () => {
    expect(simulation.approvalAttempts).toEqual([
      {
        planId: 'PLAN-003',
        approvalCount: 2,
        success: false,
        reason: 'The plan lacks all required approvals',
      },
      { planId: 'PLAN-003', approvalCount: 3, success: true },
    ]);
  });

  it('keeps all three plan versions in official order and terminal status', () => {
    expect(
      simulation.plans.map(({ id, version, status }) => ({ id, version, status })),
    ).toEqual([
      { id: 'PLAN-001', version: 1, status: 'REJECTED' },
      { id: 'PLAN-002', version: 2, status: 'NO_SOLUTION' },
      { id: 'PLAN-003', version: 3, status: 'APPROVED' },
    ]);
  });

  it('keeps events chronologically ordered with explicit unique IDs', () => {
    const timestamps = simulation.events.map(({ createdAt }) =>
      Date.parse(createdAt),
    );
    const eventIds = simulation.events.map(({ eventId }) => eventId);

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });

  it('does not mutate CASE-001 or the initial PLAN-001 input', () => {
    const caseBefore = structuredClone(case001Fixture);
    const planBefore = structuredClone(case001Plan001);

    simulateCase001(case001Fixture);

    expect(case001Fixture).toEqual(caseBefore);
    expect(case001Plan001).toEqual(planBefore);
  });

  it('finishes CASE-001 successfully with PLAN-003 approved', () => {
    expect(simulation).toMatchObject({
      caseId: 'CASE-001',
      status: 'APPROVED',
      finalPlanId: 'PLAN-003',
      success: true,
    });
  });

  it('serializes to JSON without losing essential audit information', () => {
    const restored = JSON.parse(JSON.stringify(simulation)) as Record<
      string,
      unknown
    >;

    expect(restored).toMatchObject({
      caseId: 'CASE-001',
      status: 'APPROVED',
      finalPlanId: 'PLAN-003',
      success: true,
    });
    expect(restored.plans).toHaveLength(3);
    expect(restored.events).toHaveLength(simulation.events.length);
    expect(restored.approvals).toHaveLength(simulation.approvals.length);
  });
});

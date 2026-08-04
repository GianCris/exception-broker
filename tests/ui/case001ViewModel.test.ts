import { describe, expect, it } from 'vitest';

import { simulateCase001 } from '../../src/domain/case-001.simulation.js';
import { createCase001ViewModel, formatDate, formatDateTime, formatTime } from '../../src/presentation/case001ViewModel.js';

describe('CASE-001 presentation model', () => {
  it('formats known timestamps explicitly in America/Lima', () => {
    expect(formatDateTime('2026-08-04T22:00:00.000Z')).toBe('Aug 4, 5:00 PM');
    expect(formatDate('2026-08-04T13:00:00.000Z')).toBe('Aug 4, 2026');
    expect(formatTime('2026-08-04T13:00:00.000Z')).toBe('8:00 AM');
  });

  it('formats delivery dates and trace endpoints deterministically', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    const finalPlan = viewModel.finalPlan;

    expect(viewModel.header.targetDeliveryDate).toBe('Aug 4, 5:00 PM');
    expect(finalPlan?.laterDeliveryDate).toBe('Aug 7, 5:00 PM');
    expect(viewModel.events[0]).toMatchObject({ date: 'Aug 4, 2026', time: '8:00 AM' });
    expect(viewModel.events.at(-1)).toMatchObject({ date: 'Aug 4, 2026', time: '1:01 PM' });
  });

  it('derives the title and participant metric from the simulated case', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);

    expect(viewModel.header.title).toBe(`${simulation.updatedCase.requestedQuantity}-unit shortage resolved`);
    expect(viewModel.resolutionApproved).toBe(true);
    expect(viewModel.header.statusLabel).toBe('Approved');
    expect(viewModel.finalApprovals).toHaveLength(3);
    expect(viewModel.header.participantCount).toBe(simulation.updatedCase.actors.length);
  });

  it('uses the historical client limit for the rejected plan', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);
    const rejected = viewModel.priorPlans.find(({ status }) => status === 'REJECTED');
    const client = simulation.updatedCase.actors.find(({ role }) => role === 'client');

    expect(client?.authorization.maxSubstituteQuantity).toBe(simulation.authorizationChanges[0]?.newValue);
    expect(rejected?.explanation).toMatchObject({
      kind: 'rejected',
      clientLimit: simulation.authorizationChanges[0]?.previousValue,
    });
  });

  it('derives required, available and shortfall evidence for the no-solution plan', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);
    const noSolution = viewModel.priorPlans.find(({ status }) => status === 'NO_SOLUTION');
    const evidence = simulation.noSolutionEvidence;

    expect(noSolution?.explanation).toEqual({
      kind: 'no-solution',
      requiredTomorrow: evidence.requiredMinimumUnitsTomorrow,
      availableTomorrow: evidence.availableUnitsTomorrow,
      shortfall: evidence.requiredMinimumUnitsTomorrow - evidence.availableUnitsTomorrow,
    });
  });

  it('derives the final unlock and approvals from finalPlanId', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);
    const final = viewModel.finalPlan;
    const change = simulation.authorizationChanges[0];

    expect(final?.isFinal).toBe(true);
    expect(final?.explanation).toMatchObject({
      kind: 'final',
      unlockPreviousValue: change?.previousValue,
      unlockNewValue: change?.newValue,
    });
    expect(viewModel.finalApprovals.every(({ planId }) => planId === final?.id)).toBe(true);
  });

  it('selects the final plan by exact id and keeps only earlier plans in order', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);

    expect(viewModel.finalPlan?.id).toBe(simulation.finalPlanId);
    expect(viewModel.priorPlans.map(({ id }) => id)).toEqual(
      [...simulation.plans]
        .sort((left, right) => left.version - right.version)
        .filter(({ version }) => version < viewModel.finalPlan!.version)
        .map(({ id }) => id),
    );
    expect(viewModel.resolutionAvailable).toBe(true);
  });

  it.each([null, 'PLAN-UNKNOWN'])('fails safely when finalPlanId is %s', (finalPlanId) => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel({ ...simulation, finalPlanId: finalPlanId as typeof simulation.finalPlanId });

    expect(viewModel.finalPlan).toBeNull();
    expect(viewModel.priorPlans).toHaveLength(simulation.plans.length);
    expect(viewModel.finalApprovals).toEqual([]);
    expect(viewModel.resolutionAvailable).toBe(false);
    expect(viewModel.resolutionApproved).toBe(false);
    expect(viewModel.header.title).not.toContain('resolved');
  });

  it('does not approve a final plan whose status is not APPROVED', () => {
    const simulation = simulateCase001();
    const plans = simulation.plans.map((plan) => plan.id === simulation.finalPlanId ? { ...plan, status: 'PENDING_APPROVAL' as const } : plan);
    const viewModel = createCase001ViewModel({ ...simulation, plans });

    expect(viewModel.finalPlan?.statusLabel).toBe('Pending approval');
    expect(viewModel.resolutionApproved).toBe(false);
    expect(viewModel.finalApprovals).toEqual([]);
    expect(viewModel.header.statusTone).toBe('neutral');
  });

  it('requires all three valid approvals for the exact final plan', () => {
    const simulation = simulateCase001();
    const finalApprovals = simulation.approvals.filter(({ planId }) => planId === simulation.finalPlanId);
    const partial = createCase001ViewModel({ ...simulation, approvals: finalApprovals.slice(0, 2) });
    const otherPlan = simulation.plans[0]!;
    const wrongPlanApprovals = finalApprovals.map((approval) => ({ ...approval, planId: otherPlan.id }));
    const wrongPlan = createCase001ViewModel({ ...simulation, approvals: wrongPlanApprovals });

    expect(partial.resolutionApproved).toBe(false);
    expect(partial.finalApprovals).toEqual([]);
    expect(wrongPlan.resolutionApproved).toBe(false);
    expect(wrongPlan.finalApprovals).toEqual([]);
  });

  it('fails closed when approval history cannot identify three presentable current records', () => {
    const simulation = simulateCase001();
    const finalApproval = simulation.approvals.find(({ planId }) => planId === simulation.finalPlanId)!;
    const historical = { ...finalApproval, createdAt: '2026-08-04T12:00:00.000Z' };
    const viewModel = createCase001ViewModel({ ...simulation, approvals: [historical, ...simulation.approvals] });

    expect(viewModel.resolutionApproved).toBe(false);
    expect(viewModel.finalApprovals).toEqual([]);
    expect(viewModel.header.title).toBe('Approval evidence incomplete');
  });

  it('rejects mismatched actor identity and role from approval evidence', () => {
    const simulation = simulateCase001();
    const client = simulation.updatedCase.actors.find(({ role }) => role === 'client')!;
    const approvals = simulation.approvals.map((approval) => approval.actorRole === 'supplier'
      ? { ...approval, actorId: client.id }
      : approval);
    const viewModel = createCase001ViewModel({ ...simulation, approvals });

    expect(viewModel.resolutionApproved).toBe(false);
    expect(viewModel.finalApprovals).toEqual([]);
    expect(viewModel.header.title).toBe('Approval evidence incomplete');
  });

  it('does not fabricate an authorization change when history is absent', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel({ ...simulation, authorizationChanges: [] });

    expect(viewModel.authorizationChangeAvailable).toBe(false);
    expect(viewModel.authorizationChanges).toEqual([]);
    expect(viewModel.finalPlan?.explanation).toEqual({ kind: 'neutral', message: 'Authorization history is unavailable.' });
    expect(viewModel.priorPlans.find(({ status }) => status === 'REJECTED')?.explanation.kind).toBe('neutral');
  });

  it('handles empty plan and evidence collections without invented values', () => {
    const simulation = simulateCase001();
    const before = structuredClone(simulation);
    const viewModel = createCase001ViewModel({
      ...simulation,
      plans: [], approvals: [], authorizationChanges: [], validations: [], events: [], finalPlanId: null,
    });

    expect(viewModel.priorPlans).toEqual([]);
    expect(viewModel.finalPlan).toBeNull();
    expect(viewModel.finalApprovals).toEqual([]);
    expect(viewModel.events).toEqual([]);
    expect(JSON.stringify(viewModel)).not.toMatch(/Infinity|NaN|undefined/);
    expect(simulation).toEqual(before);
  });

  it('maps an unexpected plan status to a neutral presentation', () => {
    const simulation = simulateCase001();
    const plans = simulation.plans.map((plan) => plan.id === simulation.finalPlanId
      ? { ...plan, status: 'UNEXPECTED_STATUS' as typeof plan.status }
      : plan);
    const viewModel = createCase001ViewModel({ ...simulation, plans });

    expect(viewModel.finalPlan).toMatchObject({ statusLabel: 'Unavailable', statusTone: 'neutral', isFinal: false });
    expect(viewModel.resolutionApproved).toBe(false);
  });

  it('keeps prior plans ordered when input plans are disordered and does not mutate input', () => {
    const simulation = simulateCase001();
    const disordered = { ...simulation, plans: [...simulation.plans].reverse() };
    const before = structuredClone(disordered);
    const viewModel = createCase001ViewModel(disordered);

    expect(viewModel.priorPlans.map(({ version }) => version)).toEqual([1, 2]);
    expect(disordered).toEqual(before);
  });
});

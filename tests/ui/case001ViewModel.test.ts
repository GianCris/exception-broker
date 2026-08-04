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
    const finalPlan = viewModel.plans.find(({ id }) => id === viewModel.finalPlanId);

    expect(viewModel.header.targetDeliveryDate).toBe('Aug 4, 5:00 PM');
    expect(finalPlan?.laterDeliveryDate).toBe('Aug 7, 5:00 PM');
    expect(viewModel.events[0]).toMatchObject({ date: 'Aug 4, 2026', time: '8:00 AM' });
    expect(viewModel.events.at(-1)).toMatchObject({ date: 'Aug 4, 2026', time: '1:01 PM' });
  });

  it('derives the title and participant metric from the simulated case', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);

    expect(viewModel.header.title).toBe(`${simulation.updatedCase.requestedQuantity}-unit shortage resolved`);
    expect(viewModel.header.participantCount).toBe(simulation.updatedCase.actors.length);
  });

  it('uses the historical client limit for the rejected plan', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);
    const rejected = viewModel.plans.find(({ status }) => status === 'REJECTED');
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
    const noSolution = viewModel.plans.find(({ status }) => status === 'NO_SOLUTION');
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
    const final = viewModel.plans.find(({ id }) => id === viewModel.finalPlanId);
    const change = simulation.authorizationChanges[0];

    expect(final?.isFinal).toBe(true);
    expect(final?.explanation).toMatchObject({
      kind: 'final',
      unlockPreviousValue: change?.previousValue,
      unlockNewValue: change?.newValue,
    });
    expect(viewModel.approvals.every(({ planId }) => planId === viewModel.finalPlanId)).toBe(true);
  });
});

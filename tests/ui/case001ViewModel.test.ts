import { describe, expect, it } from 'vitest';

import { simulateCase001 } from '../../src/domain/case-001.simulation.js';
import {
  createCase001ViewModel,
  formatDate,
  formatDateTime,
  formatTime,
} from '../../src/presentation/case001ViewModel.js';

describe('CASE-001 presentation timezone', () => {
  it('formats known timestamps explicitly in America/Lima', () => {
    expect(formatDateTime('2026-08-04T22:00:00.000Z')).toBe(
      'Aug 4, 5:00 PM',
    );
    expect(formatDate('2026-08-04T13:00:00.000Z')).toBe('Aug 4, 2026');
    expect(formatTime('2026-08-04T13:00:00.000Z')).toBe('8:00 AM');
  });

  it('formats target and later delivery dates deterministically', () => {
    const viewModel = createCase001ViewModel(simulateCase001());

    expect(viewModel.header.targetDeliveryDate).toBe('Aug 4, 5:00 PM');
    expect(viewModel.finalPlan?.laterDeliveryDate).toBe('Aug 7, 5:00 PM');
  });

  it('formats the first and last trace events deterministically', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    const firstEvent = viewModel.events[0];
    const lastEvent = viewModel.events.at(-1);

    expect(firstEvent).toMatchObject({
      date: 'Aug 4, 2026',
      time: '8:00 AM',
    });
    expect(lastEvent).toMatchObject({
      date: 'Aug 4, 2026',
      time: '1:01 PM',
    });
  });
});

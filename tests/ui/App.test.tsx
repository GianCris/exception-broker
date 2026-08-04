// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../../src/App.js';
import { simulateCase001 } from '../../src/domain/case-001.simulation.js';
import { createCase001ViewModel } from '../../src/presentation/case001ViewModel.js';

afterEach(cleanup);

describe('Exception Broker demo UI', () => {
  it('renders the official case without errors', () => {
    const simulation = simulateCase001();

    expect(() => render(<App />)).not.toThrow();
    expect(screen.getByText(new RegExp(simulation.caseId))).toBeInTheDocument();
  });

  it('shows all simulated plans in version order with their real statuses', () => {
    const simulation = simulateCase001();
    render(<App />);

    const cards = screen.getAllByTestId('plan-card');
    const orderedPlans = [...simulation.plans].sort(
      (left, right) => left.version - right.version,
    );

    expect(cards).toHaveLength(orderedPlans.length);
    orderedPlans.forEach((plan, index) => {
      const card = cards[index];
      expect(card).toBeDefined();
      expect(within(card!).getByText(plan.id)).toBeInTheDocument();
      expect(
        within(card!).getByText(
          plan.status
            .toLowerCase()
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' '),
        ),
      ).toBeInTheDocument();
    });
  });

  it('shows the real authorization value change', () => {
    const [change] = simulateCase001().authorizationChanges;
    expect(change).toBeDefined();
    render(<App />);

    expect(
      screen.getByLabelText(
        `${change!.previousValue} changed to ${change!.newValue}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(change!.reason)).toBeInTheDocument();
  });

  it('shows the three final actors and their real decisions', () => {
    const simulation = simulateCase001();
    const finalApprovals = simulation.approvals.filter(
      ({ planId }) => planId === simulation.finalPlanId,
    );
    render(<App />);

    for (const approval of finalApprovals) {
      expect(
        screen.getByRole('heading', {
          name:
            approval.actorRole.charAt(0).toUpperCase() +
            approval.actorRole.slice(1),
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByText(approval.decision)).not.toHaveLength(0);
    }
  });

  it('starts Decision Trace closed and opens to show simulated events', () => {
    const simulation = simulateCase001();
    render(<App />);

    const toggle = screen.getByRole('button', { name: /view decision trace/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(simulation.events[0]!.message)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(simulation.events[0]!.message)).toBeInTheDocument();
    expect(screen.getByText(simulation.events.at(-1)!.message)).toBeInTheDocument();
  });

  it('uses finalPlanId to select the final plan', () => {
    const simulation = simulateCase001();
    const selectedPlan = simulation.plans[0];
    expect(selectedPlan).toBeDefined();

    const viewModel = createCase001ViewModel({
      ...simulation,
      finalPlanId: selectedPlan!.id,
    });

    expect(viewModel.finalPlan?.id).toBe(selectedPlan!.id);
  });

  it('does not mutate the official simulation result while rendering', () => {
    const simulation = simulateCase001();
    const before = structuredClone(simulation);

    createCase001ViewModel(simulation);
    render(<App />);

    expect(simulation).toEqual(before);
  });
});

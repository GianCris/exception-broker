// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../../src/App.js';
import { simulateCase001 } from '../../src/domain/case-001.simulation.js';
import { createCase001ViewModel } from '../../src/presentation/case001ViewModel.js';

afterEach(cleanup);

describe('Exception Broker demo UI', () => {
  it('renders the derived case title and every simulated plan in view-model order', () => {
    const simulation = simulateCase001();
    const viewModel = createCase001ViewModel(simulation);
    render(<App />);

    expect(screen.getByRole('heading', { name: viewModel.header.title })).toBeInTheDocument();
    const cards = screen.getAllByTestId('plan-card');
    expect(cards).toHaveLength(viewModel.plans.length);
    viewModel.plans.forEach((plan, position) => {
      expect(within(cards[position]!).getByText(plan.id)).toBeInTheDocument();
      expect(within(cards[position]!).getByText(plan.statusLabel)).toBeInTheDocument();
    });
  });

  it('shows rejection evidence and the no-solution shortfall prepared by the view model', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    const rejected = viewModel.plans.find(({ explanation }) => explanation.kind === 'rejected');
    const blocked = viewModel.plans.find(({ explanation }) => explanation.kind === 'no-solution');
    expect(rejected?.explanation.kind).toBe('rejected');
    expect(blocked?.explanation.kind).toBe('no-solution');
    render(<App />);

    if (rejected?.explanation.kind === 'rejected') {
      expect(screen.getByText(`${rejected.explanation.proposedSubstitutes} substitutes proposed`)).toBeInTheDocument();
      expect(screen.getByText(`Client limit: ${rejected.explanation.clientLimit}`)).toBeInTheDocument();
    }
    if (blocked?.explanation.kind === 'no-solution') {
      expect(screen.getByText('required').previousSibling).toHaveTextContent(String(blocked.explanation.requiredTomorrow));
      expect(screen.getByText('available').previousSibling).toHaveTextContent(String(blocked.explanation.availableTomorrow));
      expect(screen.getByText(/Shortfall:/)).toHaveTextContent(String(blocked.explanation.shortfall));
    }
  });

  it('marks the final plan and displays its authorization unlock from simulation data', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    const change = viewModel.authorizationChanges[0];
    render(<App />);

    expect(screen.getByText('Final approved plan')).toBeInTheDocument();
    expect(screen.getByLabelText(`${change!.previousValue} changed to ${change!.newValue}`)).toBeInTheDocument();
    expect(screen.getAllByText(change!.reason)).not.toHaveLength(0);
  });

  it('shows only approvals belonging to the final plan', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    render(<App />);

    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes(String(viewModel.finalPlanId)) === true)).toBeInTheDocument();
    for (const approval of viewModel.approvals) {
      expect(approval.planId).toBe(viewModel.finalPlanId);
      expect(screen.getByRole('heading', { name: approval.roleLabel })).toBeInTheDocument();
    }
  });

  it('starts Decision Trace closed and opens to show simulated events', () => {
    const viewModel = createCase001ViewModel(simulateCase001());
    render(<App />);
    const toggle = screen.getByRole('button', { name: /view decision trace/i });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(viewModel.events[0]!.message)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(viewModel.events[0]!.message)).toBeInTheDocument();
    expect(screen.getByText(viewModel.events.at(-1)!.message)).toBeInTheDocument();
  });

  it('does not mutate the official simulation result', () => {
    const simulation = simulateCase001();
    const before = structuredClone(simulation);
    createCase001ViewModel(simulation);
    render(<App />);
    expect(simulation).toEqual(before);
  });

  it('references the SVG favicon and ships the requested symbol', () => {
    const html = readFileSync('index.html', 'utf8');
    const favicon = readFileSync('public/favicon.svg', 'utf8');
    expect(html).toContain('type="image/svg+xml" href="/favicon.svg"');
    expect(html).not.toContain('/favicon.ico');
    expect(favicon).toContain('<svg');
    expect(favicon.match(/<circle/g)).toHaveLength(4);
  });

  it('keeps business values out of React source files', () => {
    const sources = ['src/App.tsx', 'src/ui/CaseHeader.tsx', 'src/ui/PlanProgress.tsx', 'src/ui/AuthorizationChangeCard.tsx', 'src/ui/ApprovalCards.tsx'];
    const combined = sources.map((file) => readFileSync(file, 'utf8')).join('\n');
    const simulation = simulateCase001();
    for (const plan of simulation.plans) expect(combined).not.toContain(`>${plan.id}<`);
    expect(combined).not.toContain(`>${simulation.updatedCase.requestedQuantity}<`);
    expect(combined).not.toContain(`>${simulation.authorizationChanges[0]?.previousValue}<`);
    expect(combined).not.toContain(`>${simulation.authorizationChanges[0]?.newValue}<`);
  });
});

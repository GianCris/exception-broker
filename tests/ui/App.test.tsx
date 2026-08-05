// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/App.js';
import { createLocalSimulationInput, runDemo } from '../../src/demo/demoRunner.js';
import type { DemoRunResult, DemoRunnerInput } from '../../src/demo/demoTypes.js';
import { DemoExperience } from '../../src/ui/DemoExperience.js';

afterEach(cleanup);

const completed = async () => {
  const result = await runDemo(createLocalSimulationInput());
  if (result.status !== 'COMPLETED') throw new Error('Expected completed demo fixture');
  return result;
};

describe('Exception Broker safe demo UI', () => {
  it('starts IDLE with explicit safe mode and no premature resolution', () => {
    render(<App />);
    expect(screen.getByText(/local simulation/i)).toBeInTheDocument();
    expect(screen.getByText(/no real calls/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run exception resolution' })).toBeEnabled();
    expect(screen.getByText(/Ready\. Run the local demo/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /case resolved safely/i })).not.toBeInTheDocument();
  });

  it('executes once, disables during RUNNING, and blocks a double click', async () => {
    let resolve!: (value: DemoRunResult) => void;
    const runner = vi.fn(() => new Promise<DemoRunResult>((done) => { resolve = done; }));
    render(<DemoExperience runner={runner} createInput={createLocalSimulationInput} />);
    const button = screen.getByRole('button', { name: 'Run exception resolution' });
    fireEvent.click(button); fireEvent.click(button);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByText(/Running the deterministic local simulation/i)).toBeInTheDocument();
    await act(async () => resolve(await completed()));
    expect(screen.getByRole('heading', { name: 'Case resolved safely' })).toBeInTheDocument();
  });

  it('renders the complete evidence narrative and exactly nine runner steps', async () => {
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(await screen.findByRole('heading', { name: 'Case resolved safely' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /PLAN-001 · Rejected/i })).toBeInTheDocument();
    expect(screen.getByText('R-04')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByLabelText('50 changed to 100')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /PLAN-003 · Approved/i })).toBeInTheDocument();
    expect(screen.getByText('✓ supplier')).toBeInTheDocument();
    expect(screen.getByText('✓ production')).toBeInTheDocument();
    expect(screen.getByText('✓ client')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(9);
  });

  it('keeps Decision Trace closed and toggles the exact received steps', async () => {
    render(<App />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    const toggle = await screen.findByRole('button', { name: /view decision trace/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Request REQUEST-001')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Request REQUEST-001')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders the verified causal sequence once and in runner order', async () => {
    const result = await completed();
    render(<DemoExperience runner={vi.fn(async () => result)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    const renderedSteps = screen.getAllByRole('listitem').map((item) => within(item).getByRole('strong').textContent);
    expect(renderedSteps).toEqual(result.steps.map(({ type }) => type.replaceAll('_', ' ')));
    expect(new Set(renderedSteps).size).toBe(9);
  });

  it('links every displayed final approval to PLAN-003 and distinct trace identifiers', async () => {
    const result = await completed();
    render(<DemoExperience runner={vi.fn(async () => result)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    fireEvent.click(screen.getByRole('button', { name: /view decision trace/i }));
    for (const approver of result.caseNarrative.plan003.approvers) {
      const approval = screen.getByText(`Approval ${approver.approvalId}`);
      const traceItem = approval.closest('li');
      expect(traceItem).not.toBeNull();
      expect(within(traceItem!).getByText(`Plan ${result.caseNarrative.plan003.planId}`)).toBeInTheDocument();
      expect(within(traceItem!).getByText(`Request ${approver.requestId}`)).toBeInTheDocument();
      expect(within(traceItem!).getByText(`Operation ${approver.operationId}`)).toBeInTheDocument();
    }
  });

  it('renders FAILED without success or future invented steps', async () => {
    const full = await completed();
    const failure: DemoRunResult = {
      status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: full.runId,
      startedAt: full.startedAt, completedAt: full.completedAt,
      failedStep: 'CLIENT_APPROVAL', reason: 'Safe simulated failure',
      partialState: {
        exceptionCase: full.finalCase,
        plans: full.finalPlans.map((plan) => plan.id === full.caseNarrative.plan003.planId ? { ...plan, status: 'PENDING_APPROVAL' } : plan),
        approvals: full.approvals.filter(({ actorRole }) => actorRole !== 'client'),
        operationHistory: full.operationHistory,
        events: [], planRejectionEvidence: {
          planId: full.caseNarrative.plan001.planId as never,
          actorId: full.caseNarrative.plan001.actorId, decision: 'REJECTED',
          violatedRequirementIds: full.caseNarrative.plan001.reasonCodes,
          validationIssues: full.caseNarrative.plan001.validationIssues,
          summary: full.caseNarrative.plan001.summary,
        },
      },
      steps: full.steps.filter(({ type }) => !['CLIENT_APPROVED', 'PLAN-003_FINALIZED', 'CASE_RESOLVED'].includes(type)),
      caseNarrative: { plan001: full.caseNarrative.plan001, plan002: full.caseNarrative.plan002, authorization: full.caseNarrative.authorization },
      summary: 'CASE_NOT_RESOLVED',
    };
    render(<DemoExperience runner={vi.fn(async () => failure)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(screen.getByRole('heading', { name: 'Simulation stopped safely' })).toBeInTheDocument();
    expect(screen.getByText(/CLIENT_APPROVAL/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Case resolved safely' })).not.toBeInTheDocument();
    expect(screen.queryByText(/CASE RESOLVED/)).not.toBeInTheDocument();
  });

  it('renders BLOCKED without steps or fallback execution', async () => {
    const runner = vi.fn(async (): Promise<DemoRunResult> => ({
      status: 'BLOCKED', mode: 'LIVE_CALL_E', runId: 'BLOCKED-RUN', reason: 'MODE_NOT_AVAILABLE',
    }));
    render(<DemoExperience runner={runner} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(screen.getByRole('heading', { name: 'Demo blocked safely' })).toBeInTheDocument();
    expect(screen.getByText('MODE_NOT_AVAILABLE')).toBeInTheDocument();
    expect(screen.getByText(/No calls were made/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Resolution steps/i })).not.toBeInTheDocument();
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('keeps incomplete approvals neutral and omits future success steps', async () => {
    const full = await completed();
    const partialSteps = full.steps.filter(({ type }) => !['CLIENT_APPROVED', 'PLAN-003_FINALIZED', 'CASE_RESOLVED'].includes(type));
    const failure: DemoRunResult = {
      status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: full.runId,
      startedAt: full.startedAt, completedAt: full.completedAt,
      failedStep: 'CLIENT_APPROVAL', reason: 'Approval evidence incomplete',
      partialState: { exceptionCase: full.finalCase, plans: full.finalPlans,
        approvals: full.approvals.filter(({ actorRole }) => actorRole !== 'client'),
        operationHistory: full.operationHistory, events: [], planRejectionEvidence: null },
      steps: partialSteps,
      caseNarrative: { plan001: full.caseNarrative.plan001, plan002: full.caseNarrative.plan002, authorization: full.caseNarrative.authorization },
      summary: 'CASE_NOT_RESOLVED',
    };
    render(<DemoExperience runner={vi.fn(async () => failure)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(screen.getByRole('heading', { name: 'Simulation stopped safely' })).toBeInTheDocument();
    expect(screen.queryByText(/CLIENT APPROVED|PLAN-003 FINALIZED|CASE RESOLVED/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Case resolved safely' })).not.toBeInTheDocument();
  });

  it('does not invent authorization evidence when the partial narrative lacks it', async () => {
    const full = await completed();
    const failure: DemoRunResult = {
      status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: full.runId,
      startedAt: full.startedAt, completedAt: full.completedAt,
      failedStep: 'CASE_AUTHORIZATION', reason: 'Authorization evidence unavailable',
      partialState: { exceptionCase: full.finalCase, plans: full.finalPlans.slice(0, 2), approvals: [],
        operationHistory: [], events: [], planRejectionEvidence: null },
      steps: full.steps.slice(0, 2),
      caseNarrative: { plan001: full.caseNarrative.plan001, plan002: full.caseNarrative.plan002 },
      summary: 'CASE_NOT_RESOLVED',
    };
    render(<DemoExperience runner={vi.fn(async () => failure)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(screen.queryByLabelText('50 changed to 100')).not.toBeInTheDocument();
    expect(screen.queryByText('maxSubstituteQuantity')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Case resolved safely' })).not.toBeInTheDocument();
  });

  it('renders an empty last-safe state without unsafe values or false success', async () => {
    const full = await completed();
    const failure: DemoRunResult = {
      status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: full.runId,
      startedAt: full.startedAt, completedAt: full.completedAt,
      failedStep: 'CONFIGURATION', reason: 'No safe plan state available',
      partialState: { exceptionCase: full.finalCase, plans: [], approvals: [], operationHistory: [], events: [], planRejectionEvidence: null },
      steps: [], caseNarrative: {}, summary: 'CASE_NOT_RESOLVED',
    };
    const { container } = render(<DemoExperience runner={vi.fn(async () => failure)} createInput={createLocalSimulationInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(screen.getByText(/0 plan versions and 0 recorded decisions/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Infinity|NaN|undefined/);
    expect(screen.queryByRole('heading', { name: 'Case resolved safely' })).not.toBeInTheDocument();
  });

  it('does not mutate the explicit demo configuration passed by the UI', async () => {
    const explicitInput = createLocalSimulationInput();
    const before = structuredClone(explicitInput);
    const runner = vi.fn(async () => runDemo(explicitInput));
    render(<DemoExperience runner={runner} createInput={() => explicitInput} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run exception resolution' })));
    expect(explicitInput).toEqual(before);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('continues to reference the SVG favicon and its established symbol', () => {
    const html = readFileSync('index.html', 'utf8');
    const favicon = readFileSync('public/favicon.svg', 'utf8');
    expect(html).toContain('type="image/svg+xml" href="/favicon.svg"');
    expect(html).not.toContain('/favicon.ico');
    expect(favicon).toContain('<svg');
    expect(favicon.match(/<circle/g)).toHaveLength(4);
  });

  it('keeps scenario identifiers and historical values out of React source', () => {
    const sources = ['src/App.tsx', 'src/ui/DemoExperience.tsx', 'src/ui/DemoDecisionTrace.tsx']
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(sources).not.toMatch(/PLAN-001|PLAN-002|PLAN-003|REQUEST-00|OPERATION-00|APPROVAL-00/);
    expect(sources).not.toMatch(/>\s*(50|100|250|300)\s*</);
  });

  it('keeps React isolated from domain, CALL-E, environment, network, IDs, dates, and phones', () => {
    const sources = ['src/App.tsx', 'src/ui/DemoExperience.tsx', 'src/ui/DemoDecisionTrace.tsx']
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(sources).not.toMatch(/simulateCase001|src\/domain|CallEProvider|provider|adapter|mapper|DecisionBridge|DecisionApplication|process\.env|CALLE_API_KEY|fetch\s*\(|axios/i);
    expect(sources).not.toMatch(/Date\.now|new Date\(\)|Math\.random|randomUUID|phoneNumber|\+\d{7,}/);
  });

  it('provides semantic headings, live status, and a full-width mobile-safe action hook', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(/Resolve a supply exception/i);
    expect(screen.getByRole('button', { name: 'Run exception resolution' })).toHaveAttribute('type', 'button');
    expect(document.querySelector('.demo-state')).toHaveAttribute('aria-live', 'polite');
    expect(document.querySelector('.demo-mode-bar')).toBeInTheDocument();
  });
});

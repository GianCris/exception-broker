// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { App } from '../../src/App.js';
import { ProofExperience } from '../../src/ui/ProofExperience.js';
import { prepareProof, reviewProof } from '../../src/demo/proofDemo.js';
import { createReadyDecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';
import { createDecisionTransitionView } from '../../src/presentation/decisionTraceViewModel.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); window.localStorage.clear(); delete document.documentElement.dataset.theme; delete document.documentElement.dataset.themeMode; vi.useRealTimers(); vi.unstubAllGlobals(); });
const openReview = () => fireEvent.click(screen.getByRole('button', { name: 'Review exact proposal' }));
const resolveAttempt = () => act(() => vi.runOnlyPendingTimers());
const startApply = () => { openReview(); fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' })); };
const apply = () => { startApply(); resolveAttempt(); };
const select = (id: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${id} /`) }));
const revealSupporting = () => fireEvent.click(screen.getByText('Verify current decision'));
const attempt = () => screen.getByRole('region', { name: 'Application Attempt' });

describe('Evidence-to-decision primary experience', () => {
  it('defaults to accessible System theme and supports explicit persisted finishes', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const rendered = render(<App />);
    const theme = screen.getByRole('combobox', { name: 'Theme' });
    expect(theme).toHaveValue('system');
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'system');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    fireEvent.change(theme, { target: { value: 'light' } });
    expect(theme).toHaveValue('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    fireEvent.change(theme, { target: { value: 'dark' } });
    expect(theme).toHaveValue('dark');
    expect(window.localStorage.getItem('exception-broker-theme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    rendered.unmount();
    render(<App />);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
  });

  it('keeps System selection distinct and reacts to operating-system theme changes', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: (_type: string, next: (event: MediaQueryListEvent) => void) => { listener = next; },
      removeEventListener: vi.fn(),
    })));
    render(<App />);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('system');
    act(() => listener?.({ matches: true } as MediaQueryListEvent));
    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('system');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('keeps compressed queue truth and primary controls available in every theme', () => {
    render(<App />);
    const selected = screen.getByRole('button', { name: /^H02 \/.*NOT RESOLVED/ });
    expect(within(selected).getByText('APPROVED')).toBeVisible();
    expect(within(selected).getByText('EXACT REVIEW REQUIRED')).toBeVisible();
    expect(within(selected).getByText(/normalized decision is ready/i)).toBeVisible();
    expect(within(selected).getByText('Review exact proposal')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Decision control model' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
  });

  it('frames deterministic work as case-first product context without invented commercial data', () => {
    render(<App />);
    const selected = screen.getByRole('button', { name: /^H02 \/ Short physical supply/ });
    expect(within(selected).getByText('Short physical supply').tagName).toBe('STRONG');
    expect(within(selected).getByText('Demo case H02')).toBeVisible();
    const context = screen.getByRole('region', { name: 'Demo case context' });
    expect(within(context).getByRole('heading', { name: 'Short physical supply' })).toBeVisible();
    expect(within(context).getByText(/Supply exception.*Demo case H02/)).toBeVisible();
    expect(within(context).getByText('Deterministic workspace')).toBeVisible();
    expect(screen.getByText('Three independent deterministic demo cases.')).toBeVisible();
    expect(context).not.toHaveTextContent(/customer|order number|shipment|SLA/i);
  });

  it('starts on H02 with factual evidence and a genuine review pause, not a spoiled result', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /^H02 \// })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Verify current decision')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Technical result' })).not.toBeVisible();
    expect(screen.getByText('350 original + 100 substitute units')).toBeInTheDocument();
    expect(screen.queryByText('PLAN_PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByText('PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
  });

  it('H02 click exposes the real physical reason and operation-scoped zero effects', () => {
    render(<App />); apply();
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('Up to 180 substitute units')).toBeVisible();
    expect(within(explanation).getByText('150 substitute units required')).toBeVisible();
    expect(within(explanation).getByText('100 substitute units available')).toBeVisible();
    expect(within(explanation).getByText('50 substitute units unsupported')).toBeVisible();
    expect(within(explanation).getByText('Application stopped. No application effects created.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resolve the supply gap externally or revise the proposal' })).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('APPROVED')).toBeVisible();
    expect(screen.getByRole('button', { name: /^H02 \/.*BLOCK/ })).toHaveAttribute('aria-pressed', 'true');
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Technical result' })).toBeInTheDocument();
    expect(screen.getAllByText('PLAN_PHYSICALLY_INFEASIBLE').length).toBeGreaterThan(0);
    expect(screen.getByText('SUBSTITUTE_SUPPLY_EXCEEDED: 150 required / 100 available')).toBeInTheDocument();
    expect(screen.getByText('PLAN_VALID')).toBeInTheDocument();
    expect(screen.getAllByText(/same state reference/).length).toBeGreaterThan(0);
    const effects = screen.getByRole('heading', { name: 'Local effects of this attempt' }).parentElement!;
    expect(within(effects).getAllByText('0')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
  });

  it('H01 requires fresh visible role reviews and shows only local authorization', () => {
    render(<App />); select('H01');
    for (const role of ['client', 'production', 'supplier']) {
      openReview();
      expect(screen.getByRole('heading', { name: `Review the ${role} decision` })).toBeInTheDocument();
      expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' }));
      resolveAttempt();
    }
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('ALLOW', { exact: true })).toBeVisible();
    expect(within(explanation).getByText(/1 decision, 1 operation, and 1 event record created locally/)).toBeVisible();
    expect(within(explanation).getAllByText(/No external execution/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^H01 \/.*ALLOW/ })).toHaveAttribute('aria-pressed', 'true');
    revealSupporting();
    expect(screen.getAllByText('ALLOW', { exact: true }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Before this attempt: 2 decision records, 2 operations, 2 events/)).toBeInTheDocument();
    expect(screen.getByText(/No shipment, ERP\/WMS write, or external execution/)).toBeInTheDocument();
    const technical = screen.getByRole('region', { name: 'Technical basis & local effects' });
    expect(within(technical).getByText('PLAN_VALID')).toBeInTheDocument();
    expect(within(technical).getByText(/SUBSTITUTE: 150 required \/ 150 available/)).toBeInTheDocument();
    expect(within(technical).getByText(/Current in its lineage at the attempted snapshot/)).toBeInTheDocument();
    expect(within(technical).getByText('LINEAGE_RESOLVED', { exact: true })).toBeInTheDocument();
    expect(within(technical).getByText('New decision breakdown: 1 APPROVED / 0 REJECTED.')).toBeInTheDocument();
  });

  it('scenario switching and reset cannot carry a reviewed proposal or effects', () => {
    render(<App />); apply(); select('H01');
    expect(screen.queryByRole('heading', { name: 'Local effects of this attempt' })).not.toBeInTheDocument();
    expect(screen.queryByText('PLAN_PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.getAllByText(/CASE-PROOF-H01 \/ PLAN-PROOF-H01/).length).toBeGreaterThan(0);
    apply();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo case' }));
    openReview();
    expect(screen.getByRole('heading', { name: 'Review the client decision' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Local effects of this attempt' })).not.toBeInTheDocument();
    select('H02');
    expect(screen.getByText('350 original + 100 substitute units')).toBeInTheDocument();
  });

  it('H03 shows unaccepted claims and never offers review or fabricated feasibility', () => {
    render(<App />); select('H03');
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText(/Conflicting physical-supply claims prevent a trusted operational state/)).toBeVisible();
    expect(within(explanation).getByText('WAIT', { exact: true })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resolve the conflicting supply evidence' })).toBeVisible();
    expect(within(explanation).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Input claims — not a trusted snapshot' })).toBeInTheDocument();
    expect(screen.getAllByText('Unaccepted input claim')).toHaveLength(4);
    expect(screen.queryByText('Accepted evidence')).not.toBeInTheDocument();
    expect(screen.getByText(/No trusted case produced/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
    expect(screen.queryByText('PHYSICALLY_INFEASIBLE')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
  });

  it('DISCARD is a real result and cannot subsequently apply the same review', () => {
    render(<App />);
    openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(within(screen.getByRole('region', { name: 'Why this disposition' })).getByText('DISCARDED')).toBeVisible();
    expect(screen.queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    revealSupporting();
    expect(screen.getAllByText('DISCARDED_BY_REVIEWER').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Apply reviewed decision' })).not.toBeInTheDocument();
  });

  it('separates historical operator-reported live acquisition from deterministic application', () => {
    render(<App />);
    revealSupporting();
    fireEvent.click(screen.getByText('Observed live validation', { selector: 'summary' }));
    const historical = screen.getByRole('complementary', { name: 'Observed live validation' });
    expect(within(historical).getByText(/Not provenance for the selected deterministic demo case/)).toBeInTheDocument();
    expect(within(historical).getByText(/NOT DEMONSTRATED/)).toBeInTheDocument();
    expect(within(historical).getByText(/No original recording is bundled/)).toBeInTheDocument();
    expect(within(historical).getByText(/OPERATOR-LIVE-V1/)).toBeInTheDocument();
    expect(within(historical).getByText(/OPERATOR-LIVE-V2/)).toBeInTheDocument();
    expect(within(historical).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Configured ERP \/ WMS sources are not live connections/)).toBeInTheDocument();
    expect(screen.getByText(/authenticated reviewer identity.*NOT DEMONSTRATED/)).toBeInTheDocument();
    openReview();
    expect(screen.getByText(/not a live CALL-E response/)).toBeInTheDocument();
  });

  it('keeps deterministic Control composition free of network and clock mechanisms', () => {
    const sources = ['src/ui/ProofExperience.tsx', 'src/demo/proofDemo.ts', 'src/presentation/decisionTraceViewModel.ts']
      .map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(sources).not.toMatch(/fetch\s*\(|axios|process\.env|CALLE_API_KEY|new CallEProvider|Date\.now|new Date\(|Math\.random|randomUUID/);
    expect(sources).not.toMatch(/from ['"][^'"]*(?:callEProvider|mockProvider|\/adapter)\.js/);
    expect(sources).not.toContain('12/12');
  });

  it('renders an unknown technical failure as TECHNICAL STOP, not an operational WAIT or business-safety result', () => {
    const prepared = prepareProof('H02');
    const failed = { ...prepared, stopped: true, registration: { accepted: false as const, state: prepared.state!, failure: { source: 'STATE' as const, reason: 'UNKNOWN_PREPARATION_FAILURE' } } };
    render(<ProofExperience prepare={() => failed} review={reviewProof} />);
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('TECHNICAL STOP')).toBeVisible();
    expect(within(explanation).queryByText('WAIT', { exact: true })).not.toBeInTheDocument();
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Technical result' })).toBeInTheDocument();
    expect(screen.getByText('UNKNOWN_PREPARATION_FAILURE')).toBeInTheDocument();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/Only local plan registration has occurred/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pre-attempt snapshot assessments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
  });

  it('the browser App graph includes only the same-origin acquisition client and excludes provider/server execution', () => {
    const visited = new Set<string>();
    const browserNetworkFiles: string[] = [];
    const inspect = (path: string) => {
      if (visited.has(path)) return;
      visited.add(path);
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/@call-e\/calle|process\.env|CALLE_API_KEY|XMLHttpRequest|WebSocket/);
      if (source.includes('globalThis.fetch')) browserNetworkFiles.push(path);
      for (const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const base = resolve(dirname(path), match[1]!).replace(/\.js$/, '');
        const file = [`${base}.ts`, `${base}.tsx`].find(existsSync);
        if (file) inspect(file);
      }
    };
    inspect(resolve('src/App.tsx'));
    expect([...visited].some((path) => /callEProvider\.ts|mockProvider\.ts|[/\\]adapter\.ts$/.test(path))).toBe(false);
    expect(browserNetworkFiles).toEqual([resolve('src/acquisition/browserClient.ts')]);
    expect([...visited].some((path) => path.endsWith('adaptiveOrchestrator.ts'))).toBe(true);
    expect([...visited].some((path) => path.endsWith('decisionApplication.ts'))).toBe(true);
  });

  it('renders a real rejection as a new rejected decision record, never as a new approval', () => {
    const session = prepareProof('H01');
    if (!session.bridge?.ready) throw new Error('Bridge required');
    const rejected = reviewProof({ ...session, bridge: createReadyDecisionBridgeResult({ ...session.bridge.proposal, decision: 'REJECTED' }) }, 'APPLY');
    render(<ProofExperience prepare={() => rejected} review={reviewProof} />);
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('REJECTED', { exact: true })).toBeVisible();
    expect(within(explanation).getByText(/represented decision rejected the proposal/)).toBeVisible();
    expect(within(explanation).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    revealSupporting();
    expect(screen.getByRole('heading', { name: 'Technical result' })).toBeInTheDocument();
    expect(screen.getByText('PLAN_REJECTED', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('New decision breakdown: 0 APPROVED / 1 REJECTED.')).toBeInTheDocument();
    expect(screen.queryByText('New approvals')).not.toBeInTheDocument();
    expect(screen.getByText('New decision records')).toBeInTheDocument();
  });

  it('renders a three-item control queue from current deterministic snapshots without equating APPROVED to ALLOW', () => {
    render(<App />);
    const queue = screen.getByRole('complementary', { name: 'Needs attention' });
    expect(within(queue).getAllByRole('button')).toHaveLength(3);
    expect(within(queue).getAllByText('APPROVED')).toHaveLength(2);
    expect(within(queue).getAllByText('NOT RESOLVED')).toHaveLength(2);
    expect(within(queue).queryByText('ALLOW')).not.toBeInTheDocument();
    expect(within(queue).getByText('WAIT')).toBeInTheDocument();
  });

  it('keeps authority scope distinct from exact review completion in the side sheet', () => {
    render(<App />);
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeInTheDocument();
    expect(within(model).getByText('NOT RESOLVED')).toBeInTheDocument();
    openReview();
    const sheet = screen.getByRole('dialog', { name: 'Review the client decision' });
    expect(within(sheet).getByText(/Review applies to this exact proposal/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Synthetic decision input, not a live CALL-E response/)).toBeInTheDocument();
  });

  it('keeps supporting proof depth collapsed until deliberately revealed while primary control remains visible', () => {
    render(<App />);
    const disclosure = screen.getByText('Verify current decision').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible();
    expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeVisible();
    expect(within(model).getByText('Not evaluated for application')).toBeVisible();
    expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).getByText(/normalized decision is ready/)).toBeVisible();
    expect(screen.getByLabelText(/deterministic local proof with configured evidence.*No external execution/i)).toHaveClass('proof-mode');
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Trusted snapshot facts' })).not.toBeVisible();
    expect(screen.getByRole('heading', { name: 'Technical result' })).not.toBeVisible();
    revealSupporting();
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Trusted snapshot facts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current pending exact review' })).toBeInTheDocument();
    expect(screen.getByText('Operational evidence')).toBeInTheDocument();
    expect(screen.getByText('Exact review & application')).toBeInTheDocument();
    expect(screen.getByText('Technical basis & local effects')).toBeInTheDocument();
  });

  it('computes H02 APPLY exactly once and retains the coherent pre-attempt snapshot until reveal', () => {
    const review = vi.fn(reviewProof);
    render(<ProofExperience prepare={prepareProof} review={review} />);
    openReview();
    const applyButton = screen.getByRole('button', { name: 'Apply reviewed decision' });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton);
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(attempt()).toHaveClass('attempt-interrupted');
    expect(screen.getByText('Exact review bound')).toBeVisible();
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible();
    expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^H02 \/.*NOT RESOLVED/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset demo case' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(699));
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('BLOCK', { exact: true })).toBeVisible();
    expect(screen.getByText(/^Broker disposition BLOCK\./)).toHaveTextContent(/150 substitute units.*100/);
  });

  it('resolves an H01 intermediate attempt to WAIT and re-derives exact review authority for the next role', () => {
    const review = vi.fn(reviewProof);
    render(<ProofExperience prepare={prepareProof} review={review} />);
    select('H01');
    startApply();
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(attempt()).toHaveClass('attempt-suspended');
    resolveAttempt();
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(within(model).getByText('WAIT', { exact: true })).toBeVisible();
    expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review exact proposal' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
  });

  it('uses completed continuity only for a pending resolved ALLOW, not for the scenario name', () => {
    let session = prepareProof('H01');
    session = reviewProof(session, 'APPLY');
    session = reviewProof(session, 'APPLY');
    render(<ProofExperience prepare={() => session} review={reviewProof} />);
    startApply();
    expect(attempt()).toHaveClass('attempt-complete');
    resolveAttempt();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('ALLOW', { exact: true })).toBeVisible();
  });

  it('never creates an Application Attempt for opening review, DISCARD, H03, or a pre-apply technical stop', () => {
    render(<App />);
    openReview();
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Why this disposition' })).getByText('DISCARDED')).toBeVisible();
    select('H03');
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    cleanup();
    const prepared = prepareProof('H02');
    const failed = { ...prepared, stopped: true, registration: { accepted: false as const, state: prepared.state!, failure: { source: 'STATE' as const, reason: 'UNKNOWN_PREPARATION_FAILURE' } } };
    render(<ProofExperience prepare={() => failed} review={reviewProof} />);
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
  });

  it('uses an Application Attempt for a real REJECTED apply and resolves without BLOCK or WAIT', () => {
    const prepareRejected = () => {
      const session = prepareProof('H01');
      if (!session.bridge?.ready) throw new Error('Bridge required');
      return { ...session, bridge: createReadyDecisionBridgeResult({ ...session.bridge.proposal, decision: 'REJECTED' }) };
    };
    render(<ProofExperience prepare={prepareRejected} review={reviewProof} />);
    startApply();
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(attempt()).toHaveClass('attempt-neutral');
    resolveAttempt();
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('REJECTED', { exact: true })).toBeVisible();
    expect(within(explanation).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    expect(within(explanation).queryByText('WAIT', { exact: true })).not.toBeInTheDocument();
  });

  it('resolves an unclassified post-APPLY result to neutral TECHNICAL STOP', () => {
    const before = prepareProof('H02');
    const applied = reviewProof(before, 'APPLY');
    const priorAttempt = applied.attempts[0]!;
    const technical = { ...applied, state: priorAttempt.before, attempts: [{ ...priorAttempt, result: {
      accepted: false as const, state: priorAttempt.before, failure: { source: 'STATE' as const, reason: 'UNCLASSIFIED_AFTER_APPLY' },
    } }] };
    render(<ProofExperience prepare={() => before} review={() => technical} />);
    startApply();
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(attempt()).toHaveClass('attempt-neutral-stopped');
    resolveAttempt();
    const explanation = screen.getByRole('region', { name: 'Why this disposition' });
    expect(within(explanation).getByText('TECHNICAL STOP')).toBeVisible();
    expect(within(explanation).queryByText('WAIT', { exact: true })).not.toBeInTheDocument();
    expect(within(explanation).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
  });

  it('uses discrete reduced-motion stages without retaining normal reveal latency', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const review = vi.fn(reviewProof);
    render(<ProofExperience prepare={prepareProof} review={review} />);
    startApply();
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    expect(attempt()).toHaveClass('attempt-interrupted');
    expect(review).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('BLOCK', { exact: true })).toBeVisible();
    const styles = readFileSync('src/styles/app.css', 'utf8');
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.attempt-continuity span \{ animation: none; transform: none; \}/);
  });

  it('cleans a pending reveal timer on unmount without re-running review', () => {
    const review = vi.fn(reviewProof);
    const rendered = render(<ProofExperience prepare={prepareProof} review={review} />);
    startApply();
    expect(screen.getByRole('region', { name: 'Application Attempt' })).toBeVisible();
    rendered.unmount();
    expect(() => resolveAttempt()).not.toThrow();
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('creates no action receipt without APPLY or DISCARD and review inspection alone changes nothing', () => {
    render(<App />);
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Close exact review' }));
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    select('H03');
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    cleanup();
    const prepared = prepareProof('H02');
    const failed = { ...prepared, stopped: true, registration: { accepted: false as const, state: prepared.state!, failure: { source: 'STATE' as const, reason: 'UNKNOWN_PREPARATION_FAILURE' } } };
    render(<ProofExperience prepare={() => failed} review={reviewProof} />);
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
  });

  it('reveals one H02 receipt only after commit and separates established interpretation from zero local effects', () => {
    const review = vi.fn(reviewProof);
    render(<ProofExperience prepare={prepareProof} review={review} />);
    startApply();
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    resolveAttempt();
    const receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(within(receipt).getByText(/Decision stayed APPROVED.*represented supply was insufficient.*resolved to BLOCK.*No local application effects/s)).toBeVisible();
    fireEvent.click(within(receipt).getByText('Inspect comparison'));
    expect(within(receipt).getByText('State comparison')).toBeInTheDocument();
    expect(within(receipt).getByText('Local effects')).toBeInTheDocument();
    expect(within(receipt).getAllByText('APPROVED', { exact: true })).toHaveLength(2);
    expect(within(receipt).getByText('ESTABLISHED BY THIS ATTEMPT')).toBeInTheDocument();
    expect(within(receipt).getByText('Modeled supply snapshot is insufficient')).toBeInTheDocument();
    expect(within(receipt).queryByText(/Operational reality changed/i)).not.toBeInTheDocument();
    expect(within(receipt).getAllByText('0')).toHaveLength(3);
  });

  it('tracks exact H01 review targets even while headline authority or WAIT remains unchanged', () => {
    render(<App />); select('H01'); apply();
    let receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(within(receipt).getByText(/Decision stayed APPROVED.*target changed from Client to Production.*resolved to WAIT/s)).toBeVisible();
    fireEvent.click(within(receipt).getByText('Inspect comparison'));
    expect(within(receipt).getByText('Exact review required · client')).toBeInTheDocument();
    expect(within(receipt).getByText('Exact review required · production')).toBeInTheDocument();
    apply();
    receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(screen.getAllByRole('heading', { name: 'What Changed?' })).toHaveLength(1);
    expect(within(receipt).getByText(/Decision stayed APPROVED.*target changed from Production to Supplier.*disposition remains WAIT/s)).toBeVisible();
    fireEvent.click(within(receipt).getByText('Inspect comparison'));
    expect(within(receipt).getByText('Exact review required · production')).toBeInTheDocument();
    expect(within(receipt).getByText('Exact review required · supplier')).toBeInTheDocument();
    expect(within(receipt).getAllByText('WAIT', { exact: true })).toHaveLength(2);
    expect(within(receipt).getAllByText('UNCHANGED').length).toBeGreaterThan(0);
    apply();
    receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(within(receipt).getByText(/Decision stayed APPROVED.*resolved to ALLOW/s)).toBeVisible();
    fireEvent.click(within(receipt).getByText('Inspect comparison'));
    expect(within(receipt).getByText('Review submitted · supplier')).toBeInTheDocument();
    expect(within(receipt).getByText('ALLOW', { exact: true })).toBeInTheDocument();
  });

  it('records DISCARD immediately without an Application Attempt or application evaluation', () => {
    const review = vi.fn(reviewProof);
    render(<ProofExperience prepare={prepareProof} review={review} />);
    openReview(); fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(review).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('Not evaluated for application')).toBeVisible();
    const receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(within(receipt).getByText(/No Application Attempt occurred.*No application evaluation occurred.*No local application effects/s)).toBeVisible();
    fireEvent.click(within(receipt).getByText('Inspect comparison'));
    expect(within(receipt).getAllByText('Not evaluated for application')).toHaveLength(2);
    expect(within(receipt).getByText('Review discarded · client')).toBeInTheDocument();
  });

  it('keeps a real rejected transition neutral and distinct from BLOCK or WAIT', () => {
    const prepareRejected = () => {
      const session = prepareProof('H01');
      if (!session.bridge?.ready) throw new Error('Bridge required');
      return { ...session, bridge: createReadyDecisionBridgeResult({ ...session.bridge.proposal, decision: 'REJECTED' }) };
    };
    render(<ProofExperience prepare={prepareRejected} review={reviewProof} />);
    startApply(); resolveAttempt();
    const receipt = screen.getByRole('heading', { name: 'What Changed?' }).parentElement!;
    expect(within(receipt).getByText(/Broker disposition resolved to REJECTED/)).toBeVisible();
    expect(within(receipt).queryByText(/now BLOCK|now WAIT/)).not.toBeInTheDocument();
  });

  it('clears a receipt on reset or scenario switch, but not when review is opened and closed', () => {
    render(<App />); select('H01'); apply();
    expect(screen.getByRole('heading', { name: 'What Changed?' })).toBeInTheDocument();
    openReview(); fireEvent.click(screen.getByRole('button', { name: 'Close exact review' }));
    expect(screen.getByRole('heading', { name: 'What Changed?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset demo case' }));
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
    apply(); select('H02');
    expect(screen.queryByRole('heading', { name: 'What Changed?' })).not.toBeInTheDocument();
  });

  it('keeps current verification and observed live validation separate and collapsed', () => {
    render(<App />);
    const current = screen.getByText('Verify current decision').closest('details')!;
    const historical = screen.getByText('Observed live validation', { selector: 'summary' }).closest('details')!;
    expect(current).not.toHaveAttribute('open');
    expect(historical).not.toHaveAttribute('open');
    expect(current).not.toContainElement(historical);
    fireEvent.click(current.querySelector('summary')!);
    expect(within(current).getByText('Operational evidence')).toBeInTheDocument();
    expect(within(current).getByText('Exact review & application')).toBeInTheDocument();
    expect(within(current).getByText('Technical basis & local effects')).toBeInTheDocument();
    expect(within(current).queryByText('Observed live validation')).not.toBeInTheDocument();
    fireEvent.click(historical.querySelector('summary')!);
    expect(within(historical).getByText(/Not replayed by this browser/)).toBeInTheDocument();
    expect(within(historical).getByText(/Not provenance for the selected deterministic demo case/)).toBeInTheDocument();
    expect(within(historical).queryByRole('button')).not.toBeInTheDocument();
  });

  it('traps modal focus, closes on Escape, and returns focus to the review trigger', () => {
    render(<App />);
    const trigger = screen.getByRole('button', { name: 'Review exact proposal' });
    fireEvent.click(trigger);
    expect((trigger.closest('.proof-shell')?.firstElementChild as HTMLElement).inert).toBe(true);
    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close exact review' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('derives receipt semantics without scenario identifiers or ordinal progress geometry', () => {
    const before = prepareProof('H02');
    const after = reviewProof(before, 'APPLY');
    const transition = createDecisionTransitionView({ beforeSession: before, afterSession: after, action: 'APPLY' });
    expect(transition.comparison.find(({ label }) => label === 'Exact proposal')?.before).toContain('PLAN-PROOF-H02');
    const presentation = readFileSync('src/presentation/decisionTraceViewModel.ts', 'utf8');
    const transitionSource = presentation.slice(presentation.indexOf('export const createDecisionTransitionView'), presentation.indexOf('// Provenance:'));
    expect(transitionSource).not.toMatch(/inputs\.scenario|scenario\s*===|['"]H0[123]['"]/);
    const ui = readFileSync('src/ui/ProofExperience.tsx', 'utf8');
    expect(ui).not.toMatch(/continuity:\s*['"]\d+%/);
    const styles = readFileSync('src/styles/app.css', 'utf8');
    expect(styles).toMatch(/@media \(max-width: 1050px\)[\s\S]*\.application-attempt \{ grid-template-columns: 1fr; \}/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.proof-table-scroll \{ max-width: 100%; overflow-x: auto; \}/);
  });

  it('contains long technical identifiers within local proof surfaces instead of the page grid', () => {
    const styles = readFileSync('src/styles/app.css', 'utf8');
    expect(styles).toMatch(/\.proof-effects \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(styles).toMatch(/\.proof-effects > div \{ min-width:\s*0;/);
    expect(styles).not.toMatch(/\.receipt-depth dl > div|\.receipt-depth dd \{ display:\s*grid/);
    expect(styles).toMatch(/\.state-comparison dl > div[^}]*grid-template-columns:\s*135px minmax\(0, 1fr\)/s);
    expect(styles).toMatch(/\.control-workspace[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s);
    expect(styles).toMatch(/\.receipt-depth dd[^}]*overflow-wrap:\s*anywhere/s);
    expect(styles).toMatch(/\.proof-table-scroll \{ max-width:\s*100%;[^}]*overscroll-behavior-inline:\s*contain;/);
    expect(styles).toMatch(/\.proof-shell pre \{ max-width:\s*100%; overflow-x:\s*auto;/);
  });

  it('assigns evidence, exact review, and technical effects to their truthful verification groups', () => {
    render(<App />); apply(); revealSupporting();
    const operational = screen.getByRole('region', { name: 'Operational evidence' });
    const exact = screen.getByRole('region', { name: 'Exact review & application' });
    const technical = screen.getByRole('region', { name: 'Technical basis & local effects' });
    expect(within(operational).getByRole('table', { name: 'Assembly: ACCEPTED' })).toBeInTheDocument();
    expect(within(exact).getByText('Completed review/application attempts')).toBeInTheDocument();
    expect(within(exact).getByText('Bound review target retained')).toBeInTheDocument();
    expect(within(exact).queryByText('Technical result')).not.toBeInTheDocument();
    expect(within(exact).queryByText('Local effects of this attempt')).not.toBeInTheDocument();
    expect(within(technical).getByText('PLAN_VALID')).toBeInTheDocument();
    expect(within(technical).getByText('PHYSICALLY_INFEASIBLE')).toBeInTheDocument();
    expect(within(technical).getByText('Local effects of this attempt')).toBeInTheDocument();
    expect(within(technical).getAllByText('0')).toHaveLength(3);
  });

  it('keeps each completed H01 attempt distinct from the next pending exact review', () => {
    render(<App />); select('H01'); apply(); revealSupporting();
    let exact = screen.getByRole('region', { name: 'Exact review & application' });
    let pending = within(exact).getByRole('region', { name: 'Current pending exact review' });
    let completed = within(exact).getByRole('region', { name: 'Completed review/application attempts' });
    expect(within(pending).getByText(/ACTOR-PROOF-H01-production \/ production/)).toBeInTheDocument();
    expect(within(pending).getByText('REQUEST-PLAN-PROOF-H01-production')).toBeInTheDocument();
    expect(within(completed).getByText(/Attempt 1 · client/)).toBeInTheDocument();
    expect(within(completed).getByText(/ACTOR-PROOF-H01-client \/ client/)).toBeInTheDocument();
    expect(within(completed).getByText('REQUEST-PLAN-PROOF-H01-client')).toBeInTheDocument();
    apply();
    exact = screen.getByRole('region', { name: 'Exact review & application' });
    pending = within(exact).getByRole('region', { name: 'Current pending exact review' });
    completed = within(exact).getByRole('region', { name: 'Completed review/application attempts' });
    expect(within(pending).getByText(/ACTOR-PROOF-H01-supplier \/ supplier/)).toBeInTheDocument();
    expect(within(pending).getByText('REQUEST-PLAN-PROOF-H01-supplier')).toBeInTheDocument();
    expect(within(completed).getByText(/Attempt 2 · production/)).toBeInTheDocument();
    expect(within(completed).getByText(/ACTOR-PROOF-H01-production \/ production/)).toBeInTheDocument();
    expect(within(completed).getByText('REQUEST-PLAN-PROOF-H01-production')).toBeInTheDocument();
  });

  it('keeps event and lineage evidence with technical effects after final H01 application', () => {
    render(<App />); select('H01'); apply(); apply(); apply(); revealSupporting();
    const technical = screen.getByRole('region', { name: 'Technical basis & local effects' });
    expect(within(technical).getByText('Local effects of this attempt')).toBeInTheDocument();
    fireEvent.click(within(technical).getByText('Event and lineage evidence'));
    expect(within(technical).getByText(/EVENT-PLAN-PROOF-H01-supplier/)).toBeInTheDocument();
    expect(within(technical).getByText(/Lineage-scoped resolution: CASE-PROOF-H01/)).toBeInTheDocument();
  });

  it('returns post-action focus to the stable control model without revealing pending APPLY outcome', () => {
    render(<App />);
    openReview(); fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' }));
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(model).toHaveFocus();
    expect(model.parentElement?.parentElement).not.toHaveAttribute('inert');
    expect(screen.getByRole('region', { name: 'Application Attempt' })).not.toHaveFocus();
    expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
  });

  it('returns post-DISCARD focus to the stable control model and restores the background', () => {
    render(<App />);
    openReview(); fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const model = screen.getByRole('region', { name: 'Decision control model' });
    expect(model).toHaveFocus();
    expect(model.parentElement?.parentElement).not.toHaveAttribute('inert');
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Changed?' })).not.toHaveFocus();
  });
});

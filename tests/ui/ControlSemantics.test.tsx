// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import type { AcquisitionBrowserApi } from '../../src/acquisition/browserClient.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { proofScenarios } from '../../src/demo/proofDemo.js';
import { acquisitionAccessKey } from '../../src/ui/AcquisitionExperience.js';
import { controlSessionStorageKey, LiveControlExperience } from '../../src/ui/LiveControlExperience.js';
import { walkthroughHash } from '../../src/ui/GuidedWalkthroughExperience.js';

/**
 * CONTROL WORKSPACE is not CONTROL PROOF.
 *
 * Control means "the workspace for an acquired decision"; the deterministic H01/H02/H03
 * cases are an independent surface for verifying ALLOW / BLOCK / WAIT behaviour. These
 * tests pin that separation from every surface, because the failure they replace was
 * precisely a nav item whose label said one thing and whose destination meant another.
 */

const nav = () => within(screen.getByRole('navigation', { name: 'Primary navigation' }));
const goControl = () => fireEvent.click(nav().getByRole('button', { name: 'Control' }));
const gateTitle = () => screen.queryByRole('heading', { name: 'Control starts with an acquired decision.' });
const proofContext = () => screen.queryByText('Deterministic proof');
const setHash = (hash: string) => { window.history.replaceState(null, '', hash === '' ? '/' : hash); };
const scenarioTitle = (id: string) => new RegExp(proofScenarios.find((scenario) => scenario.id === id)!.title);

const liveRecord = (): LiveControlPublicRecord => ({
  controlSessionId: 'CONTROL-ACQ-LIVE-1', acquisitionId: 'ACQ-LIVE-1', definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1,
  sourceBinding: { acquisitionId: 'ACQ-LIVE-1', callId: 'CALL-LIVE-1', requestId: 'REQUEST-LIVE-1', receivedAt: '2027-07-01T17:00:00-05:00', terminalAt: '2027-07-01T17:00:00-05:00', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' },
  provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' }, status: 'AWAITING_REVIEW',
  reviewTarget: { operationType: 'PLAN_DECISION', requestId: 'REQUEST-LIVE-1', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', decision: 'APPROVED', summary: 'Live Client approved.', proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'], completionConfidence: { score: .93, label: 'high' }, receivedAt: '2027-07-01T17:00:00-05:00', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' },
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', planVersion: 1, actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', createdAt: '2027-07-01T17:05:00-05:00',
});
const noopApi = (): AcquisitionBrowserApi => ({ connectHosted: vi.fn(), connectByok: vi.fn(), getConnection: vi.fn(), disconnect: vi.fn(), getActive: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), handoff: vi.fn(), getControl: vi.fn(), review: vi.fn() });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setHash(''); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setHash(''); });

describe('Primary Control navigation resolves to the Control workspace', () => {
  it('never opens deterministic proof from Home', () => {
    render(<App />);
    goControl();
    expect(gateTitle()).toBeVisible();
    expect(proofContext()).not.toBeInTheDocument();
  });

  it('never opens deterministic proof from Acquisition', () => {
    render(<App />);
    fireEvent.click(nav().getByRole('button', { name: 'Acquisition' }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    goControl();
    expect(gateTitle()).toBeVisible();
    expect(proofContext()).not.toBeInTheDocument();
  });

  it('never opens deterministic proof from the Interactive Demo', () => {
    setHash(walkthroughHash);
    render(<App />);
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
    goControl();
    expect(gateTitle()).toBeVisible();
    expect(proofContext()).not.toBeInTheDocument();
  });

  it('leads out of Control Proof rather than to another proof state', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: scenarioTitle('H02') }));
    expect(screen.getByText('Deterministic proof')).toBeVisible();
    goControl();
    expect(gateTitle()).toBeVisible();
    expect(proofContext()).not.toBeInTheDocument();
  });

  it('stays in the live workspace from Live Control instead of jumping to H01/H02/H03', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1');
    render(<App />);
    goControl();
    expect(screen.getByText('Live control')).toBeVisible();
    expect(proofContext()).not.toBeInTheDocument();
    expect(gateTitle()).not.toBeInTheDocument();
    await waitFor(() => expect(nav().getByRole('button', { name: 'Control' })).toHaveAttribute('aria-current', 'page'));
  });
});

describe('Control Gate', () => {
  it('is the honest empty state, fabricating no decision and no operational truth', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<App />);
    goControl();
    const gate = screen.getByRole('region', { name: /Control starts with an acquired decision/ });
    expect(within(gate).getByText(/Exception Broker first acquires a usable decision/)).toBeVisible();
    // No fabricated decision, disposition, case or H02 supply quantity anywhere on it.
    expect(gate.textContent).not.toMatch(/APPROVED|REJECTED|ALLOW|BLOCK|WAIT|H0[123]|CASE-|PLAN-/);
    expect(gate.textContent).not.toMatch(/\d+\s*(units|substitutes)/i);
    // The prerequisite is a decision, not credentials: acquisition may be BYOK or hosted.
    expect(gate.textContent).not.toMatch(/API key|configure your api/i);
    expect(screen.queryByRole('region', { name: 'Decision control model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Control the active primary module while offering three unequal exits', () => {
    render(<App />);
    goControl();
    expect(nav().getByRole('button', { name: 'Control' })).toHaveAttribute('aria-current', 'page');
    const gate = screen.getByRole('region', { name: /Control starts with an acquired decision/ });
    // Acquire, then learn, then verify — expressed in the markup, not three equal buttons.
    expect(within(gate).getByRole('button', { name: /Acquire a decision/ })).toHaveClass('gate-primary');
    expect(within(gate).getByRole('button', { name: /Interactive demo/ })).toHaveClass('gate-secondary');
    expect(within(gate).getByRole('button', { name: /Explore Control proof/ })).toHaveClass('gate-quiet');
  });

  it('routes its primary exit to Acquisition', () => {
    render(<App />);
    goControl();
    fireEvent.click(screen.getByRole('button', { name: /Acquire a decision/ }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
  });

  it('routes its secondary exit to the Interactive Demo', () => {
    render(<App />);
    goControl();
    const gate = screen.getByRole('region', { name: /Control starts with an acquired decision/ });
    fireEvent.click(within(gate).getByRole('button', { name: /Interactive demo/ }));
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
  });

  it('offers the same shared Interactive demo action in the topbar as Home and Acquisition', () => {
    render(<App />);
    const topbarAction = () => within(screen.getByRole('navigation', { name: 'Primary navigation' }).closest('header')!)
      .getByRole('button', { name: /Interactive demo/ });
    // One component, so one class list and one label on all three surfaces.
    const home = topbarAction().className;
    fireEvent.click(nav().getByRole('button', { name: 'Acquisition' }));
    expect(topbarAction().className).toBe(home);
    goControl();
    expect(gateTitle()).toBeVisible();
    expect(topbarAction().className).toBe(home);
    expect(topbarAction().className).toContain('shell-slot');
    fireEvent.click(topbarAction());
    expect(screen.getByText('Step 1 of 6')).toBeVisible();
  });

  it('renders the dormant Control architecture instead of a generic empty card', () => {
    render(<App />);
    goControl();
    // Control is visibly the module the user asked for: its architecture is drawn, and
    // every region of it states that it is unavailable rather than showing a value.
    const architecture = screen.getByRole('group', { name: 'Control architecture, dormant' });
    for (const [region, state] of [
      ['Decision', 'Awaiting acquired decision'], ['Exact review', 'Not available yet'],
      ['Application boundary', 'NOT AVAILABLE'], ['Operational reality', 'Not evaluated'],
      ['Broker disposition', 'No disposition'],
    ] as const) {
      expect(within(architecture).getByText(region)).toBeVisible();
      expect(within(architecture).getByText(state)).toBeVisible();
    }
    // Dormant means dormant: no quantity, no case, no disposition anywhere on the canvas.
    expect(architecture.textContent).not.toMatch(/APPROVED|REJECTED|ALLOW|BLOCK|WAIT|H0[123]|CASE-|PLAN-|\d/);
    // And Control's own environment stays out of an empty workspace.
    expect(document.querySelector('.rail-scene')).toBeNull();
    expect(document.querySelector('.control-queue')).toBeNull();
  });

  it('draws the whole instrument as a ghost that carries structure and no state', () => {
    render(<App />);
    goControl();
    // Every region of the real instrument is present in silhouette, so the workspace reads
    // as Control waiting rather than as a page with nothing on it.
    const ghosts = document.querySelectorAll('.ghost-panel');
    expect(ghosts).toHaveLength(4);
    for (const ghost of ghosts) {
      // Bars, never glyphs: there is nothing in the ghost that could be read as a
      // decision, a quantity or a disposition, because it contains no text at all.
      expect(ghost.textContent).toBe('');
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
    }
    // Nowhere on the canvas — ghost included — is a single operational value invented.
    const canvas = document.querySelector('.control-dormant-canvas')!;
    expect(canvas.textContent).not.toMatch(/APPROVED|REJECTED|ALLOW|BLOCK|WAIT|H0[123]|CASE-|PLAN-/);
    expect(canvas.textContent).not.toMatch(/\d/);
  });

  it('routes its quiet exit to Control Proof, not back into the workspace', () => {
    render(<App />);
    goControl();
    fireEvent.click(screen.getByRole('button', { name: /Explore Control proof/ }));
    expect(screen.getByText('Deterministic proof')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Proof case context' })).toBeVisible();
  });
});

describe('Control workspace resolution', () => {
  it('uses a currently held usable Live Control record', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={noopApi()} initial={liveRecord()} onNavigateAcquisition={vi.fn()} onNavigateControl={vi.fn()} />);
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible();
    expect(screen.getByText('Live control')).toBeVisible();
  });

  it('sends a persisted session pointer through the existing recovery path when access is gone', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-LOCAL-RESUME');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    goControl();
    // The honest recovery state, not a Gate and never a fabricated record.
    expect(screen.getByRole('heading', { name: 'Live Control recovery locked' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reconnect CALL-E' })).toBeVisible();
    expect(gateTitle()).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-LOCAL-RESUME');
  });

  it('renders recovery in the same dormant Control canvas while staying recovery, not the Gate', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-LOCAL-RESUME');
    render(<App />);
    // Same canvas language as the Gate...
    expect(screen.getByRole('group', { name: 'Control architecture, dormant' })).toBeVisible();
    expect(document.querySelector('.rail-scene')).toBeNull();
    // ...and a different, honest truth: a saved session exists and is preserved.
    const announcement = screen.getByRole('region', { name: 'Live Control recovery locked' });
    expect(within(announcement).getByText(/A saved Control session exists/)).toBeVisible();
    expect(within(announcement).getByText(/session pointer is preserved/)).toBeVisible();
    expect(within(announcement).getByRole('button', { name: /Reconnect CALL-E/ })).toHaveClass('gate-primary');
    expect(within(announcement).getByRole('button', { name: /Start a new acquisition/ })).toHaveClass('gate-secondary');
    expect(gateTitle()).not.toBeInTheDocument();
    expect(announcement.textContent).not.toMatch(/APPROVED|ALLOW|BLOCK|WAIT/);
    expect(fetch).not.toHaveBeenCalled();
    // Leaving through either exit never deletes or rewrites the pointer.
    fireEvent.click(within(announcement).getByRole('button', { name: /Start a new acquisition/ }));
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-LOCAL-RESUME');
  });

  it('keeps a stored Control session intact while visiting proof, walkthrough, home and acquisition', () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-LOCAL-RESUME');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Live Control recovery locked' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    fireEvent.click(screen.getByRole('button', { name: /View all scenarios/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Exception Broker home' }));
    fireEvent.click(screen.getByRole('button', { name: 'See it in action' }));
    fireEvent.click(nav().getByRole('button', { name: 'Acquisition' }));
    expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-LOCAL-RESUME');
    // And Control still returns to that workspace's own recovery, not to the Gate.
    goControl();
    expect(screen.getByRole('heading', { name: 'Live Control recovery locked' })).toBeVisible();
    expect(gateTitle()).not.toBeInTheDocument();
  });
});

describe('Control Proof stays independently reachable with unchanged semantics', () => {
  it.each(proofScenarios)('opens $id from the Home proof cards with its deterministic context', ({ id, title }) => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(title) }));
    expect(screen.getByRole('region', { name: 'Proof case context' })).toHaveTextContent(`Proof case ${id}`);
    const context = screen.getByLabelText(/deterministic local proof with configured evidence.*No external execution/i);
    expect(within(context).getByText('Deterministic proof')).toBeVisible();
    expect(within(context).getByText('Configured evidence · local only · no external execution')).toBeVisible();
  });

  // H01's full three-role ALLOW path and H02's effects are already covered in depth by
  // ProofExperience.test.tsx; this only re-pins that reaching the proof through its new
  // entry points still evaluates through the same Broker.
  it('still produces the unchanged H02 BLOCK disposition through a proof entry point', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: scenarioTitle('H02') }));
    fireEvent.click(screen.getByRole('button', { name: /Review exact proposal/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply reviewed decision' }));
    const model = within(screen.getByRole('region', { name: 'Decision control model' }));
    expect(model.getByText('BLOCK', { exact: true })).toBeVisible();
    expect(model.getByText('PLAN_PHYSICALLY_INFEASIBLE')).toBeVisible();
    expect(model.getByRole('heading', { name: 'APPROVED' })).toBeVisible();
  });

  it('keeps H03 WAIT unreviewable because no trusted operational state exists', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: scenarioTitle('H03') }));
    expect(screen.queryByRole('button', { name: 'Review exact proposal' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Decision control model' })).getByText('WAIT', { exact: true })).toBeVisible();
  });

  it('describes deterministic scenarios as proof rather than as a demo', () => {
    render(<App />);
    expect(screen.getAllByText(/Open proof/)).toHaveLength(proofScenarios.length);
    fireEvent.click(screen.getByRole('button', { name: /View all scenarios/ }));
    expect(screen.getByText('Three independent deterministic proof cases.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset proof case' })).toBeVisible();
    expect(screen.queryByText(/Demo case|Reset demo case|deterministic demo/i)).not.toBeInTheDocument();
  });
});

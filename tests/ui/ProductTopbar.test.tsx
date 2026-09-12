// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { App } from '../../src/App.js';
import type { AcquisitionBrowserApi } from '../../src/acquisition/browserClient.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { acquisitionAccessKey } from '../../src/ui/AcquisitionExperience.js';
import { LiveControlExperience } from '../../src/ui/LiveControlExperience.js';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(cleanup);

const topbar = () => screen.getByRole('navigation', { name: 'Primary navigation' }).closest('header')!;
const nav = () => within(screen.getByRole('navigation', { name: 'Primary navigation' }));
const currentRoute = () => nav().getAllByRole('button').find((button) => button.getAttribute('aria-current') === 'page')?.textContent;
const goto = (route: 'Home' | 'Acquisition' | 'Control') => fireEvent.click(nav().getByRole('button', { name: route }));

const liveRecord = (): LiveControlPublicRecord => ({
  controlSessionId: 'CONTROL-ACQ-LIVE-1', acquisitionId: 'ACQ-LIVE-1', definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1,
  sourceBinding: { acquisitionId: 'ACQ-LIVE-1', callId: 'CALL-LIVE-1', requestId: 'REQUEST-LIVE-1', receivedAt: '2027-07-01T17:00:00-05:00', terminalAt: '2027-07-01T17:00:00-05:00', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' },
  provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' }, status: 'AWAITING_REVIEW',
  reviewTarget: { operationType: 'PLAN_DECISION', requestId: 'REQUEST-LIVE-1', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', decision: 'APPROVED', summary: 'Live Client approved.', proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'], completionConfidence: { score: .93, label: 'high' }, receivedAt: '2027-07-01T17:00:00-05:00', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' },
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', planVersion: 1, actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', createdAt: '2027-07-01T17:05:00-05:00',
});
const noopApi = () => ({ connectHosted: vi.fn(), connectByok: vi.fn(), getConnection: vi.fn(), disconnect: vi.fn(), getActive: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), handoff: vi.fn(), getControl: vi.fn(), review: vi.fn() } as AcquisitionBrowserApi);

describe('Shared product topbar', () => {
  it('renders one topbar implementation with the same brand and navigation on every route', () => {
    render(<App />);
    for (const route of ['Home', 'Acquisition', 'Control'] as const) {
      goto(route);
      // One header, one navigation, one brand asset — no route-specific copies.
      expect(screen.getAllByRole('navigation', { name: 'Primary navigation' })).toHaveLength(1);
      expect(within(topbar()).getByAltText('Exception Broker logo')).toHaveAttribute('src', '/images/home/exception-broker-logo-transparent.png');
      expect(within(topbar()).getByRole('button', { name: 'Exception Broker home' })).toBeVisible();
      expect(within(topbar()).getByRole('combobox', { name: 'Theme' })).toBeVisible();
      expect(nav().getAllByRole('button').map((button) => button.textContent)).toEqual(['Home', 'Acquisition', 'Control']);
      expect(currentRoute()).toBe(route);
    }
  });

  it('marks exactly one navigation item current per route and routes Live Control under Control', () => {
    render(<App />);
    expect(currentRoute()).toBe('Home');
    goto('Acquisition');
    expect(nav().getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'page')).toHaveLength(1);
    expect(currentRoute()).toBe('Acquisition');
    cleanup();
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={noopApi()} initial={liveRecord()} onNavigateAcquisition={() => undefined} onNavigateControl={() => undefined} />);
    expect(currentRoute()).toBe('Control');
  });

  it('exposes the learning entry as Guided walkthrough and never as a demo that does not exist', () => {
    render(<App />);
    // Home and Acquisition may open the walkthrough; the label says exactly what it opens.
    expect(within(topbar()).getByRole('button', { name: /Guided walkthrough/ })).toBeVisible();
    goto('Acquisition');
    expect(within(topbar()).getByRole('button', { name: /Guided walkthrough/ })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Try demo|Start demo|Run demo|View proof/i);
  });

  it('replaces the proof action with a truthful context badge once the user is inside the proof', () => {
    render(<App />);
    // Control Proof is reached by an explicit proof entry point, never by primary Control.
    fireEvent.click(screen.getByRole('button', { name: /View all scenarios/ }));
    expect(within(topbar()).queryByRole('button', { name: /Guided walkthrough/ })).not.toBeInTheDocument();
    const context = screen.getByLabelText(/deterministic local proof with configured evidence.*No external execution/i);
    expect(context).toHaveClass('proof-mode');
    expect(context.tagName).toBe('SPAN');
    expect(within(context).getByText('Deterministic proof')).toBeVisible();
    expect(within(context).getByText('Configured evidence · local only · no external execution')).toBeVisible();
    // And it never wears the Control module's active treatment: Control is the workspace.
    expect(currentRoute()).toBeUndefined();
  });

  it('states the live source on Live Control without claiming a deterministic proof', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={noopApi()} initial={liveRecord()} onNavigateAcquisition={() => undefined} onNavigateControl={() => undefined} />);
    const context = within(topbar()).getByText('Live control').closest<HTMLElement>('.proof-mode')!;
    expect(within(context).getByText('CALL-E acquisition · controlled local context · no external execution')).toBeVisible();
    expect(within(topbar()).queryByText('Deterministic proof')).not.toBeInTheDocument();
    expect(within(topbar()).queryByRole('button', { name: /Guided walkthrough/ })).not.toBeInTheDocument();
  });

  it('shares one mobile navigation disclosure across routes, closing on Escape with focus restored', () => {
    render(<App />);
    for (const route of ['Home', 'Acquisition', 'Control'] as const) {
      goto(route);
      const toggle = within(topbar()).getByRole('button', { name: 'Open navigation' });
      expect(toggle).toHaveAttribute('type', 'button');
      expect(toggle).toHaveAttribute('aria-controls', 'product-navigation');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(within(topbar()).getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
      expect(within(topbar()).getByRole('button', { name: 'Open navigation' })).toHaveFocus();
    }
  });

  it('keeps topbar geometry in the one shared stylesheet so routes cannot drift', () => {
    const shell = readFileSync('src/styles/shell.css', 'utf8');
    // The shared sheet owns brand, navigation and theme geometry.
    expect(shell).toMatch(/\.product-topbar \{/);
    expect(shell).toMatch(/\.product-nav \{[^}]*margin: 0 0 0 77px/);
    expect(shell).toMatch(/\.product-brand img \{[^}]*width: 55px/);
    for (const [file, dead] of [
      ['src/styles/home.css', /\.eb-header|\.eb-nav\b|\.eb-demo\b|\.eb-menu\b/],
      ['src/styles/acquisition.css', /\.acq-topbar|\.acq-nav\b|\.acq-brand\b|\.acq-demo\b/],
      ['src/styles/control.css', /\.product-topbar|\.product-nav\b|\.product-brand\b/],
      ['src/styles/app.css', /\.product-topbar|\.product-nav\b|\.theme-control\b/],
    ] as const) expect(readFileSync(file, 'utf8')).not.toMatch(dead);
    // And only the shared component renders one.
    const sources = ['src/ui/HomeExperience.tsx', 'src/ui/AcquisitionExperience.tsx', 'src/ui/ProofExperience.tsx', 'src/ui/LiveControlExperience.tsx'];
    for (const file of sources) {
      const source = readFileSync(file, 'utf8');
      expect(source).toMatch(/<ProductTopbar\b/);
      expect(source).not.toMatch(/<header className="(eb-header|acq-topbar|product-topbar)"/);
    }
  });
});

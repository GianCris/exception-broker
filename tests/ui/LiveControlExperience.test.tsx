// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionBrowserApi } from '../../src/acquisition/browserClient.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { acquisitionAccessKey } from '../../src/ui/AcquisitionExperience.js';
import { controlSessionStorageKey, LiveControlExperience } from '../../src/ui/LiveControlExperience.js';

const awaiting = (): LiveControlPublicRecord => ({
  controlSessionId: 'CONTROL-ACQ-LIVE-1', acquisitionId: 'ACQ-LIVE-1', definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1,
  sourceBinding: { acquisitionId: 'ACQ-LIVE-1', callId: 'CALL-LIVE-1', requestId: 'REQUEST-LIVE-1', receivedAt: '2027-07-01T17:00:00-05:00', terminalAt: '2027-07-01T17:00:00-05:00', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' },
  provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' }, status: 'AWAITING_REVIEW',
  reviewTarget: { operationType: 'PLAN_DECISION', requestId: 'REQUEST-LIVE-1', caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', decision: 'APPROVED', summary: 'Live Client approved.', proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'], completionConfidence: { score: .93, label: 'high' }, receivedAt: '2027-07-01T17:00:00-05:00', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' },
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', planVersion: 1, actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', createdAt: '2027-07-01T17:05:00-05:00',
});
const terminal = (action: 'APPLY' | 'DISCARD' = 'APPLY'): LiveControlPublicRecord => ({ ...awaiting(), status: 'TERMINAL', review: { action, operationId: 'OPERATION-CONTROL', eventId: 'EVENT-CONTROL', approvalId: 'APPROVAL-CONTROL', reviewedAt: '2027-07-01T17:06:00-05:00', reviewer: 'LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED' }, receipt: { disposition: action === 'APPLY' ? 'ALLOW' : 'DISCARDED', reason: action === 'APPLY' ? 'PLAN_APPROVED' : 'DISCARDED_BY_REVIEWER', planStatus: action === 'APPLY' ? 'APPROVED' : 'PENDING_APPROVAL', before: { decisions: 2, operations: 2, events: 2 }, effects: { decisions: action === 'APPLY' ? 1 : 0, operations: action === 'APPLY' ? 1 : 0, events: action === 'APPLY' ? 1 : 0 } } });
const api = (): AcquisitionBrowserApi => ({ connectHosted: vi.fn(), connectByok: vi.fn(), getConnection: vi.fn(), disconnect: vi.fn(), getActive: vi.fn(), create: vi.fn(), get: vi.fn(), refresh: vi.fn(), handoff: vi.fn(), getControl: vi.fn(), review: vi.fn() });

describe('Live Control browser experience', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); }); afterEach(cleanup);

  it('shows live decision, controlled context and NOT RESOLVED before exact review', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); render(<LiveControlExperience api={api()} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible(); expect(within(model).getByText('Exact review required')).toBeVisible(); expect(within(model).getByText('Controlled local snapshot.')).toBeVisible(); expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).getByText('NOT ENGAGED')).toBeVisible(); expect(within(model).getByText('NOT CLAIMED')).toBeVisible();
    expect(screen.getAllByText(/CALL-E · Live acquisition/).length).toBeGreaterThan(0); expect(screen.getByText(/no live ERP\/WMS truth/i)).toBeVisible();
    expect(screen.getByText(/operational context is a controlled local snapshot; live ERP\/WMS truth is not claimed/i)).toBeVisible();
  });

  it('renders the immutable server target and sends only review intent through the API client', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api(); vi.mocked(client.review).mockResolvedValue({ accepted: true, record: terminal(), existing: true });
    render(<LiveControlExperience api={client} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review exact decision' })); const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/CALL-E live acquisition/)).toBeVisible(); expect(within(dialog).getByText(/not authenticated commercial identity/)).toBeVisible(); expect(within(dialog).getByText('Live Client approved.')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply reviewed decision' }));
    await waitFor(() => expect(client.review).toHaveBeenCalledWith('CONTROL-ACQ-LIVE-1', 'ACCESS', 'APPLY'));
    expect((await screen.findAllByText('PLAN_APPROVED')).length).toBeGreaterThan(0); expect(screen.getByText(/Local controlled effects only; no external execution/)).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Live decision control model' })).getByText('EVALUATED')).toBeVisible();
  });

  it('shows only truthful submission feedback while HTTP is pending and reveals no anticipated result', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const client = api();
    let publish!: (value: Awaited<ReturnType<AcquisitionBrowserApi['review']>>) => void;
    vi.mocked(client.review).mockReturnValue(new Promise((resolve) => { publish = resolve; }));
    render(<LiveControlExperience api={client} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review exact decision' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed decision' }));
    expect(screen.getByText('Submitting review intent to the server…')).toBeVisible();
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(within(model).queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(model).queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
    expect(within(model).queryByText('BLOCK', { exact: true })).not.toBeInTheDocument();
    publish({ accepted: true, record: terminal(), existing: true });
    expect(await within(model).findByText('ALLOW', { exact: true })).toBeVisible();
    expect(within(model).getByRole('region', { name: 'Application Attempt' })).toBeVisible();
  });

  it('preserves a non-sensitive pointer and locks recovery when session access is absent', () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); const client = api();
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect(screen.getByText('Live Control recovery locked')).toBeVisible(); expect(client.getControl).not.toHaveBeenCalled(); expect(localStorage.getItem(controlSessionStorageKey)).toBe('CONTROL-ACQ-LIVE-1');
  });

  it('recovers awaiting server truth with the exact same ReviewTarget', async () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api(); vi.mocked(client.getControl).mockResolvedValue({ accepted: true, record: awaiting(), existing: true });
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect(await screen.findByRole('button', { name: 'Review exact decision' })).toBeVisible(); expect(client.getControl).toHaveBeenCalledWith('CONTROL-ACQ-LIVE-1', 'ACCESS');
  });

  it('recovers terminal receipt without submitting another review', async () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api(); vi.mocked(client.getControl).mockResolvedValue({ accepted: true, record: terminal(), existing: true });
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect((await screen.findAllByText('PLAN_APPROVED')).length).toBeGreaterThan(0); expect(screen.queryByRole('button', { name: 'Review exact decision' })).not.toBeInTheDocument(); expect(client.review).not.toHaveBeenCalled();
  });

  it('offers an explicit same-intent resume when an owned review did not publish a terminal result', async () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api();
    const reviewing = { ...awaiting(), status: 'REVIEWING' as const, review: terminal().review! }; vi.mocked(client.getControl).mockResolvedValue({ accepted: true, record: reviewing, existing: true });
    vi.mocked(client.review).mockResolvedValue({ accepted: true, record: terminal(), existing: true });
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect(await screen.findByText('Review resume required')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Resume APPLY review' }));
    await waitFor(() => expect(client.review).toHaveBeenCalledWith('CONTROL-ACQ-LIVE-1', 'ACCESS', 'APPLY'));
  });

  it('keeps REVIEWING without owned metadata non-resumable and fail closed', async () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api();
    vi.mocked(client.getControl).mockResolvedValue({ accepted: true, record: { ...awaiting(), status: 'REVIEWING' }, existing: true });
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect(await screen.findByText('Review incomplete')).toBeVisible(); expect(screen.getByText('Review stopped safely')).toBeVisible(); expect(client.review).not.toHaveBeenCalled();
  });

  it('separates the live acquisition source from the controlled local operational context', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={api()} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    const decision = within(model).getByRole('region', { name: 'Decision fixed' });
    expect(within(decision).getByText('CALL-E · Live acquisition')).toBeVisible();
    expect(within(decision).getByText('Bound to acquisition ACQ-LIVE-1')).toBeVisible();
    const reality = within(model).getByRole('region', { name: 'Operational reality' });
    expect(within(reality).getByText('Controlled local snapshot.')).toBeVisible();
    expect(within(reality).getByText('NOT CLAIMED')).toBeVisible();
    expect(within(reality).getByText('OPERATOR_SANDBOX')).toBeVisible();
    // The source is live; the operational environment is not, and nothing executes outside it.
    expect(document.body.textContent).not.toMatch(/live (ERP|WMS|inventory) (sync|truth|connection)/i);
    expect(within(model).getByText('No external execution occurred.')).toBeVisible();
  });

  it('uses the same Control grammar as the deterministic surface', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<LiveControlExperience api={api()} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(model).toHaveClass('control-instrument');
    expect(within(model).getByRole('region', { name: 'Decision fixed' })).toBeVisible();
    expect(within(model).getByRole('region', { name: 'Exact review' })).toBeVisible();
    expect(within(model).getByLabelText('Application boundary')).toBeVisible();
    expect(within(model).getByRole('region', { name: 'Operational reality' })).toBeVisible();
    expect(within(model).getByRole('region', { name: 'Broker disposition' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Can this decision be applied safely now?' })).toBeVisible();
  });

  it('records a live DISCARD without an Application Attempt or an engaged boundary', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const client = api(); vi.mocked(client.review).mockResolvedValue({ accepted: true, record: terminal('DISCARD'), existing: true });
    render(<LiveControlExperience api={client} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review exact decision' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(client.review).toHaveBeenCalledWith('CONTROL-ACQ-LIVE-1', 'ACCESS', 'DISCARD'));
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(await within(model).findByText('DISCARDED', { exact: true })).toBeVisible();
    expect(within(model).queryByRole('region', { name: 'Application Attempt' })).not.toBeInTheDocument();
    expect(within(within(model).getByLabelText('Application boundary')).getByText('NOT ENGAGED')).toBeVisible();
    expect(within(model).queryByText('ALLOW', { exact: true })).not.toBeInTheDocument();
  });
});

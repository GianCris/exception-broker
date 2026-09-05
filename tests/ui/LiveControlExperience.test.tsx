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
const api = (): AcquisitionBrowserApi => ({ create: vi.fn(), get: vi.fn(), refresh: vi.fn(), handoff: vi.fn(), getControl: vi.fn(), review: vi.fn() });

describe('Live Control browser experience', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); }); afterEach(cleanup);

  it('shows live decision, controlled context and NOT RESOLVED before exact review', () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); render(<LiveControlExperience api={api()} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    const model = screen.getByRole('region', { name: 'Live decision control model' });
    expect(within(model).getByText('APPROVED')).toBeVisible(); expect(within(model).getByText('EXACT REVIEW REQUIRED')).toBeVisible(); expect(within(model).getByText('CONTROLLED LOCAL SNAPSHOT')).toBeVisible(); expect(within(model).getByText('NOT RESOLVED')).toBeVisible();
    expect(screen.getAllByText(/CALL-E · Live acquisition/).length).toBeGreaterThan(0); expect(screen.getByText(/no live ERP\/WMS truth/)).toBeVisible();
  });

  it('renders the immutable server target and sends only review intent through the API client', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api(); vi.mocked(client.review).mockResolvedValue({ accepted: true, record: terminal(), existing: true });
    render(<LiveControlExperience api={client} initial={awaiting()} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review exact decision' })); const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/CALL-E live acquisition/)).toBeVisible(); expect(within(dialog).getByText(/not authenticated commercial identity/)).toBeVisible(); expect(within(dialog).getByText('Live Client approved.')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply reviewed decision' }));
    await waitFor(() => expect(client.review).toHaveBeenCalledWith('CONTROL-ACQ-LIVE-1', 'ACCESS', 'APPLY'));
    expect((await screen.findAllByText('PLAN_APPROVED')).length).toBeGreaterThan(0); expect(screen.getByText(/Local controlled effects only; no external execution/)).toBeVisible();
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

  it('fails closed visibly when an owned review did not publish a terminal result', async () => {
    localStorage.setItem(controlSessionStorageKey, 'CONTROL-ACQ-LIVE-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const client = api();
    vi.mocked(client.getControl).mockResolvedValue({ accepted: true, record: { ...awaiting(), status: 'REVIEWING', review: terminal().review! }, existing: true });
    render(<LiveControlExperience api={client} onNavigateAcquisition={() => undefined} onNavigateDeterministic={() => undefined} />);
    expect(await screen.findByText('REVIEW INCOMPLETE')).toBeVisible(); expect(screen.getByText('Review stopped safely')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review exact decision' })).not.toBeInTheDocument(); expect(client.review).not.toHaveBeenCalled();
  });
});

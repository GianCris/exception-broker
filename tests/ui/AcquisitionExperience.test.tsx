// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAcquisitionBrowserApi,
  createBrowserAcquisitionRequest,
  type AcquisitionBrowserApi,
} from '../../src/acquisition/browserClient.js';
import type { AcquisitionPublicRecord } from '../../src/acquisition/contracts.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { phoneDecisionSchema } from '../../src/integrations/calle/schemas.js';
import { createAcquisitionPresentation } from '../../src/presentation/acquisitionViewModel.js';
import {
  AcquisitionExperience,
  acquisitionAccessKey,
  acquisitionStorageKey,
} from '../../src/ui/AcquisitionExperience.js';
import { App } from '../../src/App.js';

const record = (overrides: Partial<AcquisitionPublicRecord> = {}): AcquisitionPublicRecord => ({
  acquisitionId: 'ACQ-TEST-1', idempotencyKey: 'IDEMPOTENCY-TEST-1', authorizationConfirmed: true,
  maskedRecipient: '+15*******67', decisionContext: { requestId: 'REQUEST-TEST-1', createdAt: '2027-06-10T22:00:00Z', caseId: 'CASE-ACQUISITION-V1-SANDBOX', planId: 'PLAN-ACQUISITION-V1-SANDBOX', actorId: 'ACTOR-ACQUISITION-V1-CLIENT', actorRole: 'client' },
  status: 'queued', callId: 'CALL-TEST-1', createdAt: '2027-06-10T22:00:00Z', updatedAt: '2027-06-10T22:00:01Z', terminalAt: null,
  providerEvidence: { callId: 'CALL-TEST-1', status: 'queued', taskCompleted: null, completionConfidence: null, summary: null, evidence: [], structuredResult: null, createdAt: '2027-06-10T22:00:00Z', completedAt: null, failureCode: null, failureMessage: null, recipients: [] },
  normalizedResult: null, normalizationStatus: 'PENDING', safeStopReason: null, handoffState: 'NOT_READY', ...overrides,
});
const completed = (decision: 'APPROVED' | 'REJECTED' | 'PENDING' = 'PENDING'): AcquisitionPublicRecord => record({
  status: 'completed', terminalAt: '2027-06-10T22:02:00Z', updatedAt: '2027-06-10T22:02:00Z',
  providerEvidence: { callId: 'CALL-TEST-1', status: 'completed', taskCompleted: true, completionConfidence: { score: .93, label: 'high' }, summary: 'Synthetic participant responded.', evidence: ['One supported decision was requested.'], structuredResult: phoneDecisionSchema.parse({ decision, actorId: 'ACTOR-ACQUISITION-V1-CLIENT', actorRole: 'client', caseId: 'CASE-ACQUISITION-V1-SANDBOX', planId: 'PLAN-ACQUISITION-V1-SANDBOX', summary: 'Synthetic decision.', authorizationChanges: [], clarificationNeeded: decision === 'PENDING' }), createdAt: '2027-06-10T22:00:00Z', completedAt: '2027-06-10T22:02:00Z', failureCode: null, failureMessage: null, recipients: [{ id: 'RECIPIENT-1', status: 'completed', summary: 'Complete', attempts: [{ id: 'ATTEMPT-1', status: 'completed', startedAt: '2027-06-10T22:00:02Z', completedAt: '2027-06-10T22:01:59Z', summary: 'Done', transcriptTurns: [{ offsetSeconds: 2, speaker: 'bot', text: 'Choose one decision.' }, { offsetSeconds: 9, speaker: 'user', text: decision }], providerCallId: 'PROVIDER-CALL-1', failureCode: null, failureMessage: null }] }] },
  normalizedResult: decision === 'APPROVED' || decision === 'REJECTED' ? { requestId: 'REQUEST-TEST-1', createdAt: '2027-06-10T22:00:00Z', receivedAt: '2027-06-10T22:02:00Z', decision, actorId: 'ACTOR-ACQUISITION-V1-CLIENT', actorRole: 'client', caseId: 'CASE-ACQUISITION-V1-SANDBOX', planId: 'PLAN-ACQUISITION-V1-SANDBOX', summary: 'Synthetic decision.', authorizationChanges: [], evidence: ['One supported decision was requested.'], completionConfidence: { score: .93, label: 'high' } } : null,
  normalizationStatus: decision === 'APPROVED' || decision === 'REJECTED' ? 'USABLE' : 'SAFE_STOP',
  handoffState: decision === 'APPROVED' || decision === 'REJECTED' ? 'READY_FOR_REVIEW' : 'SAFE_STOP',
  safeStopReason: decision === 'PENDING' ? 'Decision PENDING requires a safe stop before review' : null,
});
const api = (initial = record()): AcquisitionBrowserApi & { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; handoff: ReturnType<typeof vi.fn>; getControl: ReturnType<typeof vi.fn>; review: ReturnType<typeof vi.fn> } => ({
  create: vi.fn().mockResolvedValue({ accepted: true, record: initial, existing: false }),
  get: vi.fn().mockResolvedValue(initial), refresh: vi.fn().mockResolvedValue({ found: true, record: initial }),
  handoff: vi.fn(), getControl: vi.fn(), review: vi.fn(),
});
const unlock = () => {
  fireEvent.change(screen.getByLabelText('Temporary live-access token'), { target: { value: 'INERT-SESSION-TOKEN' } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock session' }));
};

describe('Acquisition V1 browser client', () => {
  it('uses the existing create body contract without putting access in URL or headers', async () => {
    const response = { accepted: true, record: record(), existing: false };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 201, headers: { 'content-type': 'application/json' } }));
    const input = createBrowserAcquisitionRequest({ identity: 'FIXED', createdAt: '2027-06-10T22:00:00Z', accessToken: 'ACCESS', phoneNumber: '+15551234567' });
    await createAcquisitionBrowserApi(fetcher).create(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/acquisitions');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(input);
    expect(String(url)).not.toContain('ACCESS');
  });

  it('recovers with GET and the existing access header without token query leakage', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(record()), { status: 200, headers: { 'content-type': 'application/json' } }));
    await createAcquisitionBrowserApi(fetcher).get('ACQ-TEST-1', 'ACCESS');
    expect(fetcher).toHaveBeenCalledWith('/api/acquisitions/ACQ-TEST-1', { headers: { 'x-acquisition-demo-token': 'ACCESS' } });
    expect(fetcher.mock.calls[0]![0]).not.toContain('ACCESS');
  });

  it('uses only same-origin endpoints and keeps read access in the existing header contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ found: true, record: record() }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createAcquisitionBrowserApi(fetcher);
    await client.refresh('ACQ / 1', 'ACCESS');
    expect(fetcher).toHaveBeenCalledWith('/api/acquisitions/ACQ%20%2F%201/refresh', { method: 'POST', headers: { 'x-acquisition-demo-token': 'ACCESS' } });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('CALLE_API_KEY');
  });

  it('sends only action intent to the same-origin review endpoint', async () => {
    const response = { accepted: true, record: {}, existing: true };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }));
    await createAcquisitionBrowserApi(fetcher).review('CONTROL / 1', 'ACCESS', 'DISCARD');
    const [url, init] = fetcher.mock.calls[0]!; expect(url).toBe('/api/control-sessions/CONTROL%20%2F%201/review');
    expect(JSON.parse(init.body)).toEqual({ action: 'DISCARD' }); expect(JSON.stringify(init.body)).not.toMatch(/reviewTarget|caseId|planId|reviewedAt/);
  });

  it('builds a fixed controlled request rather than accepting browser-authored correlation truth', () => {
    const input = createBrowserAcquisitionRequest({ identity: 'FIXED', createdAt: '2027-06-10T22:00:00Z', accessToken: 'ACCESS', phoneNumber: '+15551234567' });
    expect(input.request).toMatchObject({ caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' });
    expect(input).not.toHaveProperty('operationalTruth');
  });

  it('keeps per-call identity, recipient and time outside the canonical definition', () => {
    const left = createBrowserAcquisitionRequest({ identity: 'ONE', createdAt: '2027-06-10T22:00:00Z', accessToken: 'A', phoneNumber: '+15551234567' });
    const right = createBrowserAcquisitionRequest({ identity: 'TWO', createdAt: '2027-06-11T22:00:00Z', accessToken: 'B', phoneNumber: '+15557654321' });
    expect(left).toMatchObject({ acquisitionId: 'ACQ-BROWSER-V1-ONE', phoneNumber: '+15551234567', request: { requestId: 'REQUEST-BROWSER-V1-ONE', createdAt: '2027-06-10T22:00:00Z' } });
    expect(right).toMatchObject({ acquisitionId: 'ACQ-BROWSER-V1-TWO', phoneNumber: '+15557654321', request: { requestId: 'REQUEST-BROWSER-V1-TWO', createdAt: '2027-06-11T22:00:00Z' } });
    expect(left.request).toMatchObject({ caseId: right.request.caseId, planId: right.request.planId, actorId: right.request.actorId, actorRole: right.request.actorRole, context: right.request.context });
  });
});

describe('Acquisition V1 presentation', () => {
  it('gives terminal state precedence over stale in-progress attempt evidence', () => {
    const staleAttempt = completed('PENDING');
    const providerEvidence = { ...staleAttempt.providerEvidence!, recipients: [{ ...staleAttempt.providerEvidence!.recipients[0]!, attempts: [{ ...staleAttempt.providerEvidence!.recipients[0]!.attempts[0]!, status: 'in_progress' as const }] }] };
    expect(createAcquisitionPresentation({ ...staleAttempt, providerEvidence }).lifecycle).toBe('COMPLETED');
  });

  it('presents queued task plus current attempt as in progress', () => {
    const queued = record({ providerEvidence: { ...record().providerEvidence!, recipients: [{ id: 'RECIPIENT', status: 'in_progress', summary: null, attempts: [{ id: 'ATTEMPT', status: 'in_progress', startedAt: null, completedAt: null, summary: null, transcriptTurns: [], providerCallId: null, failureCode: null, failureMessage: null }] }] } });
    expect(createAcquisitionPresentation(queued).lifecycle).toBe('IN_PROGRESS');
  });
});

describe('Acquisition V1 experience', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('adds real Acquisition and Control navigation without changing the default Control proof', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Decision is not authority.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Acquisition' }));
    expect(screen.getByRole('heading', { name: 'Acquire the decision. Preserve the boundary.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(screen.getByRole('heading', { name: 'Decision is not authority.' })).toBeVisible();
  });

  it('keeps access in sessionStorage, never localStorage, and clears the visible secret input', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    unlock();
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBe('INERT-SESSION-TOKEN');
    expect(JSON.stringify(localStorage)).not.toContain('INERT-SESSION-TOKEN');
    expect(screen.queryByDisplayValue('INERT-SESSION-TOKEN')).not.toBeInTheDocument();
    expect(screen.getByText(/token is not business identity/)).toBeVisible();
  });

  it('locking clears session access but preserves the non-sensitive recovery pointer', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Acquisition completed'); fireEvent.click(screen.getByRole('button', { name: 'Lock live access' }));
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBeNull(); expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-TEST-1');
    expect(screen.getByText(/Recovery locked/)).toBeVisible();
  });

  it('requires valid recipient and explicit authorization and prevents duplicate create', async () => {
    const fake = api(); let resolveCreate!: (value: { accepted: true; record: AcquisitionPublicRecord; existing: false }) => void;
    fake.create.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FIXED'} clock={() => '2027-06-10T22:00:00Z'} />);
    unlock(); fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(fake.create).not.toHaveBeenCalled(); expect(screen.getByText(/Confirm explicit recipient authorization/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    fireEvent.submit(screen.getByRole('button', { name: 'Starting…' }).closest('form')!);
    expect(fake.create).toHaveBeenCalledTimes(1);
    resolveCreate({ accepted: true, record: record(), existing: false }); await waitFor(() => expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-TEST-1'));
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).toEqual([acquisitionStorageKey]);
  });

  it('preserves a recovery pointer while locked and does not request server truth before unlock', () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-RECOVER'); const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(screen.getByText(/Recovery locked/)).toBeVisible(); expect(fake.get).not.toHaveBeenCalled();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-RECOVER');
  });

  it('recovers from GET after reload with session access', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); const fake = api(completed('PENDING'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await waitFor(() => expect(fake.get).toHaveBeenCalledWith('ACQ-TEST-1', 'ACCESS'));
    expect(await screen.findByText('Acquisition completed')).toBeVisible();
  });

  it('keeps the opaque pointer after failed restoration and clears it only explicitly', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-OPAQUE'); sessionStorage.setItem(acquisitionAccessKey, 'WRONG'); const fake = api(); fake.get.mockRejectedValue(new Error('opaque'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByText(/could not be restored with the current live-access session/)).toBeVisible();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-OPAQUE');
    fireEvent.click(screen.getByRole('button', { name: 'Clear recovery pointer' })); expect(localStorage.getItem(acquisitionStorageKey)).toBeNull();
  });

  it('refreshes through refresh only and stops at a terminal response', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record()); fake.refresh.mockResolvedValue({ found: true, record: completed('PENDING') });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(fake.refresh).toHaveBeenCalledTimes(1); expect(fake.create).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); }); expect(fake.refresh).toHaveBeenCalledTimes(1);
  });

  it('renders only returned transcript turns and otherwise promises no fake streaming', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { unmount } = render(<AcquisitionExperience api={api(record())} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Conversation evidence will appear when available.')).toBeVisible(); unmount();
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Choose one decision.')).toBeVisible(); expect(screen.getByText('APPROVED', { selector: '.transcript-timeline p' })).toBeVisible();
    expect(screen.queryByText(/waveform|audio streaming/i)).not.toBeInTheDocument();
  });

  it('renders completed PENDING as deliberate SAFE_STOP, never authority, ALLOW, or provider failure', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('NOT READY FOR REVIEW')).toBeVisible(); expect(within(eligibility).getByText(/No authority created/)).toBeVisible();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['failed', 'canceled'] as const)('renders %s with SAFE_STOP metadata only as a provider/system outcome', async (status) => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(record({ status, terminalAt: '2027-06-10T22:02:00Z', normalizationStatus: 'SAFE_STOP', handoffState: 'SAFE_STOP', safeStopReason: 'Not usable' }))} onNavigateControl={() => undefined} />);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByText(/The acquisition completed, but no usable/)).not.toBeInTheDocument();
    expect(screen.queryByText('NOT READY FOR REVIEW')).not.toBeInTheDocument();
  });

  it('does not render stale READY_FOR_REVIEW metadata as a primary state after provider failure', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(record({ status: 'failed', terminalAt: '2027-06-10T22:02:00Z', normalizationStatus: 'USABLE', handoffState: 'READY_FOR_REVIEW' }))} onNavigateControl={() => undefined} />);
    expect(await screen.findByRole('alert')).toBeVisible(); expect(screen.queryByText('READY FOR REVIEW')).not.toBeInTheDocument();
  });

  it.each(['APPROVED', 'REJECTED'] as const)('renders usable %s as acquired and ready, not as Broker disposition or handoff action', async (decision) => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed(decision))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText(decision)).toBeVisible(); expect(within(eligibility).getByText('READY FOR REVIEW')).toBeVisible();
    expect(within(eligibility).getByText(/Acquired decision ≠ execution authority/)).toBeVisible();
    expect(screen.queryByText('BLOCK', { exact: true })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Continue to Control' })).toBeVisible();
    expect(within(eligibility).getByText(/Eligible for exact review/)).toBeVisible();
  });

  it('hands off a READY acquisition using only its identity and existing access, then opens the server record', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(completed('APPROVED')); const onOpenControl = vi.fn();
    const serverRecord = { controlSessionId: 'CONTROL-ACQ-TEST-1' } as LiveControlPublicRecord;
    fake.handoff.mockResolvedValue({ accepted: true, record: serverRecord, existing: false });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} onOpenControl={onOpenControl} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Control' }));
    await waitFor(() => expect(fake.handoff).toHaveBeenCalledWith('ACQ-TEST-1', 'ACCESS'));
    expect(onOpenControl).toHaveBeenCalledWith(serverRecord);
  });

  it('offers one explicit refresh after the automatic bound and prevents duplicate pending requests', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    fake.refresh.mockResolvedValue({ found: true, record: record() });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    for (let count = 0; count < 30; count += 1) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(fake.refresh).toHaveBeenCalledTimes(30); expect(fake.create).not.toHaveBeenCalled();
    const beforeId = localStorage.getItem(acquisitionStorageKey);
    let release!: (value: { found: true; record: AcquisitionPublicRecord }) => void;
    fake.refresh.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const refresh = screen.getByRole('button', { name: 'Refresh status' });
    fireEvent.click(refresh); fireEvent.click(refresh);
    expect(fake.refresh).toHaveBeenCalledTimes(31); expect(screen.getByRole('button', { name: 'Refreshing status…' })).toBeDisabled();
    release({ found: true, record: record({ updatedAt: '2027-06-10T22:03:00Z' }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Refresh status' })).toBeVisible(); expect(localStorage.getItem(acquisitionStorageKey)).toBe(beforeId); expect(fake.create).not.toHaveBeenCalled();
  });

  it('removes explicit refresh after its single server request returns terminal truth', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    fake.refresh.mockResolvedValue({ found: true, record: record() });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    for (let count = 0; count < 30; count += 1) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    fake.refresh.mockResolvedValueOnce({ found: true, record: completed('PENDING') });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'Refresh status' })).not.toBeInTheDocument(); expect(screen.getByText('NOT READY FOR REVIEW')).toBeVisible(); expect(fake.create).not.toHaveBeenCalled();
  });

  it('keeps confidence secondary to authority and shows both provenance axes', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    fireEvent.click(await screen.findByText('Inspect sanitized provider evidence'));
    expect(screen.getByText('0.93 · high')).toBeVisible(); expect(screen.getByText('LIVE_CALLE')).toBeVisible(); expect(screen.getAllByText('Controlled sandbox template').length).toBeGreaterThan(0);
    expect(screen.queryByText(/confidence.*authority/i)).not.toBeInTheDocument();
  });

  it('keeps provider/system failure separate from SAFE_STOP and Broker outcomes', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(record({ status: 'failed', terminalAt: '2027-06-10T22:02:00Z' }))} onNavigateControl={() => undefined} />);
    const alert = await screen.findByRole('alert'); expect(within(alert).getByText(/not a business SAFE_STOP or Broker disposition/)).toBeVisible();
    expect(screen.queryByText('NOT READY FOR REVIEW')).not.toBeInTheDocument();
  });

  it('contains no provider SDK, server control implementation, operator scenario, or VITE credential in browser acquisition modules', () => {
    const source = ['src/acquisition/browserClient.ts', 'src/ui/AcquisitionExperience.tsx', 'src/presentation/acquisitionViewModel.ts'].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/@call-e\/calle|CALLE_API_KEY|VITE_|CallEProvider|operatorScenario|control\/service|control\/store|prepareProof\(|reviewProof\(|executeOrchestrationAction|OrchestrationState|ProofSession/);
    expect(source).not.toMatch(/localStorage\.setItem\([^\n]*access|localStorage\.setItem\([^\n]*token/i);
  });
});

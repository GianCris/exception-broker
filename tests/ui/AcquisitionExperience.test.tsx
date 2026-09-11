// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACQUISITION_V1_CONTEXT,
  ACQUISITION_V1_OBJECTIVE,
  createAcquisitionBrowserApi,
  createBrowserAcquisitionRequest,
  type AcquisitionBrowserApi,
} from '../../src/acquisition/browserClient.js';
import type { AcquisitionPublicRecord } from '../../src/acquisition/contracts.js';
import type { LiveControlPublicRecord } from '../../src/control/contracts.js';
import { callRequestSchema, phoneDecisionSchema } from '../../src/integrations/calle/schemas.js';
import { buildCallEInput } from '../../src/integrations/calle/callEProvider.js';
import { createAcquisitionPresentation } from '../../src/presentation/acquisitionViewModel.js';
import {
  AcquisitionExperience,
  acquisitionAccessKey,
  acquisitionHostedSessionKey,
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
const completed = (decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION' | 'PENDING' = 'PENDING'): AcquisitionPublicRecord => record({
  status: 'completed', terminalAt: '2027-06-10T22:02:00Z', updatedAt: '2027-06-10T22:02:00Z',
  providerEvidence: { callId: 'CALL-TEST-1', status: 'completed', taskCompleted: true, completionConfidence: { score: .93, label: 'high' }, summary: 'Synthetic participant responded.', evidence: ['One supported decision was requested.'], structuredResult: phoneDecisionSchema.parse({ decision, actorId: 'ACTOR-ACQUISITION-V1-CLIENT', actorRole: 'client', caseId: 'CASE-ACQUISITION-V1-SANDBOX', planId: 'PLAN-ACQUISITION-V1-SANDBOX', summary: 'Synthetic decision.', authorizationChanges: [], clarificationNeeded: decision === 'PENDING' }), createdAt: '2027-06-10T22:00:00Z', completedAt: '2027-06-10T22:02:00Z', failureCode: null, failureMessage: null, recipients: [{ id: 'RECIPIENT-1', status: 'completed', summary: 'Complete', attempts: [{ id: 'ATTEMPT-1', status: 'completed', startedAt: '2027-06-10T22:00:02Z', completedAt: '2027-06-10T22:01:59Z', summary: 'Done', transcriptTurns: [{ offsetSeconds: 2, speaker: 'bot', text: 'Choose one decision.' }, { offsetSeconds: 9, speaker: 'user', text: decision }], providerCallId: 'PROVIDER-CALL-1', failureCode: null, failureMessage: null }] }] },
  normalizedResult: decision === 'APPROVED' || decision === 'REJECTED' ? { requestId: 'REQUEST-TEST-1', createdAt: '2027-06-10T22:00:00Z', receivedAt: '2027-06-10T22:02:00Z', decision, actorId: 'ACTOR-ACQUISITION-V1-CLIENT', actorRole: 'client', caseId: 'CASE-ACQUISITION-V1-SANDBOX', planId: 'PLAN-ACQUISITION-V1-SANDBOX', summary: 'Synthetic decision.', authorizationChanges: [], evidence: ['One supported decision was requested.'], completionConfidence: { score: .93, label: 'high' } } : null,
  normalizationStatus: decision === 'APPROVED' || decision === 'REJECTED' ? 'USABLE' : 'SAFE_STOP',
  handoffState: decision === 'APPROVED' || decision === 'REJECTED' ? 'READY_FOR_REVIEW' : 'SAFE_STOP',
  safeStopReason: decision === 'PENDING' || decision === 'NEEDS_CLARIFICATION' ? `Decision ${decision} requires a safe stop before review` : null,
});
const api = (initial = record()): AcquisitionBrowserApi & { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn>; handoff: ReturnType<typeof vi.fn>; getControl: ReturnType<typeof vi.fn>; review: ReturnType<typeof vi.fn> } => ({
  connectHosted: vi.fn().mockResolvedValue({ connectionId: 'INERT-SESSION-TOKEN', kind: 'HOSTED_DEMO', connected: true }),
  connectByok: vi.fn().mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true }),
  getConnection: vi.fn().mockResolvedValue({ connectionId: 'ACCESS', kind: 'HOSTED_DEMO', connected: true }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getActive: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ accepted: true, record: initial, existing: false }),
  get: vi.fn().mockResolvedValue(initial), refresh: vi.fn().mockResolvedValue({ found: true, record: initial }),
  handoff: vi.fn(), getControl: vi.fn(), review: vi.fn(),
});
const unlock = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Use hosted demo' }));
  await screen.findByRole('heading', { name: 'Acquire a decision' });
};
const unlockByok = async (fake: ReturnType<typeof api>) => {
  vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
  fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'INERT-BYOK-KEY' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect CALL-E' }));
  await screen.findByRole('heading', { name: 'Acquire a decision' });
};

describe('Acquisition V1 browser client', () => {
  it('connects hosted access without browser credentials and sends BYOK only once to the server endpoint', async () => {
    const connection = { connectionId: 'OPAQUE-CONNECTION', kind: 'BYOK', connected: true };
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(connection), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = createAcquisitionBrowserApi(fetcher);
    await client.connectHosted();
    await client.connectByok('INERT-BYOK-KEY');
    expect(fetcher.mock.calls[0]).toEqual(['/api/acquisition-access/hosted', { method: 'POST' }]);
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/acquisition-access/byok');
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ apiKey: 'INERT-BYOK-KEY' });
    expect(JSON.stringify(connection)).not.toContain('INERT-BYOK-KEY');
  });

  it('uses the server connection header without putting access identity in the body or URL', async () => {
    const response = { accepted: true, record: record(), existing: false };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 201, headers: { 'content-type': 'application/json' } }));
    const input = createBrowserAcquisitionRequest({ identity: 'FIXED', createdAt: '2027-06-10T22:00:00Z', phoneNumber: '+15551234567' });
    await createAcquisitionBrowserApi(fetcher).create(input, 'ACCESS');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/acquisitions');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-acquisition-connection': 'ACCESS' });
    expect(JSON.parse(init.body)).toEqual(input);
    expect(String(url)).not.toContain('ACCESS');
  });

  it('recovers with GET and the existing access header without token query leakage', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(record()), { status: 200, headers: { 'content-type': 'application/json' } }));
    await createAcquisitionBrowserApi(fetcher).get('ACQ-TEST-1', 'ACCESS');
    expect(fetcher).toHaveBeenCalledWith('/api/acquisitions/ACQ-TEST-1', { headers: { 'x-acquisition-connection': 'ACCESS' } });
    expect(fetcher.mock.calls[0]![0]).not.toContain('ACCESS');
  });

  it('uses only same-origin endpoints and keeps read access in the existing header contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ found: true, record: record() }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createAcquisitionBrowserApi(fetcher);
    await client.refresh('ACQ / 1', 'ACCESS');
    expect(fetcher).toHaveBeenCalledWith('/api/acquisitions/ACQ%20%2F%201/refresh', { method: 'POST', headers: { 'x-acquisition-connection': 'ACCESS' } });
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
    const input = createBrowserAcquisitionRequest({ identity: 'FIXED', createdAt: '2027-06-10T22:00:00Z', phoneNumber: '+15551234567' });
    expect(input.request).toMatchObject({ caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client' });
    expect(input).not.toHaveProperty('operationalTruth');
  });

  it('builds a neutral terms-before-decision CALL-E protocol from the real scenario values', () => {
    const browser = createBrowserAcquisitionRequest({ identity: 'FIXED', createdAt: '2027-06-10T22:00:00Z', phoneNumber: '+15551234567' });
    const task = buildCallEInput(callRequestSchema.parse({ ...browser.request, phoneNumber: browser.phoneNumber })).task;
    expect(task).toContain('present the exact proposal: 350 original units, 150 substitute units, 0 additional Client cost, 500 total units');
    expect(task).toContain('no more than 180 substitute units');
    expect(task).toContain('no more than 100 additional Client cost');
    expect(task).toContain('Only after presenting the proposal and conditions');
    expect(task).toContain('If the recipient gives a decision before hearing those terms');
    expect(task).toContain('no outcome is preferred');
    expect(task).toContain('accept APPROVED, REJECTED, or NEEDS_CLARIFICATION as final');
    expect(task).toContain('ask at most once for a brief reason');
    expect(task).toContain('Do not repeat the proposal');
    expect(task).toContain('at most two brief connection checks');
    expect(task).toContain('Never enter a hold loop');
    expect(task).toContain('must not persuade or pressure');
    expect(task).not.toMatch(/prefer APPROVED|expected answer is APPROVED/i);
  });

  it('keeps per-call identity, recipient and time outside the canonical definition', () => {
    const left = createBrowserAcquisitionRequest({ identity: 'ONE', createdAt: '2027-06-10T22:00:00Z', phoneNumber: '+15551234567' });
    const right = createBrowserAcquisitionRequest({ identity: 'TWO', createdAt: '2027-06-11T22:00:00Z', phoneNumber: '+15557654321' });
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

  it('opens real Acquisition and Control from the Home entry', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Decisions need guardrails to reach reality.' })).toBeVisible();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Acquisition' }));
    expect(screen.getByRole('heading', { name: 'Choose how to connect CALL-E' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(screen.getByRole('heading', { name: 'Decision is not authority.' })).toBeVisible();
  });

  it('offers hosted and own-account connection paths without exposing demo-token UX', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Choose how to connect CALL-E' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Use hosted demo' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Connect your CALL-E account' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/temporary live-access token/i);
  });

  it('keeps a BYOK key out of browser storage and disconnects only the opaque connection', async () => {
    const fake = api();
    vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'INERT-BYOK-KEY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect CALL-E' }));
    await screen.findByText('Your CALL-E account is connected for this session');
    expect(fake.connectByok).toHaveBeenCalledWith('INERT-BYOK-KEY');
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBe('INERT-BYOK-CONNECTION');
    expect(JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })).not.toContain('INERT-BYOK-KEY');
    expect(screen.queryByDisplayValue('INERT-BYOK-KEY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect CALL-E' }));
    expect(fake.disconnect).toHaveBeenCalledWith('INERT-BYOK-CONNECTION');
    await waitFor(() => expect(sessionStorage.getItem(acquisitionAccessKey)).toBeNull());
  });

  it('keeps only opaque hosted access in sessionStorage and never exposes the raw demo-token concept', async () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    await unlock();
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBe('INERT-SESSION-TOKEN');
    expect(sessionStorage.getItem(acquisitionHostedSessionKey)).toBe('INERT-SESSION-TOKEN');
    expect(JSON.stringify(localStorage)).not.toContain('INERT-SESSION-TOKEN');
    expect(document.body.textContent).not.toMatch(/temporary live-access token/i);
    expect(screen.getByText(/Connection access is not business identity/)).toBeVisible();
  });

  it('presents READY as a controlled four-stage path with Control locked', async () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    await unlock();
    const rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    expect(within(rail).getByText('READY')).toBeVisible();
    expect(within(rail).getAllByText('WAITING')).toHaveLength(2);
    expect(within(rail).getByText('LOCKED')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Acquire a decision' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start CALL-E acquisition' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue to Control' })).not.toBeInTheDocument();
    expect(screen.getByText(ACQUISITION_V1_OBJECTIVE)).not.toBeVisible();
    expect(screen.getByText(ACQUISITION_V1_CONTEXT)).not.toBeVisible();
    expect(screen.queryByLabelText('Recipient phone')).not.toBeInTheDocument();
    expect(screen.getByText('Hosted synthetic destination')).toBeVisible();
    expect(screen.getByText(/Configured by Exception Broker/)).toBeVisible();
  });

  it('recovers the current connection owned active acquisition before showing READY', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const fake = api();
    vi.mocked(fake.getActive).mockResolvedValueOnce(record());
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Waiting for CALL-E to begin…')).toBeVisible();
    expect(fake.getActive).toHaveBeenCalledWith('ACCESS');
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-TEST-1');
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
  });

  it('retains the opaque connection and withholds READY when active-state verification fails', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const fake = api();
    vi.mocked(fake.getActive).mockRejectedValueOnce(new Error('inert lookup failure'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByText(/connection is retained, but active acquisition state could not be verified/i)).toBeVisible();
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBe('ACCESS');
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use hosted demo' })).not.toBeInTheDocument();
  });

  it('keeps active acquisition evidence truthful with no fabricated turns', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const active = record({ providerEvidence: { ...record().providerEvidence!, status: 'in_progress', recipients: [{ id: 'RECIPIENT', status: 'in_progress', summary: null, attempts: [{ id: 'ATTEMPT', status: 'in_progress', startedAt: '2027-06-10T22:00:02Z', completedAt: null, summary: null, transcriptTurns: [], providerCallId: 'PROVIDER-CALL', failureCode: null, failureMessage: null }] }] } });
    const { unmount } = render(<AcquisitionExperience api={api(active)} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Listening for provider transcript…')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue to Control' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect CALL-E' })).toBeDisabled();
    expect(screen.getByText('Connection locked while this acquisition is active.')).toBeVisible();
    unmount();
    const withTurns = { ...active, providerEvidence: { ...active.providerEvidence!, recipients: [{ ...active.providerEvidence!.recipients[0]!, attempts: [{ ...active.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: [{ offsetSeconds: 4, speaker: 'bot' as const, text: 'Returned CALL-E turn.' }, { offsetSeconds: null, speaker: 'unknown' as const, text: 'Returned unknown turn.' }] }] }] } };
    render(<AcquisitionExperience api={api(withTurns)} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Returned CALL-E turn.')).toBeVisible();
    expect(screen.getByText('Unknown speaker')).toBeVisible();
  });

  it('keeps provider depth collapsed until deliberately inspected', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    const disclosure = (await screen.findByText('Inspect sanitized provider evidence')).closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getAllByText('One supported decision was requested.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('Inspect sanitized provider evidence'));
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByText('REQUEST-TEST-1')).toBeVisible();
  });

  it('previews returned conversation evidence and reveals every real turn on request', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const complete = completed('APPROVED');
    const turns = Array.from({ length: 6 }, (_, index) => ({ offsetSeconds: index + 1, speaker: index % 2 === 0 ? 'bot' as const : 'user' as const, text: `Returned turn ${index + 1}` }));
    const withTranscript = { ...complete, providerEvidence: { ...complete.providerEvidence!, recipients: [{ ...complete.providerEvidence!.recipients[0]!, attempts: [{ ...complete.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: turns }] }] } };
    render(<AcquisitionExperience api={api(withTranscript)} onNavigateControl={() => undefined} />);
    expect((await screen.findAllByText('Returned turn 4'))[0]).toBeVisible();
    expect(screen.getByText('Returned turn 5')).not.toBeVisible();
    fireEvent.click(screen.getByText(/View full transcript/));
    expect(screen.getByText('Returned turn 6')).toBeVisible();
  });

  it('locking clears session access but preserves the non-sensitive recovery pointer', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed'); fireEvent.click(screen.getByRole('button', { name: 'Disconnect CALL-E' }));
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBeNull(); expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-TEST-1');
    expect(screen.getByText(/Recovery locked/)).toBeVisible();
  });

  it('requires valid recipient and explicit authorization and prevents duplicate create', async () => {
    const fake = api(); let resolveCreate!: (value: { accepted: true; record: AcquisitionPublicRecord; existing: false }) => void;
    fake.create.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FIXED'} clock={() => '2027-06-10T22:00:00Z'} />);
    await unlockByok(fake); fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(fake.create).not.toHaveBeenCalled(); expect(screen.getByText(/Confirm recipient ownership or authorization/)).toBeVisible();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    fireEvent.submit(document.getElementById('acquisition-create')!);
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
    expect(await screen.findByText('Call completed')).toBeVisible();
  });

  it('keeps the opaque pointer after failed restoration and clears it only explicitly', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-OPAQUE'); sessionStorage.setItem(acquisitionAccessKey, 'WRONG'); const fake = api(); fake.get.mockRejectedValue(new Error('opaque'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect((await screen.findAllByText(/no active acquisition belongs to this connection/i))[0]).toBeVisible();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-OPAQUE');
    fireEvent.click(screen.getByRole('button', { name: 'Clear recovery pointer' })); expect(localStorage.getItem(acquisitionStorageKey)).toBeNull();
  });

  it('replaces a stale local pointer only with the same connection owned active acquisition', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-STALE'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const owned = record({ acquisitionId: 'ACQ-ACTIVE' }); const fake = api();
    fake.get.mockRejectedValueOnce(new Error('stale pointer')); vi.mocked(fake.getActive).mockResolvedValueOnce(owned);
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByText(/Acquisition record ACQ-ACTIVE/)).toBeVisible();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-ACTIVE');
    expect(screen.getByRole('button', { name: 'Recovery pointer locked while active' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
  });

  it('keeps a stale pointer locked when same-connection active recovery cannot be verified', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-STALE'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const fake = api(); fake.get.mockRejectedValueOnce(new Error('stale pointer')); vi.mocked(fake.getActive).mockRejectedValueOnce(new Error('lookup unavailable'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect((await screen.findAllByText(/Recovery could not be verified/))[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recovery pointer locked pending verification' })).toBeDisabled();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-STALE');
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBe('ACCESS');
  });

  it('refreshes through refresh only and stops at a terminal response', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record()); fake.refresh.mockResolvedValue({ found: true, record: completed('PENDING') });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(fake.refresh).toHaveBeenCalledTimes(1); expect(fake.create).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(10_000); await Promise.resolve(); }); expect(fake.refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels scheduled monitoring when the Acquisition surface unmounts', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    const { unmount } = render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await vi.mocked(fake.getConnection).mock.results[0]!.value; await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await fake.get.mock.results[0]!.value; await Promise.resolve(); });
    unmount();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fake.refresh).not.toHaveBeenCalled();
  });

  it('does not allow an active acquisition to be orphaned or replaced while a refresh is in flight', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    let releaseOld!: (value: { found: true; record: AcquisitionPublicRecord }) => void;
    fake.refresh.mockReturnValueOnce(new Promise((resolve) => { releaseOld = resolve; }));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'TWO'} clock={() => '2027-06-10T22:05:00Z'} />);
    await act(async () => { await vi.mocked(fake.getConnection).mock.results[0]!.value; await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await fake.get.mock.results[0]!.value; await Promise.resolve(); });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(screen.getByRole('button', { name: 'Recovery pointer locked while active' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
    releaseOld({ found: true, record: completed('APPROVED') });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Acquisition record ACQ-TEST-1/)).toBeVisible();
    expect(screen.getByText('Call completed')).toBeVisible();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('keeps Provider Evidence waiting until actual evidence items exist', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const completeWithoutEvidence = completed('APPROVED');
    const withoutEvidence = { ...completeWithoutEvidence, providerEvidence: { ...completeWithoutEvidence.providerEvidence!, evidence: [] } };
    const { unmount } = render(<AcquisitionExperience api={api(withoutEvidence)} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed');
    let rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    expect(within(rail).getByText('NOT AVAILABLE')).toBeVisible();
    unmount();
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed');
    rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    expect(within(rail).getByText('AVAILABLE')).toBeVisible();
  });

  it('renders only returned transcript turns and otherwise promises no fake streaming', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { unmount } = render(<AcquisitionExperience api={api(record())} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Waiting for CALL-E to begin…')).toBeVisible(); unmount();
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Choose one decision.')).toBeVisible(); expect(screen.getByText('APPROVED', { selector: '.transcript-timeline p' })).toBeVisible();
    expect(screen.queryByText(/waveform|audio streaming/i)).not.toBeInTheDocument();
  });

  it('renders completed PENDING as deliberate SAFE_STOP, never authority, ALLOW, or provider failure', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('NOT READY FOR REVIEW')).toBeVisible(); expect(within(eligibility).getByText(/No authority/, { selector: 'small' })).toBeVisible();
    expect(screen.queryByText('ALLOW', { exact: true })).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('presents completed NEEDS_CLARIFICATION as a legitimate clarification safe stop with no Control handoff', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('NEEDS_CLARIFICATION'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByRole('heading', { name: 'CLARIFICATION REQUIRED' })).toBeVisible();
    expect(within(eligibility).getByText('Provider decision: NEEDS_CLARIFICATION')).toBeVisible();
    expect(within(eligibility).getByText(/legitimate clarification outcome/)).toBeVisible();
    expect(within(eligibility).getByText(/No authority/, { selector: 'small' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue to Control' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains APPROVED plus taskCompleted false as a human-readable SAFE_STOP while retaining technical provenance', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const acquired = completed('APPROVED');
    const contradiction = { ...acquired, normalizedResult: null, normalizationStatus: 'SAFE_STOP' as const, handoffState: 'SAFE_STOP' as const, safeStopReason: 'taskCompleted contradicts the structured decision', providerEvidence: { ...acquired.providerEvidence!, taskCompleted: false } };
    const fake = api(contradiction);
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('Provider decision: APPROVED')).toBeVisible();
    expect(within(eligibility).getByText(/provider did not mark the acquisition task complete/)).toBeVisible();
    expect(within(eligibility).getByText(/Required decision conditions were not sufficiently established/)).toBeVisible();
    expect(within(eligibility).getByText('NOT READY FOR REVIEW')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue to Control' })).not.toBeInTheDocument();
    expect(fake.handoff).not.toHaveBeenCalled(); expect(fake.review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Inspect sanitized provider evidence'));
    expect(screen.getByText('taskCompleted contradicts the structured decision')).toBeVisible();
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

  it('monitors adaptively beyond one minute, then offers one explicit current-status check without creating another acquisition', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    fake.refresh.mockResolvedValue({ found: true, record: record() });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    const monitoringStartedAt = Date.now();
    for (let count = 0; count < 31; count += 1) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(fake.refresh).toHaveBeenCalledTimes(31); expect(screen.queryByRole('button', { name: 'Check latest status' })).not.toBeInTheDocument();
    for (let count = 31; count < 66; count += 1) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(fake.refresh).toHaveBeenCalledTimes(66); expect(fake.create).not.toHaveBeenCalled();
    expect(Date.now() - monitoringStartedAt).toBe(300_000);
    expect(screen.getByText('CALL-E is still finalizing the interaction.')).toBeVisible();
    expect(screen.getByText(/acquisition record is preserved/)).toBeVisible();
    const beforeId = localStorage.getItem(acquisitionStorageKey);
    let release!: (value: { found: true; record: AcquisitionPublicRecord }) => void;
    fake.refresh.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const refresh = screen.getByRole('button', { name: 'Check latest status' });
    fireEvent.click(refresh); fireEvent.click(refresh);
    expect(fake.refresh).toHaveBeenCalledTimes(67); expect(screen.getByRole('button', { name: 'Checking latest provider status…' })).toBeDisabled();
    release({ found: true, record: record({ updatedAt: '2027-06-10T22:03:00Z' }) });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: 'Check latest status' })).toBeVisible(); expect(localStorage.getItem(acquisitionStorageKey)).toBe(beforeId); expect(fake.create).not.toHaveBeenCalled();
  });

  it('removes explicit refresh after its single server request returns terminal truth', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    fake.refresh.mockResolvedValue({ found: true, record: record() });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    for (let count = 0; count < 66; count += 1) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    fake.refresh.mockResolvedValueOnce({ found: true, record: completed('PENDING') });
    fireEvent.click(screen.getByRole('button', { name: 'Check latest status' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'Check latest status' })).not.toBeInTheDocument(); expect(screen.getByText('NOT READY FOR REVIEW')).toBeVisible(); expect(fake.create).not.toHaveBeenCalled();
  });

  it('keeps automatic refresh errors distinct and leaves one manual current-status check available', async () => {
    vi.useFakeTimers(); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); const fake = api(record());
    fake.refresh.mockRejectedValueOnce(new Error('not exposed'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(screen.getByText('Acquisition service is unavailable.')).toBeVisible();
    expect(screen.getByText('Automatic status check paused')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check latest status' })).toBeVisible();
    expect(screen.queryByText('SAFE STOP', { exact: true })).not.toBeInTheDocument();
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
    expect(source).not.toMatch(/__mockup|mockup registry|prototype state selector|fixture business/i);
  });
});

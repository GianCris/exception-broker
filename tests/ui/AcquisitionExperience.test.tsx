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
import type { AcquisitionPublicRecord, SanitizedTranscriptTurn } from '../../src/acquisition/contracts.js';
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
  fireEvent.click(screen.getByRole('button', { name: 'Use hosted sandbox' }));
  await screen.findByRole('heading', { name: 'Acquire a decision' });
};
const unlockByok = async (fake: ReturnType<typeof api>) => {
  vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
  fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'INERT-BYOK-KEY' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect your account' }));
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
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    // Primary Control from Acquisition resolves to the Control workspace. With nothing
    // acquired yet, that workspace is honestly empty rather than a deterministic proof case.
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(screen.getByRole('heading', { name: 'Control starts with an acquired decision.' })).toBeVisible();
  });

  it('offers hosted and own-account connection paths without exposing demo-token UX', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Hosted sandbox' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your CALL-E account' })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/temporary live-access token/i);
  });

  it('keeps a BYOK key out of browser storage and disconnects only the opaque connection', async () => {
    const fake = api();
    vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'INERT-BYOK-KEY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect your account' }));
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
    expect(screen.getByText('Connected for this browser session.')).toBeVisible();
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
    expect(screen.getAllByText('Hosted synthetic destination').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Configured by Exception Broker/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Not entered')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: 'Use hosted sandbox' })).not.toBeInTheDocument();
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
    expect(screen.getByText('Returned turn 1')).toBeVisible();
    expect(screen.getByText('Returned turn 5')).not.toBeVisible();
    const toggle = screen.getByRole('button', { name: /View 2 more turns/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByText('Returned turn 1')).toBeVisible();
    expect(screen.getByText('Returned turn 5')).toBeVisible();
    expect(screen.getByText('Returned turn 6')).toBeVisible();
    expect(screen.getAllByText(/Returned turn 1$/)).toHaveLength(1);
    const collapse = screen.getByRole('button', { name: /Collapse transcript/ });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);
    expect(screen.getByText('Returned turn 5')).not.toBeVisible();
  });

  it('locking clears session access but preserves the non-sensitive recovery pointer', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed'); fireEvent.click(screen.getByRole('button', { name: 'Disconnect CALL-E' }));
    expect(sessionStorage.getItem(acquisitionAccessKey)).toBeNull(); expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-TEST-1');
    expect(screen.getByText(/Previous acquisition saved/)).toBeVisible();
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
    expect(screen.getByText(/Previous acquisition saved/)).toBeVisible(); expect(fake.get).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole('button', { name: 'Clear previous session' })); expect(localStorage.getItem(acquisitionStorageKey)).toBeNull();
  });

  it('replaces a stale local pointer only with the same connection owned active acquisition', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-STALE'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const owned = record({ acquisitionId: 'ACQ-ACTIVE' }); const fake = api();
    fake.get.mockRejectedValueOnce(new Error('stale pointer')); vi.mocked(fake.getActive).mockResolvedValueOnce(owned);
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByText(/Acquisition record ACQ-ACTIVE/)).toBeVisible();
    expect(localStorage.getItem(acquisitionStorageKey)).toBe('ACQ-ACTIVE');
    expect(screen.getByRole('button', { name: 'Available once this acquisition finishes' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
  });

  it('keeps a stale pointer locked when same-connection active recovery cannot be verified', async () => {
    localStorage.setItem(acquisitionStorageKey, 'ACQ-STALE'); sessionStorage.setItem(acquisitionAccessKey, 'ACCESS');
    const fake = api(); fake.get.mockRejectedValueOnce(new Error('stale pointer')); vi.mocked(fake.getActive).mockRejectedValueOnce(new Error('lookup unavailable'));
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect((await screen.findAllByText(/Recovery could not be verified/))[0]).toBeVisible();
    expect(screen.getByRole('button', { name: 'Checking before we can clear it…' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: 'Available once this acquisition finishes' })).toBeDisabled();
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
    expect(await screen.findByText('Choose one decision.')).toBeVisible(); expect(screen.getByText('APPROVED', { selector: '.acq-turn-text' })).toBeVisible();
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
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/technical provider outcome, not a business SAFE STOP/)).toBeVisible();
    expect(within(alert).getByText(/No decision was formed\. No Control handoff or external execution occurred\./)).toBeVisible();
    expect(screen.queryByText('NOT READY FOR REVIEW')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SAFE STOP' })).not.toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Control locked' })).toBeDisabled();
  });

  it('contains no provider SDK, server control implementation, operator scenario, or VITE credential in browser acquisition modules', () => {
    const source = ['src/acquisition/browserClient.ts', 'src/ui/AcquisitionExperience.tsx', 'src/presentation/acquisitionViewModel.ts'].map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(/@call-e\/calle|CALLE_API_KEY|VITE_|CallEProvider|operatorScenario|control\/service|control\/store|prepareProof\(|reviewProof\(|executeOrchestrationAction|OrchestrationState|ProofSession/);
    expect(source).not.toMatch(/localStorage\.setItem\([^\n]*access|localStorage\.setItem\([^\n]*token/i);
    expect(source).not.toMatch(/__mockup|mockup registry|prototype state selector|fixture business/i);
  });
});

describe('Acquisition V1 visual polish', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('gates Hosted acquisition creation behind an explicit pre-call confirmation and never double-confirms', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlock();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(fake.create).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/synthetic CALL-E demonstration/)).toBeVisible();
    expect(within(dialog).getByText(/No real customer is contacted/)).toBeVisible();
    expect(within(dialog).getByText(/2–10 minutes/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('creates no acquisition when the Hosted warning is dismissed with Escape', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('creates exactly one acquisition after explicit Hosted confirmation', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlock();
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Start hosted demo/ }));
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never shows the Hosted pre-call warning for BYOK, which creates directly once authorized', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlockByok(fake);
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
  });

  it('keeps the BYOK recipient authorization requirement in place', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlockByok(fake);
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(fake.create).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm recipient ownership or authorization/)).toBeVisible();
  });

  it('strips spaces, hyphens, parentheses and dots from the visible BYOK phone input as the user types', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlockByok(fake);
    const input = screen.getByLabelText('Recipient phone');
    fireEvent.change(input, { target: { value: '+1 (276) 322-9632' } });
    expect(input).toHaveValue('+12763229632');
    fireEvent.change(input, { target: { value: '+1-276-322-9632' } });
    expect(input).toHaveValue('+12763229632');
    fireEvent.change(input, { target: { value: '+1.276.322.9632' } });
    expect(input).toHaveValue('+12763229632');
  });

  it('sends the normalized international BYOK phone number to create', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FIXED'} clock={() => '2027-06-10T22:00:00Z'} />);
    await unlockByok(fake);
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+1 (276) 322-9632' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    expect(fake.create.mock.calls[0]![0]).toMatchObject({ phoneNumber: '+12763229632' });
  });

  it('gives human-readable guidance, not schema language, for an unusable BYOK phone number', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await unlockByok(fake);
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Start CALL-E acquisition' }));
    expect(screen.getByText(/Enter a full phone number, including the country code/)).toBeVisible();
    expect(screen.queryByText(/E\.164/)).not.toBeInTheDocument();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('shows truthful QUEUED waiting copy as the empty conversation surface', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(record())} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Waiting for CALL-E')).toBeVisible();
    expect(screen.getByText('CALL-E is preparing the interaction.')).toBeVisible();
    expect(screen.queryByText('Finalizing provider result')).not.toBeInTheDocument();
  });

  it('shows truthful IN_PROGRESS copy while the attempt is active with no transcript yet', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const active = record({ status: 'in_progress', providerEvidence: { ...record().providerEvidence!, status: 'in_progress', recipients: [{ id: 'RECIPIENT', status: 'in_progress', summary: null, attempts: [{ id: 'ATTEMPT', status: 'in_progress', startedAt: '2027-06-10T22:00:02Z', completedAt: null, summary: null, transcriptTurns: [], providerCallId: 'PROVIDER-CALL', failureCode: null, failureMessage: null }] }] } });
    const { container } = render(<AcquisitionExperience api={api(active)} onNavigateControl={() => undefined} />);
    await screen.findByText('CALL-E interaction is active.');
    const activity = container.querySelector<HTMLElement>('.acq-provider-activity')!;
    expect(within(activity).getByText('Conversation in progress')).toBeVisible();
  });

  it('shows finalizing copy only once the attempt itself completed while the record stays non-terminal', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const finalizing = record({ status: 'in_progress', providerEvidence: { ...record().providerEvidence!, status: 'in_progress', recipients: [{ id: 'RECIPIENT', status: 'completed', summary: null, attempts: [{ id: 'ATTEMPT', status: 'completed', startedAt: '2027-06-10T22:00:02Z', completedAt: '2027-06-10T22:01:00Z', summary: null, transcriptTurns: [], providerCallId: 'PROVIDER-CALL', failureCode: null, failureMessage: null }] }] } });
    render(<AcquisitionExperience api={api(finalizing)} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Finalizing provider result')).toBeVisible();
    expect(screen.getByText(/The call may be complete while CALL-E prepares the terminal structured result/)).toBeVisible();
  });

  it('stops the provider activity indicator immediately once the record reaches a terminal state', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const fake = api(record());
    fake.refresh.mockResolvedValue({ found: true, record: completed('APPROVED') });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Waiting for CALL-E')).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(screen.queryByText('Waiting for CALL-E')).not.toBeInTheDocument();
    const eligibility = screen.getByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('READY FOR REVIEW')).toBeVisible();
  });

  it('keeps SAFE_STOP and READY_FOR_REVIEW semantics unchanged after the visual pass', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { unmount } = render(<AcquisitionExperience api={api(completed('PENDING'))} onNavigateControl={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'SAFE STOP' })).toBeVisible();
    expect(screen.getByText('NOT READY FOR REVIEW')).toBeVisible();
    unmount();
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('READY FOR REVIEW')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue to Control' })).toBeVisible();
  });
});

describe('Acquisition V1 visual grammar', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps every rail step numbered — active steps never become a bullet', async () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    await unlock();
    const rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    const steps = within(rail).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent('1');
    expect(steps[1]).toHaveTextContent('2');
    expect(steps[2]).toHaveTextContent('3');
    expect(steps[3]).toHaveTextContent('4');
    expect(rail.textContent).not.toContain('●');
  });

  it('renders a completed rail step as a check while keeping the still-active step numbered', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed');
    const rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    const steps = within(rail).getAllByRole('listitem');
    expect(steps[0]!.querySelector('svg')).not.toBeNull();
    expect(steps[0]!.textContent).not.toMatch(/[✓●]/);
    expect(steps[3]).toHaveTextContent('4');
  });

  it('groups adjacent same-speaker turns visually without merging, rewriting or reordering the raw turns', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const complete = completed('APPROVED');
    const turns = [
      { offsetSeconds: 0, speaker: 'bot' as const, text: 'Hi,' },
      { offsetSeconds: 2, speaker: 'bot' as const, text: 'is this Client?' },
      { offsetSeconds: 5, speaker: 'user' as const, text: 'Yes.' },
      { offsetSeconds: 7, speaker: 'bot' as const, text: "Great, let's continue." },
    ];
    const withTranscript = { ...complete, providerEvidence: { ...complete.providerEvidence!, recipients: [{ ...complete.providerEvidence!.recipients[0]!, attempts: [{ ...complete.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: turns }] }] } };
    render(<AcquisitionExperience api={api(withTranscript)} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Hi,')).toBeVisible();
    expect(screen.getByText('is this Client?')).toBeVisible();
    expect(screen.getByText('Yes.')).toBeVisible();
    expect(screen.getByText("Great, let's continue.")).toBeVisible();
    const timeline = document.querySelector('.transcript-timeline') as HTMLElement;
    const groups = within(timeline).getAllByRole('listitem');
    expect(groups).toHaveLength(3);
    expect(within(groups[0]!).getAllByText('CALL-E')).toHaveLength(1);
    expect(within(groups[0]!).getByText('Hi,')).toBeVisible();
    expect(within(groups[0]!).getByText('is this Client?')).toBeVisible();
    expect(within(groups[1]!).getByText('Recipient')).toBeVisible();
    expect(within(groups[1]!).getByText('Yes.')).toBeVisible();
    expect(within(groups[2]!).getByText("Great, let's continue.")).toBeVisible();
    expect(document.body.textContent).not.toContain('Hi, is this Client?');
  });

  it('ends a same-speaker visual group at the preview boundary and resumes it as a fresh group after expansion', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const complete = completed('APPROVED');
    const turns = [
      { offsetSeconds: 0, speaker: 'bot' as const, text: 'Turn 1' },
      { offsetSeconds: 1, speaker: 'user' as const, text: 'Turn 2' },
      { offsetSeconds: 2, speaker: 'bot' as const, text: 'Turn 3' },
      { offsetSeconds: 3, speaker: 'bot' as const, text: 'Turn 4' },
      { offsetSeconds: 4, speaker: 'bot' as const, text: 'Turn 5' },
      { offsetSeconds: 5, speaker: 'user' as const, text: 'Turn 6' },
    ];
    const withTranscript = { ...complete, providerEvidence: { ...complete.providerEvidence!, recipients: [{ ...complete.providerEvidence!.recipients[0]!, attempts: [{ ...complete.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: turns }] }] } };
    render(<AcquisitionExperience api={api(withTranscript)} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Turn 4')).toBeVisible();
    expect(screen.getByText('Turn 3')).toBeVisible();
    expect(screen.getByText('Turn 5')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /View \d+ more turns/ }));
    expect(screen.getByText('Turn 5')).toBeVisible();
    expect(screen.getByText('Turn 6')).toBeVisible();
    // Turn 3 and Turn 4 (both bot, preview) stay grouped together; Turn 5 (bot, remaining) starts its own group instead of silently joining Turn 4's.
    const previewLastGroup = screen.getByText('Turn 4').closest('li')!;
    expect(within(previewLastGroup).getByText('Turn 3')).toBeVisible();
    const remainingFirstGroup = screen.getByText('Turn 5').closest('li')!;
    expect(remainingFirstGroup).not.toBe(previewLastGroup);
    expect(within(remainingFirstGroup).queryByText('Turn 4')).not.toBeInTheDocument();
    ['Turn 1', 'Turn 2', 'Turn 3', 'Turn 4', 'Turn 5', 'Turn 6'].forEach((text) => {
      expect(screen.getAllByText(text)).toHaveLength(1);
    });
  });

  it('tells the user Hosted demo outcomes are not scripted before they connect', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    expect(screen.getByText(/outcomes are not scripted/i)).toBeVisible();
    expect(screen.queryByText(/guaranteed to be approved/i)).not.toBeInTheDocument();
  });

  it('keeps recovery copy human — no architecture jargon leaks into visible strings', () => {
    const source = readFileSync('src/ui/AcquisitionExperience.tsx', 'utf8');
    expect(source).not.toMatch(/opaque/i);
    expect(source).not.toMatch(/server truth/i);
    expect(source).not.toMatch(/recovery pointer/i);
    expect(source).not.toMatch(/not business identity/i);
  });

  it('reserves green for a future ALLOW disposition — Acquisition completion/decision styling stays out of --allow', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css).not.toMatch(/var\(--allow\)/);
    expect(css.match(/\.acq-inline-status\.is-complete\s*\{[^}]*\}/)?.[0]).not.toMatch(/#83ddb8|rgb\(\s*1?\d\d\s+2\d\d\s+1\d\d\s*\)/i);
    expect(css.match(/\.acq-formation li\.is-done \.acq-state[^{]*\{[^}]*\}/)?.[0]).not.toMatch(/#a8d9c2/i);
  });

  it('keeps SAFE STOP visually distinct from the shared future WAIT amber token', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css).toContain('--acq-brass');
    expect(css.match(/\.acq-resolution\.is-safe-stop\s*\{[^}]*\}/)?.[0]).not.toMatch(/var\(--wait\)/);
    const safeStopHeadingRules = css.match(/\.acq-resolution\.is-safe-stop h2[^{]*\{[^}]*\}/g) ?? [];
    expect(safeStopHeadingRules.some((rule) => rule.includes('var(--acq-brass)'))).toBe(true);
  });

  it('gives CLARIFICATION REQUIRED its own neutral/plum treatment, distinct from plain SAFE STOP brass', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('NEEDS_CLARIFICATION'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(eligibility).toHaveClass('is-clarification');
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css.match(/\.acq-resolution\.is-safe-stop\.is-clarification h2[^{]*\{[^}]*\}/)?.[0]).not.toMatch(/var\(--acq-brass\)/);
  });
});

describe('Acquisition V1 Connection Gate', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders the rail alongside the gate without renaming the Conversation lifecycle step to Connection', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    const rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    expect(within(rail).getByText('Conversation')).toBeVisible();
    expect(within(rail).queryByText('Connection', { selector: 'strong' })).not.toBeInTheDocument();
    expect(within(rail).getByText('CONNECTION REQUIRED')).toBeVisible();
    expect(within(rail).getByText('Evidence')).toBeVisible();
    expect(within(rail).getByText('Decision')).toBeVisible();
    expect(within(rail).getByText('Control')).toBeVisible();
    // Not yet connected: the rail's own connection/disconnect block stays hidden.
    expect(screen.queryByRole('button', { name: 'Disconnect CALL-E' })).not.toBeInTheDocument();
  });

  it('creates no acquisition and makes no CALL-E request merely by viewing or selecting a connection route', () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Connect to CALL-E' })).toBeVisible();
    expect(fake.connectHosted).not.toHaveBeenCalled();
    expect(fake.connectByok).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'X' } });
    expect(fake.connectByok).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('keeps Hosted connection behavior unchanged from the gate — one connectHosted call, no acquisition created', async () => {
    const fake = api();
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted sandbox' }));
    await screen.findByRole('heading', { name: 'Acquire a decision' });
    expect(fake.connectHosted).toHaveBeenCalledTimes(1);
    expect(fake.create).not.toHaveBeenCalled();
    // Reaching READY does not itself create an acquisition — the existing pre-call
    // confirmation still gates that, unchanged by this presentation pass.
    expect(screen.getByRole('button', { name: 'Start CALL-E acquisition' })).toBeVisible();
  });

  it('keeps BYOK connection behavior unchanged from the gate', async () => {
    const fake = api();
    vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    fireEvent.change(screen.getByLabelText('CALL-E API key'), { target: { value: 'INERT-BYOK-KEY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect your account' }));
    await screen.findByRole('heading', { name: 'Acquire a decision' });
    expect(fake.connectByok).toHaveBeenCalledWith('INERT-BYOK-KEY');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('gives Hosted and BYOK clear, distinct semantics on one gate composition', () => {
    render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Hosted sandbox' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your CALL-E account' })).toBeVisible();
    expect(screen.getByText('For live acquisitions')).toBeVisible();
    expect(screen.getByText('Limited live test')).toBeVisible();
    expect(screen.getByText(/No CALL-E account required/)).toBeVisible();
    expect(screen.getByText(/Your CALL-E account and balance/)).toBeVisible();
    expect(screen.getByText(/outcomes are not scripted/i)).toBeVisible();
    // "Hosted live demo"/"Recommended" is retired: Try Demo owns the guided-demo concept and
    // BYOK is the primary live route.
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
    expect(screen.queryByText(/Hosted live demo/i)).not.toBeInTheDocument();
  });

  it('keeps CALL-E provider yellow scoped to real provider-identity marks — the gate and the CALL-E transcript/instrument mark', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    const calleUsages = css.match(/[^\n{]*var\(--acq-calle\)[^\n{;]*\{[^}]*\}/g) ?? [];
    for (const rule of calleUsages) expect(rule).toMatch(/\.acq-gate|\.acq-speaker\.is-bot/);
  });

  it('does not change any Acquisition state after connection — READY_FOR_REVIEW stays reachable and untouched', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    const eligibility = await screen.findByRole('region', { name: 'Control eligibility' });
    expect(within(eligibility).getByText('READY FOR REVIEW')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Connect to CALL-E' })).not.toBeInTheDocument();
  });

  it('renders the real CALL-E brand artwork, never a redrawn or phone-glyph substitute', () => {
    const { container } = render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    const brandImages = [...container.querySelectorAll<HTMLImageElement>('img')].filter((image) => /call-e/i.test(image.getAttribute('src') ?? ''));
    expect(brandImages.length).toBeGreaterThanOrEqual(2);
    expect(brandImages.some((image) => /icon-yellow/.test(image.src))).toBe(true);
    expect(brandImages.some((image) => /logo-yellow/.test(image.src))).toBe(true);
    for (const image of brandImages) expect(image.getAttribute('alt')).toBe('CALL-E');
    // The previous text-pill / outgoing-call-glyph stand-in for CALL-E identity is gone.
    expect(container.querySelector('.acq-gate-calle-mark')).toBeNull();
    const source = readFileSync('src/ui/AcquisitionExperience.tsx', 'utf8');
    expect(source).toMatch(/assets\/brands\/call-e\/icon-yellow/);
    expect(source).toMatch(/assets\/brands\/call-e\/logo-yellow/);
  });

  it('keeps a real signal bridge between Exception Broker and CALL-E that only animates on real state', () => {
    const { container } = render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    const bridge = container.querySelector('.acq-bridge');
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveClass('is-idle');
    // More than a divider: layered strands plus luminous signal points.
    expect(bridge!.querySelectorAll('.acq-bridge-strands path').length).toBeGreaterThanOrEqual(4);
    expect(bridge!.querySelectorAll('.acq-bridge-points circle').length).toBeGreaterThanOrEqual(2);
    expect(bridge).toHaveAttribute('aria-hidden', 'true');
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    // At rest there is no travelling signal; the travelling pulse is bound to .is-connecting.
    expect(css).toMatch(/\.acq-bridge\.is-connecting \.acq-bridge-pulse\s*\{[^}]*animation:acq-bridge-travel/);
    expect(css).not.toMatch(/\.acq-bridge\.is-idle \.acq-bridge-pulse\s*\{[^}]*animation/);
    // Reduced motion keeps the composition but removes the travelling signal.
    expect(css.match(/@media \(prefers-reduced-motion:reduce\)[\s\S]*?\n\n/)?.[0] ?? css).toMatch(/\.acq-bridge \.acq-bridge-pulse \{ display:none; \}/);
  });

  it('shows a travelling signal only while a real connection request is in flight', async () => {
    const fake = api();
    let release!: (value: { connectionId: string; kind: 'HOSTED_DEMO'; connected: true }) => void;
    vi.mocked(fake.connectHosted).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { container } = render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(container.querySelector('.acq-bridge')).toHaveClass('is-idle');
    fireEvent.click(screen.getByRole('button', { name: 'Use hosted sandbox' }));
    await waitFor(() => expect(container.querySelector('.acq-bridge')).toHaveClass('is-connecting'));
    release({ connectionId: 'INERT-SESSION-TOKEN', kind: 'HOSTED_DEMO', connected: true });
    await screen.findByRole('heading', { name: 'Acquire a decision' });
  });

  it('routes the learning escape hatch to the interactive demo', () => {
    const onNavigateControl = vi.fn(); const onNavigateWalkthrough = vi.fn();
    render(<AcquisitionExperience api={api()} onNavigateControl={onNavigateControl} onNavigateWalkthrough={onNavigateWalkthrough} />);
    const escape = screen.getByRole('button', { name: /Try the interactive demo/ });
    expect(escape).toBeVisible();
    fireEvent.click(escape);
    expect(onNavigateWalkthrough).toHaveBeenCalledTimes(1);
    expect(onNavigateControl).not.toHaveBeenCalled();
  });

  it('keeps the learning escape hatch working when no walkthrough destination is supplied', () => {
    const onNavigateControl = vi.fn();
    render(<AcquisitionExperience api={api()} onNavigateControl={onNavigateControl} />);
    fireEvent.click(screen.getByRole('button', { name: /Try the interactive demo/ }));
    expect(onNavigateControl).toHaveBeenCalledTimes(1);
  });

  it('presents BYOK as the primary live route and Hosted sandbox as the secondary test route', () => {
    const { container } = render(<AcquisitionExperience api={api()} onNavigateControl={() => undefined} />);
    const routes = [...container.querySelectorAll('.acq-gate-route')];
    expect(routes).toHaveLength(2);
    expect(routes[0]).toHaveClass('acq-gate-route--byok');
    expect(routes[1]).toHaveClass('acq-gate-route--hosted');
    expect(within(routes[0] as HTMLElement).getByRole('heading', { name: 'Your CALL-E account' })).toBeVisible();
    expect(within(routes[1] as HTMLElement).getByRole('heading', { name: 'Hosted sandbox' })).toBeVisible();
    // Hosted's session limit stays as restrained supporting copy, never a headline benefit.
    const hostedLimit = screen.getByText(/one acquisition per browser session/i);
    expect(hostedLimit.tagName).toBe('SMALL');
  });

  it('keeps CALL-E yellow out of every result, status and disposition color', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    const semanticSelectors = /\.(acq-resolution|acq-inline-status|acq-state|acq-rail-step)[^{]*\{[^}]*\}/g;
    for (const rule of css.match(semanticSelectors) ?? []) expect(rule).not.toMatch(/--acq-calle/);
  });
});

describe('Acquisition V1 Pass 2A — active instrument + documentary conversation', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const withAttempt = (recordStatus: AcquisitionPublicRecord['status'], attemptStatus: 'queued' | 'in_progress' | 'completed', transcriptTurns: SanitizedTranscriptTurn[] = []) => record({
    status: recordStatus,
    providerEvidence: { ...record().providerEvidence!, status: attemptStatus === 'completed' ? 'in_progress' : attemptStatus, recipients: [{ id: 'RECIPIENT', status: attemptStatus === 'queued' ? 'pending' : attemptStatus, summary: null, attempts: [{ id: 'ATTEMPT', status: attemptStatus, startedAt: '2027-06-10T22:00:02Z', completedAt: attemptStatus === 'completed' ? '2027-06-10T22:01:00Z' : null, summary: null, transcriptTurns, providerCallId: 'PROVIDER-CALL', failureCode: null, failureMessage: null }] }] },
  });

  it('keeps the same topbar and rail DOM node from READY through CREATING into QUEUED — no scene replacement', async () => {
    const fake = api();
    let resolveCreate!: (value: { accepted: true; record: AcquisitionPublicRecord; existing: false }) => void;
    fake.create.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const { container } = render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FIXED'} clock={() => '2027-06-10T22:00:00Z'} />);
    await unlockByok(fake);
    const topbarBefore = container.querySelector('.product-topbar');
    const railBefore = container.querySelector('.acq-rail');
    fireEvent.change(screen.getByLabelText('Recipient phone'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(document.getElementById('acquisition-create')!);
    expect(screen.getByText('Starting…')).toBeVisible();
    expect(container.querySelector('.product-topbar')).toBe(topbarBefore);
    expect(container.querySelector('.acq-rail')).toBe(railBefore);
    resolveCreate({ accepted: true, record: withAttempt('queued', 'queued'), existing: false });
    await screen.findByText('Acquisition queued');
    expect(container.querySelector('.product-topbar')).toBe(topbarBefore);
    expect(container.querySelector('.acq-rail')).toBe(railBefore);
  });

  it('renders the quiet, almost-dormant signal instrument for QUEUED with no turns yet', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { container } = render(<AcquisitionExperience api={api(withAttempt('queued', 'queued'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Waiting for CALL-E');
    const bridge = container.querySelector('.acq-signal-instrument .acq-bridge');
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveClass('is-idle');
  });

  it('renders the more active travelling-pulse signal instrument for IN_PROGRESS with no turns yet', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { container } = render(<AcquisitionExperience api={api(withAttempt('in_progress', 'in_progress'))} onNavigateControl={() => undefined} />);
    await screen.findByText('CALL-E interaction is active.');
    const bridge = container.querySelector('.acq-signal-instrument .acq-bridge');
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveClass('is-connecting');
  });

  it('renders the converging, settled signal instrument once FINALIZING with no turns yet — no celebratory burst', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { container } = render(<AcquisitionExperience api={api(withAttempt('in_progress', 'completed'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Finalizing provider result');
    const bridge = container.querySelector('.acq-signal-instrument .acq-bridge');
    expect(bridge).not.toBeNull();
    expect(bridge).toHaveClass('is-arrived');
  });

  it('keeps the documentary transcript visible through FINALIZING once turns exist, with only a restrained status badge', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const turns: SanitizedTranscriptTurn[] = [{ offsetSeconds: 2, speaker: 'bot', text: 'Confirming the plan.' }, { offsetSeconds: 9, speaker: 'user', text: 'Understood.' }];
    const { container } = render(<AcquisitionExperience api={api(withAttempt('in_progress', 'completed', turns))} onNavigateControl={() => undefined} />);
    expect(await screen.findByText('Confirming the plan.')).toBeVisible();
    expect(screen.getByText('Understood.')).toBeVisible();
    // Never regress an already-informative transcript back to the large instrument.
    expect(container.querySelector('.acq-signal-instrument')).toBeNull();
    expect(container.querySelector('.acq-provider-activity')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Acquisition in progress' })).toBeVisible();
    expect(within(screen.getByRole('heading', { name: 'Conversation evidence' }).closest('header') as HTMLElement).getByText('FINALIZING')).toBeVisible();
  });

  it('never restores the active instrument once the acquisition reaches a terminal state', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { container } = render(<AcquisitionExperience api={api(completed('APPROVED'))} onNavigateControl={() => undefined} />);
    await screen.findByText('Call completed');
    expect(container.querySelector('.acq-signal-instrument')).toBeNull();
    expect(container.querySelector('.acq-provider-activity')).toBeNull();
    expect(screen.queryByText('FINALIZING')).not.toBeInTheDocument();
  });

  it('shows the real CALL-E mark once per new CALL-E visual group, never once per raw turn — and gives the recipient no avatar', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const complete = completed('APPROVED');
    // All four turns stay within the preview boundary, so grouping is not split by pagination.
    const turns: SanitizedTranscriptTurn[] = [
      { offsetSeconds: 0, speaker: 'bot', text: 'Turn A' }, { offsetSeconds: 1, speaker: 'bot', text: 'Turn B' },
      { offsetSeconds: 2, speaker: 'user', text: 'Turn C' },
      { offsetSeconds: 3, speaker: 'bot', text: 'Turn D' },
    ];
    const withTranscript = { ...complete, providerEvidence: { ...complete.providerEvidence!, recipients: [{ ...complete.providerEvidence!.recipients[0]!, attempts: [{ ...complete.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: turns }] }] } };
    const { container } = render(<AcquisitionExperience api={api(withTranscript)} onNavigateControl={() => undefined} />);
    await screen.findByText('Turn A');
    // Two CALL-E groups (A+B, D) — one real mark each, never one per raw turn.
    expect(container.querySelectorAll('.acq-speaker.is-bot img')).toHaveLength(2);
    expect(container.querySelectorAll('.acq-speaker.is-user img')).toHaveLength(0);
  });

  it('keeps a realistic 48-turn transcript structurally exact, internally scrollable and duplicate-free across expand', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const complete = completed('APPROVED');
    const bigTurns: SanitizedTranscriptTurn[] = Array.from({ length: 48 }, (_, index) => ({
      offsetSeconds: index * 3, speaker: index % 2 === 0 ? 'bot' as const : 'user' as const,
      text: `Turn ${index + 1} — a longer realistic sentence describing the controlled sandbox recovery scenario in documentary detail.`,
    }));
    const withTranscript = { ...complete, providerEvidence: { ...complete.providerEvidence!, recipients: [{ ...complete.providerEvidence!.recipients[0]!, attempts: [{ ...complete.providerEvidence!.recipients[0]!.attempts[0]!, transcriptTurns: bigTurns }] }] } };
    const { container } = render(<AcquisitionExperience api={api(withTranscript)} onNavigateControl={() => undefined} />);
    await screen.findByText(/^Turn 1 —/);
    const rawRows = Array.from(container.querySelectorAll('.transcript-timeline p'));
    expect(rawRows).toHaveLength(48);
    expect(rawRows.every((row) => row.children.length === 2 && row.children[0]?.tagName === 'TIME' && row.children[1]?.classList.contains('acq-turn-text'))).toBe(true);
    expect(rawRows.map((row) => row.querySelector('.acq-turn-text')?.textContent)).toEqual(bigTurns.map((turn) => turn.text));
    expect(container.querySelector('.acq-transcript-scroll')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /View 44 more turns/ }));
    expect(container.querySelectorAll('.transcript-timeline p')).toHaveLength(48);
    expect(screen.getAllByText(/^Turn 20 —/)).toHaveLength(1);
    expect(screen.getAllByText(/^Turn 48 —/)).toHaveLength(1);
  });

  it('scopes the Acquisition transcript out of the legacy app timeline grid and fixes only its desktop reading viewport', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css).toMatch(/\.acq-conversation \.transcript-timeline li\s*\{[^}]*display:block;[^}]*width:100%;[^}]*min-width:0;/);
    expect(css).toMatch(/\.acq-conversation \.transcript-timeline p\s*\{[^}]*display:grid;[^}]*grid-template-columns:48px minmax\(0,1fr\);[^}]*max-width:none;/);
    expect(css).toMatch(/\.acq-transcript-scroll\s*\{[^}]*height:336px;[^}]*overflow-y:auto;/);
    expect(css).toMatch(/@media \(max-width:560px\)[^{]*\{[\s\S]*?\.acq-transcript-scroll\s*\{[^}]*height:auto;[^}]*overflow-y:visible;/);
  });

  it('gives the title a restrained micro-transition class — opacity/translateY only, no scale or blur', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css).toMatch(/@keyframes acq-title-shift\s*\{\s*from\s*\{\s*opacity:0;\s*transform:translateY\(5px\);?\s*\}\s*to\s*\{\s*opacity:1;\s*transform:translateY\(0\);?\s*\}\s*\}/);
    expect(css).not.toMatch(/acq-title-shift[^}]*scale/);
    expect(css).not.toMatch(/acq-title-shift[^}]*blur/);
  });

  it('remounts the interaction title on every lifecycle label change so the micro-transition replays truthfully', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const fake = api(withAttempt('queued', 'queued'));
    fake.refresh.mockResolvedValue({ found: true, record: withAttempt('in_progress', 'in_progress') });
    const { container } = render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    const queuedTitle = screen.getByRole('heading', { name: 'Acquisition queued' });
    expect(queuedTitle).toHaveClass('acq-title-shift');
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(screen.getByRole('heading', { name: 'Conversation in progress' })).toHaveClass('acq-title-shift');
    expect(container.querySelectorAll('.acq-interaction-band h1')).toHaveLength(1);
  });

  it('neutralizes travelling-signal and title-shift motion under reduced motion via the existing universal override', () => {
    const css = readFileSync('src/styles/acquisition.css', 'utf8');
    expect(css).toContain('.acquisition-shell *,.acquisition-shell *::before,.acquisition-shell *::after { animation-duration:.01ms!important');
  });
});

describe('Acquisition V1 technical failure and recovery', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.useRealTimers(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  const ambiguous = (): AcquisitionPublicRecord => record({
    accessMode: 'HOSTED_DEMO',
    technicalFailure: { stage: 'CREATE', acceptance: 'UNKNOWN', reconciliationAvailable: true, attempts: 2, code: 'Error', message: 'socket hang up', observedAt: '2027-06-10T22:00:05Z' },
  });
  const providerFailed = (overrides: Partial<AcquisitionPublicRecord> = {}): AcquisitionPublicRecord => record({
    status: 'failed', terminalAt: '2027-06-10T22:02:00Z', accessMode: 'HOSTED_DEMO', normalizationStatus: 'SAFE_STOP', handoffState: 'SAFE_STOP',
    technicalFailure: { stage: 'PROVIDER_TERMINAL', acceptance: 'PROVIDER_IDENTIFIED', reconciliationAvailable: false, attempts: 1, code: 'call_failed', message: 'Call failed safely.', observedAt: '2027-06-10T22:02:00Z' },
    ...overrides,
  });

  it('presents ambiguous acceptance as recoverable rather than as a provider outcome', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { container } = render(<AcquisitionExperience api={api(ambiguous())} onNavigateControl={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'Acquisition needs reconciliation' })).toBeVisible();
    expect(screen.getByText('No decision was formed. No Control handoff or external execution occurred.')).toBeVisible();
    // Never dressed as a provider result, a business SAFE STOP or a preparing call.
    expect(screen.queryByRole('heading', { name: "CALL-E couldn't complete this acquisition" })).not.toBeInTheDocument();
    expect(screen.queryByText('SAFE STOP')).not.toBeInTheDocument();
    expect(container.querySelector('.acq-signal-instrument')).toBeNull();
    expect(screen.getByText(/did not receive a call identity from CALL-E/)).toBeVisible();
    expect(screen.getByRole('button', { name: /Retry safely/ })).toBeVisible();
  });

  it('reconciles under the same acquisition id and idempotent server key, never as a new acquisition', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const fake = api(ambiguous());
    fake.create.mockResolvedValue({ accepted: true, record: record({ status: 'queued', callId: 'CALL-TEST-1' }), existing: true });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FRESH-IDENTITY'} />);
    fireEvent.click(await screen.findByRole('button', { name: /Retry safely/ }));
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    const [submitted] = fake.create.mock.calls[0] as [{ acquisitionId: string; recoveryOfAcquisitionId?: string; request: { createdAt: string; requestId: string } }];
    expect(submitted.acquisitionId).toBe('ACQ-TEST-1');
    expect(submitted.acquisitionId).not.toContain('FRESH-IDENTITY');
    // A reconciliation is never a recovery redial and never regenerates request identity.
    expect(submitted.recoveryOfAcquisitionId).toBeUndefined();
    expect(submitted.request.requestId).toBe('REQUEST-TEST-1');
    expect(submitted.request.createdAt).toBe('2027-06-10T22:00:00Z');
  });

  it('keeps technical details collapsed and free of secrets, with a truthful legacy fallback', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { unmount } = render(<AcquisitionExperience api={api(providerFailed())} onNavigateControl={() => undefined} />);
    const summary = await screen.findByText('Technical details');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByText('CALL-E accepted the call and returned its identity')).toBeVisible();
    expect(screen.getByText('call_failed')).toBeVisible();
    expect(screen.getByText('Call failed safely.')).toBeVisible();
    unmount();

    // A record written before diagnostics existed must not be given an invented cause.
    render(<AcquisitionExperience api={api(record({ status: 'failed', terminalAt: '2027-06-10T22:02:00Z' }))} onNavigateControl={() => undefined} />);
    fireEvent.click(await screen.findByText('Technical details'));
    expect(screen.getByText('Technical cause unavailable for this earlier record.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Retry hosted test/ })).not.toBeInTheDocument();
  });

  it('offers one explicit Hosted redial for a provider-confirmed failure and never dials automatically', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const fake = api(providerFailed());
    fake.create.mockResolvedValue({ accepted: true, record: record({ acquisitionId: 'ACQ-BROWSER-V1-RECOVERY', status: 'queued' }), existing: false });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'RECOVERY'} clock={() => '2027-06-10T22:05:00Z'} />);
    expect(await screen.findByRole('heading', { name: "CALL-E couldn't complete this acquisition" })).toBeVisible();
    // Nothing is dialled until the user explicitly asks for it.
    expect(fake.create).not.toHaveBeenCalled();
    const redial = screen.getByRole('button', { name: /Retry hosted test/ });
    expect(screen.getByText('Places one new live call to the synthetic destination')).toBeVisible();
    fireEvent.click(redial);
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    const [submitted] = fake.create.mock.calls[0] as [{ acquisitionId: string; recoveryOfAcquisitionId?: string }];
    // A real second call needs a new acquisition identity, and therefore a new idempotency key.
    expect(submitted.acquisitionId).toBe('ACQ-BROWSER-V1-RECOVERY');
    expect(submitted.recoveryOfAcquisitionId).toBe('ACQ-TEST-1');
  });

  it('withdraws the redial once the allowance is already spent, and never offers it for BYOK', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const { unmount } = render(<AcquisitionExperience api={api(providerFailed({ recoveredByAcquisitionId: 'ACQ-ALREADY-RECOVERED' }))} onNavigateControl={() => undefined} />);
    await screen.findByRole('heading', { name: "CALL-E couldn't complete this acquisition" });
    expect(screen.queryByRole('button', { name: /Retry hosted test/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Control locked' })).toBeDisabled();
    unmount();

    const byok = api(providerFailed({ accessMode: 'BYOK' }));
    vi.mocked(byok.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
    render(<AcquisitionExperience api={byok} onNavigateControl={() => undefined} />);
    await screen.findByRole('heading', { name: "CALL-E couldn't complete this acquisition" });
    expect(screen.queryByRole('button', { name: /Retry hosted test/ })).not.toBeInTheDocument();
    expect(byok.create).not.toHaveBeenCalled();
  });

  it('stops offering a retry once the server has spent its reconciliation budget', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const exhausted = record({
      accessMode: 'HOSTED_DEMO',
      technicalFailure: { stage: 'CREATE', acceptance: 'UNKNOWN', reconciliationAvailable: false, attempts: 3, code: 'Error', message: 'socket hang up', observedAt: '2027-06-10T22:00:09Z' },
    });
    const fake = api(exhausted);
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'CALL-E acceptance is still unresolved' })).toBeVisible();
    expect(screen.getByText(/retaining this acquisition because CALL-E may have accepted an earlier request\. No additional call will be started automatically\./)).toBeVisible();
    expect(screen.getByText(/No further check will be made from here/)).toBeVisible();
    // No retry, no redial, no fresh start, and nothing dialled on its own.
    expect(screen.queryByRole('button', { name: /Retry safely/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry hosted test/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start CALL-E acquisition' })).not.toBeInTheDocument();
    expect(fake.create).not.toHaveBeenCalled();
    // Truthful about what it is not: never a provider verdict or a business disposition.
    expect(screen.queryByText('SAFE STOP')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: "CALL-E couldn't complete this acquisition" })).not.toBeInTheDocument();
    // Control stays locked and the acquisition stays protected.
    expect(screen.queryByRole('button', { name: 'Continue to Control' })).not.toBeInTheDocument();
    const rail = screen.getByRole('complementary', { name: 'Acquisition flow' });
    expect(within(rail).getByText('LOCKED')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disconnect CALL-E' })).toBeDisabled();
  });

  it('lets a reloaded BYOK acquisition reconcile by re-entering the same authorized recipient', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    // A reload loses the in-session request, and BYOK deliberately never stored the full number.
    const byok = record({
      accessMode: 'BYOK',
      technicalFailure: { stage: 'CREATE', acceptance: 'UNKNOWN', reconciliationAvailable: true, attempts: 2, code: 'Error', message: 'socket hang up', observedAt: '2027-06-10T22:00:05Z' },
    });
    const fake = api(byok);
    vi.mocked(fake.getConnection).mockResolvedValue({ connectionId: 'INERT-BYOK-CONNECTION', kind: 'BYOK', connected: true });
    render(<AcquisitionExperience api={fake} onNavigateControl={() => undefined} createIdentity={() => 'FRESH-IDENTITY'} />);
    await screen.findByRole('heading', { name: 'Acquisition needs reconciliation' });
    expect(screen.getByText('This must be the same recipient used for the original acquisition.')).toBeVisible();

    const submit = screen.getByRole('button', { name: /Retry safely/ });
    fireEvent.change(screen.getByLabelText('Authorized recipient'), { target: { value: '+1 (555) 123-4567' } });
    fireEvent.click(submit);
    // Authorization is still required before anything reaches the server.
    expect(fake.create).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm recipient ownership or authorization before reconciling/)).toBeVisible();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
    const [submitted] = fake.create.mock.calls[0] as [{ acquisitionId: string; phoneNumber?: string; recoveryOfAcquisitionId?: string; request: { requestId: string; createdAt: string } }];
    // Same acquisition and same canonical request: a reconciliation, never a new call.
    expect(submitted.acquisitionId).toBe('ACQ-TEST-1');
    expect(submitted.phoneNumber).toBe('+15551234567');
    expect(submitted.recoveryOfAcquisitionId).toBeUndefined();
    expect(submitted.request.requestId).toBe('REQUEST-TEST-1');
    expect(submitted.request.createdAt).toBe('2027-06-10T22:00:00Z');
    expect(JSON.stringify(submitted)).not.toContain('FRESH-IDENTITY');
  });

  it('keeps the Pass 2A shell and the guided-demo escape hatch available through a technical failure', async () => {
    sessionStorage.setItem(acquisitionAccessKey, 'ACCESS'); localStorage.setItem(acquisitionStorageKey, 'ACQ-TEST-1');
    const onNavigateControl = vi.fn();
    const { container } = render(<AcquisitionExperience api={api(providerFailed())} onNavigateControl={onNavigateControl} />);
    await screen.findByRole('heading', { name: "CALL-E couldn't complete this acquisition" });
    expect(container.querySelector('.product-topbar')).not.toBeNull();
    expect(container.querySelector('.acq-rail')).not.toBeNull();
    expect(container.querySelector('.acq-rail-scene')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Connect your CALL-E account' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try interactive demo' }));
    expect(onNavigateControl).toHaveBeenCalledTimes(1);
  });
});

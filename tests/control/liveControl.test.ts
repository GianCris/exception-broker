import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AcquisitionCallGateway } from '../../src/acquisition/calleGateway.js';
import type { AcquisitionRecord } from '../../src/acquisition/contracts.js';
import { hashClientToken } from '../../src/acquisition/guardrails.js';
import { createAcquisitionHttpHandler } from '../../src/acquisition/http.js';
import { acquisitionRequestDefinitionFingerprint, AcquisitionService } from '../../src/acquisition/service.js';
import { MemoryAcquisitionStore } from '../../src/acquisition/store.js';
import { LiveControlService, operatorSandboxContextFingerprint } from '../../src/control/service.js';
import { JsonFileLiveControlStore, MemoryLiveControlStore, type LiveControlStore } from '../../src/control/store.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, OPERATOR_SANDBOX_OBJECTIVE, operatorSandboxContext } from '../../src/sandbox/operatorDefinition.js';
import { createOperatorControlledState } from '../../src/sandbox/operatorContext.js';

const token = 'INERT-CONTROL-TOKEN';
const now = '2027-07-01T17:05:00-05:00';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const canonicalRequestDefinition = acquisitionRequestDefinitionFingerprint({ caseId: OPERATOR_SANDBOX_FACTS.caseId,
  planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, actorRole: 'client', objective: OPERATOR_SANDBOX_OBJECTIVE,
  context: operatorSandboxContext(), expectedDecisionSchema: OPERATOR_SANDBOX_DEFINITION.expectedDecisionSchema });

const acquisition = (decision: 'APPROVED' | 'REJECTED' = 'APPROVED', overrides: Partial<AcquisitionRecord> = {}): AcquisitionRecord => ({
  acquisitionId: 'ACQ-LIVE-CONTROL-1', idempotencyKey: 'ACQ-LIVE-CONTROL-1', requestFingerprint: 'fingerprint', requestDefinitionFingerprint: canonicalRequestDefinition, clientTokenHash: hashClientToken(token), authorizationConfirmed: true,
  maskedRecipient: '+12*******23', decisionContext: { requestId: 'REQUEST-LIVE-1', createdAt: '2027-07-01T16:50:00-05:00', caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, actorRole: 'client' },
  status: 'completed', callId: 'CALL-LIVE-1', createdAt: '2027-07-01T16:50:00-05:00', updatedAt: '2027-07-01T17:00:00-05:00', terminalAt: '2027-07-01T17:00:00-05:00', providerEvidence: null,
  normalizedResult: { requestId: 'REQUEST-LIVE-1', createdAt: '2027-07-01T16:50:00-05:00', receivedAt: '2027-07-01T17:00:00-05:00', caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, actorRole: 'client', decision, summary: `Live Client ${decision}`, authorizationChanges: [], evidence: ['Sanitized provider decision evidence'], completionConfidence: { score: .93, label: 'high' } },
  normalizationStatus: 'USABLE', safeStopReason: null, handoffState: 'READY_FOR_REVIEW', ...overrides,
});

const setup = async (source = acquisition(), controlStore: LiveControlStore = new MemoryLiveControlStore()) => {
  const acquisitionStore = new MemoryAcquisitionStore(); await acquisitionStore.put(source);
  const gateway: AcquisitionCallGateway = { create: vi.fn(async () => { throw new Error('Provider must not be called'); }), get: vi.fn(async () => { throw new Error('Provider must not be called'); }) };
  const acquisitions = new AcquisitionService({ store: acquisitionStore, gateway, policy: { liveCallingEnabled: false, allowedClientTokens: new Set(), perClientDailyLimit: 0, globalDailyLimit: 0, cooldownMs: 0 } });
  const controls = new LiveControlService({ acquisitions, store: controlStore, clock: () => now });
  return { controls, acquisitionStore, controlStore, gateway };
};

describe('canonical controlled V1 definition', () => {
  it('shares exact case, plan, actor, role and reviewed facts with server context', () => {
    const state = createOperatorControlledState(); const plan = state.plans[0]!;
    expect(OPERATOR_SANDBOX_DEFINITION).toMatchObject({ definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1, actorRole: 'client' });
    expect(state.exceptionCase.id).toBe(OPERATOR_SANDBOX_FACTS.caseId); expect(plan.id).toBe(OPERATOR_SANDBOX_FACTS.planId);
    expect(state.exceptionCase.actors.find(({ role }) => role === 'client')?.id).toBe(OPERATOR_SANDBOX_FACTS.clientActorId);
    expect(plan).toMatchObject({ originalQuantityTomorrow: 350, substituteQuantityTomorrow: 150, clientAdditionalCost: 0, supplierAbsorbedCost: 75 });
    expect(state.approvals.map(({ actorRole }) => actorRole).sort()).toEqual(['production', 'supplier']);
    expect(operatorSandboxContextFingerprint()).toHaveLength(64);
  });
});

describe('Live Control handoff', () => {
  it('creates one source-bound exact review session and never invokes a provider', async () => {
    const { controls, gateway } = await setup(); const result = await controls.create('ACQ-LIVE-CONTROL-1', token);
    expect(result.accepted).toBe(true); if (!result.accepted) return;
    expect(result.record).toMatchObject({ status: 'AWAITING_REVIEW', definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1, caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' } });
    expect(result.record.reviewTarget).toMatchObject({ decision: 'APPROVED', requestId: 'REQUEST-LIVE-1', summary: 'Live Client APPROVED' });
    expect(result.record.sourceBinding).toMatchObject({ acquisitionId: 'ACQ-LIVE-CONTROL-1', callId: 'CALL-LIVE-1', requestId: 'REQUEST-LIVE-1' });
    expect(result.record).not.toHaveProperty('contextFingerprint'); expect(result.record.sourceBinding).not.toHaveProperty('normalizedDecisionFingerprint');
    expect(gateway.create).not.toHaveBeenCalled(); expect(gateway.get).not.toHaveBeenCalled();
  });

  it('is sequentially and concurrently idempotent for one acquisition', async () => {
    const { controls } = await setup(); const [left, right] = await Promise.all([controls.create('ACQ-LIVE-CONTROL-1', token), controls.create('ACQ-LIVE-CONTROL-1', token)]);
    expect(left.accepted && right.accepted).toBe(true); if (!left.accepted || !right.accepted) return;
    expect(left.record.controlSessionId).toBe(right.record.controlSessionId); expect((await controls.create('ACQ-LIVE-CONTROL-1', token))).toMatchObject({ accepted: true, existing: true });
  });

  it.each([
    ['safe stop', { normalizationStatus: 'SAFE_STOP', handoffState: 'SAFE_STOP' }], ['pending normalization', { normalizationStatus: 'PENDING', handoffState: 'NOT_READY' }],
    ['failed', { status: 'failed' }], ['canceled', { status: 'canceled' }], ['missing normalized result', { normalizedResult: null }],
  ] as const)('fails closed for %s', async (_label, overrides) => {
    const { controls } = await setup(acquisition('APPROVED', overrides as Partial<AcquisitionRecord>)); expect(await controls.create('ACQ-LIVE-CONTROL-1', token)).toMatchObject({ accepted: false, code: 'NOT_ELIGIBLE' });
  });

  it.each([
    ['caseId', { caseId: 'CASE-WRONG' }], ['planId', { planId: 'PLAN-WRONG' }], ['actorId', { actorId: 'ACTOR-WRONG' }], ['actorRole', { actorRole: 'supplier' as const }],
  ])('fails closed when acquisition decisionContext %s mismatches', async (_field, change) => {
    const base = acquisition(); const { controls } = await setup({ ...base, decisionContext: { ...base.decisionContext, ...change } });
    expect(await controls.create(base.acquisitionId, token)).toMatchObject({ accepted: false, code: 'BINDING_INVALID' });
  });

  it('fails through the existing Decision Bridge when normalized identity mismatches', async () => {
    const base = acquisition(); const { controls } = await setup({ ...base, normalizedResult: { ...base.normalizedResult!, planId: 'PLAN-OTHER' } });
    expect(await controls.create(base.acquisitionId, token)).toMatchObject({ accepted: false, code: 'BRIDGE_REJECTED' });
  });

  it('fails closed when the persisted acquisition used altered task or policy content', async () => {
    const base = acquisition(); const { controls } = await setup({ ...base, requestDefinitionFingerprint: 'ALTERED-DEFINITION' });
    expect(await controls.create(base.acquisitionId, token)).toMatchObject({ accepted: false, code: 'BINDING_INVALID' });
  });

  it('uses opaque access failure and binds reads to the unchanged source acquisition snapshot', async () => {
    const { controls, acquisitionStore } = await setup(); const created = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!created.accepted) throw new Error('required');
    expect(await controls.get(created.record.controlSessionId, 'WRONG')).toMatchObject({ accepted: false, code: 'NOT_FOUND' });
    await acquisitionStore.put(acquisition('APPROVED', { normalizedResult: { ...acquisition().normalizedResult!, summary: 'Changed later' } }));
    expect(await controls.get(created.record.controlSessionId, token)).toMatchObject({ accepted: false, code: 'NOT_FOUND' });
  });
});

describe('Live Control exact review and Broker execution', () => {
  it('APPLY uses existing orchestration once, resolves APPROVED, and replays stable metadata/result', async () => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const first = await controls.review(handoff.record.controlSessionId, token, 'APPLY'); const second = await controls.review(handoff.record.controlSessionId, token, 'APPLY');
    expect(first).toEqual(second); if (!first.accepted) throw new Error('required');
    expect(first.record.receipt).toMatchObject({ disposition: 'ALLOW', reason: 'PLAN_APPROVED', planStatus: 'APPROVED', effects: { decisions: 1, operations: 1, events: 1 } });
    expect(first.record.review).toMatchObject({ action: 'APPLY', operationId: 'OPERATION-CONTROL-ACQ-LIVE-CONTROL-1', eventId: 'EVENT-CONTROL-ACQ-LIVE-CONTROL-1', approvalId: 'APPROVAL-CONTROL-ACQ-LIVE-CONTROL-1', reviewedAt: now, reviewer: 'LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED' });
    expect(first.record.review).toEqual(second.accepted ? second.record.review : undefined); expect(first.record.receipt?.resolutionScope).toMatchObject({ caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId });
  });

  it('preserves REJECTED as PLAN_REJECTED rather than BLOCK', async () => {
    const { controls } = await setup(acquisition('REJECTED')); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const result = await controls.review(handoff.record.controlSessionId, token, 'APPLY'); if (!result.accepted) throw new Error('required');
    expect(result.record.reviewTarget.decision).toBe('REJECTED'); expect(result.record.receipt).toMatchObject({ disposition: 'PLAN_REJECTED', reason: 'PLAN_REJECTED', planStatus: 'REJECTED' });
  });

  it('DISCARD terminalizes with zero effects and is idempotent', async () => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const first = await controls.review(handoff.record.controlSessionId, token, 'DISCARD'); const second = await controls.review(handoff.record.controlSessionId, token, 'DISCARD');
    expect(first).toEqual(second); if (!first.accepted) return; expect(first.record.receipt).toMatchObject({ disposition: 'DISCARDED', effects: { decisions: 0, operations: 0, events: 0 } });
  });

  it.each([['APPLY', 'DISCARD'], ['DISCARD', 'APPLY']] as const)('%s then %s fails closed as a conflict', async (first, second) => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    expect((await controls.review(handoff.record.controlSessionId, token, first)).accepted).toBe(true);
    expect(await controls.review(handoff.record.controlSessionId, token, second)).toMatchObject({ accepted: false, code: 'REVIEW_CONFLICT' });
  });

  it('serializes concurrent APPLY requests into one stable terminal effect', async () => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const [left, right] = await Promise.all([controls.review(handoff.record.controlSessionId, token, 'APPLY'), controls.review(handoff.record.controlSessionId, token, 'APPLY')]);
    expect(left).toEqual(right); expect(left.accepted && left.record.receipt?.effects).toEqual({ decisions: 1, operations: 1, events: 1 });
  });

  it('serializes concurrent DISCARD requests into one stable zero-effect terminal result', async () => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const [left, right] = await Promise.all([controls.review(handoff.record.controlSessionId, token, 'DISCARD'), controls.review(handoff.record.controlSessionId, token, 'DISCARD')]);
    expect(left).toEqual(right); expect(left.accepted && left.record.receipt?.effects).toEqual({ decisions: 0, operations: 0, events: 0 });
  });

  it('serializes concurrent conflicting intents with exactly one winner', async () => {
    const { controls } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const results = await Promise.all([controls.review(handoff.record.controlSessionId, token, 'APPLY'), controls.review(handoff.record.controlSessionId, token, 'DISCARD')]);
    expect(results.filter(({ accepted }) => accepted)).toHaveLength(1); expect(results.find(({ accepted }) => !accepted)).toMatchObject({ code: 'REVIEW_CONFLICT' });
  });

  it('fails closed before review when the persisted controlled context fingerprint changes', async () => {
    const { controls, controlStore } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const stored = await controlStore.get(handoff.record.controlSessionId); if (!stored) throw new Error('required'); await controlStore.put({ ...stored, contextFingerprint: 'STALE' });
    expect(await controls.review(handoff.record.controlSessionId, token, 'APPLY')).toMatchObject({ accepted: false, code: 'CONTEXT_STALE' });
  });

  it.each([['definitionId', 'OTHER'], ['definitionVersion', 2]] as const)('fails closed when persisted %s changes', async (field, value) => {
    const { controls, controlStore } = await setup(); const handoff = await controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const stored = await controlStore.get(handoff.record.controlSessionId); if (!stored) throw new Error('required'); await controlStore.put({ ...stored, [field]: value });
    expect(await controls.review(handoff.record.controlSessionId, token, 'APPLY')).toMatchObject({ accepted: false, code: 'CONTEXT_STALE' });
  });

  it('durably restores awaiting and terminal sessions without re-executing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'live-control-')); directories.push(directory); const store = new JsonFileLiveControlStore(join(directory, 'controls.json'));
    const firstSetup = await setup(acquisition(), store); const handoff = await firstSetup.controls.create('ACQ-LIVE-CONTROL-1', token); if (!handoff.accepted) throw new Error('required');
    const recoveredService = (await setup(acquisition(), new JsonFileLiveControlStore(join(directory, 'controls.json')))).controls;
    const awaiting = await recoveredService.get(handoff.record.controlSessionId, token); expect(awaiting).toMatchObject({ accepted: true, record: { status: 'AWAITING_REVIEW' } });
    const terminal = await recoveredService.review(handoff.record.controlSessionId, token, 'APPLY'); const recoveredAgain = await recoveredService.get(handoff.record.controlSessionId, token);
    expect(recoveredAgain).toEqual(terminal); expect(recoveredAgain).toMatchObject({ accepted: true, record: { status: 'TERMINAL', receipt: { effects: { decisions: 1, operations: 1, events: 1 } } } });
  });
});

describe('Live Control HTTP intent boundary', () => {
  it('accepts only action from the browser and preserves opaque access semantics', async () => {
    const { controls } = await setup(); const handler = createAcquisitionHttpHandler({} as AcquisitionService, controls);
    const invalid = await handler(new Request('http://local/api/control-sessions/CONTROL-1/review', { method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-demo-token': token }, body: JSON.stringify({ action: 'APPLY', reviewTarget: {} }) }));
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ accepted: false, code: 'REVIEW_CONFLICT' });
  });
});

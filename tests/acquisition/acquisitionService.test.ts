import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Call, CreateCallInput } from '@call-e/calle';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AcquisitionCallGateway } from '../../src/acquisition/calleGateway.js';
import { CalleAcquisitionGateway } from '../../src/acquisition/calleGateway.js';
import { acquisitionCreateSchema, type AcquisitionCreateInput } from '../../src/acquisition/contracts.js';
import { acquisitionGuardPolicyFromEnvironment, hashClientToken, type AcquisitionGuardPolicy } from '../../src/acquisition/guardrails.js';
import { createAcquisitionHttpHandler } from '../../src/acquisition/http.js';
import { createProductionAcquisitionHandler } from '../../src/acquisition/server.js';
import { AcquisitionService } from '../../src/acquisition/service.js';
import { JsonFileAcquisitionStore, MemoryAcquisitionStore } from '../../src/acquisition/store.js';
import { PHONE_DECISION_SCHEMA } from '../../src/integrations/calle/contract.js';
import { mapCalleResponseForContext } from '../../src/integrations/calle/mapper.js';

const now = '2026-09-05T15:00:00.000Z';
const token = 'inert-demo-token';
const phone = '+12025550123';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const input = (overrides: Record<string, unknown> = {}): AcquisitionCreateInput => acquisitionCreateSchema.parse({
  acquisitionId: 'ACQ-001',
  clientToken: token,
  authorizationConfirmed: true,
  phoneNumber: phone,
  request: {
    requestId: 'REQUEST-ACQ-001',
    caseId: 'CASE-ACQ-001',
    planId: 'PLAN-ACQ-001',
    actorId: 'ACTOR-CLIENT-001',
    actorRole: 'client',
    objective: 'Obtain one explicit decision about the synthetic proposal.',
    context: 'The recipient may approve, reject, or request clarification.',
    expectedDecisionSchema: PHONE_DECISION_SCHEMA,
    createdAt: '2026-09-05T14:59:00.000Z',
  },
  ...overrides,
});

const decision = (value = 'APPROVED') => ({
  decision: value,
  actorId: 'ACTOR-CLIENT-001',
  actorRole: 'client',
  caseId: 'CASE-ACQ-001',
  planId: 'PLAN-ACQ-001',
  summary: 'The synthetic client gave an explicit decision.',
  authorizationChanges: [],
  clarificationNeeded: value === 'NEEDS_CLARIFICATION',
});

const call = (status: Call['status'] = 'completed', structuredResult: unknown = decision()): Call => ({
  id: 'call_test_001',
  object: 'call_task',
  status,
  task: 'provider task is deliberately not persisted',
  recipients: [{
    id: 'recipient_001',
    phones: [phone],
    locale: null,
    region: null,
    status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'in_progress',
    structuredResult: null,
    summary: status === 'completed' ? 'Recipient completed.' : null,
    attempts: [{
      id: 'attempt_001',
      phone,
      status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status === 'canceled' ? 'canceled' : 'in_progress',
      startedAt: now,
      completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? now : null,
      summary: 'Attempt summary.',
      transcriptTurns: [{ offset_seconds: 1, speaker: 'user', text: 'I approve this synthetic proposal.' }],
      providerCallId: 'provider_call_public_001',
      failureCode: status === 'failed' ? 'provider_failed' : null,
      failureMessage: status === 'failed' ? 'Provider reported a terminal failure.' : null,
    }],
  }],
  structuredResult: structuredResult as Record<string, unknown> | null,
  summary: status === 'completed' ? 'Call completed.' : null,
  taskCompleted: status === 'completed' ? true : false,
  completionConfidence: { score: 0.99, label: 'high' },
  evidence: ['The recipient stated an explicit decision.'],
  metadata: { private_provider_field: 'not persisted' },
  failureCode: status === 'failed' ? 'call_failed' : null,
  failureMessage: status === 'failed' ? 'Call failed safely.' : null,
  createdAt: now,
  completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? now : null,
});

const policy = (overrides: Partial<AcquisitionGuardPolicy> = {}): AcquisitionGuardPolicy => ({
  liveCallingEnabled: true,
  allowedClientTokens: new Set([token]),
  perClientDailyLimit: 5,
  globalDailyLimit: 10,
  cooldownMs: 0,
  ...overrides,
});

const setup = (created: Call = call(), policyOverride: Partial<AcquisitionGuardPolicy> = {}) => {
  const create = vi.fn(async (_request: CreateCallInput, _idempotencyKey: string) => structuredClone(created));
  const get = vi.fn(async (_callId: string) => structuredClone(created));
  const gateway: AcquisitionCallGateway = { create, get };
  const store = new MemoryAcquisitionStore();
  const service = new AcquisitionService({ store, gateway, policy: policy(policyOverride), clock: () => now, delay: async () => undefined, pollIntervalMs: 10, pollTimeoutMs: 30 });
  return { service, store, create, get };
};

describe('Acquisition V1 server boundary', () => {
  it('fails closed when a persisted decision correlation context is malformed', () => {
    expect(mapCalleResponseForContext({}, call(), now)).toMatchObject({
      success: false,
      reason: 'Invalid call request context',
    });
  });

  it.each([
    ['invalid E.164', { phoneNumber: '202-555-0123' }],
    ['missing authorization', { authorizationConfirmed: false }],
  ])('rejects %s before creating a provider call', async (_name, override) => {
    const { service, create } = setup();
    expect(await service.create({ ...input(), ...override })).toMatchObject({ accepted: false, code: 'INVALID_INPUT' });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled policy', {}, { liveCallingEnabled: false }, 'LIVE_CALLING_DISABLED'],
    ['unknown token', { clientToken: 'untrusted-token' }, {}, 'CLIENT_NOT_ALLOWED'],
    ['recipient allowlist', {}, { recipientAllowlist: new Set(['+12025550999']) }, 'RECIPIENT_NOT_ALLOWED'],
    ['zero global cap', {}, { globalDailyLimit: 0 }, 'CALL_LIMIT_REACHED'],
  ])('rejects %s with zero provider calls', async (_name, inputOverride, policyOverride, code) => {
    const { service, create } = setup(call(), policyOverride as Partial<AcquisitionGuardPolicy>);
    expect(await service.create(input(inputOverride as Record<string, unknown>))).toMatchObject({ accepted: false, code });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates once, sends the strict existing CALL-E schema, and reuses the durable idempotency identity', async () => {
    const { service, create } = setup();
    const first = await service.create(input());
    const second = await service.create(input());
    expect(first).toMatchObject({ accepted: true, existing: false });
    expect(second).toMatchObject({ accepted: true, existing: true });
    expect(create).toHaveBeenCalledOnce();
    const [providerInput, idempotencyKey] = create.mock.calls[0] ?? [];
    expect(idempotencyKey).toBe('exception-broker-acquisition-v1:ACQ-001');
    expect(providerInput?.recipients).toEqual([{ phones: [phone] }]);
    expect(providerInput?.resultSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { decision: { enum: ['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'] } },
    });
  });

  it('coalesces concurrent creates for the same logical acquisition', async () => {
    const { service, create } = setup(call('queued'));
    const [first, second] = await Promise.all([service.create(input()), service.create(input())]);
    expect(first).toEqual(second);
    expect(create).toHaveBeenCalledOnce();
  });

  it('rejects reuse of an acquisition id with changed request content', async () => {
    const { service, create } = setup();
    await service.create(input());
    expect(await service.create(input({ phoneNumber: '+12025550124' }))).toMatchObject({ accepted: false, code: 'INVALID_INPUT' });
    expect(create).toHaveBeenCalledOnce();
  });

  it('reuses the persisted key to recover an interrupted create reservation', async () => {
    const store = new MemoryAcquisitionStore();
    const original = setup(call('queued'));
    const first = await original.service.create(input());
    expect(first).toMatchObject({ accepted: true, record: { callId: 'call_test_001' } });
    const reserved = first.accepted ? { ...first.record, status: 'creating' as const, callId: null, providerEvidence: null } : undefined;
    expect(reserved).toBeDefined();
    await store.put(reserved!);
    const create = vi.fn(async (_request: CreateCallInput, _idempotencyKey: string) => call('queued'));
    const recovered = new AcquisitionService({ store, gateway: { create, get: vi.fn() }, policy: policy(), clock: () => now });
    const result = await recovered.create(input());
    expect(result).toMatchObject({ accepted: true, existing: true, record: { callId: 'call_test_001', status: 'queued' } });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1]).toBe('exception-broker-acquisition-v1:ACQ-001');
  });

  it('serializes different creates so one active call blocks the second', async () => {
    const { service, create } = setup(call('queued'));
    const [first, second] = await Promise.all([
      service.create(input()),
      service.create(input({ acquisitionId: 'ACQ-002', request: { ...input().request, requestId: 'REQUEST-ACQ-002' } })),
    ]);
    expect(first).toMatchObject({ accepted: true });
    expect(second).toMatchObject({ accepted: false, code: 'ACTIVE_ACQUISITION_EXISTS' });
    expect(create).toHaveBeenCalledOnce();
  });

  it('enforces per-client cap and cooldown without another provider call', async () => {
    const capped = setup(call(), { perClientDailyLimit: 1 });
    await capped.service.create(input());
    expect(await capped.service.create(input({ acquisitionId: 'ACQ-002', request: { ...input().request, requestId: 'REQUEST-ACQ-002' } }))).toMatchObject({ accepted: false, code: 'CALL_LIMIT_REACHED' });
    expect(capped.create).toHaveBeenCalledOnce();

    const cooling = setup(call(), { cooldownMs: 1_000 });
    await cooling.service.create(input());
    expect(await cooling.service.create(input({ acquisitionId: 'ACQ-003', request: { ...input().request, requestId: 'REQUEST-ACQ-003' } }))).toMatchObject({ accepted: false, code: 'COOLDOWN_ACTIVE' });
    expect(cooling.create).toHaveBeenCalledOnce();
  });

  it('polls queued to in_progress to completed without recreating the call', async () => {
    const { service, create, get } = setup(call('queued'));
    get.mockResolvedValueOnce(call('in_progress')).mockResolvedValueOnce(call('completed'));
    await service.create(input());
    const result = await service.poll('ACQ-001', token);
    expect(result).toMatchObject({ found: true, record: { status: 'completed', normalizationStatus: 'USABLE', handoffState: 'READY_FOR_REVIEW' } });
    expect(create).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('refreshes with exactly one get and zero additional creates', async () => {
    const { service, create, get } = setup(call('queued'));
    get.mockResolvedValueOnce(call('in_progress'));
    await service.create(input());
    const result = await service.refresh('ACQ-001', token);
    expect(result).toMatchObject({ found: true, record: { status: 'in_progress', normalizationStatus: 'PENDING' } });
    expect(get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it('repeated refresh never recreates and terminal state requires no additional get', async () => {
    const { service, create, get } = setup(call('queued'));
    get.mockResolvedValueOnce(call('completed'));
    await service.create(input());
    const terminal = await service.refresh('ACQ-001', token);
    const repeated = await service.refresh('ACQ-001', token);
    expect(terminal).toEqual(repeated);
    expect(get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it.each([
    ['usable decision', decision(), 'USABLE', 'READY_FOR_REVIEW'],
    ['null structured result', null, 'SAFE_STOP', 'SAFE_STOP'],
    ['clarification', decision('NEEDS_CLARIFICATION'), 'SAFE_STOP', 'SAFE_STOP'],
  ])('preserves terminal refresh semantics for %s', async (_name, structuredResult, normalizationStatus, handoffState) => {
    const { service, get } = setup(call('queued'));
    get.mockResolvedValueOnce(call('completed', structuredResult));
    await service.create(input());
    expect(await service.refresh('ACQ-001', token)).toMatchObject({
      found: true,
      record: { status: 'completed', normalizationStatus, handoffState },
    });
  });

  it('protects refresh with the acquisition token and performs no provider operation on denial', async () => {
    const { service, create, get } = setup(call('queued'));
    await service.create(input());
    expect(await service.refresh('ACQ-001', 'wrong-token')).toMatchObject({ found: false, code: 'NOT_FOUND' });
    expect(get).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it.each(['failed', 'canceled'] as const)('persists terminal %s as a safe stop', async (status) => {
    const { service } = setup(call(status));
    const result = await service.create(input());
    expect(result).toMatchObject({ accepted: true, record: { status, normalizationStatus: 'SAFE_STOP', handoffState: 'SAFE_STOP' } });
    if (result.accepted) expect(result.record.normalizedResult).toBeNull();
  });

  it('normalizes APPROVED through the existing mapper but grants no authority or application effect', async () => {
    const { service } = setup();
    const result = await service.create(input());
    expect(result).toMatchObject({ accepted: true, record: { normalizationStatus: 'USABLE', handoffState: 'READY_FOR_REVIEW', normalizedResult: { decision: 'APPROVED' } } });
    expect(JSON.stringify(result)).not.toMatch(/approvalId|operationId|eventId|LINEAGE_RESOLVED/);
  });

  it.each([
    ['null result', null, 'CALL-E returned no schema-valid structured result'],
    ['invalid result despite task completion', { decision: 'APPROVED' }, 'CALL-E returned no schema-valid structured result'],
    ['clarification', decision('NEEDS_CLARIFICATION'), 'Decision NEEDS_CLARIFICATION requires a safe stop before review'],
    ['pending', decision('PENDING'), 'Decision PENDING requires a safe stop before review'],
  ])('fails safely for %s regardless of high confidence', async (_name, structuredResult, reason) => {
    const { service } = setup(call('completed', structuredResult));
    const result = await service.create(input());
    expect(result).toMatchObject({ accepted: true, record: { normalizationStatus: 'SAFE_STOP', handoffState: 'SAFE_STOP', safeStopReason: reason } });
  });

  it('bounds polling and returns timeout without creating again', async () => {
    const { service, create, get } = setup(call('queued'));
    get.mockResolvedValue(call('in_progress'));
    await service.create(input());
    expect(await service.poll('ACQ-001', token)).toMatchObject({ found: false, code: 'POLL_TIMEOUT' });
    expect(get).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledOnce();
  });

  it('fails provider create and polling errors safely without exposing error details or retrying', async () => {
    const first = setup();
    first.create.mockRejectedValueOnce(new Error('Bearer private-key +12025550123'));
    const created = await first.service.create(input());
    expect(created).toMatchObject({ accepted: true, record: { status: 'failed', safeStopReason: 'CALL-E provider operation failed safely' } });
    expect(JSON.stringify(created)).not.toContain('private-key');
    expect(first.create).toHaveBeenCalledOnce();

    const second = setup(call('queued'));
    second.get.mockRejectedValueOnce(new Error('rate limited private detail'));
    await second.service.create(input());
    expect(await second.service.poll('ACQ-001', token)).toEqual({ found: false, code: 'PROVIDER_FAILURE', reason: 'CALL-E provider operation failed safely' });
  });

  it('persists a sanitized record that survives reopening without raw phone, token, task, or metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'exception-broker-acquisition-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'acquisitions.json');
    const unsafe = call();
    unsafe.summary = 'Bearer private-token called +12025550123';
    unsafe.evidence = ['Evidence from +12025550123'];
    unsafe.recipients[0]!.attempts[0]!.transcriptTurns[0]!.text = 'Bearer transcript-secret';
    const create = vi.fn(async () => unsafe);
    const service = new AcquisitionService({
      store: new JsonFileAcquisitionStore(path), gateway: { create, get: vi.fn() }, policy: policy(), clock: () => now,
    });
    await service.create(input());

    const reopened = new JsonFileAcquisitionStore(path);
    const record = await reopened.get('ACQ-001');
    const persisted = await readFile(path, 'utf8');
    expect(record).toMatchObject({ acquisitionId: 'ACQ-001', authorizationConfirmed: true, maskedRecipient: '+12*******23' });
    expect(persisted).not.toContain(phone);
    expect(persisted).not.toContain(token);
    expect(persisted).not.toContain('private-token');
    expect(persisted).not.toContain('transcript-secret');
    expect(persisted).not.toContain('provider task is deliberately not persisted');
    expect(persisted).not.toContain('private_provider_field');
    expect(record?.providerEvidence?.recipients[0]?.attempts[0]?.transcriptTurns[0]?.speaker).toBe('user');
    expect(record?.normalizedResult?.decision).toBe('APPROVED');
  });

  it('exposes only sanitized records through the framework-free HTTP boundary', async () => {
    const { service } = setup();
    const handler = createAcquisitionHttpHandler(service);
    const response = await handler(new Request('http://localhost/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input()),
    }));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(phone);
    expect(JSON.stringify(body)).not.toContain('clientTokenHash');
    expect(await handler(new Request('http://localhost/api/acquisitions/ACQ-001', { headers: { 'x-acquisition-demo-token': token } }))).toMatchObject({ status: 200 });
    expect(await handler(new Request('http://localhost/api/acquisitions/ACQ-001'))).toMatchObject({ status: 404 });
  });

  it('routes token-protected one-step refresh through the HTTP boundary', async () => {
    const { service, create, get } = setup(call('queued'));
    get.mockResolvedValueOnce(call('completed'));
    await service.create(input());
    const handler = createAcquisitionHttpHandler(service);
    const response = await handler(new Request('http://localhost/api/acquisitions/ACQ-001/refresh', {
      method: 'POST', headers: { 'x-acquisition-demo-token': token },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ found: true, record: { status: 'completed', normalizationStatus: 'USABLE' } });
    expect(get).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it('uses deny-by-default environment policy and never persists raw demo tokens', async () => {
    const denied = acquisitionGuardPolicyFromEnvironment({});
    expect(denied.liveCallingEnabled).toBe(false);
    expect(denied.allowedClientTokens.size).toBe(0);
    const { service, create } = setup(call(), denied);
    expect(await service.create(input())).toMatchObject({ accepted: false, code: 'LIVE_CALLING_DISABLED' });
    expect(create).not.toHaveBeenCalled();
    expect(hashClientToken(token)).not.toContain(token);
  });

  it('keeps the production server boundary out of the browser import graph and reads credentials only on explicit composition', async () => {
    const appSources = [
      await readFile('src/main.tsx', 'utf8'),
      await readFile('src/App.tsx', 'utf8'),
    ].join('\n');
    const serverSource = await readFile('src/acquisition/server.ts', 'utf8');
    expect(appSources).not.toMatch(/acquisition\/server|CALLE_API_KEY|CalleAcquisitionGateway/);
    expect(serverSource).toContain('process.env');
    expect(serverSource).toContain('CALLE_API_KEY');
  });

  it('does not read the API key or construct an SDK client before a provider operation', async () => {
    const apiKeySource = vi.fn(() => 'inert-api-key');
    const clientFactory = vi.fn(() => ({ calls: { create: vi.fn(), get: vi.fn() } }));
    const gateway = new CalleAcquisitionGateway(apiKeySource, clientFactory);
    expect(gateway).toBeInstanceOf(CalleAcquisitionGateway);
    expect(apiKeySource).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('reads the server key lazily and delegates create/get without exposing it in provider input', async () => {
    const providerCreate = vi.fn(async () => call('queued'));
    const providerGet = vi.fn(async () => call('completed'));
    const apiKeySource = vi.fn(() => 'inert-api-key');
    const clientFactory = vi.fn(() => ({ calls: { create: providerCreate, get: providerGet } }));
    const gateway = new CalleAcquisitionGateway(apiKeySource, clientFactory);
    const providerInput: CreateCallInput = { task: 'Synthetic task.', recipients: [{ phones: [phone] }] };
    await gateway.create(providerInput, 'inert-idempotency-key');
    await gateway.get('call_test_001');
    expect(apiKeySource).toHaveBeenCalledOnce();
    expect(clientFactory).toHaveBeenCalledWith('inert-api-key');
    expect(providerCreate).toHaveBeenCalledWith(providerInput, { idempotencyKey: 'inert-idempotency-key' });
    expect(providerGet).toHaveBeenCalledWith('call_test_001');
    expect(JSON.stringify(providerInput)).not.toContain('inert-api-key');
  });

  it('serves deny-by-default policy without reading CALLE_API_KEY', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'exception-broker-disabled-acquisition-'));
    temporaryDirectories.push(directory);
    let apiKeyReads = 0;
    const environment = new Proxy<Record<string, string | undefined>>({}, {
      get: (_target, property) => {
        if (property === 'CALLE_API_KEY') apiKeyReads += 1;
        return undefined;
      },
    }) as NodeJS.ProcessEnv;
    const handler = createProductionAcquisitionHandler({ storePath: join(directory, 'records.json'), environment });
    const response = await handler(new Request('http://localhost/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input()),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'LIVE_CALLING_DISABLED' });
    expect(apiKeyReads).toBe(0);
  });
});

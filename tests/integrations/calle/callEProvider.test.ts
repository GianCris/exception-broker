import {
  CalleAPIError,
  CalleAuthenticationError,
  CalleConnectionError,
  CalleTimeoutError,
  type CreateCallInput,
} from '@call-e/calle';
import { describe, expect, it, vi } from 'vitest';

import { executeCall } from '../../../src/integrations/calle/adapter.js';
import {
  CallEProvider,
  buildCallEInput,
  type CallEClientPort,
} from '../../../src/integrations/calle/callEProvider.js';
import { PHONE_DECISION_SCHEMA, createCallRequest } from '../../../src/integrations/calle/contract.js';

const receivedAt = '2026-08-06T15:10:00.000Z';
const request = () => createCallRequest({
  requestId: 'REQ-REAL-PROVIDER-001',
  caseId: 'CASE-001',
  planId: 'PLAN-003',
  actorId: 'ACTOR-CLIENT',
  actorRole: 'client',
  phoneNumber: '+12025550125',
  objective: 'Obtain an explicit decision about the proposed plan.',
  context: 'The client is evaluating the plan and its authorization conditions.',
  expectedDecisionSchema: PHONE_DECISION_SCHEMA,
  createdAt: '2026-08-06T15:00:00.000Z',
});

const terminalResponse = () => ({
  status: 'completed',
  structuredResult: {
    decision: 'APPROVED',
    actorId: 'ACTOR-CLIENT',
    actorRole: 'client',
    caseId: 'CASE-001',
    planId: 'PLAN-003',
    summary: 'The client explicitly approved the plan.',
    authorizationChanges: [],
    clarificationNeeded: false,
  },
  taskCompleted: true,
  completionConfidence: { score: 0.95, label: 'high' },
  evidence: ['The client explicitly approved the proposed plan.'],
});

const clientWith = (implementation: () => Promise<unknown>) => {
  const createAndWait = vi.fn(async (
    _input: CreateCallInput,
    _options: Readonly<{ idempotencyKey: string }>,
  ) => implementation());
  const client: CallEClientPort = { calls: { createAndWait } };
  return { client, createAndWait };
};

const providerWith = (client: CallEClientPort) => new CallEProvider({
  apiKeySource: () => 'test-only-placeholder',
  clientFactory: () => client,
});

describe('official CALL-E provider', () => {
  it('is constructed with injected server configuration without contacting CALL-E', () => {
    const factory = vi.fn<() => CallEClientPort>();
    const provider = new CallEProvider({
      apiKeySource: () => 'test-only-placeholder',
      clientFactory: factory,
    });
    expect(provider).toBeInstanceOf(CallEProvider);
    expect(factory).not.toHaveBeenCalled();
  });

  it('builds the documented createAndWait request and idempotency option', async () => {
    const { client, createAndWait } = clientWith(async () => terminalResponse());
    const callRequest = request();

    await providerWith(client).executeCall(callRequest);

    expect(createAndWait).toHaveBeenCalledOnce();
    expect(createAndWait).toHaveBeenCalledWith(
      buildCallEInput(callRequest),
      { idempotencyKey: callRequest.requestId },
    );
    const input = createAndWait.mock.calls[0]?.[0] as CreateCallInput;
    expect(input.recipients).toEqual([{ phones: [callRequest.phoneNumber] }]);
    expect(input.task).toContain(callRequest.objective);
    expect(input.task).toContain(callRequest.context);
    expect(input).not.toHaveProperty('context');
    expect(JSON.stringify(input)).not.toContain('test-only-placeholder');
  });

  it('uses a strict documented structured-result schema without interpreting a decision', () => {
    const input = buildCallEInput(request());
    expect(input.resultSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        decision: { type: 'string', enum: ['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'] },
        actorId: { enum: ['ACTOR-CLIENT'] },
        actorRole: { enum: ['client'] },
        caseId: { enum: ['CASE-001'] },
        planId: { enum: ['PLAN-003'] },
        authorizationChanges: { type: 'array' },
      },
    });
  });

  it('returns exactly the valid terminal payload received from the injected client', async () => {
    const payload = terminalResponse();
    const { client } = clientWith(async () => payload);
    await expect(providerWith(client).executeCall(request())).resolves.toBe(payload);
  });

  it('returns structuredResult null unchanged for conservative handling by W3-01', async () => {
    const payload = { ...terminalResponse(), structuredResult: null };
    const { client } = clientWith(async () => payload);
    await expect(providerWith(client).executeCall(request())).resolves.toBe(payload);
  });

  it('does not mutate a frozen request or frozen terminal payload', async () => {
    const callRequest = Object.freeze(request());
    const payload = Object.freeze(terminalResponse());
    const beforeRequest = structuredClone(callRequest);
    const beforePayload = structuredClone(payload);
    const { client } = clientWith(async () => payload);

    await providerWith(client).executeCall(callRequest);

    expect(callRequest).toEqual(beforeRequest);
    expect(payload).toEqual(beforePayload);
  });

  it('maps a missing API key to a non-retryable operational failure without creating a client', async () => {
    const factory = vi.fn<() => CallEClientPort>();
    const provider = new CallEProvider({ apiKeySource: () => undefined, clientFactory: factory });

    const result = await executeCall(provider, request(), receivedAt);

    expect(result).toMatchObject({
      success: false,
      reason: 'Call provider configuration is unavailable',
      retryable: false,
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', new CalleTimeoutError('sensitive timeout detail'), true],
    ['connection failure', new CalleConnectionError('sensitive transport detail'), true],
    ['authentication failure', new CalleAuthenticationError({ code: 'unauthorized', message: 'secret-like detail', status: 401 }), false],
    ['HTTP client error', new CalleAPIError({ code: 'invalid_request', message: 'private request detail', status: 400 }), false],
    ['service unavailable', new CalleAPIError({ code: 'provider_unavailable', message: 'private service detail', status: 503 }), true],
    ['unreadable response', new SyntaxError('private malformed response detail'), false],
  ] as const)('maps %s to a safe operational result', async (_name, sdkError, retryable) => {
    const { client, createAndWait } = clientWith(async () => { throw sdkError; });

    const result = await executeCall(providerWith(client), request(), receivedAt);

    expect(result).toMatchObject({ success: false, retryable });
    expect(JSON.stringify(result)).not.toMatch(/sensitive|secret-like|private/);
    expect(createAndWait).toHaveBeenCalledOnce();
  });

  it('does not disguise an unexpected client defect as an operational error', async () => {
    const defect = new TypeError('Unexpected client implementation defect');
    const { client } = clientWith(async () => { throw defect; });
    await expect(providerWith(client).executeCall(request())).rejects.toBe(defect);
  });

  it('integrates with the W3-02 adapter and W3-01 mapper', async () => {
    const payload = terminalResponse();
    const { client } = clientWith(async () => payload);

    const result = await executeCall(providerWith(client), request(), receivedAt);

    expect(result).toMatchObject({
      success: true,
      value: {
        requestId: 'REQ-REAL-PROVIDER-001',
        decision: 'APPROVED',
        receivedAt,
        evidence: payload.evidence,
        completionConfidence: payload.completionConfidence,
      },
    });
  });

  it('never invokes a real client when the injected response is used', async () => {
    const { client, createAndWait } = clientWith(async () => terminalResponse());
    await executeCall(providerWith(client), request(), receivedAt);
    expect(createAndWait).toHaveBeenCalledOnce();
  });
});

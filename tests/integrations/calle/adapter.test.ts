import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { executeCall } from '../../../src/integrations/calle/adapter.js';
import { PHONE_DECISION_SCHEMA, createCallRequest } from '../../../src/integrations/calle/contract.js';
import { mapCalleResponse } from '../../../src/integrations/calle/mapper.js';
import { ProviderOperationalError, type CallProvider } from '../../../src/integrations/calle/provider.js';

const receivedAt = '2026-08-05T15:10:00.000Z';
const request = () => createCallRequest({
  requestId: 'REQ-ADAPTER-001',
  caseId: 'CASE-001',
  planId: 'PLAN-003',
  actorId: 'ACTOR-CLIENT',
  actorRole: 'client',
  phoneNumber: '+12025550123',
  objective: 'Obtain an explicit plan decision.',
  context: 'The request contains only the context needed for the decision.',
  expectedDecisionSchema: PHONE_DECISION_SCHEMA,
  createdAt: '2026-08-05T15:00:00.000Z',
});

const structuredResult = (decision = 'APPROVED') => ({
  decision,
  actorId: 'ACTOR-CLIENT',
  actorRole: 'client',
  caseId: 'CASE-001',
  planId: 'PLAN-003',
  summary: 'The client stated an explicit decision.',
  authorizationChanges: [{
    field: 'maxSubstituteQuantity',
    previousValue: 50,
    newValue: 100,
    reason: 'Explicitly authorized',
  }],
  clarificationNeeded: decision === 'NEEDS_CLARIFICATION',
});

const externalResponse = (decision = 'APPROVED') => ({
  status: 'completed',
  structuredResult: structuredResult(decision),
  taskCompleted: decision === 'APPROVED' || decision === 'REJECTED',
  completionConfidence: { score: 0.92, label: 'high' },
  evidence: ['The recipient stated the decision explicitly.'],
});

const providerReturning = (payload: unknown): CallProvider => ({
  executeCall: vi.fn(async () => payload),
});

describe('CALL-E adapter', () => {
  it.each(['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'])(
    'normalizes a valid %s provider response through the W3-01 mapper',
    async (decision) => {
      const callRequest = request();
      const payload = externalResponse(decision);
      const provider = providerReturning(payload);

      const result = await executeCall(provider, callRequest, receivedAt);

      expect(result).toEqual(mapCalleResponse(callRequest, payload, receivedAt));
      expect(result.success).toBe(true);
      if (result.success) expect(result.value.decision).toBe(decision);
    },
  );

  it('preserves evidence, confidence, receivedAt, request identifiers, and un-applied authorization changes', async () => {
    const result = await executeCall(providerReturning(externalResponse()), request(), receivedAt);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toMatchObject({
        requestId: 'REQ-ADAPTER-001',
        createdAt: '2026-08-05T15:00:00.000Z',
        receivedAt,
        evidence: ['The recipient stated the decision explicitly.'],
        completionConfidence: { score: 0.92, label: 'high' },
        authorizationChanges: [{
          field: 'maxSubstituteQuantity',
          externalPreviousValue: 50,
          newValue: 100,
          reason: 'Explicitly authorized',
        }],
      });
      expect(result.value).not.toHaveProperty('approval');
      expect(result.value).not.toHaveProperty('plan');
      expect(result.value).not.toHaveProperty('exceptionCase');
    }
  });

  it('invokes the injected provider exactly once with the exact request', async () => {
    const executeProviderCall = vi.fn(async () => externalResponse());
    const callRequest = request();

    await executeCall({ executeCall: executeProviderCall }, callRequest, receivedAt);

    expect(executeProviderCall).toHaveBeenCalledOnce();
    expect(executeProviderCall).toHaveBeenCalledWith(callRequest);
  });

  it('supports interchangeable providers without adapter changes', async () => {
    const approved = await executeCall(providerReturning(externalResponse('APPROVED')), request(), receivedAt);
    const rejected = await executeCall(providerReturning(externalResponse('REJECTED')), request(), receivedAt);

    expect(approved.success && approved.value.decision).toBe('APPROVED');
    expect(rejected.success && rejected.value.decision).toBe('REJECTED');
  });

  it('is deterministic and does not generate or replace timestamps or IDs', async () => {
    const callRequest = request();
    const payload = externalResponse();

    const first = await executeCall(providerReturning(payload), callRequest, receivedAt);
    const second = await executeCall(providerReturning(payload), callRequest, receivedAt);

    expect(first).toEqual(second);
    expect(first).toEqual(mapCalleResponse(callRequest, payload, receivedAt));
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', 'completed'],
    ['array', []],
    ['partial object', { status: 'completed' }],
    ['null structuredResult', { ...externalResponse(), structuredResult: null }],
    ['unknown status', { ...externalResponse(), status: 'unknown' }],
    ['contradictory approval', { ...externalResponse(), taskCompleted: false }],
    ['other case', { ...externalResponse(), structuredResult: { ...structuredResult(), caseId: 'CASE-OTHER' } }],
    ['other plan', { ...externalResponse(), structuredResult: { ...structuredResult(), planId: 'PLAN-OTHER' } }],
    ['other actor', { ...externalResponse(), structuredResult: { ...structuredResult(), actorId: 'ACTOR-OTHER' } }],
    ['forged role', { ...externalResponse(), structuredResult: { ...structuredResult(), actorRole: 'supplier' } }],
  ] as const)('fails safely for provider payload: %s', async (_name, payload) => {
    const result = await executeCall(providerReturning(payload), request(), receivedAt);
    expect(result.success).toBe(false);
  });

  it('runtime-validates a provider response falsely asserted as valid', async () => {
    const falselyTyped = { status: 'completed', structuredResult: { decision: 'APPROVED' } } as unknown;
    const result = await executeCall(providerReturning(falselyTyped), request(), receivedAt);
    expect(result.success).toBe(false);
  });

  it.each([undefined, '', 'not-a-date'])('fails safely when receivedAt is %j', async (invalidReceivedAt) => {
    const result = await executeCall(providerReturning(externalResponse()), request(), invalidReceivedAt as string);
    expect(result).toMatchObject({ success: false, reason: 'Invalid receivedAt timestamp' });
  });

  it.each([
    ['NETWORK_FAILURE', true],
    ['TIMEOUT', true],
    ['TEMPORARILY_UNAVAILABLE', true],
    ['UNREADABLE_RESPONSE', false],
    ['OPERATION_REJECTED', false],
  ] as const)('maps expected operational error %s without retrying', async (kind, retryable) => {
    const executeProviderCall = vi.fn(async () => {
      throw new ProviderOperationalError(kind);
    });

    const result = await executeCall({ executeCall: executeProviderCall }, request(), receivedAt);

    expect(result).toMatchObject({ success: false, retryable });
    expect(result).not.toHaveProperty('externalStatus');
    expect(result).not.toHaveProperty('evidence');
    expect(result).not.toHaveProperty('completionConfidence');
    expect(executeProviderCall).toHaveBeenCalledOnce();
  });

  it('maps an operational error thrown synchronously', async () => {
    const provider: CallProvider = {
      executeCall() {
        throw new ProviderOperationalError('NETWORK_FAILURE');
      },
    };
    await expect(executeCall(provider, request(), receivedAt)).resolves.toMatchObject({
      success: false,
      retryable: true,
    });
  });

  it('does not expose arbitrary provider error text that could contain secrets', async () => {
    const error = new ProviderOperationalError('TIMEOUT');
    const result = await executeCall({ executeCall: async () => { throw error; } }, request(), receivedAt);
    expect(JSON.stringify(result)).not.toContain('API_KEY');
    expect(result).toMatchObject({ reason: 'Call provider timed out' });
  });

  it('propagates unexpected internal defects instead of disguising them', async () => {
    const defect = new TypeError('Internal provider implementation defect');
    await expect(executeCall({ executeCall: async () => { throw defect; } }, request(), receivedAt)).rejects.toBe(defect);
  });

  it('does not mutate frozen requests or frozen provider payloads', async () => {
    const callRequest = Object.freeze(request());
    const payload = Object.freeze(externalResponse());
    const requestBefore = structuredClone(callRequest);
    const payloadBefore = structuredClone(payload);

    await expect(executeCall(providerReturning(payload), callRequest, receivedAt)).resolves.toMatchObject({ success: true });
    expect(callRequest).toEqual(requestBefore);
    expect(payload).toEqual(payloadBefore);
  });

  it('protects the original request from a provider that mutates its received copy', async () => {
    const callRequest = request();
    const before = structuredClone(callRequest);
    const provider: CallProvider = {
      async executeCall(receivedRequest) {
        receivedRequest.objective = 'Mutated by a defective provider';
        return externalResponse();
      },
    };

    const result = await executeCall(provider, callRequest, receivedAt);

    expect(result.success).toBe(true);
    expect(callRequest).toEqual(before);
  });

  it('contains no concrete mock, React, network, key, timer, or retry dependency', () => {
    const source = readFileSync('src/integrations/calle/adapter.ts', 'utf8');
    expect(source).not.toMatch(/MockProvider|react|fetch\s*\(|axios|CALLE_API_KEY|setTimeout|Date\.now|new Date|Math\.random/);
    expect(source.match(/provider\.executeCall/g)).toHaveLength(1);
  });
});

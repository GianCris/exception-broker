import { describe, expect, it } from 'vitest';

import { executeCall } from '../../../src/integrations/calle/adapter.js';
import { PHONE_DECISION_SCHEMA, createCallRequest } from '../../../src/integrations/calle/contract.js';
import { MockProvider } from '../../../src/integrations/calle/mockProvider.js';

const receivedAt = '2026-08-05T15:10:00.000Z';
const request = () => createCallRequest({
  requestId: 'REQ-MOCK-001', caseId: 'CASE-001', planId: 'PLAN-003',
  actorId: 'ACTOR-SUPPLIER', actorRole: 'supplier', phoneNumber: '+12025550124',
  objective: 'Obtain a decision.', context: 'Plan decision context.',
  expectedDecisionSchema: PHONE_DECISION_SCHEMA, createdAt: '2026-08-05T15:00:00.000Z',
});
const response = (decision = 'APPROVED') => ({
  status: 'completed',
  structuredResult: {
    decision, actorId: 'ACTOR-SUPPLIER', actorRole: 'supplier', caseId: 'CASE-001', planId: 'PLAN-003',
    summary: 'The supplier stated a decision.', authorizationChanges: [],
    clarificationNeeded: decision === 'NEEDS_CLARIFICATION',
  },
  taskCompleted: decision === 'APPROVED' || decision === 'REJECTED',
  completionConfidence: { score: 0.9, label: 'high' }, evidence: [],
});

describe('deterministic MockProvider', () => {
  it.each(['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'])(
    'can provide a valid %s response',
    async (decision) => {
      const result = await executeCall(
        new MockProvider({ type: 'response', payload: response(decision) }),
        request(),
        receivedAt,
      );
      expect(result.success && result.value.decision).toBe(decision);
    },
  );

  it.each([
    ['structuredResult null', { ...response(), structuredResult: null }],
    ['unknown status', { ...response(), status: 'unknown' }],
    ['invalid payload', { approved: true }],
  ] as const)('can provide deterministic unsafe scenario: %s', async (_name, payload) => {
    const result = await executeCall(new MockProvider({ type: 'response', payload }), request(), receivedAt);
    expect(result.success).toBe(false);
  });

  it.each([
    ['TIMEOUT', true],
    ['OPERATION_REJECTED', false],
  ] as const)('can simulate %s operational errors', async (kind, retryable) => {
    const provider = new MockProvider({ type: 'operational-error', kind });
    await expect(executeCall(provider, request(), receivedAt)).resolves.toMatchObject({ success: false, retryable });
    expect(provider.invocationCount).toBe(1);
  });

  it('propagates a configured unexpected internal error', async () => {
    const defect = new Error('Mock internal defect');
    const provider = new MockProvider({ type: 'internal-error', error: defect });
    await expect(executeCall(provider, request(), receivedAt)).rejects.toBe(defect);
  });

  it('records one invocation without modifying the request or options', async () => {
    const callRequest = Object.freeze(request());
    const payload = Object.freeze(response());
    const behavior = Object.freeze({ type: 'response' as const, payload });
    const beforeRequest = structuredClone(callRequest);
    const beforePayload = structuredClone(payload);
    const provider = new MockProvider(behavior);

    await executeCall(provider, callRequest, receivedAt);

    expect(provider.invocationCount).toBe(1);
    expect(provider.lastRequest).toEqual(callRequest);
    expect(provider.lastRequest).not.toBe(callRequest);
    expect(callRequest).toEqual(beforeRequest);
    expect(payload).toEqual(beforePayload);
    expect(behavior).toEqual({ type: 'response', payload });
  });

  it('returns the configured payload without modifying it', async () => {
    const payload = Object.freeze(response());
    const provider = new MockProvider({ type: 'response', payload });
    await expect(provider.executeCall(request())).resolves.toBe(payload);
  });
});

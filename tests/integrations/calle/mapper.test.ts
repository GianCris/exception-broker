import { describe, expect, it } from 'vitest';

import { PHONE_DECISION_SCHEMA, createCallRequest } from '../../../src/integrations/calle/contract.js';
import { mapCalleResponse } from '../../../src/integrations/calle/mapper.js';

const receivedAt = '2026-08-04T18:10:00.000Z';
const request = () => createCallRequest({
  requestId: 'REQ-CALL-001', caseId: 'CASE-001', planId: 'PLAN-003',
  actorId: 'ACTOR-CLIENT', actorRole: 'client', phoneNumber: '+12025550123',
  objective: 'Obtain an explicit decision.', context: 'Plan approval context.',
  expectedDecisionSchema: PHONE_DECISION_SCHEMA, createdAt: '2026-08-04T18:00:00.000Z',
});
const structured = (decision = 'APPROVED'): Record<string, unknown> & { authorizationChanges: unknown[] } => ({
  decision,
  actorId: 'ACTOR-CLIENT', actorRole: 'client', caseId: 'CASE-001', planId: 'PLAN-003',
  summary: 'The client gave an explicit decision.', authorizationChanges: [],
  clarificationNeeded: decision === 'NEEDS_CLARIFICATION',
});
const response = (decision = 'APPROVED') => ({
  status: 'completed', structuredResult: structured(decision),
  taskCompleted: decision === 'APPROVED' || decision === 'REJECTED',
  completionConfidence: { score: 0.92, label: 'high' },
  evidence: ['The recipient stated the decision explicitly.'],
});

describe('CALL-E response mapper', () => {
  it.each(['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'])('accepts a valid %s decision', (decision) => {
    const result = mapCalleResponse(request(), response(decision), receivedAt);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.decision).toBe(decision);
  });

  it('accepts empty authorization changes and evidence without inventing content', () => {
    const payload = { ...response(), evidence: [] };
    const result = mapCalleResponse(request(), payload, receivedAt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.authorizationChanges).toEqual([]);
      expect(result.value.evidence).toEqual([]);
    }
  });

  it('normalizes a proposed authorization change while isolating untrusted previousValue', () => {
    const payload = response();
    payload.structuredResult.authorizationChanges = [{ field: 'maxSubstituteQuantity', previousValue: 50, newValue: 100, reason: 'Explicitly authorized during the call' }];
    const result = mapCalleResponse(request(), payload, receivedAt);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.authorizationChanges).toEqual([{
      field: 'maxSubstituteQuantity', newValue: 100, reason: 'Explicitly authorized during the call', externalPreviousValue: 50,
    }]);
  });

  it('preserves evidence, confidence, request timestamps, and explicit receivedAt', () => {
    const result = mapCalleResponse(request(), response(), receivedAt);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toMatchObject({
      requestId: 'REQ-CALL-001', createdAt: '2026-08-04T18:00:00.000Z',
      receivedAt, completionConfidence: { score: 0.92, label: 'high' },
      evidence: ['The recipient stated the decision explicitly.'],
    });
  });

  it('is deterministic and does not mutate frozen inputs', () => {
    const callRequest = Object.freeze(request());
    const payload = Object.freeze(response());
    const requestBefore = structuredClone(callRequest);
    const payloadBefore = structuredClone(payload);
    expect(mapCalleResponse(callRequest, payload, receivedAt)).toEqual(mapCalleResponse(callRequest, payload, receivedAt));
    expect(callRequest).toEqual(requestBefore);
    expect(payload).toEqual(payloadBefore);
  });

  it.each([
    ['null structured result', { ...response(), structuredResult: null }],
    ['unknown external status', { ...response(), status: 'unknown_status' }],
    ['missing decision', { ...response(), structuredResult: { ...structured(), decision: undefined } }],
    ['unknown decision', { ...response(), structuredResult: structured('probably') }],
    ['false task completion with approval', { ...response(), taskCompleted: false }],
    ['different case', { ...response(), structuredResult: { ...structured(), caseId: 'CASE-OTHER' } }],
    ['different plan', { ...response(), structuredResult: { ...structured(), planId: 'PLAN-OTHER' } }],
    ['different actor', { ...response(), structuredResult: { ...structured(), actorId: 'ACTOR-OTHER' } }],
    ['different role', { ...response(), structuredResult: { ...structured(), actorRole: 'supplier' } }],
    ['approval requiring clarification', { ...response(), structuredResult: { ...structured(), clarificationNeeded: true } }],
    ['malformed changes', { ...response(), structuredResult: { ...structured(), authorizationChanges: [{ field: '', newValue: {} }] } }],
    ['missing confidence', { ...response(), completionConfidence: undefined }],
    ['malformed confidence', { ...response(), completionConfidence: { score: 'high', label: 'high' } }],
    ['negative confidence', { ...response(), completionConfidence: { score: -0.01, label: 'low' } }],
    ['excess confidence', { ...response(), completionConfidence: { score: 1.01, label: 'high' } }],
    ['NaN confidence', { ...response(), completionConfidence: { score: Number.NaN, label: 'unknown' } }],
    ['infinite confidence', { ...response(), completionConfidence: { score: Number.POSITIVE_INFINITY, label: 'high' } }],
    ['malformed evidence', { ...response(), evidence: [{ text: 'unsupported' }] }],
    ['empty evidence item', { ...response(), evidence: [''] }],
  ] as const)('fails safely for %s', (_name, payload) => {
    const result = mapCalleResponse(request(), payload, receivedAt);
    expect(result.success).toBe(false);
  });

  it.each([null, undefined, '', {}, []])('fails safely for adversarial payload %j', (payload) => {
    expect(mapCalleResponse(request(), payload, receivedAt).success).toBe(false);
  });

  it('ignores untrusted extra fields without leaking them into the normalized result', () => {
    const payload = { ...response(), apiKey: 'not-a-real-secret', structuredResult: { ...structured(), inventedApproval: true } };
    const result = mapCalleResponse(request(), payload, receivedAt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).not.toHaveProperty('apiKey');
      expect(result.value).not.toHaveProperty('inventedApproval');
    }
  });

  it.each([
    ['queued', true], ['in_progress', true], ['failed', false], ['canceled', false],
  ] as const)('returns a failure with retryability for documented non-success status %s', (status, retryable) => {
    const result = mapCalleResponse(request(), { ...response(), status }, receivedAt);
    expect(result).toMatchObject({ success: false, retryable, externalStatus: status });
  });

  it('requires receivedAt explicitly and never generates it', () => {
    expect(mapCalleResponse(request(), response(), undefined)).toMatchObject({ success: false, reason: 'Invalid receivedAt timestamp' });
  });

  it('never falls back to approval for incomplete or ambiguous text', () => {
    for (const value of ['probably', 'sounds fine', 'maybe', 'I will check']) {
      const result = mapCalleResponse(request(), { ...response(), structuredResult: structured(value) }, receivedAt);
      expect(result.success).toBe(false);
    }
  });
});

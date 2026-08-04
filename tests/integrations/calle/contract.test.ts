import { describe, expect, it } from 'vitest';

import { PHONE_DECISION_SCHEMA, createCallRequest, validateCallRequest } from '../../../src/integrations/calle/contract.js';

const validRequest = () => ({
  requestId: 'REQ-CALL-001',
  caseId: 'CASE-001',
  planId: 'PLAN-003',
  actorId: 'ACTOR-CLIENT',
  actorRole: 'client',
  phoneNumber: '+12025550123',
  objective: 'Obtain an explicit decision for the proposed plan.',
  context: 'The plan requires a decision from the client actor.',
  expectedDecisionSchema: PHONE_DECISION_SCHEMA,
  createdAt: '2026-08-04T18:00:00.000Z',
});

describe('CALL-E request contract', () => {
  it('accepts a complete request with an explicit id, timestamp, and E.164 phone', () => {
    const result = validateCallRequest(validRequest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({ requestId: 'REQ-CALL-001', createdAt: '2026-08-04T18:00:00.000Z', phoneNumber: '+12025550123' });
    }
  });

  it.each(['2025550123', '+02025550123', '+1 202 555 0123', '+123', ''])('rejects invalid E.164 phone %s', (phoneNumber) => {
    expect(validateCallRequest({ ...validRequest(), phoneNumber }).success).toBe(false);
  });

  it.each(['requestId', 'createdAt', 'actorId', 'objective', 'expectedDecisionSchema'] as const)('rejects a missing required field: %s', (field) => {
    const input: Record<string, unknown> = { ...validRequest() };
    delete input[field];
    expect(validateCallRequest(input).success).toBe(false);
  });

  it('does not mutate even a frozen input', () => {
    const input = Object.freeze(validRequest());
    const before = structuredClone(input);
    const result = createCallRequest(input);
    expect(input).toEqual(before);
    expect(result).not.toBe(input);
  });

  it.each(['apiKey', 'CALLE_API_KEY', 'secret', 'token'])('rejects secret-like contract field %s', (field) => {
    expect(validateCallRequest({ ...validRequest(), [field]: 'not-a-real-secret' }).success).toBe(false);
  });

  it('contains no secret or API-key field in the accepted request', () => {
    const result = createCallRequest(validRequest());
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['apiKey', 'CALLE_API_KEY', 'secret', 'token']));
  });
});

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { simulateCase001 } from '../../../src/domain/case-001.simulation.js';
import { case001Fixture } from '../../../src/domain/case-001.fixture.js';
import type { ExceptionCase, Plan } from '../../../src/domain/types.js';
import {
  prepareDecisionProposal,
  type DecisionBridgeContext,
  type ExpectedDecisionReference,
} from '../../../src/integrations/calle/decisionBridge.js';
import type {
  CallMappingResult,
  NormalizedCallDecision,
} from '../../../src/integrations/calle/types.js';

const simulation = simulateCase001();
const finalPlan = simulation.plans.find(({ id }) => id === simulation.finalPlanId);
if (finalPlan === undefined) throw new Error('Approved fixture must contain its final plan');

const context = (): DecisionBridgeContext => ({
  exceptionCase: structuredClone(simulation.updatedCase),
  plans: structuredClone(simulation.plans),
});

const expected = (): ExpectedDecisionReference => ({
  operationType: 'PLAN_DECISION',
  caseId: simulation.updatedCase.id,
  planId: finalPlan.id,
  actorId: 'client',
  actorRole: 'client',
});

const normalizedDecision = (
  decision: NormalizedCallDecision['decision'] = 'APPROVED',
): NormalizedCallDecision => ({
  requestId: 'REQ-BRIDGE-001',
  createdAt: '2026-08-07T15:00:00.000Z',
  caseId: simulation.updatedCase.id,
  planId: finalPlan.id,
  actorId: 'client',
  actorRole: 'client',
  decision,
  summary: 'The client gave an explicit plan decision.',
  authorizationChanges: [],
  evidence: ['The client explicitly stated the decision.'],
  completionConfidence: { score: 0.94, label: 'high' },
  receivedAt: '2026-08-07T15:05:00.000Z',
});

const success = (
  value: NormalizedCallDecision = normalizedDecision(),
): CallMappingResult => ({ success: true, value });

const withValue = (
  updates: Record<string, unknown>,
): CallMappingResult => ({
  success: true,
  value: { ...normalizedDecision(), ...updates } as NormalizedCallDecision,
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const caseAuthorizationExpected = (): ExpectedDecisionReference => ({
  operationType: 'CASE_AUTHORIZATION', caseId: case001Fixture.id,
  actorId: 'client', actorRole: 'client',
});

const caseAuthorizationResult = (updates: Record<string, unknown> = {}): CallMappingResult => ({
  success: true,
  value: {
    ...normalizedDecision('APPROVED'), caseId: case001Fixture.id, planId: 'PLAN-002',
    authorizationChanges: [{ field: 'maxSubstituteQuantity', newValue: 100, externalPreviousValue: 999 }],
    ...updates,
  } as NormalizedCallDecision,
});

describe('CALL-E normalized decision bridge', () => {
  it.each(['APPROVED', 'REJECTED'] as const)(
    'produces a reviewable %s proposal without applying it',
    (decision) => {
      const result = prepareDecisionProposal(success(normalizedDecision(decision)), context(), expected());
      expect(result).toMatchObject({
        ready: true,
        proposal: {
          operationType: 'PLAN_DECISION',
          requestId: 'REQ-BRIDGE-001',
          caseId: simulation.updatedCase.id,
          planId: finalPlan.id,
          actorId: 'client',
          actorRole: 'client',
          decision,
          requiresReview: true,
          reviewState: 'DECISION_REVIEW_REQUIRED',
        },
      });
      if (result.ready) {
        expect(result.proposal).not.toHaveProperty('approval');
        expect(result.proposal).not.toHaveProperty('plan');
        expect(result.proposal).not.toHaveProperty('exceptionCase');
      }
    },
  );

  it('rejects PENDING as a final reviewable decision', () => {
    expect(prepareDecisionProposal(success(normalizedDecision('PENDING')), context(), expected()))
      .toMatchObject({ ready: false, reason: 'PENDING is not a final reviewable decision' });
  });

  it('keeps NEEDS_CLARIFICATION pending for review and never represents approval', () => {
    const result = prepareDecisionProposal(
      success(normalizedDecision('NEEDS_CLARIFICATION')),
      context(),
      expected(),
    );
    expect(result).toMatchObject({
      ready: true,
      proposal: {
        decision: 'NEEDS_CLARIFICATION',
        reviewState: 'CLARIFICATION_REQUIRED',
        requiresReview: true,
      },
    });
  });

  it('fails safely for a normalized failure', () => {
    expect(prepareDecisionProposal(
      { success: false, reason: 'No structured result', retryable: false },
      context(),
      expected(),
    )).toMatchObject({ ready: false });
  });

  it.each([
    ['caseId', { caseId: 'CASE-OTHER' }],
    ['planId', { planId: 'PLAN-OTHER' }],
    ['actorId', { actorId: 'supplier' }],
    ['actorRole', { actorRole: 'supplier' }],
  ] as const)('rejects an external %s mismatch', (_field, updates) => {
    expect(prepareDecisionProposal(withValue(updates), context(), expected()).ready).toBe(false);
  });

  it('rejects an expected actor that does not exist in the current case', () => {
    const reference = { ...expected(), actorId: 'ACTOR-NOT-IN-CASE' };
    const result = prepareDecisionProposal(
      withValue({ actorId: reference.actorId }),
      context(),
      reference,
    );
    expect(result).toMatchObject({ ready: false, reason: 'Expected actor does not exist in the current case' });
  });

  it('rejects an expected role that contradicts the real actor', () => {
    const reference = { ...expected(), actorRole: 'supplier' as const };
    const result = prepareDecisionProposal(
      withValue({ actorRole: reference.actorRole }),
      context(),
      reference,
    );
    expect(result).toMatchObject({ ready: false, reason: 'Expected actor role does not match the current case' });
  });

  it('rejects a plan absent from the current context', () => {
    const reference = { ...expected(), planId: 'PLAN-NOT-IN-CONTEXT' };
    const result = prepareDecisionProposal(
      withValue({ planId: reference.planId }),
      context(),
      reference,
    );
    expect(result).toMatchObject({ ready: false, reason: 'Expected plan does not exist in the current context' });
  });

  it('rejects a plan that belongs to another case', () => {
    const otherCasePlan = { ...finalPlan, caseId: 'CASE-OTHER' } as Plan;
    const current = context();
    const alteredContext = { ...current, plans: [otherCasePlan] };
    expect(prepareDecisionProposal(success(), alteredContext, expected()))
      .toMatchObject({ ready: false, reason: 'Expected plan does not belong to the current case' });
  });

  it('rejects a reference whose case contradicts the current context', () => {
    expect(prepareDecisionProposal(success(), context(), { ...expected(), caseId: 'CASE-OTHER' }))
      .toMatchObject({ ready: false, reason: 'Expected operation caseId does not match the current case' });
  });

  it('does not infer an operation type from a missing planId', () => {
    const { planId: _planId, ...incomplete } = expected() as Extract<ExpectedDecisionReference, { operationType: 'PLAN_DECISION' }>;
    expect(prepareDecisionProposal(success(), context(), incomplete as ExpectedDecisionReference).ready)
      .toBe(false);
  });

  it.each([
    ['missing normalized value', null],
    ['unknown decision', { decision: 'UNKNOWN' }],
    ['missing requestId', { requestId: undefined }],
    ['missing summary', { summary: undefined }],
    ['missing evidence', { evidence: undefined }],
    ['invalid evidence', { evidence: [''] }],
    ['missing confidence', { completionConfidence: undefined }],
    ['partial request identity', { requestId: '' }],
    ['contradictory clarification flag', { clarificationNeeded: true }],
    ['corrupt authorization change', { authorizationChanges: [null] }],
  ] as const)('rejects an adulterated normalized result: %s', (_name, updates) => {
    const result = updates === null
      ? ({ success: true, value: null } as unknown as CallMappingResult)
      : withValue(updates);
    expect(prepareDecisionProposal(result, context(), expected()).ready).toBe(false);
  });

  it('accepts empty authorization changes', () => {
    const result = prepareDecisionProposal(success(), context(), expected());
    expect(result.ready && result.proposal.proposedAuthorizationChanges).toEqual([]);
  });

  it('resolves a recognized authorization field from current internal state', () => {
    const result = prepareDecisionProposal(withValue({
      authorizationChanges: [{
        field: 'maxSubstituteQuantity',
        newValue: 120,
        externalPreviousValue: 999,
        reason: 'External proposal for review',
      }],
    }), context(), expected());

    expect(result).toMatchObject({
      ready: true,
      proposal: {
        proposedAuthorizationChanges: [{
          field: 'maxSubstituteQuantity',
          currentInternalValue: 100,
          proposedNewValue: 120,
          externalPreviousValue: 999,
          reason: 'External proposal for review',
          requiresReview: true,
        }],
      },
    });
  });

  it('does not allow an external previousValue to replace the internal value', () => {
    const result = prepareDecisionProposal(withValue({
      authorizationChanges: [{
        field: 'maxAbsorbableAdditionalCost',
        newValue: 10,
        externalPreviousValue: 9999,
      }],
    }), context(), expected());
    expect(result.ready && result.proposal.proposedAuthorizationChanges[0]).toMatchObject({
      currentInternalValue: 0,
      externalPreviousValue: 9999,
    });
  });

  it('rejects an unknown authorization field', () => {
    const result = prepareDecisionProposal(withValue({
      authorizationChanges: [{ field: 'inventedLimit', newValue: 10 }],
    }), context(), expected());
    expect(result).toMatchObject({ ready: false, reason: 'Unknown authorization field: inventedLimit' });
  });

  it('rejects a recognized field whose current internal value is unavailable', () => {
    const current = context();
    const alteredCase = structuredClone(current.exceptionCase) as ExceptionCase;
    const client = alteredCase.actors.find(({ id }) => id === 'client');
    if (client === undefined) throw new Error('Fixture client is required');
    delete (client.authorization as Partial<typeof client.authorization>).maxSubstituteQuantity;

    const result = prepareDecisionProposal(withValue({
      authorizationChanges: [{ field: 'maxSubstituteQuantity', newValue: 120 }],
    }), { ...current, exceptionCase: alteredCase }, expected());
    expect(result).toMatchObject({
      ready: false,
      reason: 'Current internal authorization value is unavailable: maxSubstituteQuantity',
    });
  });

  it('does not mutate frozen inputs and is deterministic', () => {
    const callResult = deepFreeze(success());
    const currentContext = deepFreeze(context());
    const reference = deepFreeze(expected());
    const beforeResult = structuredClone(callResult);
    const beforeContext = structuredClone(currentContext);
    const beforeReference = structuredClone(reference);

    const first = prepareDecisionProposal(callResult, currentContext, reference);
    const second = prepareDecisionProposal(callResult, currentContext, reference);

    expect(first).toEqual(second);
    expect(callResult).toEqual(beforeResult);
    expect(currentContext).toEqual(beforeContext);
    expect(reference).toEqual(beforeReference);
  });

  it('uses the trusted reference rather than external values to identify the operation', () => {
    const externalOnlyReference = withValue({
      caseId: 'CASE-EXTERNAL',
      planId: 'PLAN-EXTERNAL',
      actorId: 'ACTOR-EXTERNAL',
    });
    expect(prepareDecisionProposal(externalOnlyReference, context(), expected()).ready).toBe(false);
  });

  describe('CASE_AUTHORIZATION', () => {
    const caseContext = (): DecisionBridgeContext => ({ exceptionCase: structuredClone(case001Fixture), plans: [] });

    it('prepares a case-level proposal without inventing or propagating planId', () => {
      const result = prepareDecisionProposal(caseAuthorizationResult(), caseContext(), caseAuthorizationExpected());
      expect(result).toMatchObject({ ready: true, proposal: {
        operationType: 'CASE_AUTHORIZATION', decision: 'APPROVED',
        proposedAuthorizationChanges: [{ currentInternalValue: 50, proposedNewValue: 100, externalPreviousValue: 999 }],
      } });
      if (result.ready) expect(result.proposal).not.toHaveProperty('planId');
    });

    it('rejects empty changes and unknown authorization fields', () => {
      expect(prepareDecisionProposal(caseAuthorizationResult({ authorizationChanges: [] }), caseContext(), caseAuthorizationExpected()))
        .toMatchObject({ ready: false, reason: 'CASE_AUTHORIZATION requires at least one authorization change' });
      expect(prepareDecisionProposal(caseAuthorizationResult({ authorizationChanges: [{ field: 'unknown', newValue: 1 }] }), caseContext(), caseAuthorizationExpected()).ready)
        .toBe(false);
    });

    it.each([
      ['caseId', { caseId: 'CASE-OTHER' }, caseAuthorizationExpected()],
      ['actorId', { actorId: 'missing' }, caseAuthorizationExpected()],
      ['actorRole', { actorRole: 'supplier' }, caseAuthorizationExpected()],
      ['expected actor', { actorId: 'missing' }, { ...caseAuthorizationExpected(), actorId: 'missing' }],
    ] as const)('rejects an invalid %s', (_label, updates, reference) => {
      expect(prepareDecisionProposal(caseAuthorizationResult(updates), caseContext(), reference).ready).toBe(false);
    });

    it('rejects the contract-required external planId when it is empty', () => {
      expect(prepareDecisionProposal(caseAuthorizationResult({ planId: '' }), caseContext(), caseAuthorizationExpected()).ready).toBe(false);
    });

    it('does not infer CASE_AUTHORIZATION from omitted operationType', () => {
      const { operationType: _operationType, ...invalid } = caseAuthorizationExpected();
      expect(prepareDecisionProposal(caseAuthorizationResult(), caseContext(), invalid as ExpectedDecisionReference).ready).toBe(false);
    });

    it('does not mutate the case while preparing the proposal', () => {
      const current = deepFreeze(caseContext());
      const before = structuredClone(current);
      prepareDecisionProposal(caseAuthorizationResult(), current, caseAuthorizationExpected());
      expect(current).toEqual(before);
    });
  });

  it('has no SDK, network, React, ID generation, timestamp generation, or domain mutation dependency', () => {
    const source = readFileSync('src/integrations/calle/decisionBridge.ts', 'utf8');
    expect(source).not.toMatch(/@call-e\/calle|CallEProvider|executeCall|mapCalleResponse|fetch\s*\(|axios|react/i);
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|createApproval|recordApproval|finalizePlanApproval/);

    const browserFiles = [
      'src/App.tsx',
      'src/main.tsx',
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(browserFiles).not.toMatch(/decisionBridge|prepareDecisionProposal/);
  });
});

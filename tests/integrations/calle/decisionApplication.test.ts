import { describe, expect, it } from 'vitest';

import { simulateCase001 } from '../../../src/domain/case-001.simulation.js';
import { case001Fixture } from '../../../src/domain/case-001.fixture.js';
import type { Approval, Plan } from '../../../src/domain/types.js';
import type { DecisionBridgeResult, DecisionProposal } from '../../../src/integrations/calle/decisionBridge.js';
import {
  applyReviewedDecision,
  type DecisionApplicationContext,
  type ReviewCommand,
} from '../../../src/integrations/calle/decisionApplication.js';

const simulation = simulateCase001();
const plan = { ...simulation.plans.find(({ id }) => id === simulation.finalPlanId)!, status: 'PENDING_APPROVAL' } as Plan;
const client = simulation.updatedCase.actors.find(({ role }) => role === 'client')!;
const supplier = simulation.updatedCase.actors.find(({ role }) => role === 'supplier')!;
const production = simulation.updatedCase.actors.find(({ role }) => role === 'production')!;

const context = (overrides: Partial<DecisionApplicationContext> = {}): DecisionApplicationContext => ({
  exceptionCase: simulation.updatedCase,
  plans: [plan],
  approvals: [],
  operationHistory: [],
  existingEventIds: [],
  ...overrides,
});

const proposal = (overrides: Partial<DecisionProposal> = {}): DecisionBridgeResult => ({
  ready: true,
  proposal: {
    operationType: 'PLAN_DECISION', requestId: 'REQ-APPLICATION-001', caseId: simulation.caseId, planId: plan.id,
    actorId: client.id, actorRole: client.role, decision: 'APPROVED', summary: 'Reviewed decision',
    proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'],
    completionConfidence: { score: 0.9, label: 'high' }, receivedAt: '2026-08-04T18:00:00-05:00',
    requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED', ...overrides,
  },
});

const command = (overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {}): ReviewCommand => ({
  action: 'APPLY', operationId: 'OP-001', reviewedBy: 'reviewer-001',
  reviewedAt: '2026-08-04T18:05:00-05:00', eventId: 'EVENT-001', approvalId: 'APPROVAL-APPLICATION-001', authorizationReviews: [], ...overrides,
});

const approval = (actor: typeof client, approvalId: string): Approval => ({
  approvalId: approvalId as Approval['approvalId'],
  caseId: simulation.caseId, planId: plan.id, actorId: actor.id, actorRole: actor.role,
  decision: 'APPROVED', createdAt: '2026-08-04T18:01:00-05:00',
});

type CaseAuthorizationProposal = Extract<DecisionProposal, { operationType: 'CASE_AUTHORIZATION' }>;
const caseAuthorizationProposal = (
  overrides: Partial<CaseAuthorizationProposal> = {},
): DecisionBridgeResult => ({
  ready: true,
  proposal: {
    operationType: 'CASE_AUTHORIZATION', requestId: 'REQ-AUTH-001', caseId: case001Fixture.id,
    actorId: 'client', actorRole: 'client', decision: 'APPROVED', summary: 'Client confirmed the limit.',
    proposedAuthorizationChanges: [{
      field: 'maxSubstituteQuantity', currentInternalValue: 50, proposedNewValue: 100,
      externalPreviousValue: 999, requiresReview: true,
    }],
    evidence: ['Explicit authorization'], completionConfidence: { score: 0.95, label: 'high' },
    receivedAt: '2026-08-04T10:00:00-05:00', requiresReview: true,
    reviewState: 'DECISION_REVIEW_REQUIRED', ...overrides,
  },
});

const caseContext = (overrides: Partial<DecisionApplicationContext> = {}): DecisionApplicationContext => ({
  exceptionCase: structuredClone(case001Fixture), plans: [plan], approvals: [],
  operationHistory: [], existingEventIds: [], ...overrides,
});

const authorizationCommand = (
  overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {},
): ReviewCommand => ({
  action: 'APPLY', operationId: 'OP-AUTH-001', reviewedBy: 'reviewer-001',
  reviewedAt: '2026-08-04T18:05:00-05:00', eventId: 'EVENT-AUTH-001',
  authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }], ...overrides,
});

describe('Decision Application', () => {
  it('records APPROVED through the domain without finalizing early', () => {
    const result = applyReviewedDecision(proposal(), context(), command());
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.value.createdApproval?.decision).toBe('APPROVED');
    expect(result.value.createdApproval?.approvalId).toBe('APPROVAL-APPLICATION-001');
    expect(result.value.resolutionStatus).toBe('PENDING_APPROVALS');
    expect(result.value.updatedPlans[0]?.status).toBe('PENDING_APPROVAL');
    expect(result.value.updatedOperationHistory).toHaveLength(1);
    expect(result.value.proposedEvents[0]).toMatchObject({
      requestId: 'REQ-APPLICATION-001', operationId: 'OP-001',
      approvalId: 'APPROVAL-APPLICATION-001', reviewedBy: 'reviewer-001',
    });
    expect(new Set(['REQ-APPLICATION-001', 'OP-001', 'APPROVAL-APPLICATION-001']).size).toBe(3);
  });

  it('finalizes only after the other real actors approved the same plan', () => {
    const result = applyReviewedDecision(proposal(), context({ approvals: [
      approval(supplier, 'APPROVAL-EXISTING-001'),
      approval(production, 'APPROVAL-EXISTING-002'),
    ] }), command());
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.value.resolutionStatus).toBe('PLAN_APPROVED');
      expect(result.value.updatedPlans[0]?.status).toBe('APPROVED');
    }
  });

  it('applies reviewed authorization changes atomically and preserves discarded ones', () => {
    const changes = [
      { field: 'maxSubstituteQuantity' as const, currentInternalValue: 100, proposedNewValue: 120, requiresReview: true as const },
      { field: 'maxAbsorbableAdditionalCost' as const, currentInternalValue: 0, proposedNewValue: 5, requiresReview: true as const },
    ];
    const result = applyReviewedDecision(
      proposal({ proposedAuthorizationChanges: changes }), context(),
      command({ authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }, { field: 'maxAbsorbableAdditionalCost', action: 'DISCARD' }] }),
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      const updated = result.value.updatedCase.actors.find(({ id }) => id === client.id)!;
      expect(updated.authorization.maxSubstituteQuantity).toBe(120);
      expect(updated.authorization.maxAbsorbableAdditionalCost).toBe(0);
      expect(result.value.appliedAuthorizationChanges).toEqual(['maxSubstituteQuantity']);
      expect(result.value.discardedAuthorizationChanges).toEqual(['maxAbsorbableAdditionalCost']);
    }
  });

  it('records REJECTED through recordRejection without applying authorization', () => {
    const result = applyReviewedDecision(proposal({ decision: 'REJECTED' }), context(), command());
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.value.createdRejection?.decision).toBe('REJECTED');
      expect(result.value.createdRejection?.approvalId).toBe('APPROVAL-APPLICATION-001');
      expect(result.value.updatedPlans[0]?.status).toBe('REJECTED');
      expect(result.value.createdApproval).toBeUndefined();
    }
  });

  it('requires an explicit approvalId and rejects a duplicate without partial output', () => {
    const complete = command() as Extract<ReviewCommand, { action: 'APPLY' }>;
    const { approvalId: _approvalId, ...withoutApprovalId } = complete;
    const missing = applyReviewedDecision(proposal(), context(), withoutApprovalId);
    expect(missing).toMatchObject({ applied: false, reason: 'APPROVAL_ID_REQUIRED' });

    const existing = { ...approval(client, 'APPROVAL-APPLICATION-001'), decision: 'PENDING' as const };
    const duplicate = applyReviewedDecision(
      proposal(),
      context({ approvals: [existing] }),
      command(),
    );
    expect(duplicate.applied).toBe(false);
    if (!duplicate.applied) expect(duplicate.unchangedApprovals).toEqual([existing]);
  });

  it('DISCARD is a normal no-op and does not record the operation', () => {
    const ctx = context();
    const result = applyReviewedDecision(proposal(), ctx, { action: 'DISCARD', operationId: 'OP-X', reviewedBy: 'reviewer', reviewedAt: '2026-08-04T18:05:00-05:00' });
    expect(result).toMatchObject({ applied: false, reason: 'DISCARDED_BY_REVIEWER', unchangedCase: ctx.exceptionCase, unchangedOperationHistory: [] });
  });

  it.each([
    ['bridge not ready', { ready: false, reason: 'no result' } as DecisionBridgeResult, context(), command(), 'BRIDGE_RESULT_NOT_READY'],
    ['case mismatch', proposal({ caseId: 'CASE-OTHER' }), context(), command(), 'CASE_MISMATCH'],
    ['actor mismatch', proposal({ actorId: 'ACTOR-MISSING' }), context(), command(), 'ACTOR_NOT_FOUND'],
    ['role mismatch', proposal({ actorRole: 'supplier' }), context(), command(), 'ACTOR_ROLE_MISMATCH'],
    ['plan missing', proposal({ planId: 'PLAN-MISSING' }), context(), command(), 'PLAN_NOT_FOUND'],
    ['duplicate operation', proposal(), context({ operationHistory: [{ operationId: 'OP-001', caseId: simulation.caseId, processedAt: '2026-08-04T17:00:00-05:00' }] }), command(), 'DUPLICATE_OPERATION'],
  ])('fails safely for %s', (_label, bridge, ctx, review, reason) => {
    const result = applyReviewedDecision(bridge, ctx, review);
    expect(result).toMatchObject({ applied: false, reason });
  });

  it('rejects missing, duplicate, stale, and invalid authorization reviews without partial updates', () => {
    const change = { field: 'maxSubstituteQuantity' as const, currentInternalValue: 100, proposedNewValue: 120, requiresReview: true as const };
    const ctx = context();
    const missing = applyReviewedDecision(proposal({ proposedAuthorizationChanges: [change] }), ctx, command());
    const duplicate = applyReviewedDecision(proposal({ proposedAuthorizationChanges: [change] }), ctx, command({ authorizationReviews: [{ field: change.field, action: 'APPLY' }, { field: change.field, action: 'DISCARD' }] }));
    const stale = applyReviewedDecision(proposal({ proposedAuthorizationChanges: [{ ...change, currentInternalValue: 50 }] }), ctx, command({ authorizationReviews: [{ field: change.field, action: 'APPLY' }] }));
    const invalid = applyReviewedDecision(proposal({ proposedAuthorizationChanges: [{ ...change, proposedNewValue: -1 }] }), ctx, command({ authorizationReviews: [{ field: change.field, action: 'APPLY' }] }));
    expect([missing, duplicate, stale, invalid].map((item) => item.applied)).toEqual([false, false, false, false]);
    expect(client.authorization.maxSubstituteQuantity).toBe(100);
  });

  it('does not apply PENDING, NEEDS_CLARIFICATION, or an adulterated decision', () => {
    const pending = proposal({ decision: 'PENDING' as never });
    const clarification = proposal({ decision: 'NEEDS_CLARIFICATION', reviewState: 'CLARIFICATION_REQUIRED' });
    const unknown = proposal({ decision: 'YES' as never });
    expect(applyReviewedDecision(pending, context(), command())).toMatchObject({ applied: false });
    expect(applyReviewedDecision(clarification, context(), command())).toMatchObject({ applied: false, reason: 'NEEDS_CLARIFICATION' });
    expect(applyReviewedDecision(unknown, context(), command())).toMatchObject({ applied: false, reason: 'Decision is unknown' });
  });

  it('does not mutate frozen inputs and is deterministic', () => {
    const bridge = Object.freeze(proposal());
    const ctx = Object.freeze(context());
    const review = Object.freeze(command());
    const before = JSON.stringify({ bridge, ctx, review });
    const first = applyReviewedDecision(bridge, ctx, review);
    const second = applyReviewedDecision(bridge, ctx, review);
    expect(second).toEqual(first);
    expect(JSON.stringify({ bridge, ctx, review })).toBe(before);
  });

  it('rejects invalid review metadata and unreliable histories', () => {
    expect(applyReviewedDecision(proposal(), context(), command({ reviewedBy: '' }))).toMatchObject({ applied: false, reason: 'REVIEWER_REQUIRED' });
    expect(applyReviewedDecision(proposal(), context(), command({ reviewedAt: 'invalid' }))).toMatchObject({ applied: false, reason: 'REVIEWED_AT_INVALID' });
    expect(applyReviewedDecision(proposal(), context({ operationHistory: undefined as never }), command())).toMatchObject({ applied: false, reason: 'OPERATION_HISTORY_INSUFFICIENT' });
  });

  describe('CASE_AUTHORIZATION', () => {
    it('applies 50 to 100 through domain primitives without approvals, rejection, or plan finalization', () => {
      const ctx = caseContext();
      const result = applyReviewedDecision(caseAuthorizationProposal(), ctx, authorizationCommand());
      expect(result.applied).toBe(true);
      if (!result.applied) return;
      const updatedClient = result.value.updatedCase.actors.find(({ id }) => id === 'client')!;
      expect(updatedClient.authorization.maxSubstituteQuantity).toBe(100);
      expect(result.value.approvals).toEqual([]);
      expect(result.value).not.toHaveProperty('createdApproval');
      expect(result.value).not.toHaveProperty('createdRejection');
      expect(result.value.updatedPlans).toEqual(ctx.plans);
      expect(result.value.resolutionStatus).toBe('CASE_AUTHORIZATION_APPLIED');
      expect(result.value.updatedOperationHistory).toHaveLength(1);
      expect(result.value.proposedEvents[0]).not.toHaveProperty('planId');
    });

    it('does not trust externalPreviousValue and rejects stale internal state', () => {
      const stale = caseAuthorizationProposal({
        proposedAuthorizationChanges: [{
          field: 'maxSubstituteQuantity', currentInternalValue: 49, proposedNewValue: 100,
          externalPreviousValue: 50, requiresReview: true,
        }],
      });
      expect(applyReviewedDecision(stale, caseContext(), authorizationCommand()))
        .toMatchObject({ applied: false, reason: 'STALE_PROPOSAL' });
    });

    it('requires exactly one explicit review and rolls back all changes when one is invalid', () => {
      const bridge = caseAuthorizationProposal({ proposedAuthorizationChanges: [
        { field: 'maxSubstituteQuantity', currentInternalValue: 50, proposedNewValue: 100, requiresReview: true },
        { field: 'maxAbsorbableAdditionalCost', currentInternalValue: 0, proposedNewValue: -1, requiresReview: true },
      ] });
      const ctx = caseContext();
      const result = applyReviewedDecision(bridge, ctx, authorizationCommand({ authorizationReviews: [
        { field: 'maxSubstituteQuantity', action: 'APPLY' },
        { field: 'maxAbsorbableAdditionalCost', action: 'APPLY' },
      ] }));
      expect(result.applied).toBe(false);
      expect(ctx.exceptionCase.actors.find(({ id }) => id === 'client')?.authorization.maxSubstituteQuantity).toBe(50);
      expect(ctx.operationHistory).toEqual([]);
    });

    it('does not apply a duplicate operationId', () => {
      const ctx = caseContext({ operationHistory: [{
        operationId: 'OP-AUTH-001', caseId: case001Fixture.id,
        processedAt: '2026-08-04T09:00:00-05:00',
      }] });
      expect(applyReviewedDecision(caseAuthorizationProposal(), ctx, authorizationCommand()))
        .toMatchObject({ applied: false, reason: 'DUPLICATE_OPERATION' });
      expect(ctx.exceptionCase.actors.find(({ id }) => id === 'client')?.authorization.maxSubstituteQuantity).toBe(50);
    });

    it('does not report an application when every individual change is discarded', () => {
      const ctx = caseContext();
      const result = applyReviewedDecision(caseAuthorizationProposal(), ctx, authorizationCommand({
        authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'DISCARD' }],
      }));
      expect(result).toMatchObject({ applied: false, reason: 'CASE_AUTHORIZATION_DISCARDED' });
      expect(ctx.operationHistory).toEqual([]);
      expect(ctx.approvals).toEqual([]);
    });

    it.each([
      ['case mismatch', caseAuthorizationProposal({ caseId: 'CASE-OTHER' }), 'CASE_MISMATCH'],
      ['actor missing', caseAuthorizationProposal({ actorId: 'missing' }), 'ACTOR_NOT_FOUND'],
      ['role mismatch', caseAuthorizationProposal({ actorRole: 'supplier' }), 'ACTOR_ROLE_MISMATCH'],
      ['rejected', caseAuthorizationProposal({ decision: 'REJECTED' }), 'CASE_AUTHORIZATION_REJECTED'],
      ['clarification', caseAuthorizationProposal({ decision: 'NEEDS_CLARIFICATION', reviewState: 'CLARIFICATION_REQUIRED' }), 'NEEDS_CLARIFICATION'],
    ] as const)('fails safely for %s', (_label, bridge, reason) => {
      expect(applyReviewedDecision(bridge, caseContext(), authorizationCommand()))
        .toMatchObject({ applied: false, reason });
    });

    it('DISCARD and adulterated PENDING do not modify the case or history', () => {
      const ctx = caseContext();
      const discard = applyReviewedDecision(caseAuthorizationProposal(), ctx, {
        action: 'DISCARD', operationId: 'OP-DISCARD', reviewedBy: 'reviewer',
        reviewedAt: '2026-08-04T10:05:00-05:00',
      });
      const pending = applyReviewedDecision(
        caseAuthorizationProposal({ decision: 'PENDING' as never }), ctx, authorizationCommand(),
      );
      expect(discard).toMatchObject({ applied: false, reason: 'DISCARDED_BY_REVIEWER' });
      expect(pending).toMatchObject({ applied: false, reason: 'PENDING_NOT_APPLICABLE' });
      expect(ctx.exceptionCase.actors.find(({ id }) => id === 'client')?.authorization.maxSubstituteQuantity).toBe(50);
      expect(ctx.operationHistory).toEqual([]);
    });

    it('is deterministic and does not mutate frozen inputs', () => {
      const bridge = Object.freeze(caseAuthorizationProposal());
      const ctx = Object.freeze(caseContext());
      const review = Object.freeze(authorizationCommand());
      const before = JSON.stringify({ bridge, ctx, review });
      expect(applyReviewedDecision(bridge, ctx, review)).toEqual(applyReviewedDecision(bridge, ctx, review));
      expect(JSON.stringify({ bridge, ctx, review })).toBe(before);
    });
  });
});

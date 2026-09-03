import { describe, expect, it } from 'vitest';

import { simulateCase001 } from '../../../src/domain/case-001.simulation.js';
import { case001Fixture } from '../../../src/domain/case-001.fixture.js';
import type { Approval, Plan } from '../../../src/domain/types.js';
import { createSuccessorPlan, type PlanLineage } from '../../../src/domain/planLineage.js';
import {
  createReadyDecisionBridgeResult,
  deriveReviewTarget,
  prepareDecisionProposal,
  type DecisionBridgeResult,
  type DecisionProposal,
} from '../../../src/integrations/calle/decisionBridge.js';
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
const planLineage: PlanLineage = {
  lineageId: 'TEST-LINEAGE', caseId: plan.caseId, planIds: [plan.id],
};

const withSupply = (originalQuantity: number, substituteQuantity: number) => {
  const exceptionCase = structuredClone(simulation.updatedCase);
  const supplierActor = exceptionCase.actors.find(({ role }) => role === 'supplier')!;
  supplierActor.constraints = supplierActor.constraints.map((constraint) => constraint.type === 'SUPPLY'
    ? { ...constraint,
        originalQuantity: constraint.deliveryDate === exceptionCase.targetDeliveryDate && constraint.originalQuantity > 0 ? originalQuantity : constraint.originalQuantity,
        substituteQuantity: constraint.deliveryDate === exceptionCase.targetDeliveryDate && constraint.substituteQuantity > 0 ? substituteQuantity : constraint.substituteQuantity }
    : constraint);
  return exceptionCase;
};

const context = (overrides: Partial<DecisionApplicationContext> = {}): DecisionApplicationContext => ({
  exceptionCase: simulation.updatedCase,
  plans: [plan],
  planLineages: [planLineage],
  approvals: [],
  operationHistory: [],
  existingEventIds: [],
  ...overrides,
});

const proposal = (overrides: Partial<DecisionProposal> = {}): DecisionBridgeResult =>
  createReadyDecisionBridgeResult({
    operationType: 'PLAN_DECISION', requestId: 'REQ-APPLICATION-001', caseId: simulation.caseId, planId: plan.id,
    actorId: client.id, actorRole: client.role, decision: 'APPROVED', summary: 'Reviewed decision',
    proposedAuthorizationChanges: [], evidence: ['Sanitized evidence'],
    completionConfidence: { score: 0.9, label: 'high' }, receivedAt: '2026-08-04T18:00:00-05:00',
    requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED', ...overrides,
  });

const command = (overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {}): ReviewCommand => ({
  action: 'APPLY', operationId: 'OP-001', reviewedBy: 'reviewer-001',
  reviewedAt: '2026-08-04T18:05:00-05:00', eventId: 'EVENT-001', approvalId: 'APPROVAL-APPLICATION-001', authorizationReviews: [], ...overrides,
  reviewTarget: overrides.reviewTarget ?? deriveReviewTarget((proposal() as Extract<DecisionBridgeResult, { ready: true }>).proposal),
});

const commandFor = (
  bridge: DecisionBridgeResult,
  overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {},
): ReviewCommand => {
  if (!bridge.ready) return command(overrides);
  return command({ ...overrides, reviewTarget: bridge.reviewTarget });
};

const approval = (actor: typeof client, approvalId: string): Approval => ({
  approvalId: approvalId as Approval['approvalId'],
  caseId: simulation.caseId, planId: plan.id, actorId: actor.id, actorRole: actor.role,
  decision: 'APPROVED', createdAt: '2026-08-04T18:01:00-05:00',
});

type CaseAuthorizationProposal = Extract<DecisionProposal, { operationType: 'CASE_AUTHORIZATION' }>;
const caseAuthorizationProposal = (
  overrides: Partial<CaseAuthorizationProposal> = {},
): DecisionBridgeResult => createReadyDecisionBridgeResult({
    operationType: 'CASE_AUTHORIZATION', requestId: 'REQ-AUTH-001', caseId: case001Fixture.id,
    actorId: 'client', actorRole: 'client', decision: 'APPROVED', summary: 'Client confirmed the limit.',
    proposedAuthorizationChanges: [{
      field: 'maxSubstituteQuantity', currentInternalValue: 50, proposedNewValue: 100,
      externalPreviousValue: 999, requiresReview: true,
    }],
    evidence: ['Explicit authorization'], completionConfidence: { score: 0.95, label: 'high' },
    receivedAt: '2026-08-04T10:00:00-05:00', requiresReview: true,
    reviewState: 'DECISION_REVIEW_REQUIRED', ...overrides,
  });

const caseContext = (overrides: Partial<DecisionApplicationContext> = {}): DecisionApplicationContext => ({
  exceptionCase: structuredClone(case001Fixture), plans: [plan], approvals: [],
  planLineages: [], operationHistory: [], existingEventIds: [], ...overrides,
});

const authorizationCommand = (
  overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {},
): ReviewCommand => ({
  action: 'APPLY', operationId: 'OP-AUTH-001', reviewedBy: 'reviewer-001',
  reviewedAt: '2026-08-04T18:05:00-05:00', eventId: 'EVENT-AUTH-001',
  authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }], ...overrides,
  reviewTarget: overrides.reviewTarget ?? deriveReviewTarget((caseAuthorizationProposal() as Extract<DecisionBridgeResult, { ready: true }>).proposal),
});

const authorizationCommandFor = (
  bridge: DecisionBridgeResult,
  overrides: Partial<Extract<ReviewCommand, { action: 'APPLY' }>> = {},
): ReviewCommand => {
  if (!bridge.ready) return authorizationCommand(overrides);
  return authorizationCommand({ ...overrides, reviewTarget: bridge.reviewTarget });
};

describe('Decision Application', () => {
  it.each(['APPROVED', 'REJECTED'] as const)('rejects delayed %s on a superseded plan without recording anything', (decision) => {
    const successor = createSuccessorPlan(
      planLineage.lineageId, [planLineage], [plan], plan.id,
      'PLAN-GENERAL-SUCCESSOR' as Plan['id'], { status: 'PENDING_APPROVAL' },
    );
    expect(successor.success).toBe(true);
    if (!successor.success) return;
    const ctx = context({ plans: successor.plans, planLineages: successor.lineages });
    const bridge = proposal({ decision });
    const result = applyReviewedDecision(bridge, ctx, commandFor(bridge));
    expect(result).toMatchObject({
      applied: false, reason: 'PLAN_SUPERSEDED', unchangedApprovals: [], unchangedOperationHistory: [],
    });
    expect(ctx.plans.find(({ id }) => id === plan.id)?.status).toBe('INVALIDATED');
  });

  it('accepts a decision for the current pending tip and does not inherit predecessor approvals', () => {
    const priorApproval = approval(supplier, 'APPROVAL-PREDECESSOR');
    const successor = createSuccessorPlan(
      planLineage.lineageId, [planLineage], [plan], plan.id,
      'PLAN-GENERAL-SUCCESSOR' as Plan['id'], { status: 'PENDING_APPROVAL' },
    );
    expect(successor.success).toBe(true);
    if (!successor.success) return;
    const current = successor.plan;
    const bridge = proposal({ planId: current.id });
    const result = applyReviewedDecision(
      bridge,
      context({ plans: successor.plans, planLineages: successor.lineages, approvals: [priorApproval] }),
      commandFor(bridge),
    );
    expect(result).toMatchObject({ applied: true, value: { resolutionStatus: 'PENDING_APPROVALS' } });
    if (!result.applied) return;
    expect(result.value.approvals.filter(({ planId }) => planId === current.id)).toHaveLength(1);
    expect(result.value.updatedPlans.find(({ id }) => id === current.id)?.status).toBe('PENDING_APPROVAL');
  });

  it('keeps currentness separate from lifecycle approvability', () => {
    const noSolution = { ...plan, status: 'NO_SOLUTION' as const };
    const currentLineage: PlanLineage = { ...planLineage, planIds: [noSolution.id] };
    expect(applyReviewedDecision(
      proposal(),
      context({ plans: [noSolution], planLineages: [currentLineage] }),
      command(),
    )).toMatchObject({ applied: false, reason: 'PLAN_NOT_APPLICABLE' });
  });

  it.each([
    ['PLAN_PHYSICALLY_INFEASIBLE', withSupply(100, 50)],
    ['PHYSICAL_FEASIBILITY_UNPROVEN', withSupply(0, 0)],
  ] as const)('blocks APPROVED with %s before every side effect', (reason, exceptionCase) => {
    const ctx = context({ exceptionCase });
    const bridge = proposal({ proposedAuthorizationChanges: [{ field: 'maxSubstituteQuantity', currentInternalValue: 100, proposedNewValue: 200, requiresReview: true }] });
    const result = applyReviewedDecision(
      bridge,
      ctx,
      commandFor(bridge, { authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }] }),
    );
    expect(result).toMatchObject({
      applied: false, reason, unchangedCase: ctx.exceptionCase, unchangedPlans: ctx.plans,
      unchangedApprovals: [], unchangedOperationHistory: [], physicalFeasibilityAssessment: expect.any(Object),
    });
    if (result.applied) return;
    expect(result).not.toHaveProperty('proposedEvents');
    expect(result).not.toHaveProperty('createdApproval');
    expect(result).not.toHaveProperty('createdRejection');
    expect(ctx.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(100);
    expect(ctx.plans[0]?.status).toBe('PENDING_APPROVAL');
  });

  it.each([
    ['physically infeasible', withSupply(100, 50)],
    ['physical feasibility unproven', withSupply(0, 0)],
  ])('keeps REJECTED recordable when %s', (_label, exceptionCase) => {
    const bridge = proposal({ decision: 'REJECTED' });
    const result = applyReviewedDecision(bridge, context({ exceptionCase }), commandFor(bridge));
    expect(result).toMatchObject({ applied: true, value: { resolutionStatus: 'PLAN_REJECTED', createdRejection: { decision: 'REJECTED' } } });
  });

  it('rejects a superseded plan before physical feasibility even when supply evidence is missing', () => {
    const successor = createSuccessorPlan(planLineage.lineageId, [planLineage], [plan], plan.id, 'PLAN-FRESHNESS-FIRST' as Plan['id'], { status: 'PENDING_APPROVAL' });
    expect(successor.success).toBe(true);
    if (!successor.success) return;
    const result = applyReviewedDecision(proposal(), context({ exceptionCase: withSupply(0, 0), plans: successor.plans, planLineages: successor.lineages }), command());
    expect(result).toMatchObject({ applied: false, reason: 'PLAN_SUPERSEDED' });
    expect(result).not.toHaveProperty('physicalFeasibilityAssessment');
  });

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
    const bridge = proposal({ proposedAuthorizationChanges: changes });
    const result = applyReviewedDecision(
      bridge, context(),
      commandFor(bridge, { authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }, { field: 'maxAbsorbableAdditionalCost', action: 'DISCARD' }] }),
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
    const bridge = proposal({ decision: 'REJECTED' });
    const result = applyReviewedDecision(bridge, context(), commandFor(bridge));
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
    const bridge = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
    const result = applyReviewedDecision(bridge, ctx, { action: 'DISCARD', operationId: 'OP-X', reviewedBy: 'reviewer', reviewedAt: '2026-08-04T18:05:00-05:00', reviewTarget: bridge.reviewTarget });
    expect(result).toMatchObject({ applied: false, reason: 'DISCARDED_BY_REVIEWER', unchangedCase: ctx.exceptionCase, unchangedOperationHistory: [] });
  });

  it.each([
    ['bridge not ready', { ready: false, reason: 'no result' } as DecisionBridgeResult, context(), command(), 'BRIDGE_RESULT_NOT_READY'],
    ['case mismatch', proposal({ caseId: 'CASE-OTHER' }), context(), undefined, 'CASE_MISMATCH'],
    ['actor mismatch', proposal({ actorId: 'ACTOR-MISSING' }), context(), undefined, 'ACTOR_NOT_FOUND'],
    ['role mismatch', proposal({ actorRole: 'supplier' }), context(), undefined, 'ACTOR_ROLE_MISMATCH'],
    ['plan missing', proposal({ planId: 'PLAN-MISSING' }), context(), undefined, 'PLAN_NOT_FOUND'],
    ['duplicate operation', proposal(), context({ operationHistory: [{ operationId: 'OP-001', caseId: simulation.caseId, processedAt: '2026-08-04T17:00:00-05:00' }] }), command(), 'DUPLICATE_OPERATION'],
  ])('fails safely for %s', (_label, bridge, ctx, review, reason) => {
    const result = applyReviewedDecision(bridge, ctx, review ?? commandFor(bridge));
    expect(result).toMatchObject({ applied: false, reason });
  });

  it('rejects missing, duplicate, stale, and invalid authorization reviews without partial updates', () => {
    const change = { field: 'maxSubstituteQuantity' as const, currentInternalValue: 100, proposedNewValue: 120, requiresReview: true as const };
    const ctx = context();
    const bridge = proposal({ proposedAuthorizationChanges: [change] });
    const staleBridge = proposal({ proposedAuthorizationChanges: [{ ...change, currentInternalValue: 50 }] });
    const invalidBridge = proposal({ proposedAuthorizationChanges: [{ ...change, proposedNewValue: -1 }] });
    const missing = applyReviewedDecision(bridge, ctx, commandFor(bridge));
    const duplicate = applyReviewedDecision(bridge, ctx, commandFor(bridge, { authorizationReviews: [{ field: change.field, action: 'APPLY' }, { field: change.field, action: 'DISCARD' }] }));
    const stale = applyReviewedDecision(staleBridge, ctx, commandFor(staleBridge, { authorizationReviews: [{ field: change.field, action: 'APPLY' }] }));
    const invalid = applyReviewedDecision(invalidBridge, ctx, commandFor(invalidBridge, { authorizationReviews: [{ field: change.field, action: 'APPLY' }] }));
    expect(missing).toMatchObject({ applied: false, reason: 'AUTHORIZATION_REVIEWS_INCOMPLETE_OR_DUPLICATE' });
    expect(duplicate).toMatchObject({ applied: false, reason: 'AUTHORIZATION_REVIEWS_INCOMPLETE_OR_DUPLICATE' });
    expect(stale).toMatchObject({ applied: false, reason: 'STALE_PROPOSAL' });
    expect(invalid).toMatchObject({ applied: false, reason: 'AUTHORIZATION_VALIDATION_FAILED' });
    expect(client.authorization.maxSubstituteQuantity).toBe(100);
  });

  it('does not apply PENDING, NEEDS_CLARIFICATION, or an adulterated decision', () => {
    const pending = proposal({ decision: 'PENDING' as never });
    const clarification = proposal({ decision: 'NEEDS_CLARIFICATION', reviewState: 'CLARIFICATION_REQUIRED' });
    const unknown = proposal({ decision: 'YES' as never });
    expect(applyReviewedDecision(pending, context(), commandFor(pending))).toMatchObject({ applied: false });
    expect(applyReviewedDecision(clarification, context(), commandFor(clarification))).toMatchObject({ applied: false, reason: 'NEEDS_CLARIFICATION' });
    expect(applyReviewedDecision(unknown, context(), commandFor(unknown))).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
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

  describe('exact review-to-proposal binding', () => {
    const textBridge = (padded: boolean) => prepareDecisionProposal({
      success: true,
      value: {
        requestId: padded ? ' REQUEST-TEXT ' : 'REQUEST-TEXT',
        createdAt: '2026-08-04T17:00:00-05:00',
        caseId: simulation.caseId, planId: plan.id, actorId: client.id, actorRole: client.role,
        decision: 'APPROVED', summary: padded ? ' Summary ' : 'Summary',
        evidence: [padded ? ' Evidence ' : 'Evidence'],
        completionConfidence: { score: 0.9, label: padded ? ' high ' : 'high' },
        receivedAt: '2026-08-04T18:00:00-05:00',
        authorizationChanges: [{ field: 'maxSubstituteQuantity', newValue: 120, reason: padded ? ' Reason ' : 'Reason' }],
      },
    }, context(), {
      operationType: 'PLAN_DECISION', caseId: simulation.caseId, planId: plan.id,
      actorId: client.id, actorRole: client.role,
    });

    it.each(['summary', 'requestId', 'caseId', 'planId', 'actorId', 'evidence', 'reason', 'confidence label'])(
      'rejects whitespace-only changes to %s without effects', (field) => {
        const bridge = textBridge(false);
        if (!bridge.ready || bridge.proposal.operationType !== 'PLAN_DECISION') throw new Error('Expected ready plan proposal');
        const changed = {
          ...bridge.proposal,
          ...(field === 'evidence' ? { evidence: [' Evidence '] }
            : field === 'reason' ? { proposedAuthorizationChanges: bridge.proposal.proposedAuthorizationChanges.map((change) => ({ ...change, reason: ' Reason ' })) }
            : field === 'confidence label' ? { completionConfidence: { score: 0.9, label: ' high ' } }
            : { [field]: ` ${bridge.proposal[field as 'summary' | 'requestId' | 'caseId' | 'planId' | 'actorId']} ` }),
        };
        const ctx = context();
        const result = applyReviewedDecision(bridge, ctx, command({
          reviewTarget: deriveReviewTarget(changed),
          authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
        }));
        expect(result).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID', issues: ['MISMATCH'] });
        if (result.applied) throw new Error('Unexpected mutation');
        expect(result.unchangedCase).toBe(ctx.exceptionCase);
        expect(result.unchangedPlans).toBe(ctx.plans);
        expect(result.unchangedApprovals).toBe(ctx.approvals);
        expect(result.unchangedOperationHistory).toBe(ctx.operationHistory);
        expect(result).not.toHaveProperty('value');
      },
    );

    it('accepts the exact whitespace-containing proposal and snapshot produced by the Bridge', () => {
      const bridge = textBridge(true);
      if (!bridge.ready) throw new Error(bridge.reason);
      expect(bridge.proposal.summary).toBe(' Summary ');
      expect(bridge.reviewTarget).toEqual(bridge.proposal);
      expect(applyReviewedDecision(bridge, context(), commandFor(bridge, {
        authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
      }))).toMatchObject({ applied: true });
    });

    it.each([null, 42, { summary: '   ' }, { evidence: [null] }, { completionConfidence: { score: 0.9, label: '   ' } }])(
      'still fails closed for malformed target %j', (malformed) => {
        const bridge = textBridge(false);
        if (!bridge.ready) throw new Error(bridge.reason);
        const reviewTarget = typeof malformed === 'object' && malformed !== null
          ? { ...bridge.reviewTarget, ...malformed } : malformed;
        const result = applyReviewedDecision(bridge, context(), {
          ...commandFor(bridge), reviewTarget,
        } as unknown as ReviewCommand);
        expect(result).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID', issues: ['MALFORMED'] });
      },
    );

    it.each([
      ['caseId', { caseId: 'CASE-OTHER' }],
      ['planId', { planId: 'PLAN-OTHER' }],
      ['actorId', { actorId: 'ACTOR-OTHER' }],
      ['actorRole', { actorRole: 'supplier' as const }],
      ['decision', { decision: 'REJECTED' as const }],
      ['requestId', { requestId: 'REQ-APPLICATION-OTHER' }],
      ['summary', { summary: 'Changed reviewed summary' }],
      ['evidence', { evidence: ['Changed reviewed evidence'] }],
      ['completionConfidence', { completionConfidence: { score: 0.8, label: 'medium' } }],
      ['receivedAt', { receivedAt: '2026-08-04T18:01:00-05:00' }],
    ] as const)('blocks a review reused after %s changes with exact zero effects', (_field, overrides) => {
      const ctx = context();
      const reviewed = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      const supplied = proposal(overrides);
      const result = applyReviewedDecision(supplied, ctx, command({ reviewTarget: reviewed.reviewTarget }));
      expect(result).toMatchObject({
        applied: false,
        reason: 'REVIEW_PROPOSAL_BINDING_INVALID',
        issues: ['MISMATCH'],
        unchangedCase: ctx.exceptionCase,
        unchangedPlans: ctx.plans,
        unchangedApprovals: ctx.approvals,
        unchangedOperationHistory: ctx.operationHistory,
      });
      expect(result).not.toHaveProperty('value');
    });

    it.each([
      ['proposed value', { proposedNewValue: 300 }],
      ['current value', { currentInternalValue: 99 }],
      ['external previous value', { externalPreviousValue: 98 }],
      ['reason', { reason: 'Changed reason' }],
    ] as const)('binds authorization-change %s', (_label, changeOverride) => {
      const originalChange = {
        field: 'maxSubstituteQuantity' as const,
        currentInternalValue: 100,
        proposedNewValue: 150,
        externalPreviousValue: 100,
        reason: 'Original reason',
        requiresReview: true as const,
      };
      const reviewed = proposal({ proposedAuthorizationChanges: [originalChange] }) as Extract<DecisionBridgeResult, { ready: true }>;
      const supplied = proposal({ proposedAuthorizationChanges: [{ ...originalChange, ...changeOverride }] });
      const result = applyReviewedDecision(supplied, context(), command({
        reviewTarget: reviewed.reviewTarget,
        authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
      }));
      expect(result).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
    });

    it('fails closed for a missing, malformed, or tampered runtime target', () => {
      const bridge = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      const base = command({ reviewTarget: bridge.reviewTarget }) as Extract<ReviewCommand, { action: 'APPLY' }>;
      const { reviewTarget: _target, ...missing } = base;
      const malformed = { ...base, reviewTarget: { operationType: 'PLAN_DECISION' } };
      const tampered = { ...base, reviewTarget: { ...structuredClone(bridge.reviewTarget), summary: 'Tampered' } };
      for (const review of [missing, malformed, tampered]) {
        expect(applyReviewedDecision(bridge, context(), review as ReviewCommand)).toMatchObject({
          applied: false,
          reason: 'REVIEW_PROPOSAL_BINDING_INVALID',
        });
      }
    });

    it('accepts semantic equality regardless of object property insertion order', () => {
      const bridge = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      const target = bridge.reviewTarget;
      const reordered = {
        reviewState: target.reviewState,
        requiresReview: target.requiresReview,
        receivedAt: target.receivedAt,
        completionConfidence: { label: target.completionConfidence.label, score: target.completionConfidence.score },
        evidence: [...target.evidence],
        proposedAuthorizationChanges: [...target.proposedAuthorizationChanges],
        summary: target.summary,
        decision: target.decision,
        actorRole: target.actorRole,
        actorId: target.actorId,
        planId: target.operationType === 'PLAN_DECISION' ? target.planId : plan.id,
        caseId: target.caseId,
        requestId: target.requestId,
        operationType: 'PLAN_DECISION' as const,
      };
      expect(applyReviewedDecision(bridge, context(), command({ reviewTarget: reordered })))
        .toMatchObject({ applied: true });
    });

    it('keeps evidence ordered as presented while treating authorization changes as field-identified', () => {
      const evidenceReviewed = proposal({ evidence: ['first', 'second'] }) as Extract<DecisionBridgeResult, { ready: true }>;
      const evidenceSupplied = proposal({ evidence: ['second', 'first'] });
      expect(applyReviewedDecision(evidenceSupplied, context(), command({ reviewTarget: evidenceReviewed.reviewTarget })))
        .toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });

      const changes = [
        { field: 'maxSubstituteQuantity' as const, currentInternalValue: 100, proposedNewValue: 120, requiresReview: true as const },
        { field: 'maxAbsorbableAdditionalCost' as const, currentInternalValue: 0, proposedNewValue: 5, requiresReview: true as const },
      ];
      const bridge = proposal({ proposedAuthorizationChanges: changes });
      if (!bridge.ready) throw new Error('Expected ready bridge');
      const reorderedTarget = { ...structuredClone(bridge.reviewTarget), proposedAuthorizationChanges: [...bridge.reviewTarget.proposedAuthorizationChanges].reverse() };
      expect(applyReviewedDecision(bridge, context(), command({
        reviewTarget: reorderedTarget,
        authorizationReviews: changes.map(({ field }) => ({ field, action: 'DISCARD' as const })),
      }))).not.toMatchObject({ reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
    });

    it('creates an independent frozen snapshot in both directions', () => {
      const mutableProposal = structuredClone((proposal() as Extract<DecisionBridgeResult, { ready: true }>).proposal) as unknown as {
        evidence: string[];
        proposedAuthorizationChanges: Array<{
          field: 'maxSubstituteQuantity'; currentInternalValue: number; proposedNewValue: number; requiresReview: true;
        }>;
      } & DecisionProposal;
      mutableProposal.evidence.push('proposal-only');
      mutableProposal.proposedAuthorizationChanges.push({
        field: 'maxSubstituteQuantity', currentInternalValue: 100, proposedNewValue: 120, requiresReview: true,
      });
      const target = deriveReviewTarget(mutableProposal);
      mutableProposal.evidence.push('later proposal mutation');
      mutableProposal.proposedAuthorizationChanges[0]!.proposedNewValue = 130;
      expect(target.evidence).toEqual(['Sanitized evidence', 'proposal-only']);
      expect(target.proposedAuthorizationChanges[0]?.proposedNewValue).toBe(120);
      expect(Object.isFrozen(target)).toBe(true);
      expect(Object.isFrozen(target.evidence)).toBe(true);
      expect(Object.isFrozen(target.proposedAuthorizationChanges[0])).toBe(true);
      expect(() => (target.evidence as string[]).push('target mutation')).toThrow();
      expect(mutableProposal.evidence).not.toContain('target mutation');
    });

    it('detects proposal mutation after the target was created', () => {
      const bridge = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      (bridge.proposal as { summary: string }).summary = 'Mutated after review target creation';
      expect(applyReviewedDecision(bridge, context(), command({ reviewTarget: bridge.reviewTarget })))
        .toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
    });

    it('binds DISCARD to the exact proposal', () => {
      const reviewed = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      const supplied = proposal({ requestId: 'OTHER-REQUEST' });
      expect(applyReviewedDecision(supplied, context(), {
        action: 'DISCARD', operationId: 'OP-DISCARD-MISMATCH', reviewedBy: 'reviewer',
        reviewedAt: '2026-08-04T18:05:00-05:00', reviewTarget: reviewed.reviewTarget,
      })).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
    });

    it('enforces internal receive-to-review chronology by chronological instant', () => {
      const bridge = proposal() as Extract<DecisionBridgeResult, { ready: true }>;
      expect(applyReviewedDecision(bridge, context(), command({
        reviewTarget: bridge.reviewTarget,
        reviewedAt: '2026-08-04T17:59:59-05:00',
      }))).toMatchObject({ applied: false, reason: 'REVIEW_TIMESTAMP_PRECEDES_PROPOSAL' });
      expect(applyReviewedDecision(bridge, context(), command({
        reviewTarget: bridge.reviewTarget,
        reviewedAt: '2026-08-04T23:00:00Z',
      }))).toMatchObject({ applied: true });
    });
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

    it('bypasses physical feasibility when trusted supply evidence is absent', () => {
      const exceptionCase = structuredClone(case001Fixture);
      const supplierActor = exceptionCase.actors.find(({ role }) => role === 'supplier')!;
      supplierActor.constraints = supplierActor.constraints.map((constraint) => constraint.type === 'SUPPLY'
        ? { ...constraint, originalQuantity: 0, substituteQuantity: 0 }
        : constraint);
      const result = applyReviewedDecision(
        caseAuthorizationProposal(), caseContext({ exceptionCase }), authorizationCommand(),
      );
      expect(result).toMatchObject({ applied: true, value: { resolutionStatus: 'CASE_AUTHORIZATION_APPLIED' } });
    });

    it('does not trust externalPreviousValue and rejects stale internal state', () => {
      const stale = caseAuthorizationProposal({
        proposedAuthorizationChanges: [{
          field: 'maxSubstituteQuantity', currentInternalValue: 49, proposedNewValue: 100,
          externalPreviousValue: 50, requiresReview: true,
        }],
      });
      expect(applyReviewedDecision(stale, caseContext(), authorizationCommandFor(stale)))
        .toMatchObject({ applied: false, reason: 'STALE_PROPOSAL' });
    });

    it('requires exactly one explicit review and rolls back all changes when one is invalid', () => {
      const bridge = caseAuthorizationProposal({ proposedAuthorizationChanges: [
        { field: 'maxSubstituteQuantity', currentInternalValue: 50, proposedNewValue: 100, requiresReview: true },
        { field: 'maxAbsorbableAdditionalCost', currentInternalValue: 0, proposedNewValue: -1, requiresReview: true },
      ] });
      const ctx = caseContext();
      const result = applyReviewedDecision(bridge, ctx, authorizationCommandFor(bridge, { authorizationReviews: [
        { field: 'maxSubstituteQuantity', action: 'APPLY' },
        { field: 'maxAbsorbableAdditionalCost', action: 'APPLY' },
      ] }));
      expect(result).toMatchObject({ applied: false, reason: 'AUTHORIZATION_VALIDATION_FAILED' });
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
      expect(applyReviewedDecision(bridge, caseContext(), authorizationCommandFor(bridge)))
        .toMatchObject({ applied: false, reason });
    });

    it('DISCARD and adulterated PENDING do not modify the case or history', () => {
      const ctx = caseContext();
      const bridge = caseAuthorizationProposal() as Extract<DecisionBridgeResult, { ready: true }>;
      const discard = applyReviewedDecision(bridge, ctx, {
        action: 'DISCARD', operationId: 'OP-DISCARD', reviewedBy: 'reviewer',
        reviewedAt: '2026-08-04T10:05:00-05:00',
        reviewTarget: bridge.reviewTarget,
      });
      const pendingBridge = caseAuthorizationProposal({ decision: 'PENDING' as never });
      const pending = applyReviewedDecision(pendingBridge, ctx, authorizationCommandFor(pendingBridge));
      expect(discard).toMatchObject({ applied: false, reason: 'DISCARDED_BY_REVIEWER' });
      expect(pending).toMatchObject({ applied: false, reason: 'REVIEW_PROPOSAL_BINDING_INVALID' });
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

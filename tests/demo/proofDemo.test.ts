import { describe, expect, it } from 'vitest';
import { prepareProof, reviewProof, createProofInputs, proofReceivedAt, proofReviewedAt } from '../../src/demo/proofDemo.js';
import { createDecisionTraceView, operationEffects, presentAttempt } from '../../src/presentation/decisionTraceViewModel.js';
import { compareIsoInstants } from '../../src/domain/dateTime.js';
import { createReadyDecisionBridgeResult, reviewTargetsEqual } from '../../src/integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../../src/integrations/calle/decisionApplication.js';
import { executeOrchestrationAction, type OrchestrationResult } from '../../src/application/adaptiveOrchestrator.js';

describe('Proof UX shared public-contract adapter', () => {
  it('H02 assembles and registers but performs no application before review', () => {
    const session = prepareProof('H02');
    expect(session.assembly.status).toBe('ACCEPTED');
    expect(session.registration).toMatchObject({ accepted: true, step: { assessment: { planAssessment: { outcome: 'PLAN_VALID' } } } });
    expect(session.bridge).toMatchObject({ ready: true, proposal: { decision: 'APPROVED', proposedAuthorizationChanges: [] } });
    expect(session.attempts).toEqual([]);
    expect(session.state).toMatchObject({ approvals: [], operationHistory: [], events: [] });
    expect(session.state?.plans).toHaveLength(1);
    const view = createDecisionTraceView(session);
    expect(view.canReview).toBe(true);
    expect(view.assessments).toBeUndefined();
    expect(view.outcome.label).toBe('WAIT');
    expect(view.effects).toBeUndefined();
  });

  it('H02 APPLY binds the displayed target and reaches the real physical block without effects', () => {
    const before = prepareProof('H02');
    const snapshot = structuredClone(before);
    const after = reviewProof(before, 'APPLY');
    const attempt = after.attempts[0]!;
    expect(attempt.result).toMatchObject({ accepted: false, failure: { source: 'DECISION_APPLICATION', reason: 'PLAN_PHYSICALLY_INFEASIBLE', issues: ['SUBSTITUTE_SUPPLY_EXCEEDED'] } });
    expect(attempt.before).toBe(before.state);
    expect(attempt.result.state).toBe(before.state);
    expect(before).toEqual(snapshot);
    if (!before.bridge?.ready) throw new Error('Bridge required');
    expect(attempt.review.reviewTarget).toBe(before.bridge.reviewTarget);
    expect(reviewTargetsEqual(attempt.review.reviewTarget, before.bridge.reviewTarget)).toBe(true);
    expect(after.state?.plans[0]?.status).toBe('PENDING_APPROVAL');
    expect(after.state?.exceptionCase).toBe(before.state?.exceptionCase);
    const view = createDecisionTraceView(after);
    expect(view.outcome.label).toBe('BLOCK');
    expect(view.effects).toEqual({ decisions: [], operations: [], events: [], approvedCount: 0, rejectedCount: 0, sameState: true,
      stateEvidence: 'Authoritative broker state unchanged for this attempt (same state reference).', previous: { decisions: 0, operations: 0, events: 0 } });
    expect(view.assessments?.formal).toEqual({ valid: true, violations: [] });
    expect(view.assessments?.physical).toMatchObject({ outcome: 'PHYSICALLY_INFEASIBLE', violations: [{ code: 'SUBSTITUTE_SUPPLY_EXCEEDED', requiredQuantity: 150, availableQuantity: 100 }] });
    expect(view.assessments?.substituteAuthorized).toBe(180);
  });

  it('H01 requires three explicit exact-version reviews before local lineage resolution', () => {
    let session = prepareProof('H01');
    expect(session.state?.approvals).toHaveLength(0);
    for (const role of ['client', 'production', 'supplier']) {
      expect(session.bridge).toMatchObject({ ready: true, proposal: { actorRole: role } });
      const prior = session;
      session = reviewProof(session, 'APPLY');
      expect(session.state?.approvals.length).toBe((prior.state?.approvals.length ?? 0) + 1);
      expect(createDecisionTraceView(session).outcome.label).toBe(role === 'supplier' ? 'ALLOW' : 'WAIT');
    }
    expect(session.state?.approvals.map(({ actorRole }) => actorRole)).toEqual(['client', 'production', 'supplier']);
    expect(session.state?.approvals.every(({ planId }) => planId === session.inputs.plan.id)).toBe(true);
    expect(session.state?.plans[0]?.status).toBe('APPROVED');
    expect(session.state?.plans).toHaveLength(1);
    expect(session.state?.events.map(({ result }) => result)).toEqual(['APPROVAL_RECORDED', 'APPROVAL_RECORDED', 'PLAN_APPROVED']);
    expect(session.attempts.at(-1)?.result).toMatchObject({ accepted: true, disposition: { type: 'LINEAGE_RESOLVED', scope: { caseId: session.inputs.baseline.caseId, planId: session.inputs.plan.id, lineageId: session.inputs.lineageId } } });
    expect(createDecisionTraceView(session).effects).toMatchObject({ approvedCount: 1, rejectedCount: 0, previous: { decisions: 2, operations: 2, events: 2 } });
    expect(createDecisionTraceView(session).effects?.decisions).toHaveLength(1);
    expect(reviewProof(session, 'APPLY')).toBe(session);
  });

  it('H01 and H02 have equivalent nonphysical facts but no shared state', () => {
    const h01 = prepareProof('H01');
    const h02 = prepareProof('H02');
    expect(h01.inputs.evidence.slice(0, 2).map(({ payload }) => payload)).toEqual(h02.inputs.evidence.slice(0, 2).map(({ payload }) => payload));
    expect(h01.inputs.effectiveAt).toBe(h02.inputs.effectiveAt);
    expect(h01.inputs.authorityPolicy.authorities).toEqual(h02.inputs.authorityPolicy.authorities);
    expect(h01.inputs.baseline.actors.map(({ actorId: _, ...actor }) => actor)).toEqual(h02.inputs.baseline.actors.map(({ actorId: _, ...actor }) => actor));
    const { id: _id1, caseId: _case1, ...plan1 } = h01.inputs.plan;
    const { id: _id2, caseId: _case2, ...plan2 } = h02.inputs.plan;
    expect(plan1).toEqual(plan2);
    expect(h01.state).not.toBe(h02.state);
    reviewProof(h01, 'APPLY');
    expect(h02.state?.approvals).toEqual([]);
    expect(Object.isFrozen(h01.inputs.evidence)).toBe(true);
    expect(Object.isFrozen(h01.state?.exceptionCase.actors)).toBe(true);
  });

  it('H03 stops at conflict without a case, registration, proposal, or application', () => {
    const session = prepareProof('H03');
    expect(session.assembly).toMatchObject({ status: 'CONFLICTING_EVIDENCE', issues: [{ code: 'AUTHORITATIVE_CLAIMS_CONFLICT', factKind: 'PHYSICAL_SUPPLY' }] });
    expect('exceptionCase' in session.assembly).toBe(false);
    expect('provenance' in session.assembly).toBe(false);
    expect(session.state).toBeUndefined();
    expect(session.registration).toBeUndefined();
    expect(session.bridge).toBeUndefined();
    expect(reviewProof(session, 'APPLY')).toBe(session);
    expect(session.attempts).toEqual([]);
    const view = createDecisionTraceView(session);
    expect(view.facts.every(({ trusted }) => !trusted)).toBe(true);
    expect(view.facts.filter(({ factKind }) => factKind === 'PHYSICAL_SUPPLY').map(({ value }) => value)).toEqual(['350 original + 150 substitute units', '350 original + 100 substitute units']);
    expect(view.outcome.label).toBe('WAIT');
    expect(view.assessments).toBeUndefined();
  });

  it('DISCARD reaches the existing bound review path and changes nothing', () => {
    const before = prepareProof('H02');
    const after = reviewProof(before, 'DISCARD');
    expect(after.attempts[0]?.result).toMatchObject({ accepted: false, failure: { reason: 'DISCARDED_BY_REVIEWER' } });
    expect(after.state).toBe(before.state);
    expect(createDecisionTraceView(after).outcome.title).toBe('Proposal discarded by reviewer');
    expect(reviewProof(after, 'APPLY')).toBe(after);
  });

  it('F-04 still rejects a changed proposal with the original displayed target', () => {
    const session = prepareProof('H01');
    if (!session.bridge?.ready) throw new Error('Bridge required');
    const changed = { ...session, bridge: { ...session.bridge, proposal: { ...session.bridge.proposal, summary: 'Different proposal' } } };
    const result = reviewProof(changed, 'APPLY');
    expect(result.attempts[0]?.result).toMatchObject({ accepted: false, failure: { reason: 'REVIEW_PROPOSAL_BINDING_INVALID', issues: ['MISMATCH'] } });
    expect(result.state).toBe(session.state);
  });

  it('review chronology and complete preparation are deterministic without a clock', () => {
    expect(compareIsoInstants(proofReviewedAt, proofReceivedAt)).toEqual({ valid: true, order: 1 });
    expect(prepareProof('H02')).toEqual(prepareProof('H02'));
    expect(reviewProof(prepareProof('H01'), 'APPLY')).toEqual(reviewProof(prepareProof('H01'), 'APPLY'));
    expect(createProofInputs('H01')).toEqual(createProofInputs('H01'));
  });

  it('discard after a prior approval reports no NEW effects, not globally empty history', () => {
    const prior = reviewProof(prepareProof('H01'), 'APPLY');
    const discarded = reviewProof(prior, 'DISCARD');
    expect(discarded.state?.approvals).toHaveLength(1);
    expect(createDecisionTraceView(discarded).effects).toEqual({ decisions: [], operations: [], events: [], approvedCount: 0, rejectedCount: 0, sameState: true,
      stateEvidence: 'Authoritative broker state unchanged for this attempt (same state reference).', previous: { decisions: 1, operations: 1, events: 1 } });
    expect(operationEffects(prior.state!, prior.state!).sameState).toBe(true);
  });

  it('unknown failures and registration success never imply ALLOW or business safety BLOCK', () => {
    const session = prepareProof('H01');
    const unknown: OrchestrationResult = { accepted: false, state: session.state!, failure: { source: 'STATE', reason: 'UNRECOGNIZED_TECHNICAL_FAILURE' } };
    expect(presentAttempt(unknown, session.inputs.plan.id)).toEqual({ label: 'WAIT', title: 'Attempt not accepted — inspect the technical result', reason: 'UNRECOGNIZED_TECHNICAL_FAILURE' });
    expect(presentAttempt(session.registration!, session.inputs.plan.id).label).toBe('WAIT');
  });

  it('a real rejected decision is counted as REJECTED, not APPROVED, and retains its resolution', () => {
    const session = prepareProof('H01');
    if (!session.bridge?.ready) throw new Error('Bridge required');
    const rejected = reviewProof({ ...session, bridge: createReadyDecisionBridgeResult({ ...session.bridge.proposal, decision: 'REJECTED' }) }, 'APPLY');
    const view = createDecisionTraceView(rejected);
    expect(rejected.attempts[0]?.result).toMatchObject({ accepted: true, step: { applicationResolutionStatus: 'PLAN_REJECTED' } });
    expect(view.outcome).toEqual({ label: 'WAIT', title: 'Decision recorded as REJECTED — recovery not authorized', reason: 'PLAN_REJECTED' });
    expect(view.effects?.decisions).toHaveLength(1);
    expect(view.effects?.decisions[0]?.decision).toBe('REJECTED');
    expect(view.effects).toMatchObject({ approvedCount: 0, rejectedCount: 1 });
    expect(view.effects?.operations).toHaveLength(1);
    expect(view.effects?.events[0]?.result).toBe('REJECTION_RECORDED');
  });

  it('a real authorization-only operation preserves its specific nonfinal explanation', () => {
    const session = prepareProof('H01');
    if (!session.bridge?.ready || !session.state) throw new Error('Prepared state required');
    const { planId: _, ...base } = session.bridge.proposal as Extract<typeof session.bridge.proposal, { operationType: 'PLAN_DECISION' }>;
    const bridge = createReadyDecisionBridgeResult({ ...base, operationType: 'CASE_AUTHORIZATION', proposedAuthorizationChanges: [
      { field: 'maxSubstituteQuantity', currentInternalValue: 180, proposedNewValue: 190, requiresReview: true },
    ] });
    const result = executeOrchestrationAction(session.state, { type: 'APPLY_REVIEWED_DECISION', bridgeResult: bridge, review: bindReviewCommand({
      action: 'APPLY', operationId: 'PROOF-TEST-AUTH', eventId: 'PROOF-TEST-AUTH-EVENT', reviewedBy: 'PROOF-TEST-REVIEWER', reviewedAt: proofReviewedAt,
      authorizationReviews: [{ field: 'maxSubstituteQuantity', action: 'APPLY' }],
    }, bridge.reviewTarget) });
    expect(result).toMatchObject({ accepted: true, step: { applicationResolutionStatus: 'CASE_AUTHORIZATION_APPLIED' } });
    expect(presentAttempt(result, session.inputs.plan.id)).toEqual({ label: 'WAIT', title: 'Authorization change recorded — further explicit action required', reason: 'CASE_AUTHORIZATION_APPLIED' });
    const effects = operationEffects(session.state, result.state);
    expect(effects.decisions).toEqual([]);
    expect(effects.operations).toHaveLength(1);
    expect(effects.events).toHaveLength(1);
    expect(effects.stateEvidence).toBe('New local records were recorded by this attempt; see the record counts and result.');
  });

  it.each(['clone', 'reordered'] as const)('%s state does not establish a semantic mutation from reference inequality', (kind) => {
    const first = reviewProof(prepareProof('H01'), 'APPLY');
    const state = reviewProof(first, 'APPLY').state!;
    const after = kind === 'clone' ? structuredClone(state) : { ...state,
      approvals: [...state.approvals].reverse(), operationHistory: [...state.operationHistory].reverse(), events: [...state.events].reverse(),
    };
    const effects = operationEffects(state, after);
    expect(effects).toEqual({ decisions: [], operations: [], events: [], approvedCount: 0, rejectedCount: 0, sameState: false,
      stateEvidence: 'No new decision, operation or event records detected. A different state reference alone does not establish a business change.',
      previous: { decisions: 2, operations: 2, events: 2 },
    });
    expect(effects.stateEvidence).not.toContain('state changed');
  });
});

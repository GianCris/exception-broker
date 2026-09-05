import type { OrchestrationResult, OrchestrationState } from '../application/adaptiveOrchestrator.js';
import { assessPhysicalFeasibility } from '../domain/physicalFeasibility.js';
import { validatePlanDecisionFreshness } from '../domain/planLineage.js';
import { validatePlan } from '../domain/validator.js';
import { proofReceivedAt, proofReviewedAt, proofReviewer, type ProofSession } from '../demo/proofDemo.js';

export const operationEffects = (before: OrchestrationState, after: OrchestrationState) => {
  const decisions = after.approvals.filter((value) => !before.approvals.some((prior) => prior.approvalId === value.approvalId));
  const operations = after.operationHistory.filter((value) => !before.operationHistory.some((prior) => prior.operationId === value.operationId));
  const events = after.events.filter((value) => !before.events.some((prior) => prior.eventId === value.eventId));
  return {
    decisions, operations, events,
    approvedCount: decisions.filter(({ decision }) => decision === 'APPROVED').length,
    rejectedCount: decisions.filter(({ decision }) => decision === 'REJECTED').length,
    sameState: before === after,
    stateEvidence: before === after
      ? 'Authoritative broker state unchanged for this attempt (same state reference).'
      : decisions.length + operations.length + events.length > 0
        ? 'New local records were recorded by this attempt; see the record counts and result.'
        : 'No new decision, operation or event records detected. A different state reference alone does not establish a business change.',
    previous: { decisions: before.approvals.length, operations: before.operationHistory.length, events: before.events.length },
  };
};

// Labels interpret existing results; they never authorize an action or replace a safety check.
export const presentAttempt = (result: OrchestrationResult, planId: string) => {
  if (!result.accepted) {
    if (result.failure.reason === 'PLAN_PHYSICALLY_INFEASIBLE') return { label: 'BLOCK', title: 'Physical supply cannot support this approval', reason: result.failure.reason } as const;
    if (['PLAN_SUPERSEDED', 'STALE_PROPOSAL', 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW'].includes(result.failure.reason)) return { label: 'BLOCK', title: 'This proposed action is not applicable', reason: result.failure.reason } as const;
    if (result.failure.reason === 'DISCARDED_BY_REVIEWER') return { label: 'WAIT', title: 'Proposal discarded by reviewer', reason: result.failure.reason } as const;
    if (['NEEDS_CLARIFICATION', 'PHYSICAL_FEASIBILITY_UNPROVEN'].includes(result.failure.reason)) return { label: 'WAIT', title: 'Additional decision or evidence required', reason: result.failure.reason } as const;
    return { label: 'WAIT', title: 'Attempt not accepted — inspect the technical result', reason: result.failure.reason } as const;
  }
  const disposition = result.disposition;
  if (disposition.type === 'LINEAGE_RESOLVED' && disposition.scope.planId === planId
    && disposition.scope.caseId === result.state.exceptionCase.id
    && result.state.plans.some((plan) => plan.id === planId && plan.status === 'APPROVED')) {
    return { label: 'ALLOW', title: 'Recovery authorized locally', reason: 'LINEAGE_RESOLVED' } as const;
  }
  if (result.step.actionType === 'APPLY_REVIEWED_DECISION') {
    const resolution = result.step.applicationResolutionStatus;
    if (resolution === 'PLAN_REJECTED') return { label: 'WAIT', title: 'Decision recorded as REJECTED — recovery not authorized', reason: resolution } as const;
    if (resolution === 'CASE_AUTHORIZATION_APPLIED') return { label: 'WAIT', title: 'Authorization change recorded — further explicit action required', reason: resolution } as const;
    if (resolution === 'PENDING_APPROVALS') return { label: 'WAIT', title: 'Decision recorded — further approvals required', reason: resolution } as const;
    return { label: 'WAIT', title: 'Further explicit action required', reason: resolution } as const;
  }
  return { label: 'WAIT', title: 'Further explicit action required', reason: result.step.result } as const;
};

export const createDecisionTraceView = (session: ProofSession) => {
  const { inputs, assembly } = session;
  const latest = session.attempts.at(-1);
  const targetPlan = session.state?.plans.find((plan) => plan.id === inputs.plan.id);
  const outcome = latest !== undefined ? presentAttempt(latest.result, inputs.plan.id)
    : assembly.status !== 'ACCEPTED' ? { label: 'WAIT', title: 'Trusted operational state cannot be established', reason: assembly.status } as const
    : session.registration?.accepted === false ? { label: 'WAIT', title: 'Preparation stopped — inspect the technical result', reason: session.registration.failure.reason } as const
    : session.bridge?.ready === false ? { label: 'WAIT', title: 'Proposal unavailable for review', reason: session.bridge.reason } as const
    : { label: 'WAIT', title: 'Your explicit review is required', reason: 'No decision application attempted' } as const;
  const facts = inputs.evidence.map((evidence) => {
    const trusted = assembly.status === 'ACCEPTED' && assembly.provenance[evidence.factKind].some((reference) => reference.evidenceId === evidence.evidenceId && reference.sourceId === evidence.sourceId);
    const value = evidence.factKind === 'COMMERCIAL_ORDER' ? `${evidence.payload.requestedQuantity} units ordered`
      : evidence.factKind === 'CLIENT_AUTHORIZATION' ? `${evidence.payload.authorization.maxSubstituteQuantity} substitutes authorized`
      : evidence.payload.supplies.map((supply) => `${supply.originalQuantity} original + ${supply.substituteQuantity} substitute units`).join('; ');
    return { ...evidence, value, trusted, authority: inputs.authorityPolicy.authorities[evidence.factKind],
      label: evidence.factKind === 'COMMERCIAL_ORDER' ? 'Order' : evidence.factKind === 'CLIENT_AUTHORIZATION' ? 'Client authorization' : 'Physical supply' };
  });
  const assessedPlan = latest?.before.plans.find((plan) => plan.id === inputs.plan.id);
  // Supporting read-only assessments of the PRE-ATTEMPT snapshot, not a gate execution log.
  const assessments = latest !== undefined && assessedPlan !== undefined ? {
    formal: validatePlan(latest.before.exceptionCase, assessedPlan),
    physical: assessPhysicalFeasibility(latest.before.exceptionCase, assessedPlan),
    currentness: validatePlanDecisionFreshness(latest.before.planLineages, latest.before.plans, inputs.baseline.caseId, assessedPlan.id),
    substituteRequired: assessedPlan.substituteQuantityTomorrow,
    substituteAuthorized: latest.before.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity,
  } : undefined;
  return {
    scenario: inputs.scenario, outcome, facts, assemblyStatus: assembly.status,
    assemblyIssues: assembly.status === 'ACCEPTED' ? [] : assembly.issues,
    effectiveAt: inputs.effectiveAt, deliveryAt: inputs.evidence.find((evidence) => evidence.factKind === 'COMMERCIAL_ORDER')?.payload.targetDeliveryDate,
    plan: inputs.plan, planStatus: targetPlan?.status, trustedCaseProduced: assembly.status === 'ACCEPTED', registered: session.registration?.accepted === true,
    proposal: session.bridge?.ready ? session.bridge.proposal : undefined,
    reviewTarget: session.bridge?.ready ? session.bridge.reviewTarget : undefined,
    canReview: !session.stopped && session.bridge?.ready === true && session.state !== undefined,
    reviewer: proofReviewer, reviewedAt: proofReviewedAt, receivedAt: proofReceivedAt,
    assessments, latest, attempts: session.attempts,
    effects: latest === undefined ? undefined : operationEffects(latest.before, latest.result.state),
    scope: latest?.result.accepted && latest.result.disposition.type === 'LINEAGE_RESOLVED' ? latest.result.disposition.scope : undefined,
  };
};
export type DecisionTraceView = ReturnType<typeof createDecisionTraceView>;

// Product-control labels are presentation-only projections of the current session snapshot.
export const createDecisionControlView = (session: ProofSession) => {
  const view = createDecisionTraceView(session);
  const latest = view.latest;
  const authority = !view.trustedCaseProduced ? 'NOT REACHED'
    : view.canReview ? 'EXACT REVIEW REQUIRED'
    : latest?.review.action === 'DISCARD' ? 'REVIEW DISCARDED'
    : latest !== undefined ? 'REVIEW SUBMITTED'
    : 'NOT AVAILABLE';
  const operationalTruth = !view.trustedCaseProduced ? 'UNPROVEN — trusted snapshot not assembled'
    : latest === undefined ? 'Not evaluated for application'
    : view.assessments?.physical.outcome ?? 'Not established for this attempt';
  const disposition = latest !== undefined || !view.trustedCaseProduced ? view.outcome.label : 'NOT RESOLVED';
  const why = !view.trustedCaseProduced ? view.outcome.title
    : latest !== undefined ? view.outcome.title
    : 'A normalized decision is ready, but exact review has not been submitted.';
  const nextAction = view.canReview ? 'Review exact proposal'
    : !view.trustedCaseProduced ? 'Resolve evidence outside this local proof'
    : latest === undefined ? 'No review is currently available'
    : 'Inspect the application result';
  return { view, decision: view.proposal?.decision ?? 'NO REVIEWABLE DECISION', authority,
    operationalTruth, disposition, why, nextAction,
    provenance: view.trustedCaseProduced ? 'Deterministic local proof · configured evidence' : 'Deterministic local proof · unaccepted claims' };
};

// Provenance: operator-observed historical results recorded in
// docs/evidence/call-e-live-validation.md. Read-only; never current browser state.
export const historicalCallProof = {
  source: 'Operator-observed historical output recorded in docs/evidence/call-e-live-validation.md. No original recording is bundled.',
  runs: [
    { name: 'Operator Run 1 · OPERATOR-LIVE-V1', observation: 'Real CALL-E interaction completed. Structured NEEDS_CLARIFICATION; mapper and Bridge accepted.', limit: 'Clarification safe-stop. Zero new local effects.' },
    { name: 'Operator Run 2 · OPERATOR-LIVE-V2', observation: 'Real CALL-E interaction completed. Structured APPROVED; exact proposal displayed; operator selected APPLY.', limit: 'Local sandbox ALLOW / LINEAGE_RESOLVED and local records only. No external execution.' },
  ],
  unproven: 'Live REJECTED application, authenticated reviewer identity, and external execution: NOT DEMONSTRATED.',
} as const;

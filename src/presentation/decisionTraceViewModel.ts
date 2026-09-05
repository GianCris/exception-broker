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
    if (result.failure.reason === 'DISCARDED_BY_REVIEWER') return { label: 'DISCARDED', title: 'Proposal discarded by reviewer', reason: result.failure.reason } as const;
    if (['NEEDS_CLARIFICATION', 'PHYSICAL_FEASIBILITY_UNPROVEN'].includes(result.failure.reason)) return { label: 'WAIT', title: 'Additional decision or evidence required', reason: result.failure.reason } as const;
    return { label: 'TECHNICAL STOP', title: 'Attempt stopped by an unclassified technical result', reason: result.failure.reason } as const;
  }
  const disposition = result.disposition;
  if (disposition.type === 'LINEAGE_RESOLVED' && disposition.scope.planId === planId
    && disposition.scope.caseId === result.state.exceptionCase.id
    && result.state.plans.some((plan) => plan.id === planId && plan.status === 'APPROVED')) {
    return { label: 'ALLOW', title: 'Recovery authorized locally', reason: 'LINEAGE_RESOLVED' } as const;
  }
  if (result.step.actionType === 'APPLY_REVIEWED_DECISION') {
    const resolution = result.step.applicationResolutionStatus;
    if (resolution === 'PLAN_REJECTED') return { label: 'REJECTED', title: 'Decision recorded as REJECTED — recovery not authorized', reason: resolution } as const;
    if (resolution === 'CASE_AUTHORIZATION_APPLIED') return { label: 'WAIT', title: 'Authorization change recorded — further explicit action required', reason: resolution } as const;
    if (resolution === 'PENDING_APPROVALS') return { label: 'WAIT', title: 'Decision recorded — further approvals required', reason: resolution } as const;
    if (resolution === 'PLAN_APPROVED') return { label: 'TECHNICAL STOP', title: 'Resolved application result is internally inconsistent', reason: resolution } as const;
  }
  return { label: 'WAIT', title: 'Further explicit action required', reason: result.step.result } as const;
};

export const createDecisionTraceView = (session: ProofSession) => {
  const { inputs, assembly } = session;
  const latest = session.attempts.at(-1);
  const targetPlan = session.state?.plans.find((plan) => plan.id === inputs.plan.id);
  const outcome = latest !== undefined ? presentAttempt(latest.result, inputs.plan.id)
    : assembly.status !== 'ACCEPTED' ? { label: 'WAIT', title: 'Trusted operational state cannot be established', reason: assembly.status } as const
    : session.registration?.accepted === false ? { label: 'TECHNICAL STOP', title: 'Preparation stopped — inspect the technical result', reason: session.registration.failure.reason } as const
    : session.bridge?.ready === false ? { label: 'TECHNICAL STOP', title: 'Proposal unavailable for review', reason: session.bridge.reason } as const
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
  const physicalTruth = view.assessments?.physical.outcome;
  const operationalTruth = !view.trustedCaseProduced ? 'UNPROVEN — trusted snapshot not assembled'
    : latest === undefined ? 'Not evaluated for application'
    : latest.review.action === 'DISCARD' ? 'Not evaluated for application'
    : physicalTruth === 'PHYSICALLY_FEASIBLE' ? 'Modeled supply snapshot is sufficient'
    : physicalTruth === 'PHYSICALLY_INFEASIBLE' ? 'Modeled supply snapshot is insufficient'
    : physicalTruth === 'PHYSICAL_FEASIBILITY_UNPROVEN' ? 'Modeled supply snapshot is unresolved'
    : 'Not established for this attempt';
  const hasPresentedOutcome = latest !== undefined || !view.trustedCaseProduced
    || session.registration?.accepted === false || session.bridge?.ready === false;
  const disposition = hasPresentedOutcome ? view.outcome.label : 'NOT RESOLVED';
  const physicalViolation = view.assessments?.physical.outcome === 'PHYSICALLY_INFEASIBLE'
    ? view.assessments.physical.violations.find(({ quantityType }) => quantityType === 'SUBSTITUTE')
    : undefined;
  const unsupportedQuantity = physicalViolation?.requiredQuantity !== undefined && physicalViolation.availableQuantity !== undefined
    ? physicalViolation.requiredQuantity - physicalViolation.availableQuantity : undefined;
  const physicalBlock = disposition === 'BLOCK' && physicalViolation !== undefined;
  const evidenceConflict = !view.trustedCaseProduced && view.assemblyStatus === 'CONFLICTING_EVIDENCE';
  const physicalEvidenceConflict = evidenceConflict && view.assemblyIssues.some(({ factKind }) => factKind === 'PHYSICAL_SUPPLY');
  const why = physicalBlock
    ? `The proposal requires ${physicalViolation.requiredQuantity} substitute units, but trusted supply contains only ${physicalViolation.availableQuantity}; ${unsupportedQuantity} units are unsupported.`
    : physicalEvidenceConflict ? 'Conflicting physical-supply claims prevent a trusted operational state from being established.'
    : evidenceConflict ? 'Conflicting authoritative claims prevent a trusted operational state from being established.'
    : disposition === 'ALLOW' ? 'The exact reviewed proposal is current, formally valid, physically feasible, and has the required approvals in this local snapshot.'
    : disposition === 'REJECTED' ? 'The represented decision rejected the proposal; the Broker did not block an approved decision.'
    : disposition === 'DISCARDED' ? 'The reviewer chose not to submit this exact proposal for application.'
    : disposition === 'TECHNICAL STOP' ? 'The result has no recognized operational disposition; inspect the technical details.'
    : !view.trustedCaseProduced ? view.outcome.title
    : latest !== undefined ? view.outcome.title
    : 'A normalized decision is ready, but exact review has not been submitted.';
  const nextAction = view.canReview ? 'Review exact proposal'
    : physicalBlock ? 'Resolve the supply gap externally or revise the proposal'
    : physicalEvidenceConflict ? 'Resolve the conflicting supply evidence'
    : evidenceConflict ? 'Resolve the conflicting evidence'
    : disposition === 'ALLOW' ? 'Inspect the local application effects'
    : disposition === 'REJECTED' ? 'Return to the queue or review another decision'
    : disposition === 'DISCARDED' ? 'Return to the queue or review another decision'
    : disposition === 'TECHNICAL STOP' ? 'Inspect the technical result'
    : !view.trustedCaseProduced ? 'Resolve evidence outside this local proof'
    : latest === undefined ? 'No review is currently available'
    : 'Inspect the application result';
  const factors = physicalBlock ? [
    ...(view.assessments?.substituteAuthorized === undefined ? [] : [{ label: 'Client authority', value: `Up to ${view.assessments.substituteAuthorized} substitute units` }]),
    { label: 'Proposal', value: `${physicalViolation.requiredQuantity} substitute units required` },
    { label: 'Operational truth', value: `${physicalViolation.availableQuantity} substitute units available` },
    { label: 'Difference', value: `${unsupportedQuantity} substitute units unsupported` },
  ] : evidenceConflict ? [{ label: 'Unresolved fact', value: physicalEvidenceConflict ? 'Authoritative physical-supply claims conflict' : 'Authoritative evidence claims conflict' }]
    : disposition === 'ALLOW' ? [
      { label: 'Exact review', value: `${latest?.review.reviewTarget.actorRole} decision bound to this proposal` },
      { label: 'Formal snapshot', value: view.assessments?.formal.valid ? 'Formally valid' : 'Not established' },
      { label: 'Physical snapshot', value: view.assessments?.physical.outcome === 'PHYSICALLY_FEASIBLE' ? 'Required modeled supply is available' : 'Not established' },
      { label: 'Exact version', value: view.assessments?.currentness.valid ? `Version ${view.plan.version} current in lineage` : 'Not established' },
      { label: 'Required approvals', value: view.planStatus === 'APPROVED' ? 'Complete for this exact plan' : 'Not established' },
    ] : [];
  const effectSummary = view.effects === undefined ? undefined
    : view.effects.decisions.length + view.effects.operations.length + view.effects.events.length === 0
      ? disposition === 'BLOCK' ? 'Application stopped. No application effects created.' : 'No new local decision, operation, or event records were created.'
      : `${view.effects.decisions.length} decision, ${view.effects.operations.length} operation, and ${view.effects.events.length} event record created locally. No external execution.`;
  return { view, decision: view.proposal?.decision ?? 'NO REVIEWABLE DECISION', authority,
    operationalTruth, disposition, why, nextAction, factors, effectSummary,
    provenance: view.trustedCaseProduced ? 'Deterministic local proof · configured evidence' : 'Deterministic local proof · unaccepted claims' };
};

type ReviewAction = 'APPLY' | 'DISCARD';

const authorityContext = (session: ProofSession, action?: ReviewAction) => {
  const view = createDecisionTraceView(session);
  if (action === 'DISCARD' && view.latest) return `Review discarded · ${view.latest.review.reviewTarget.actorRole}`;
  if (view.canReview && view.proposal) return `Exact review required · ${view.proposal.actorRole}`;
  if (view.latest) return `Review submitted · ${view.latest.review.reviewTarget.actorRole}`;
  return createDecisionControlView(session).authority;
};

const proposalContext = (session: ProofSession) => {
  const proposal = createDecisionTraceView(session).proposal;
  if (!proposal) return 'No reviewable proposal';
  const plan = proposal.operationType === 'PLAN_DECISION' ? proposal.planId : 'Case authorization';
  return `${proposal.caseId} · ${plan} · ${proposal.requestId}`;
};

// Presentation-only comparison of an action's already-produced before/after snapshots.
// It never executes or replays a review.
export const createDecisionTransitionView = ({ beforeSession, afterSession, action }: Readonly<{
  beforeSession: ProofSession;
  afterSession: ProofSession;
  action: ReviewAction;
}>) => {
  const before = createDecisionControlView(beforeSession);
  const after = createDecisionControlView(afterSession);
  const latest = createDecisionTraceView(afterSession).latest;
  const effects = latest === undefined ? undefined : operationEffects(latest.before, latest.result.state);
  const actedDecision = before.view.proposal?.decision ?? before.decision;
  const beforeAuthority = authorityContext(beforeSession);
  const afterAuthority = authorityContext(afterSession, action);
  const beforeProposal = proposalContext(beforeSession);
  const afterProposal = after.view.canReview ? proposalContext(afterSession) : beforeProposal;
  const beforeOperationalTruth = action === 'DISCARD' ? 'Not evaluated for application' : before.operationalTruth;
  const afterOperationalTruth = action === 'DISCARD' ? 'Not evaluated for application' : after.operationalTruth;
  const comparison = [
    { label: 'Decision', before: actedDecision, after: actedDecision, meaning: 'UNCHANGED' },
    { label: 'Authority', before: beforeAuthority, after: afterAuthority, meaning: beforeAuthority === afterAuthority ? 'UNCHANGED' : 'CHANGED' },
    { label: 'Exact proposal', before: beforeProposal, after: afterProposal, meaning: beforeProposal === afterProposal ? 'UNCHANGED' : 'CHANGED' },
    { label: 'Operational Truth', before: beforeOperationalTruth, after: afterOperationalTruth,
      meaning: beforeOperationalTruth === afterOperationalTruth ? 'UNCHANGED' : beforeOperationalTruth === 'Not evaluated for application' ? 'ESTABLISHED BY THIS ATTEMPT' : 'CHANGED' },
    { label: 'Broker Disposition', before: before.disposition, after: after.disposition, meaning: before.disposition === after.disposition ? 'UNCHANGED' : 'CHANGED' },
  ] as const;
  const targetChanged = beforeAuthority !== afterAuthority && before.authority === after.authority;
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  const effectCount = effects === undefined ? 0 : effects.decisions.length + effects.operations.length + effects.events.length;
  const effectSentence = effectCount === 0
    ? 'No local application effects were created.'
    : `Local records created: ${effects!.decisions.length} decision, ${effects!.operations.length} operation, and ${effects!.events.length} event.`;
  const decisionSentence = `Decision stayed ${actedDecision}.`;
  const dispositionSentence = before.disposition === after.disposition
    ? `Broker disposition remains ${after.disposition}.`
    : `Broker disposition resolved to ${after.disposition}.`;
  const operationalSentence = beforeOperationalTruth === 'Not evaluated for application' && afterOperationalTruth === 'Modeled supply snapshot is insufficient'
    ? 'Application evaluation established that represented supply was insufficient.'
    : beforeOperationalTruth === 'Not evaluated for application' && afterOperationalTruth === 'Modeled supply snapshot is sufficient'
      ? 'Application evaluation established that represented supply was sufficient.'
      : undefined;
  const targetSentence = targetChanged
    ? `The next exact review target changed from ${capitalize(beforeAuthority.split(' · ').at(-1)!)} to ${capitalize(afterAuthority.split(' · ').at(-1)!)}.`
    : undefined;
  const submittedRole = capitalize(latest?.review.reviewTarget.actorRole ?? 'proposal');
  const summary = action === 'DISCARD'
    ? `The operator discarded the exact ${submittedRole} review. No Application Attempt occurred. No application evaluation occurred. ${effectSentence}`
    : [decisionSentence, operationalSentence, targetSentence ?? `The exact ${submittedRole} review was submitted.`, dispositionSentence, effectSentence].filter(Boolean).join(' ');
  return { action, summary, comparison, effects } as const;
};
export type DecisionTransitionView = ReturnType<typeof createDecisionTransitionView>;

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

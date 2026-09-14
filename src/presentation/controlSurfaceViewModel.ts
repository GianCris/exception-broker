import type { LiveControlPublicRecord } from '../control/contracts.js';
import type { ProofSession } from '../demo/proofDemo.js';
import { createDecisionControlView, createDecisionTraceView, type DecisionTraceView } from './decisionTraceViewModel.js';

// One reusable Control grammar: Decision → Review → Attempt → Reality → Disposition.
// Every field below is a projection of an already-produced result. Nothing here
// authorizes an action, executes anything, or invents an operational fact.

export type ControlTone = 'pending' | 'allow' | 'block' | 'wait' | 'neutral' | 'technical';
export type ControlBoundaryState = 'NOT ENGAGED' | 'EVALUATED' | 'NOT AVAILABLE';
export type ControlReviewState = 'REQUIRED' | 'COMPLETED' | 'DISCARDED' | 'UNAVAILABLE';

export type ControlDecision = Readonly<{
  label: string; state: string; note: string; available: boolean; sourceLabel: string; sourceDetail: string;
}>;
export type ControlReview = Readonly<{ state: ControlReviewState; label: string; detail: string }>;
export type ControlProposalLine = Readonly<{ label: string; value: string; total?: true }>;
export type ControlProposal = Readonly<{ title: string; lines: readonly ControlProposalLine[]; note: string }>;
export type ControlAttempt = Readonly<{ key: string; ordinal: number; label: string; detail: string; treatment: string }>;
export type ControlBoundary = Readonly<{ state: ControlBoundaryState; engaged: boolean; note: string }>;
export type ControlClaim = Readonly<{ key: string; sourceLabel: string; sourceDetail: string; value: string; unit: string; observedAt: string }>;
export type ControlContextFact = Readonly<{ key: string; label: string; value: string; note: string }>;
export type ControlReality =
  | Readonly<{ kind: 'NOT_EVALUATED'; headline: string; note: string }>
  | Readonly<{ kind: 'MEASURED'; headline: string; required: number; available: number; unit: string;
      authorization: string; causal: string; causalSupported: boolean }>
  | Readonly<{ kind: 'CONFLICTED'; headline: string; note: string; claims: readonly ControlClaim[] }>
  | Readonly<{ kind: 'CONTEXT'; headline: string; note: string; facts: readonly ControlContextFact[] }>;
export type ControlDisposition = Readonly<{
  label: string; tone: ControlTone; resolved: boolean; headline: string; code: string; supporting: string; effects?: string;
}>;
export type ControlTakeaway = Readonly<{ verdict: string; detail: string }>;
export type ControlSurfaceModel = Readonly<{
  answer: string;
  decision: ControlDecision;
  review: ControlReview;
  proposal?: ControlProposal;
  attempt?: ControlAttempt;
  boundary: ControlBoundary;
  reality: ControlReality;
  disposition: ControlDisposition;
  nextAction: string;
  nextActionNote: string;
  takeaway?: ControlTakeaway;
}>;

export const controlQuestion = 'Can this decision be applied safely now?';

export type ControlQueueItem = Readonly<{
  id: string; name: string; caseRef: string; state: string; tone: ControlTone; attention: string; fact?: string;
}>;

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
// Deterministic rendering of an already-supplied instant. No clock and no locale lookup.
export const controlDate = (instant: string | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(instant ?? '');
  if (match === null) return 'Not stated';
  const month = months[Number(match[2]) - 1];
  return month === undefined ? 'Not stated' : `${month} ${Number(match[3])}, ${match[1]}`;
};

const dispositionTone = (label: string): ControlTone =>
  label === 'ALLOW' ? 'allow'
  : label === 'BLOCK' ? 'block'
  : label === 'WAIT' ? 'wait'
  : label === 'TECHNICAL STOP' ? 'technical'
  : label === 'NOT RESOLVED' ? 'pending'
  : 'neutral';

const attemptTreatment = (label: string) =>
  label === 'ALLOW' ? 'complete'
  : label === 'BLOCK' ? 'interrupted'
  : label === 'WAIT' ? 'suspended'
  : label === 'TECHNICAL STOP' ? 'neutral-stopped'
  : 'neutral';

const trustedSupply = (view: DecisionTraceView) => {
  if (!view.trustedCaseProduced) return undefined;
  const fact = view.facts.filter((entry) => entry.factKind === 'PHYSICAL_SUPPLY').find((entry) => entry.trusted);
  return fact?.payload.supplies[0]?.substituteQuantity;
};
const authorizedSubstitutes = (view: DecisionTraceView) =>
  view.facts.find((entry) => entry.factKind === 'CLIENT_AUTHORIZATION')?.payload.authorization.maxSubstituteQuantity;

// The causal sentence a manager reads first: authority and physical supply are
// different facts, and either one can be the reason an application cannot proceed.
const causalSentence = (required: number, available: number, authorized: number | undefined) => {
  const authoritySufficient = authorized !== undefined && required <= authorized;
  const supplySufficient = required <= available;
  const causal = authoritySufficient && !supplySufficient ? 'Authority is sufficient. Physical supply is not.'
    : authoritySufficient && supplySufficient ? 'Authority is sufficient. Physical supply supports it.'
    : !authoritySufficient && supplySufficient ? 'Physical supply is sufficient. Authority is not.'
    : 'Neither authority nor physical supply supports this application.';
  return { causal, causalSupported: authoritySufficient && supplySufficient };
};

export const createControlSurfaceModel = (session: ProofSession): ControlSurfaceModel => {
  const control = createDecisionControlView(session);
  const view = createDecisionTraceView(session);
  const applied = view.attempts.filter((entry) => entry.review.action === 'APPLY');
  const latestApply = applied.at(-1);
  const discarded = view.latest?.review.action === 'DISCARD';
  const disposition = control.disposition;
  const tone = dispositionTone(disposition);
  const required = view.plan.substituteQuantityTomorrow;
  const available = trustedSupply(view);
  const authorized = authorizedSubstitutes(view);
  const conflictingClaims = view.trustedCaseProduced ? [] : view.facts.filter((entry) => entry.factKind === 'PHYSICAL_SUPPLY');
  const shortfall = available === undefined ? undefined : required - available;
  const decisionAvailable = view.proposal !== undefined || view.attempts.length > 0;

  const boundaryState: ControlBoundaryState = latestApply !== undefined ? 'EVALUATED'
    : view.canReview || discarded ? 'NOT ENGAGED'
    : 'NOT AVAILABLE';
  const reality: ControlReality = conflictingClaims.length > 1
    ? { kind: 'CONFLICTED', headline: 'Trusted operational truth not established.',
        note: 'Authoritative sources report different physical supply and cannot be reconciled here.',
        claims: conflictingClaims.map((claim, index) => ({
          key: claim.evidenceId, sourceLabel: `Source ${String.fromCharCode(65 + index)}`, sourceDetail: claim.sourceId,
          value: `${claim.payload.supplies[0]?.substituteQuantity ?? 0}`, unit: 'substitute units available', observedAt: claim.observedAt,
        })) }
    : latestApply !== undefined && available !== undefined
      ? { kind: 'MEASURED', headline: 'Evaluated against the controlled operational context.',
          required, available, unit: 'substitute units',
          authorization: authorized === undefined ? 'Not stated' : `Up to ${authorized} substitutes`,
          ...causalSentence(required, available, authorized) }
      : { kind: 'NOT_EVALUATED',
          headline: view.trustedCaseProduced ? 'Operational reality is evaluated after exact review.' : 'Operational reality cannot be established.',
          note: view.trustedCaseProduced
            ? 'Once the proposal is reviewed, the Broker checks the controlled operational context before any application attempt.'
            : 'No trusted operational state exists, so no application attempt is available.' };

  const dispositionHeadline = disposition === 'BLOCK' && shortfall !== undefined && shortfall > 0
      ? `${shortfall} required substitute units are unavailable.`
    : disposition === 'BLOCK' ? control.why
    : disposition === 'ALLOW' ? 'The reviewed decision can be applied within the controlled operational context.'
    : disposition === 'WAIT' && reality.kind === 'CONFLICTED' ? 'Conflicting physical-supply claims prevent a trusted operational state.'
    : disposition === 'WAIT' && latestApply !== undefined ? 'A further exact review is required before this decision can be applied.'
    : disposition === 'REJECTED' ? 'The represented decision rejected the proposal.'
    : disposition === 'DISCARDED' ? 'The reviewer did not submit this proposal for application.'
    : disposition === 'TECHNICAL STOP' ? 'The attempt produced no recognized operational disposition.'
    : control.why;

  const answer = reality.kind === 'CONFLICTED' ? 'Not yet. There is not enough trusted operational truth to attempt application.'
    : latestApply !== undefined ? 'The decision is fixed. The Broker evaluated this application attempt against the controlled operational context.'
    : discarded ? 'The reviewer closed this proposal. No application attempt was made.'
    : view.canReview ? 'The decision is fixed. Exact review is required before any application attempt.'
    : 'No application attempt is available for this decision.';

  const takeaway: ControlTakeaway | undefined =
      disposition === 'BLOCK' ? { verdict: 'APPROVED is not authority.', detail: 'A decision can be valid and still not be applicable when reality does not support it.' }
    : disposition === 'ALLOW' ? { verdict: 'ALLOW only when reviewed authority and reality align.', detail: 'Green is reserved for an application the Broker actually permits.' }
    : reality.kind === 'CONFLICTED' ? { verdict: 'WAIT for trusted operational truth.', detail: 'A decision can be applied only when source data is consistent and verified.' }
    : view.canReview ? { verdict: 'Exact review is required.', detail: 'The decision is fixed, but it must be reviewed before it can be applied.' }
    : undefined;

  const proposal: ControlProposal | undefined = view.trustedCaseProduced ? {
    title: view.canReview ? 'Review exact proposal' : 'Exact proposal reviewed',
    note: `Plan version ${view.plan.version} · ${view.plan.caseId} / ${view.plan.id}`,
    lines: [
      { label: 'Original units', value: `${view.plan.originalQuantityTomorrow}` },
      { label: 'Substitute units', value: `${view.plan.substituteQuantityTomorrow}` },
      { label: 'Total units', value: `${view.plan.originalQuantityTomorrow + view.plan.substituteQuantityTomorrow}`, total: true },
      { label: 'Additional client cost', value: `${view.plan.clientAdditionalCost} (demo cost units)` },
      { label: 'Client authorization', value: authorized === undefined ? 'Not stated' : `Up to ${authorized} substitutes` },
      { label: 'Target date', value: controlDate(view.deliveryAt) },
    ],
  } : undefined;

  return {
    answer,
    decision: decisionAvailable ? {
      label: control.decision, state: 'Decision fixed', note: 'Decision fixed and usable.', available: true,
      sourceLabel: 'Configured decision input', sourceDetail: 'Deterministic proof · not a CALL-E acquisition',
    } : {
      label: control.decision, state: 'Decision', note: 'No decision proposal was prepared for this case.', available: false,
      sourceLabel: 'Configured decision input', sourceDetail: 'Deterministic proof · not a CALL-E acquisition',
    },
    review: {
      state: view.canReview ? 'REQUIRED' : discarded ? 'DISCARDED' : latestApply !== undefined ? 'COMPLETED' : 'UNAVAILABLE',
      label: view.canReview ? 'Exact review required'
        : discarded ? 'Exact review discarded'
        : latestApply !== undefined ? 'Exact review completed'
        : 'Exact review not available',
      detail: view.canReview && view.proposal ? `Pending ${view.proposal.actorRole} review of this exact proposal.`
        : discarded ? 'The reviewer discarded this exact proposal.'
        : latestApply !== undefined ? 'You reviewed the complete proposal before it was applied.'
        : 'No reviewable proposal exists for this decision.',
    },
    ...(proposal === undefined ? {} : { proposal }),
    ...(latestApply === undefined ? {} : { attempt: {
      key: latestApply.review.operationId, ordinal: applied.length,
      label: `${latestApply.review.reviewTarget.actorRole} review applied`,
      detail: `Exact review bound · plan version ${view.plan.version}`,
      treatment: attemptTreatment(disposition),
    } }),
    boundary: {
      state: boundaryState, engaged: boundaryState === 'EVALUATED',
      note: boundaryState === 'EVALUATED' ? 'No external execution. This was a controlled evaluation.'
        : boundaryState === 'NOT AVAILABLE' ? 'No application attempt is available.'
        : 'No application attempt has been made.',
    },
    reality,
    disposition: {
      label: disposition, tone, resolved: disposition !== 'NOT RESOLVED',
      headline: dispositionHeadline, code: view.outcome.reason,
      supporting: latestApply === undefined
        ? 'No external execution occurred.'
        : 'No external execution. This was a controlled evaluation.',
      ...(control.effectSummary === undefined ? {} : { effects: control.effectSummary }),
    },
    nextAction: control.nextAction,
    nextActionNote: 'Applying does not execute. It asks the Broker whether this reviewed decision may be applied.',
    ...(takeaway === undefined ? {} : { takeaway }),
  };
};

// Attention lifecycle is not the Broker disposition: it says what this case needs next.
export const createControlQueueItem = (session: ProofSession, id: string, name: string, caseRef: string): ControlQueueItem => {
  const control = createDecisionControlView(session);
  const view = createDecisionTraceView(session);
  const model = createControlSurfaceModel(session);
  const disposition = control.disposition;
  const required = view.plan.substituteQuantityTomorrow;
  const available = trustedSupply(view);
  const shortfall = available === undefined ? undefined : required - available;
  const state = view.canReview ? control.decision : disposition;
  const attention = view.canReview ? 'Review required'
    : disposition === 'BLOCK' ? 'Application stopped'
    : disposition === 'ALLOW' ? 'Application permitted'
    : model.reality.kind === 'CONFLICTED' ? 'Trusted truth not established'
    : disposition === 'DISCARDED' ? 'Review closed'
    : disposition === 'REJECTED' ? 'Decision recorded'
    : disposition === 'TECHNICAL STOP' ? 'Attempt stopped'
    : 'Further action required';
  const fact = disposition === 'BLOCK' && shortfall !== undefined && shortfall > 0 ? `${shortfall} units short`
    : disposition === 'ALLOW' ? `${required} substitute units within supply`
    : model.reality.kind === 'CONFLICTED' ? `${model.reality.claims.length} conflicting supply claims`
    : available === undefined ? undefined
    : `${required} required · ${available} available`;
  return {
    id, name, caseRef, state, attention,
    tone: view.canReview ? 'neutral' : dispositionTone(disposition),
    ...(fact === undefined ? {} : { fact }),
  };
};

// Live Control shares the grammar. The acquisition source is live; the operational
// context is a controlled local snapshot and no external execution ever occurs.
export const createLiveControlSurfaceModel = (record: LiveControlPublicRecord): ControlSurfaceModel => {
  const receipt = record.receipt;
  const resumableAction = record.status === 'REVIEWING' ? record.review?.action : undefined;
  const applied = record.review?.action === 'APPLY' && receipt !== undefined;
  const discarded = record.review?.action === 'DISCARD';
  const rawDisposition = receipt?.disposition;
  const disposition = rawDisposition === undefined ? 'NOT RESOLVED'
    : rawDisposition === 'TECHNICAL_STOP' ? 'TECHNICAL STOP'
    : rawDisposition === 'PLAN_REJECTED' ? 'REJECTED'
    : rawDisposition;
  const boundaryState: ControlBoundaryState = applied ? 'EVALUATED'
    : record.status === 'AWAITING_REVIEW' || record.status === 'REVIEWING' || discarded ? 'NOT ENGAGED'
    : 'NOT AVAILABLE';
  return {
    answer: applied ? 'The decision is fixed. The Broker evaluated this application attempt against the controlled local context.'
      : record.status === 'AWAITING_REVIEW' ? 'The decision is fixed. Exact review is required before any application attempt.'
      : discarded ? 'The reviewer closed this decision. No application attempt was made.'
      : 'This owned review did not publish a terminal result.',
    decision: {
      label: record.reviewTarget.decision, state: 'Decision fixed', note: 'Decision fixed and usable.', available: true,
      sourceLabel: 'CALL-E · Live acquisition', sourceDetail: `Bound to acquisition ${record.acquisitionId}`,
    },
    review: {
      state: record.status === 'AWAITING_REVIEW' ? 'REQUIRED' : discarded ? 'DISCARDED' : applied ? 'COMPLETED' : 'UNAVAILABLE',
      label: record.status === 'AWAITING_REVIEW' ? 'Exact review required'
        : discarded ? 'Exact review discarded'
        : applied ? 'Exact review completed'
        : resumableAction === undefined ? 'Review incomplete' : 'Review resume required',
      detail: record.status === 'AWAITING_REVIEW' ? `Pending ${record.actorRole} review of this exact acquired decision.`
        : discarded ? 'The reviewer discarded this exact decision.'
        : applied ? 'You reviewed the complete acquired decision before it was applied.'
        : 'The owned review did not publish a terminal result; server truth is unchanged.',
    },
    proposal: {
      title: record.status === 'AWAITING_REVIEW' ? 'Review exact decision' : 'Exact decision reviewed',
      note: `Plan version ${record.planVersion} · ${record.caseId} / ${record.planId}`,
      lines: [
        { label: 'Acquired', value: controlDate(record.reviewTarget.receivedAt) },
        { label: 'Actor / role', value: `${record.actorId} / ${record.actorRole}` },
        { label: 'Request', value: record.reviewTarget.requestId },
        { label: 'Authorization changes', value: `${record.reviewTarget.proposedAuthorizationChanges.length}` },
      ],
    },
    ...(applied && record.review === undefined ? {} : applied ? { attempt: {
      key: record.review!.operationId, ordinal: 1, label: `${record.actorRole} review applied`,
      detail: `Exact review bound · plan version ${record.planVersion}`, treatment: attemptTreatment(disposition),
    } } : {}),
    boundary: {
      state: boundaryState, engaged: boundaryState === 'EVALUATED',
      note: boundaryState === 'EVALUATED' ? 'No external execution. This was a controlled evaluation.'
        : 'No application attempt has been made.',
    },
    reality: {
      kind: 'CONTEXT', headline: 'Controlled local snapshot.',
      note: 'The acquisition source is live. The operational context is a controlled local snapshot; live ERP/WMS truth is not claimed.',
      facts: [
        { key: 'definition', label: 'Controlled definition', value: `v${record.definitionVersion}`, note: record.definitionId },
        { key: 'external', label: 'External operational truth', value: 'NOT CLAIMED', note: 'No live ERP/WMS truth' },
        ...(receipt === undefined ? [] : [{ key: 'plan', label: 'Plan status', value: receipt.planStatus, note: 'Local controlled record' }]),
      ],
    },
    disposition: {
      label: disposition, tone: dispositionTone(disposition), resolved: disposition !== 'NOT RESOLVED',
      headline: receipt === undefined
        ? record.status === 'REVIEWING' ? 'The owned review did not publish a terminal result.' : 'No application attempt has been made yet.'
        : disposition === 'ALLOW' ? 'The reviewed decision can be applied within the controlled local context.'
        : disposition === 'DISCARDED' ? 'The reviewer did not submit this decision for application.'
        : disposition === 'BLOCK' ? 'The controlled local context does not support this application.'
        : 'The Broker did not permit this application attempt.',
      code: receipt?.reason ?? 'NO_APPLICATION_ATTEMPTED',
      supporting: applied ? 'No external execution. This was a controlled evaluation.' : 'No external execution occurred.',
      ...(receipt === undefined ? {} : { effects: `${receipt.effects.decisions} decision, ${receipt.effects.operations} operation, ${receipt.effects.events} event record created locally. No external execution.` }),
    },
    nextAction: record.status === 'AWAITING_REVIEW' ? 'Review exact decision'
      : resumableAction !== undefined ? `Resume owned ${resumableAction} review`
      : record.status === 'REVIEWING' ? 'Review stopped safely'
      : disposition === 'DISCARDED' ? 'Review opportunity closed'
      : 'Inspect the local application result',
    nextActionNote: 'Applying asks the existing Broker. It does not execute anything outside this controlled local context.',
  };
};

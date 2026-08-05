import {
  canApprovePlan,
  finalizePlanApproval,
  hasAllRequiredApprovals,
  recordApproval,
  recordRejection,
} from '../../domain/approvals.js';
import {
  applyAuthorizationChanges,
  resolveAuthorizationValue,
  validateAuthorizationChanges,
  type AuthorizationField,
  type AuthorizationReviewAction,
} from '../../domain/authorizationOperations.js';
import {
  checkOperationProcessed,
  recordProcessedOperation,
  type ProcessedOperation,
} from '../../domain/operationHistory.js';
import type { Approval, ExceptionCase, Plan } from '../../domain/types.js';
import { validatePlan } from '../../domain/validator.js';
import type { DecisionBridgeResult, DecisionProposal } from './decisionBridge.js';

export type AuthorizationReview = Readonly<{
  field: AuthorizationField;
  action: AuthorizationReviewAction;
  reason?: string;
}>;

export type ReviewCommand =
  | Readonly<{
      action: 'APPLY'; operationId: string; reviewedBy: string; reviewedAt: string;
      eventId: string; authorizationReviews: readonly AuthorizationReview[];
    }>
  | Readonly<{
      action: 'DISCARD'; operationId: string; reviewedBy: string; reviewedAt: string;
      reason?: string;
    }>;

export type DecisionApplicationContext = Readonly<{
  exceptionCase: ExceptionCase;
  plans: readonly Plan[];
  approvals: readonly Approval[];
  operationHistory: readonly ProcessedOperation[];
  existingEventIds: readonly string[];
}>;

export type DecisionApplicationEvent = Readonly<{
  eventId: string; operationId: string; requestId: string; caseId: string;
  planId?: string; actorId: string; actorRole: string; decision: string;
  reviewedBy: string; reviewedAt: string;
  appliedAuthorizationFields: readonly AuthorizationField[];
  discardedAuthorizationFields: readonly AuthorizationField[];
  result: 'APPROVAL_RECORDED' | 'PLAN_APPROVED' | 'REJECTION_RECORDED' | 'CASE_AUTHORIZATION_APPLIED';
}>;

export type DecisionApplicationResult =
  | Readonly<{ applied: true; value: Readonly<{
      updatedCase: ExceptionCase; updatedPlans: readonly Plan[]; approvals: readonly Approval[];
      createdApproval?: Approval; createdRejection?: Approval;
      appliedAuthorizationChanges: readonly AuthorizationField[];
      discardedAuthorizationChanges: readonly AuthorizationField[];
      updatedOperationHistory: readonly ProcessedOperation[];
      proposedEvents: readonly DecisionApplicationEvent[];
      resolutionStatus: 'PENDING_APPROVALS' | 'PLAN_APPROVED' | 'PLAN_REJECTED' | 'CASE_AUTHORIZATION_APPLIED';
    }> }>
  | Readonly<{ applied: false; reason: string; issues?: readonly string[];
      unchangedCase: ExceptionCase; unchangedPlans: readonly Plan[];
      unchangedApprovals: readonly Approval[]; unchangedOperationHistory: readonly ProcessedOperation[] }>;

const fail = (context: DecisionApplicationContext, reason: string, issues?: readonly string[]): DecisionApplicationResult => ({
  applied: false, reason, ...(issues === undefined ? {} : { issues }),
  unchangedCase: context.exceptionCase, unchangedPlans: context.plans,
  unchangedApprovals: context.approvals, unchangedOperationHistory: context.operationHistory,
});

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const iso = (value: unknown): value is string => nonEmpty(value) && Number.isFinite(Date.parse(value));
const fields = new Set<AuthorizationField>(['maxAbsorbableAdditionalCost', 'maxSubstituteQuantity', 'latestAcceptedDeliveryDate']);

const proposalIssue = (proposal: DecisionProposal): string | undefined => {
  if (typeof proposal !== 'object' || proposal === null) return 'Proposal is incomplete';
  if (![proposal.requestId, proposal.caseId, proposal.actorId, proposal.summary, proposal.receivedAt].every(nonEmpty)) return 'Proposal is incomplete';
  if (proposal.operationType !== 'PLAN_DECISION' && proposal.operationType !== 'CASE_AUTHORIZATION') return 'Proposal operation type is invalid';
  if (proposal.operationType === 'PLAN_DECISION' && !nonEmpty(proposal.planId)) return 'Proposal is incomplete';
  if (!iso(proposal.receivedAt) || proposal.requiresReview !== true) return 'Proposal is invalid';
  if (!['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'].includes(proposal.decision as string)) return 'Decision is unknown';
  if (!Array.isArray(proposal.proposedAuthorizationChanges) || !Array.isArray(proposal.evidence)) return 'Proposal is incomplete';
  if (proposal.evidence.some((item) => !nonEmpty(item))) return 'Proposal is invalid';
  if (proposal.proposedAuthorizationChanges.some((change) => typeof change !== 'object' || change === null || !fields.has(change.field) || change.requiresReview !== true)) return 'Proposal is invalid';
  return undefined;
};

export const applyReviewedDecision = (
  bridgeResult: DecisionBridgeResult,
  context: DecisionApplicationContext,
  command: ReviewCommand,
): DecisionApplicationResult => {
  if (!bridgeResult.ready) return fail(context, 'BRIDGE_RESULT_NOT_READY');
  if (typeof command !== 'object' || command === null) return fail(context, 'REVIEW_COMMAND_REQUIRED');
  if (!nonEmpty(command.operationId)) return fail(context, 'OPERATION_ID_REQUIRED');
  if (!nonEmpty(command.reviewedBy)) return fail(context, 'REVIEWER_REQUIRED');
  if (!iso(command.reviewedAt)) return fail(context, 'REVIEWED_AT_INVALID');
  if (command.action === 'DISCARD') return fail(context, 'DISCARDED_BY_REVIEWER');
  if (command.action !== 'APPLY') return fail(context, 'REVIEW_ACTION_INVALID');
  if (!nonEmpty(command.eventId)) return fail(context, 'EVENT_ID_REQUIRED');
  if (!Array.isArray(context.existingEventIds) || context.existingEventIds.includes(command.eventId)) return fail(context, 'EVENT_HISTORY_INVALID_OR_DUPLICATE');

  const duplicate = checkOperationProcessed(context.operationHistory, command.operationId);
  if (!duplicate.success) return fail(context, 'OPERATION_HISTORY_INSUFFICIENT', duplicate.issues);
  if (duplicate.processed) return fail(context, 'DUPLICATE_OPERATION');

  const proposal = bridgeResult.proposal;
  const malformed = proposalIssue(proposal);
  if (malformed !== undefined) return fail(context, malformed);
  if ((proposal.decision as string) === 'PENDING') return fail(context, 'PENDING_NOT_APPLICABLE');
  if (proposal.decision === 'NEEDS_CLARIFICATION') return fail(context, 'NEEDS_CLARIFICATION');
  if (proposal.caseId !== context.exceptionCase.id) return fail(context, 'CASE_MISMATCH');
  const actor = context.exceptionCase.actors.find(({ id }) => id === proposal.actorId);
  if (actor === undefined) return fail(context, 'ACTOR_NOT_FOUND');
  if (actor.role !== proposal.actorRole) return fail(context, 'ACTOR_ROLE_MISMATCH');
  const plan = proposal.operationType === 'PLAN_DECISION'
    ? context.plans.find(({ id }) => id === proposal.planId)
    : undefined;
  if (proposal.operationType === 'PLAN_DECISION') {
    if (plan === undefined) return fail(context, 'PLAN_NOT_FOUND');
    if (plan.caseId !== context.exceptionCase.id) return fail(context, 'PLAN_CASE_MISMATCH');
    if (plan.status !== 'PENDING_APPROVAL') return fail(context, 'PLAN_NOT_APPLICABLE');
  } else if (proposal.proposedAuthorizationChanges.length === 0) {
    return fail(context, 'CASE_AUTHORIZATION_CHANGES_REQUIRED');
  }

  const changes = proposal.proposedAuthorizationChanges;
  const changeFields = changes.map(({ field }) => field);
  if (changeFields.some((field) => !fields.has(field)) || new Set(changeFields).size !== changeFields.length) return fail(context, 'AUTHORIZATION_CHANGES_INVALID');
  if (!Array.isArray(command.authorizationReviews)) return fail(context, 'AUTHORIZATION_REVIEWS_REQUIRED');
  if (command.authorizationReviews.some((review) => {
    if (typeof review !== 'object' || review === null) return true;
    const keys = Object.keys(review);
    return keys.some((key) => !['field', 'action', 'reason'].includes(key))
      || !fields.has(review.field)
      || (review.action !== 'APPLY' && review.action !== 'DISCARD')
      || (review.reason !== undefined && !nonEmpty(review.reason));
  })) return fail(context, 'AUTHORIZATION_REVIEW_INVALID');
  const reviewFields = command.authorizationReviews.map(({ field }) => field);
  if (new Set(reviewFields).size !== reviewFields.length || reviewFields.length !== changeFields.length || reviewFields.some((field) => !changeFields.includes(field))) return fail(context, 'AUTHORIZATION_REVIEWS_INCOMPLETE_OR_DUPLICATE');

  const domainChanges = [];
  for (const change of changes) {
    const current = resolveAuthorizationValue(context.exceptionCase, actor.id, change.field);
    if (!current.success || current.value !== change.currentInternalValue) return fail(context, 'STALE_PROPOSAL');
    const review = command.authorizationReviews.find(({ field }) => field === change.field);
    if (review === undefined || (review.action !== 'APPLY' && review.action !== 'DISCARD')) return fail(context, 'AUTHORIZATION_REVIEW_INVALID');
    domainChanges.push({ actorId: actor.id, field: change.field, expectedCurrentValue: change.currentInternalValue, newValue: change.proposedNewValue, reviewedAction: review.action });
  }
  const validated = validateAuthorizationChanges(context.exceptionCase, domainChanges);
  if (!validated.success) return fail(context, 'AUTHORIZATION_VALIDATION_FAILED', validated.issues);

  if (proposal.operationType === 'CASE_AUTHORIZATION') {
    if (proposal.decision === 'REJECTED') return fail(context, 'CASE_AUTHORIZATION_REJECTED');
    if (domainChanges.every(({ reviewedAction }) => reviewedAction === 'DISCARD')) {
      return fail(context, 'CASE_AUTHORIZATION_DISCARDED');
    }
    const authorization = applyAuthorizationChanges(context.exceptionCase, domainChanges);
    if (!authorization.success) return fail(context, 'AUTHORIZATION_APPLICATION_FAILED', authorization.issues);
    const processed = recordProcessedOperation(context.operationHistory, { operationId: command.operationId, caseId: context.exceptionCase.id, processedAt: command.reviewedAt });
    if (!processed.success) return fail(context, 'OPERATION_RECORDING_FAILED', processed.issues);
    const appliedFields = authorization.appliedChanges.map(({ field }) => field);
    const discardedFields = authorization.discardedChanges.map(({ field }) => field);
    const event: DecisionApplicationEvent = {
      eventId: command.eventId, operationId: command.operationId, requestId: proposal.requestId,
      caseId: proposal.caseId, actorId: proposal.actorId, actorRole: proposal.actorRole,
      decision: proposal.decision, reviewedBy: command.reviewedBy, reviewedAt: command.reviewedAt,
      appliedAuthorizationFields: appliedFields, discardedAuthorizationFields: discardedFields,
      result: 'CASE_AUTHORIZATION_APPLIED',
    };
    return { applied: true, value: {
      updatedCase: authorization.updatedCase, updatedPlans: context.plans, approvals: context.approvals,
      appliedAuthorizationChanges: appliedFields, discardedAuthorizationChanges: discardedFields,
      updatedOperationHistory: processed.history, proposedEvents: [event],
      resolutionStatus: 'CASE_AUTHORIZATION_APPLIED',
    } };
  }

  if (plan === undefined) return fail(context, 'PLAN_NOT_FOUND');

  if (context.approvals.some((item) => item.planId === proposal.planId && item.actorId === proposal.actorId && item.decision === proposal.decision)) return fail(context, 'DUPLICATE_DECISION');

  let updatedCase = context.exceptionCase;
  let updatedPlans = context.plans;
  let approvals = context.approvals;
  let created: Approval;
  let resolutionStatus: 'PENDING_APPROVALS' | 'PLAN_APPROVED' | 'PLAN_REJECTED';
  let appliedFields: AuthorizationField[] = [];
  let discardedFields: AuthorizationField[] = [];

  if (proposal.decision === 'REJECTED') {
    if (domainChanges.some(({ reviewedAction }) => reviewedAction === 'APPLY')) return fail(context, 'REJECTION_CANNOT_APPLY_AUTHORIZATION');
    const rejected = recordRejection(plan, approvals, { caseId: context.exceptionCase.id, planId: plan.id, actorId: actor.id, actorRole: actor.role, createdAt: command.reviewedAt });
    if (!rejected.success) return fail(context, 'REJECTION_RECORDING_FAILED');
    created = rejected.approval; approvals = rejected.approvals;
    updatedPlans = context.plans.map((item) => item.id === plan.id ? rejected.plan : item);
    discardedFields = [...changeFields]; resolutionStatus = 'PLAN_REJECTED';
  } else {
    const authorization = applyAuthorizationChanges(context.exceptionCase, domainChanges);
    if (!authorization.success) return fail(context, 'AUTHORIZATION_APPLICATION_FAILED', authorization.issues);
    updatedCase = authorization.updatedCase;
    if (!validatePlan(updatedCase, plan).valid) return fail(context, 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW');
    appliedFields = authorization.appliedChanges.map(({ field }) => field);
    discardedFields = authorization.discardedChanges.map(({ field }) => field);
    const recorded = recordApproval(approvals, { caseId: updatedCase.id, planId: plan.id, actorId: actor.id, actorRole: actor.role, decision: 'APPROVED', createdAt: command.reviewedAt });
    created = recorded.approval; approvals = recorded.approvals;
    const allApproved = hasAllRequiredApprovals(updatedCase, plan, approvals);
    const approvable = canApprovePlan(updatedCase, plan, approvals);
    if (allApproved && approvable.success) {
      const finalized = finalizePlanApproval(updatedCase, plan, approvals);
      if (!finalized.success) return fail(context, 'PLAN_FINALIZATION_FAILED');
      updatedPlans = context.plans.map((item) => item.id === plan.id ? finalized.plan : item);
      resolutionStatus = 'PLAN_APPROVED';
    } else if (!approvable.success) {
      if (!allApproved && approvable.reason === 'The plan lacks all required approvals') {
        resolutionStatus = 'PENDING_APPROVALS';
      } else return fail(context, 'APPROVAL_RECORDING_NOT_APPLICABLE', [approvable.reason]);
    } else return fail(context, 'APPROVAL_STATE_INCONSISTENT');
  }

  const processed = recordProcessedOperation(context.operationHistory, { operationId: command.operationId, caseId: context.exceptionCase.id, processedAt: command.reviewedAt });
  if (!processed.success) return fail(context, 'OPERATION_RECORDING_FAILED', processed.issues);
  const event: DecisionApplicationEvent = { eventId: command.eventId, operationId: command.operationId, requestId: proposal.requestId, caseId: proposal.caseId, planId: proposal.planId, actorId: proposal.actorId, actorRole: proposal.actorRole, decision: proposal.decision, reviewedBy: command.reviewedBy, reviewedAt: command.reviewedAt, appliedAuthorizationFields: appliedFields, discardedAuthorizationFields: discardedFields, result: resolutionStatus === 'PLAN_APPROVED' ? 'PLAN_APPROVED' : resolutionStatus === 'PLAN_REJECTED' ? 'REJECTION_RECORDED' : 'APPROVAL_RECORDED' };
  return { applied: true, value: { updatedCase, updatedPlans, approvals, ...(proposal.decision === 'REJECTED' ? { createdRejection: created } : { createdApproval: created }), appliedAuthorizationChanges: appliedFields, discardedAuthorizationChanges: discardedFields, updatedOperationHistory: processed.history, proposedEvents: [event], resolutionStatus } };
};

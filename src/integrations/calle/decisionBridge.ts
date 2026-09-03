import { z } from 'zod';

import {
  approvalDecisionSchema,
  actorRoleSchema,
} from '../../domain/schemas.js';
import type { Actor, ActorRole, ExceptionCase, Plan } from '../../domain/types.js';
import { completionConfidenceSchema, receivedAtSchema } from './schemas.js';
import type {
  CallMappingResult,
  CompletionConfidence,
  NormalizedAuthorizationChange,
  NormalizedCallDecision,
} from './types.js';

export type ExpectedDecisionReference =
  | Readonly<{ operationType: 'PLAN_DECISION'; caseId: string; planId: string; actorId: string; actorRole: ActorRole }>
  | Readonly<{ operationType: 'CASE_AUTHORIZATION'; caseId: string; actorId: string; actorRole: ActorRole }>;

export type DecisionBridgeContext = Readonly<{
  exceptionCase: ExceptionCase;
  plans: readonly Plan[];
}>;

export type ReviewableAuthorizationChange = Readonly<{
  field: RecognizedAuthorizationField;
  currentInternalValue: string | number;
  proposedNewValue: string | number | boolean;
  externalPreviousValue?: string | number | boolean;
  reason?: string;
  requiresReview: true;
}>;

type DecisionProposalBase = Readonly<{
  requestId: string;
  caseId: string;
  actorId: string;
  actorRole: ActorRole;
  decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  summary: string;
  proposedAuthorizationChanges: readonly ReviewableAuthorizationChange[];
  evidence: readonly string[];
  completionConfidence: CompletionConfidence;
  receivedAt: string;
  requiresReview: true;
  reviewState: 'DECISION_REVIEW_REQUIRED' | 'CLARIFICATION_REQUIRED';
}>;

export type DecisionProposal =
  | (DecisionProposalBase & Readonly<{ operationType: 'PLAN_DECISION'; planId: string }>)
  | (DecisionProposalBase & Readonly<{ operationType: 'CASE_AUTHORIZATION' }>);

type ReviewTargetBase = Readonly<{
  requestId: string;
  caseId: string;
  actorId: string;
  actorRole: ActorRole;
  decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  summary: string;
  proposedAuthorizationChanges: readonly ReviewableAuthorizationChange[];
  evidence: readonly string[];
  completionConfidence: CompletionConfidence;
  receivedAt: string;
  requiresReview: true;
  reviewState: 'DECISION_REVIEW_REQUIRED' | 'CLARIFICATION_REQUIRED';
}>;

export type ReviewTarget =
  | (ReviewTargetBase & Readonly<{ operationType: 'PLAN_DECISION'; planId: string }>)
  | (ReviewTargetBase & Readonly<{ operationType: 'CASE_AUTHORIZATION' }>);

export type DecisionBridgeResult =
  | Readonly<{ ready: true; proposal: DecisionProposal; reviewTarget: ReviewTarget }>
  | Readonly<{ ready: false; reason: string; issues?: readonly string[] }>;

type RecognizedAuthorizationField =
  | 'maxAbsorbableAdditionalCost'
  | 'maxSubstituteQuantity'
  | 'latestAcceptedDeliveryDate';

const recognizedAuthorizationFields = new Set<string>([
  'maxAbsorbableAdditionalCost',
  'maxSubstituteQuantity',
  'latestAcceptedDeliveryDate',
]);

const primitiveSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
// Validate nonblank review text without changing the snapshot's exact value.
const reviewTextSchema = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const reviewableAuthorizationChangeSchema = z.object({
  field: z.enum(['maxAbsorbableAdditionalCost', 'maxSubstituteQuantity', 'latestAcceptedDeliveryDate']),
  currentInternalValue: z.union([z.string(), z.number().finite()]),
  proposedNewValue: primitiveSchema,
  externalPreviousValue: primitiveSchema.optional(),
  reason: reviewTextSchema.optional(),
  requiresReview: z.literal(true),
}).strict();
const reviewTargetBaseSchema = z.object({
  requestId: reviewTextSchema,
  caseId: reviewTextSchema,
  actorId: reviewTextSchema,
  actorRole: actorRoleSchema,
  decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION']),
  summary: reviewTextSchema,
  proposedAuthorizationChanges: z.array(reviewableAuthorizationChangeSchema),
  evidence: z.array(reviewTextSchema),
  completionConfidence: completionConfidenceSchema.extend({ label: reviewTextSchema }),
  receivedAt: receivedAtSchema,
  requiresReview: z.literal(true),
  reviewState: z.enum(['DECISION_REVIEW_REQUIRED', 'CLARIFICATION_REQUIRED']),
}).strict();

export const reviewTargetSchema = z.discriminatedUnion('operationType', [
  reviewTargetBaseSchema.extend({ operationType: z.literal('PLAN_DECISION'), planId: reviewTextSchema }).strict(),
  reviewTargetBaseSchema.extend({ operationType: z.literal('CASE_AUTHORIZATION') }).strict(),
]).superRefine((target, context) => {
  const expectedReviewState = target.decision === 'NEEDS_CLARIFICATION'
    ? 'CLARIFICATION_REQUIRED'
    : 'DECISION_REVIEW_REQUIRED';
  if (target.reviewState !== expectedReviewState) {
    context.addIssue({ code: 'custom', path: ['reviewState'], message: 'reviewState contradicts decision' });
  }
});

const snapshotChanges = (
  changes: readonly ReviewableAuthorizationChange[],
): readonly ReviewableAuthorizationChange[] => Object.freeze(changes.map((change) => Object.freeze({ ...change })));

export const deriveReviewTarget = (proposal: DecisionProposal): ReviewTarget => {
  const base: ReviewTargetBase = Object.freeze({
    requestId: proposal.requestId,
    caseId: proposal.caseId,
    actorId: proposal.actorId,
    actorRole: proposal.actorRole,
    decision: proposal.decision,
    summary: proposal.summary,
    proposedAuthorizationChanges: snapshotChanges(proposal.proposedAuthorizationChanges),
    evidence: Object.freeze([...proposal.evidence]),
    completionConfidence: Object.freeze({ ...proposal.completionConfidence }),
    receivedAt: proposal.receivedAt,
    requiresReview: proposal.requiresReview,
    reviewState: proposal.reviewState,
  });
  return proposal.operationType === 'PLAN_DECISION'
    ? Object.freeze({ ...base, operationType: 'PLAN_DECISION', planId: proposal.planId })
    : Object.freeze({ ...base, operationType: 'CASE_AUTHORIZATION' });
};

const primitiveEqual = (left: string | number | boolean | undefined, right: string | number | boolean | undefined) =>
  left === right;

const changeEqual = (left: ReviewableAuthorizationChange, right: ReviewableAuthorizationChange): boolean =>
  left.field === right.field
  && primitiveEqual(left.currentInternalValue, right.currentInternalValue)
  && primitiveEqual(left.proposedNewValue, right.proposedNewValue)
  && primitiveEqual(left.externalPreviousValue, right.externalPreviousValue)
  && left.reason === right.reason
  && left.requiresReview === right.requiresReview;

export const reviewTargetsEqual = (left: ReviewTarget, right: ReviewTarget): boolean => {
  if (left.operationType !== right.operationType) return false;
  if (left.operationType === 'PLAN_DECISION'
    && (right.operationType !== 'PLAN_DECISION' || left.planId !== right.planId)) return false;
  if (left.requestId !== right.requestId
    || left.caseId !== right.caseId
    || left.actorId !== right.actorId
    || left.actorRole !== right.actorRole
    || left.decision !== right.decision
    || left.summary !== right.summary
    || left.receivedAt !== right.receivedAt
    || left.requiresReview !== right.requiresReview
    || left.reviewState !== right.reviewState
    || left.completionConfidence.score !== right.completionConfidence.score
    || left.completionConfidence.label !== right.completionConfidence.label
    || left.evidence.length !== right.evidence.length
    || left.evidence.some((item, index) => item !== right.evidence[index])) return false;

  if (left.proposedAuthorizationChanges.length !== right.proposedAuthorizationChanges.length) return false;
  const rightByField = new Map(right.proposedAuthorizationChanges.map((change) => [change.field, change]));
  return rightByField.size === right.proposedAuthorizationChanges.length
    && new Set(left.proposedAuthorizationChanges.map(({ field }) => field)).size === left.proposedAuthorizationChanges.length
    && left.proposedAuthorizationChanges.every((change) => {
      const matching = rightByField.get(change.field);
      return matching !== undefined && changeEqual(change, matching);
    });
};

export const createReadyDecisionBridgeResult = (
  proposal: DecisionProposal,
): Extract<DecisionBridgeResult, { ready: true }> => ({
  ready: true,
  proposal,
  reviewTarget: deriveReviewTarget(proposal),
});

const failure = (reason: string, issues?: readonly string[]): DecisionBridgeResult => ({
  ready: false,
  reason,
  ...(issues === undefined ? {} : { issues }),
});

const currentAuthorizationValue = (
  actor: Actor,
  field: RecognizedAuthorizationField,
): string | number | undefined => {
  const authorization = actor.authorization as Actor['authorization'] | undefined;
  if (authorization === undefined) return undefined;
  switch (field) {
    case 'maxAbsorbableAdditionalCost':
      return authorization.maxAbsorbableAdditionalCost;
    case 'maxSubstituteQuantity':
      return authorization.maxSubstituteQuantity;
    case 'latestAcceptedDeliveryDate':
      return authorization.latestAcceptedDeliveryDate;
  }
};

const isRecognizedAuthorizationField = (field: string): field is RecognizedAuthorizationField =>
  recognizedAuthorizationFields.has(field);

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

const normalizedDecisionIssues = (input: unknown): string[] => {
  const issues: string[] = [];
  if (typeof input !== 'object' || input === null) return ['normalized decision is missing'];
  const value = input as Partial<NormalizedCallDecision> & Record<string, unknown>;
  if (typeof value.requestId !== 'string' || value.requestId.trim() === '') issues.push('requestId is missing');
  if (typeof value.planId !== 'string' || value.planId.trim() === '') issues.push('planId is invalid');
  if (typeof value.summary !== 'string' || value.summary.trim() === '') issues.push('summary is missing');
  if (!approvalDecisionSchema.safeParse(value.decision).success) issues.push('decision is invalid');
  if (!actorRoleSchema.safeParse(value.actorRole).success) issues.push('actorRole is invalid');
  if (!receivedAtSchema.safeParse(value.receivedAt).success) issues.push('receivedAt is invalid');
  if (!Array.isArray(value.evidence) || value.evidence.some((item) => typeof item !== 'string' || item.trim() === '')) {
    issues.push('evidence is invalid');
  }
  if (!completionConfidenceSchema.safeParse(value.completionConfidence).success) {
    issues.push('completionConfidence is invalid');
  }
  if (!Array.isArray(value.authorizationChanges)) {
    issues.push('authorizationChanges is invalid');
  } else {
    for (const change of value.authorizationChanges as readonly unknown[]) {
      if (typeof change !== 'object' || change === null) {
        issues.push('authorizationChanges is invalid');
        break;
      }
      const candidate = change as Record<string, unknown>;
      if (
        typeof candidate.field !== 'string'
        || candidate.field.trim() === ''
        || !isPrimitive(candidate.newValue)
        || (candidate.reason !== undefined && (typeof candidate.reason !== 'string' || candidate.reason.trim() === ''))
        || (candidate.externalPreviousValue !== undefined && !isPrimitive(candidate.externalPreviousValue))
      ) {
        issues.push('authorizationChanges is invalid');
        break;
      }
    }
  }

  const externalClarification = value.clarificationNeeded;
  if (
    externalClarification !== undefined
    && (
      typeof externalClarification !== 'boolean'
      || externalClarification !== (value.decision === 'NEEDS_CLARIFICATION')
    )
  ) {
    issues.push('clarificationNeeded contradicts decision');
  }
  return issues;
};

const reviewableChanges = (
  changes: readonly NormalizedAuthorizationChange[],
  actor: Actor,
): Readonly<
  | { success: true; value: readonly ReviewableAuthorizationChange[] }
  | { success: false; result: DecisionBridgeResult }
> => {
  const proposals: ReviewableAuthorizationChange[] = [];
  for (const change of changes) {
    if (!isRecognizedAuthorizationField(change.field)) {
      return { success: false, result: failure(`Unknown authorization field: ${change.field}`) };
    }
    const currentInternalValue = currentAuthorizationValue(actor, change.field);
    if (currentInternalValue === undefined) {
      return {
        success: false,
        result: failure(`Current internal authorization value is unavailable: ${change.field}`),
      };
    }
    proposals.push({
      field: change.field,
      currentInternalValue,
      proposedNewValue: change.newValue,
      ...(change.externalPreviousValue === undefined
        ? {}
        : { externalPreviousValue: change.externalPreviousValue }),
      ...(change.reason === undefined ? {} : { reason: change.reason }),
      requiresReview: true,
    });
  }
  return { success: true, value: proposals };
};

export const prepareDecisionProposal = (
  callResult: CallMappingResult,
  context: DecisionBridgeContext,
  expected: ExpectedDecisionReference,
): DecisionBridgeResult => {
  if (!callResult.success) return failure('Normalized CALL-E result is not successful');
  if (expected.operationType !== 'PLAN_DECISION' && expected.operationType !== 'CASE_AUTHORIZATION') {
    return failure('Expected operation type is invalid');
  }

  const value = callResult.value;
  const structuralIssues = normalizedDecisionIssues(value);
  if (structuralIssues.length > 0) return failure('Normalized CALL-E result is invalid', structuralIssues);
  if (value.decision === 'PENDING') return failure('PENDING is not a final reviewable decision');

  if (expected.caseId !== context.exceptionCase.id) {
    return failure('Expected operation caseId does not match the current case');
  }
  if (value.caseId !== expected.caseId) return failure('Result caseId does not match the expected operation');
  if (value.actorId !== expected.actorId) return failure('Result actorId does not match the expected operation');
  if (value.actorRole !== expected.actorRole) return failure('Result actorRole does not match the expected operation');

  const actor = context.exceptionCase.actors.find(({ id }) => id === expected.actorId);
  if (actor === undefined) return failure('Expected actor does not exist in the current case');
  if (actor.role !== expected.actorRole) return failure('Expected actor role does not match the current case');

  if (expected.operationType === 'PLAN_DECISION') {
    if (value.planId !== expected.planId) return failure('Result planId does not match the expected operation');
    const plan = context.plans.find(({ id }) => id === expected.planId);
    if (plan === undefined) return failure('Expected plan does not exist in the current context');
    if (plan.caseId !== context.exceptionCase.id) return failure('Expected plan does not belong to the current case');
  } else {
    // W3-01 currently requires planId in the normalized external contract.
    // It is validated structurally above, but is deliberately not trusted,
    // matched to a plan, or propagated into a case-authorization proposal.
    if (value.authorizationChanges.length === 0) {
      return failure('CASE_AUTHORIZATION requires at least one authorization change');
    }
    if (value.decision !== 'APPROVED' && value.decision !== 'REJECTED' && value.decision !== 'NEEDS_CLARIFICATION') {
      return failure('Decision is not compatible with CASE_AUTHORIZATION');
    }
  }

  const changes = reviewableChanges(value.authorizationChanges, actor);
  if (!changes.success) return changes.result;

  const proposalBase: DecisionProposalBase = {
      requestId: value.requestId,
      caseId: expected.caseId,
      actorId: expected.actorId,
      actorRole: expected.actorRole,
      decision: value.decision,
      summary: value.summary,
      proposedAuthorizationChanges: changes.value,
      evidence: [...value.evidence],
      completionConfidence: { ...value.completionConfidence },
      receivedAt: value.receivedAt,
      requiresReview: true,
      reviewState: value.decision === 'NEEDS_CLARIFICATION'
        ? 'CLARIFICATION_REQUIRED'
        : 'DECISION_REVIEW_REQUIRED',
  };
  const proposal: DecisionProposal = expected.operationType === 'PLAN_DECISION'
    ? { ...proposalBase, operationType: 'PLAN_DECISION', planId: expected.planId }
    : { ...proposalBase, operationType: 'CASE_AUTHORIZATION' };
  return createReadyDecisionBridgeResult(proposal);
};

import { approvalDecisionSchema, actorRoleSchema } from '../../domain/schemas.js';
import type { Actor, ActorRole, ExceptionCase, Plan } from '../../domain/types.js';
import { completionConfidenceSchema, receivedAtSchema } from './schemas.js';
import type {
  CallMappingResult,
  CompletionConfidence,
  NormalizedAuthorizationChange,
  NormalizedCallDecision,
} from './types.js';

export type ExpectedDecisionReference = Readonly<{
  caseId: string;
  planId?: string;
  actorId: string;
  actorRole: ActorRole;
}>;

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

export type DecisionProposal = Readonly<{
  requestId: string;
  caseId: string;
  planId: string;
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

export type DecisionBridgeResult =
  | Readonly<{ ready: true; proposal: DecisionProposal }>
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

  const value = callResult.value;
  const structuralIssues = normalizedDecisionIssues(value);
  if (structuralIssues.length > 0) return failure('Normalized CALL-E result is invalid', structuralIssues);
  if (value.decision === 'PENDING') return failure('PENDING is not a final reviewable decision');

  if (expected.caseId !== context.exceptionCase.id) {
    return failure('Expected operation caseId does not match the current case');
  }
  if (value.caseId !== expected.caseId) return failure('Result caseId does not match the expected operation');
  if (expected.planId === undefined) {
    return failure('Expected operation does not identify a plan');
  }
  if (value.planId !== expected.planId) return failure('Result planId does not match the expected operation');
  if (value.actorId !== expected.actorId) return failure('Result actorId does not match the expected operation');
  if (value.actorRole !== expected.actorRole) return failure('Result actorRole does not match the expected operation');

  const actor = context.exceptionCase.actors.find(({ id }) => id === expected.actorId);
  if (actor === undefined) return failure('Expected actor does not exist in the current case');
  if (actor.role !== expected.actorRole) return failure('Expected actor role does not match the current case');

  const plan = context.plans.find(({ id }) => id === expected.planId);
  if (plan === undefined) return failure('Expected plan does not exist in the current context');
  if (plan.caseId !== context.exceptionCase.id) return failure('Expected plan does not belong to the current case');

  const changes = reviewableChanges(value.authorizationChanges, actor);
  if (!changes.success) return changes.result;

  return {
    ready: true,
    proposal: {
      requestId: value.requestId,
      caseId: expected.caseId,
      planId: expected.planId,
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
    },
  };
};

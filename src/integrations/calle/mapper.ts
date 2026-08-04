import {
  callRequestSchema,
  calleTerminalResponseSchema,
  phoneDecisionSchema,
  receivedAtSchema,
} from './schemas.js';
import type { CallMappingResult } from './types.js';

const issuesFor = (issues: readonly Readonly<{ path: readonly PropertyKey[]; message: string }>[]) =>
  issues.map(({ path, message }) => `${path.join('.') || 'payload'}: ${message}`);

const failure = (
  reason: string,
  retryable: boolean,
  externalStatus?: string,
  issues?: readonly string[],
): CallMappingResult => ({
  success: false,
  reason,
  retryable,
  ...(externalStatus === undefined ? {} : { externalStatus }),
  ...(issues === undefined ? {} : { issues }),
});

export const mapCalleResponse = (
  requestInput: unknown,
  responseInput: unknown,
  receivedAtInput: unknown,
): CallMappingResult => {
  const requestResult = callRequestSchema.safeParse(requestInput);
  if (!requestResult.success) {
    return failure('Invalid call request', false, undefined, issuesFor(requestResult.error.issues));
  }

  const receivedAtResult = receivedAtSchema.safeParse(receivedAtInput);
  if (!receivedAtResult.success) {
    return failure('Invalid receivedAt timestamp', false, undefined, issuesFor(receivedAtResult.error.issues));
  }

  const responseResult = calleTerminalResponseSchema.safeParse(responseInput);
  if (!responseResult.success) {
    const externalStatus = typeof responseInput === 'object' && responseInput !== null && 'status' in responseInput && typeof responseInput.status === 'string'
      ? responseInput.status
      : undefined;
    return failure('Invalid CALL-E response', false, externalStatus, issuesFor(responseResult.error.issues));
  }

  const response = responseResult.data;
  if (response.status !== 'completed') {
    return failure(
      response.status === 'queued' || response.status === 'in_progress'
        ? 'CALL-E response is not terminal'
        : 'CALL-E call did not complete successfully',
      response.status === 'queued' || response.status === 'in_progress',
      response.status,
    );
  }
  if (response.structuredResult === null) {
    return failure('CALL-E returned no schema-valid structured result', false, response.status);
  }
  if (response.completionConfidence === null) {
    return failure('CALL-E returned no completion confidence', false, response.status);
  }

  const decisionResult = phoneDecisionSchema.safeParse(response.structuredResult);
  if (!decisionResult.success) {
    return failure('Invalid structured decision', false, response.status, issuesFor(decisionResult.error.issues));
  }

  const request = requestResult.data;
  const decision = decisionResult.data;
  if (decision.caseId !== request.caseId) return failure('Decision caseId does not match request', false, response.status);
  if (request.planId !== undefined && decision.planId !== request.planId) return failure('Decision planId does not match request', false, response.status);
  if (decision.actorId !== request.actorId) return failure('Decision actorId does not match request', false, response.status);
  if (decision.actorRole !== request.actorRole) return failure('Decision actorRole does not match request', false, response.status);

  if (decision.decision === 'APPROVED' && response.taskCompleted !== true) {
    return failure('taskCompleted contradicts the structured decision', false, response.status);
  }
  const expectsClarification = decision.decision === 'NEEDS_CLARIFICATION';
  if (decision.clarificationNeeded !== expectsClarification) {
    return failure('clarificationNeeded contradicts the structured decision', false, response.status);
  }

  return {
    success: true,
    value: {
      requestId: request.requestId,
      createdAt: request.createdAt,
      caseId: decision.caseId,
      planId: decision.planId,
      actorId: decision.actorId,
      actorRole: decision.actorRole,
      decision: decision.decision,
      summary: decision.summary,
      authorizationChanges: decision.authorizationChanges.map((change) => ({
        field: change.field,
        newValue: change.newValue,
        ...(change.reason === undefined ? {} : { reason: change.reason }),
        ...(change.previousValue === undefined ? {} : { externalPreviousValue: change.previousValue }),
      })),
      evidence: [...response.evidence],
      completionConfidence: { ...response.completionConfidence },
      receivedAt: receivedAtResult.data,
    },
  };
};

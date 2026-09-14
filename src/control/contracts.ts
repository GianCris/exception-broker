import type { ReviewTarget } from '../integrations/calle/decisionBridge.js';

export type LiveControlStatus = 'AWAITING_REVIEW' | 'REVIEWING' | 'TERMINAL';
export type LiveControlProvenance = Readonly<{
  acquisition: 'LIVE_CALLE'; operationalContext: 'CONTROLLED_SANDBOX_CONTEXT'; externalExecution: 'NONE';
}>;
export type LiveControlReviewMetadata = Readonly<{
  action: 'APPLY' | 'DISCARD'; operationId: string; eventId: string; approvalId: string;
  reviewedAt: string; reviewer: 'LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED';
}>;
export type LiveControlReceipt = Readonly<{
  disposition: 'ALLOW' | 'BLOCK' | 'WAIT' | 'PLAN_REJECTED' | 'DISCARDED' | 'TECHNICAL_STOP';
  reason: string; planStatus: string;
  before: Readonly<{ decisions: number; operations: number; events: number }>;
  effects: Readonly<{ decisions: number; operations: number; events: number }>;
  resolutionScope?: Readonly<{ caseId: string; lineageId: string; planId: string }>;
}>;
export type SourceAcquisitionBinding = Readonly<{
  acquisitionId: string; callId: string; requestId: string; receivedAt: string; terminalAt: string;
  caseId: string; planId: string; actorId: string; actorRole: string; normalizedDecisionFingerprint: string;
}>;
export type LiveControlSession = Readonly<{
  controlSessionId: string; acquisitionId: string; definitionId: string; definitionVersion: number;
  contextFingerprint: string; sourceBinding: SourceAcquisitionBinding;
  provenance: LiveControlProvenance; status: LiveControlStatus; reviewTarget: ReviewTarget;
  caseId: string; planId: string; planVersion: number; actorId: string; actorRole: string; createdAt: string;
  review?: LiveControlReviewMetadata; receipt?: LiveControlReceipt;
}>;
export type LiveControlPublicRecord = Readonly<
  Omit<LiveControlSession, 'contextFingerprint' | 'sourceBinding'> & {
    sourceBinding: Omit<SourceAcquisitionBinding, 'normalizedDecisionFingerprint'>;
  }
>;

export type LiveControlResult =
  | Readonly<{ accepted: true; record: LiveControlPublicRecord; existing: boolean }>
  | Readonly<{ accepted: false; code: 'NOT_ELIGIBLE' | 'BINDING_INVALID' | 'CONTEXT_STALE' | 'BRIDGE_REJECTED' | 'REVIEW_CONFLICT' | 'REVIEW_INCOMPLETE' | 'NOT_FOUND'; reason: string }>;

export const toPublicLiveControlRecord = (record: LiveControlSession): LiveControlPublicRecord => {
  const { contextFingerprint: _contextFingerprint, sourceBinding, ...publicRecord } = record;
  const { normalizedDecisionFingerprint: _normalizedDecisionFingerprint, ...publicSourceBinding } = sourceBinding;
  return structuredClone({ ...publicRecord, sourceBinding: publicSourceBinding });
};

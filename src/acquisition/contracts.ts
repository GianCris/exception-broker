import { z } from 'zod';

import { callRequestSchema, calleStatusSchema, completionConfidenceSchema, phoneDecisionSchema } from '../integrations/calle/schemas.js';
import type { NormalizedCallDecision } from '../integrations/calle/types.js';

const nonEmpty = z.string().trim().min(1);
const isoTime = z.string().datetime({ offset: true });

export const acquisitionCreateSchema = z.object({
  acquisitionId: nonEmpty.max(120),
  clientToken: nonEmpty.max(256),
  accessMode: z.enum(['HOSTED_DEMO', 'BYOK']),
  authorizationConfirmed: z.literal(true),
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone number must use E.164 format'),
  request: callRequestSchema.omit({ phoneNumber: true }).extend({
    objective: nonEmpty.max(2_000),
    context: nonEmpty.max(5_000),
  }),
}).strict();

export type AcquisitionCreateInput = z.infer<typeof acquisitionCreateSchema>;

export type AcquisitionStatus = 'creating' | z.infer<typeof calleStatusSchema>;
export type AcquisitionAccessMode = 'HOSTED_DEMO' | 'BYOK';
export type NormalizationStatus = 'PENDING' | 'USABLE' | 'SAFE_STOP';
export type HandoffState = 'NOT_READY' | 'READY_FOR_REVIEW' | 'SAFE_STOP';

export type SanitizedTranscriptTurn = Readonly<{
  offsetSeconds: number | null;
  speaker: 'bot' | 'user' | 'unknown';
  text: string;
}>;

export type SanitizedAttempt = Readonly<{
  id: string;
  status: 'queued' | 'dialing' | 'in_progress' | 'completed' | 'failed' | 'canceled';
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
  transcriptTurns: readonly SanitizedTranscriptTurn[];
  providerCallId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}>;

export type SanitizedRecipient = Readonly<{
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  summary: string | null;
  attempts: readonly SanitizedAttempt[];
}>;

export type SanitizedCall = Readonly<{
  callId: string;
  status: z.infer<typeof calleStatusSchema>;
  taskCompleted: boolean | null;
  completionConfidence: z.infer<typeof completionConfidenceSchema> | null;
  summary: string | null;
  evidence: readonly string[];
  structuredResult: z.infer<typeof phoneDecisionSchema> | null;
  createdAt: string;
  completedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  recipients: readonly SanitizedRecipient[];
}>;

export type PersistedDecisionContext = Readonly<{
  requestId: string;
  createdAt: string;
  caseId: string;
  planId?: string;
  actorId: string;
  actorRole: 'supplier' | 'production' | 'client';
}>;

export type AcquisitionRecord = Readonly<{
  acquisitionId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  requestDefinitionFingerprint?: string;
  clientTokenHash: string;
  /** Server-derived metadata. Missing only on records created before access-mode persistence. */
  accessMode?: AcquisitionAccessMode;
  authorizationConfirmed: true;
  maskedRecipient: string;
  decisionContext: PersistedDecisionContext;
  status: AcquisitionStatus;
  callId: string | null;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
  providerEvidence: SanitizedCall | null;
  normalizedResult: NormalizedCallDecision | null;
  normalizationStatus: NormalizationStatus;
  safeStopReason: string | null;
  handoffState: HandoffState;
}>;

export type CreateAcquisitionResult =
  | Readonly<{ accepted: true; record: AcquisitionRecord; existing: boolean }>
  | Readonly<{ accepted: false; code: 'INVALID_INPUT' | 'LIVE_CALLING_DISABLED' | 'CLIENT_NOT_ALLOWED' | 'RECIPIENT_NOT_ALLOWED' | 'CALL_LIMIT_REACHED' | 'COOLDOWN_ACTIVE' | 'ACTIVE_ACQUISITION_EXISTS' | 'PROVIDER_FAILURE'; reason: string }>;

export type PollAcquisitionResult =
  | Readonly<{ found: true; record: AcquisitionRecord }>
  | Readonly<{ found: false; code: 'NOT_FOUND' | 'PROVIDER_FAILURE' | 'POLL_TIMEOUT'; reason: string }>;

export type AcquisitionPublicRecord = Omit<AcquisitionRecord, 'clientTokenHash' | 'requestFingerprint' | 'requestDefinitionFingerprint' | 'decisionContext'> & Readonly<{
  decisionContext: PersistedDecisionContext;
}>;

export const toPublicAcquisitionRecord = (record: AcquisitionRecord): AcquisitionPublicRecord => {
  const { clientTokenHash: _clientTokenHash, requestFingerprint: _requestFingerprint, requestDefinitionFingerprint: _requestDefinitionFingerprint, ...safe } = record;
  return structuredClone(safe);
};

export const isTerminalStatus = (status: AcquisitionStatus): status is 'completed' | 'failed' | 'canceled' =>
  status === 'completed' || status === 'failed' || status === 'canceled';

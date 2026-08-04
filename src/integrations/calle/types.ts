import type { z } from 'zod';

import type {
  authorizationChangeSchema,
  callRequestSchema,
  calleTerminalResponseSchema,
  completionConfidenceSchema,
  expectedDecisionSchemaSchema,
  phoneDecisionSchema,
} from './schemas.js';

export type ExpectedDecisionSchema = z.infer<typeof expectedDecisionSchemaSchema>;
export type CallRequest = z.infer<typeof callRequestSchema>;
export type AuthorizationChangeProposal = z.infer<typeof authorizationChangeSchema>;
export type PhoneDecision = z.infer<typeof phoneDecisionSchema>;
export type CompletionConfidence = z.infer<typeof completionConfidenceSchema>;
export type CalleTerminalResponse = z.infer<typeof calleTerminalResponseSchema>;

export type NormalizedAuthorizationChange = Readonly<{
  field: string;
  newValue: string | number | boolean;
  reason?: string;
  externalPreviousValue?: string | number | boolean;
}>;

export type NormalizedCallDecision = Readonly<{
  requestId: string;
  createdAt: string;
  caseId: string;
  planId: string;
  actorId: string;
  actorRole: 'supplier' | 'production' | 'client';
  decision: 'APPROVED' | 'REJECTED' | 'PENDING' | 'NEEDS_CLARIFICATION';
  summary: string;
  authorizationChanges: readonly NormalizedAuthorizationChange[];
  evidence: readonly string[];
  completionConfidence: CompletionConfidence;
  receivedAt: string;
}>;

export type CallMappingResult =
  | Readonly<{ success: true; value: NormalizedCallDecision }>
  | Readonly<{
      success: false;
      reason: string;
      retryable: boolean;
      externalStatus?: string;
      issues?: readonly string[];
    }>;

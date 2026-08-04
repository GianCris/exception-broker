import type { z } from 'zod';

import type {
  actorIdSchema,
  actorRoleSchema,
  actorSchema,
  approvalDecisionSchema,
  approvalSchema,
  authorizationSchema,
  callResultSchema,
  caseIdSchema,
  caseStatusSchema,
  constraintSchema,
  exceptionCaseSchema,
  planIdSchema,
  planSchema,
  planStatusSchema,
  transitionSchema,
} from './schemas.js';

export type CaseId = z.infer<typeof caseIdSchema>;
export type PlanId = z.infer<typeof planIdSchema>;
export type ActorId = z.infer<typeof actorIdSchema>;
export type ActorRole = z.infer<typeof actorRoleSchema>;
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type PlanStatus = z.infer<typeof planStatusSchema>;
export type Constraint = z.infer<typeof constraintSchema>;
export type Authorization = z.infer<typeof authorizationSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type ExceptionCase = z.infer<typeof exceptionCaseSchema>;
export type Plan = z.infer<typeof planSchema>;
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type CallResult = z.infer<typeof callResultSchema>;
export type Transition = z.infer<typeof transitionSchema>;

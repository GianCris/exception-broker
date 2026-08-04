import type { ValidationResult } from './rules.js';
import type {
  ActorId,
  ActorRole,
  Approval,
  CaseId,
  CaseStatus,
  ExceptionCase,
  Plan,
  PlanId,
} from './types.js';

export type SimulationEventType =
  | 'PLAN_CREATED'
  | 'PLAN_VALIDATED'
  | 'PLAN_REJECTED'
  | 'NO_SOLUTION_DETECTED'
  | 'AUTHORIZATION_UPDATED'
  | 'APPROVAL_RECORDED'
  | 'PLAN_APPROVED';

export type SimulationEvent = Readonly<{
  eventId: string;
  caseId: CaseId;
  type: SimulationEventType;
  planId?: PlanId;
  actorId?: ActorId;
  message: string;
  createdAt: string;
}>;

export type AuthorizationChange = Readonly<{
  actorRole: ActorRole;
  field: 'maxSubstituteQuantity';
  previousValue: number;
  newValue: number;
  reason: string;
  createdAt: string;
}>;

export type PlanValidationAudit = Readonly<{
  planId: PlanId;
  result: ValidationResult;
}>;

export type NoSolutionEvidence = Readonly<{
  originalUnitsTomorrow: number;
  supplierSubstituteCapacityTomorrow: number;
  authorizedSubstituteUnitsTomorrow: number;
  substituteUnitAdditionalCost: number;
  availableUnitsTomorrow: number;
  requiredMinimumUnitsTomorrow: number;
  compatible: boolean;
}>;

export type ApprovalAttempt = Readonly<{
  planId: PlanId;
  approvalCount: number;
  success: boolean;
  reason?: string;
}>;

export type Case001SimulationResult = Readonly<{
  caseId: CaseId;
  status: CaseStatus;
  plans: readonly Plan[];
  approvals: readonly Approval[];
  events: readonly SimulationEvent[];
  authorizationChanges: readonly AuthorizationChange[];
  validations: readonly PlanValidationAudit[];
  noSolutionEvidence: NoSolutionEvidence;
  approvalAttempts: readonly ApprovalAttempt[];
  updatedCase: ExceptionCase;
  finalPlanId: PlanId | null;
  success: boolean;
  reason?: string;
}>;

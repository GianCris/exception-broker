import { approvalSchema } from './schemas.js';
import { validatePlan } from './validator.js';
import type {
  ActorId,
  ActorRole,
  Approval,
  ApprovalDecision,
  CaseId,
  ExceptionCase,
  Plan,
  PlanId,
} from './types.js';

export type ApprovalInput = Readonly<{
  caseId: CaseId;
  planId: PlanId;
  actorId: ActorId;
  actorRole: ActorRole;
  decision: ApprovalDecision;
  createdAt: string;
}>;

export type RecordApprovalResult = Readonly<{
  success: true;
  approval: Approval;
  approvals: readonly Approval[];
}>;

export type RecordRejectionResult =
  | Readonly<{
      success: true;
      plan: Plan;
      approval: Approval;
      approvals: readonly Approval[];
    }>
  | Readonly<{
      success: false;
      reason: string;
    }>;

export type PlanDecisionResult =
  | Readonly<{ success: true; plan: Plan }>
  | Readonly<{ success: false; reason: string }>;

const REQUIRED_ROLES: readonly ActorRole[] = [
  'supplier',
  'production',
  'client',
];

export const approvalsForPlan = (
  approvals: readonly Approval[],
  planId: PlanId,
): readonly Approval[] =>
  approvals.filter((approval) => approval.planId === planId);

const latestDecisionsByRole = (
  approvals: readonly Approval[],
  planId: PlanId,
): ReadonlyMap<ActorRole, Approval> => {
  const latest = new Map<ActorRole, Approval>();

  for (const approval of approvalsForPlan(approvals, planId)) {
    latest.set(approval.actorRole, approval);
  }

  return latest;
};

export const hasAllRequiredApprovals = (
  approvals: readonly Approval[],
  planId: PlanId,
): boolean => {
  const latest = latestDecisionsByRole(approvals, planId);

  return REQUIRED_ROLES.every(
    (role) => latest.get(role)?.decision === 'APPROVED',
  );
};

export const recordApproval = (
  approvals: readonly Approval[],
  input: ApprovalInput,
): RecordApprovalResult => {
  const approval = approvalSchema.parse(input);

  return {
    success: true,
    approval,
    approvals: [...approvals, approval],
  };
};

export const recordRejection = (
  plan: Plan,
  approvals: readonly Approval[],
  input: Omit<ApprovalInput, 'decision'>,
): RecordRejectionResult => {
  if (input.caseId !== plan.caseId || input.planId !== plan.id) {
    return {
      success: false,
      reason: 'The rejection must reference the rejected plan and case',
    };
  }

  const recorded = recordApproval(approvals, {
    ...input,
    decision: 'REJECTED',
  });

  return {
    success: true,
    plan: { ...plan, status: 'REJECTED' },
    approval: recorded.approval,
    approvals: recorded.approvals,
  };
};

export const canApprovePlan = (
  exceptionCase: ExceptionCase,
  plan: Plan,
  approvals: readonly Approval[],
): PlanDecisionResult => {
  if (plan.status === 'INVALIDATED') {
    return { success: false, reason: 'An invalidated plan cannot be approved' };
  }

  if (plan.status === 'REJECTED') {
    return { success: false, reason: 'A rejected plan cannot be approved' };
  }

  if (
    approvalsForPlan(approvals, plan.id).some(
      ({ decision }) => decision === 'REJECTED',
    )
  ) {
    return { success: false, reason: 'The plan has a recorded rejection' };
  }

  if (!hasAllRequiredApprovals(approvals, plan.id)) {
    return { success: false, reason: 'The plan lacks all required approvals' };
  }

  if (!validatePlan(exceptionCase, plan).valid) {
    return { success: false, reason: 'The plan violates active constraints' };
  }

  return { success: true, plan };
};

export const finalizePlanApproval = (
  exceptionCase: ExceptionCase,
  plan: Plan,
  approvals: readonly Approval[],
): PlanDecisionResult => {
  const result = canApprovePlan(exceptionCase, plan, approvals);

  return result.success
    ? { success: true, plan: { ...plan, status: 'APPROVED' } }
    : result;
};

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

type ApprovalState =
  | Readonly<{
      success: true;
      currentByRole: ReadonlyMap<ActorRole, Approval>;
      planApprovals: readonly Approval[];
    }>
  | Readonly<{
      success: false;
      reason: string;
    }>;

const approvalState = (
  exceptionCase: ExceptionCase,
  plan: Plan,
  approvals: readonly Approval[],
): ApprovalState => {
  if (plan.caseId !== exceptionCase.id) {
    return { success: false, reason: 'Plan caseId does not match the case' };
  }

  const planApprovals = approvalsForPlan(approvals, plan.id);
  const decisionsByActor = new Map<ActorId, Approval[]>();

  for (const approval of planApprovals) {
    if (approval.caseId !== exceptionCase.id) {
      return {
        success: false,
        reason: 'Approval caseId does not match the case',
      };
    }

    const actor = exceptionCase.actors.find(
      ({ id }) => id === approval.actorId,
    );

    if (actor === undefined) {
      return { success: false, reason: 'Approval actorId does not exist' };
    }

    if (actor.role !== approval.actorRole) {
      return {
        success: false,
        reason: 'Approval actorRole does not match the actor identity',
      };
    }

    const actorDecisions = decisionsByActor.get(actor.id) ?? [];
    decisionsByActor.set(actor.id, [...actorDecisions, approval]);
  }

  const currentByRole = new Map<ActorRole, Approval>();

  for (const actorDecisions of decisionsByActor.values()) {
    const latestTimestamp = Math.max(
      ...actorDecisions.map(({ createdAt }) => Date.parse(createdAt)),
    );
    const latest = actorDecisions.filter(
      ({ createdAt }) => Date.parse(createdAt) === latestTimestamp,
    );
    const latestDecisions = new Set(latest.map(({ decision }) => decision));

    if (latestDecisions.size > 1) {
      return {
        success: false,
        reason: 'Conflicting decisions share the same timestamp',
      };
    }

    // Equal actor, timestamp, and decision entries are historical duplicates;
    // either instance represents the same deterministic current state.
    const current = latest[0];
    if (current !== undefined) {
      currentByRole.set(current.actorRole, current);
    }
  }

  return { success: true, currentByRole, planApprovals };
};

export const hasAllRequiredApprovals = (
  exceptionCase: ExceptionCase,
  plan: Plan,
  approvals: readonly Approval[],
): boolean => {
  const state = approvalState(exceptionCase, plan, approvals);

  return (
    state.success &&
    REQUIRED_ROLES.every(
      (role) => state.currentByRole.get(role)?.decision === 'APPROVED',
    )
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
  const state = approvalState(exceptionCase, plan, approvals);

  if (!state.success) {
    return state;
  }

  if (plan.status !== 'PENDING_APPROVAL') {
    return {
      success: false,
      reason: `Plan status ${plan.status} does not allow approval`,
    };
  }

  if (
    state.planApprovals.some(
      ({ decision }) => decision === 'REJECTED',
    )
  ) {
    return { success: false, reason: 'The plan has a recorded rejection' };
  }

  if (
    !REQUIRED_ROLES.every(
      (role) => state.currentByRole.get(role)?.decision === 'APPROVED',
    )
  ) {
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

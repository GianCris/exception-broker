import { canApprovePlan } from '../../domain/approvals.js';
import type { ProcessedOperation } from '../../domain/operationHistory.js';
import type { RuleId, RuleViolation, ValidationResult } from '../../domain/rules.js';
import type { Approval, ExceptionCase, Plan, PlanId } from '../../domain/types.js';
import { validatePlan } from '../../domain/validator.js';
import { createNextPlanVersion, type PlanConditionChanges } from '../../domain/versioning.js';
import { executeCall } from './adapter.js';
import {
  prepareDecisionProposal,
  type DecisionBridgeResult,
  type ExpectedDecisionReference,
} from './decisionBridge.js';
import {
  applyReviewedDecision,
  type DecisionApplicationEvent,
  type DecisionApplicationResult,
  type ReviewCommand,
} from './decisionApplication.js';
import type { CallProvider } from './provider.js';
import type { CallMappingResult, CallRequest } from './types.js';

export type FlowCallStep = Readonly<{
  stepId: string;
  provider: CallProvider;
  request: CallRequest;
  receivedAt: string;
  expected: ExpectedDecisionReference;
  review: ReviewCommand;
}>;

export type ThreePartyFlowConfig = Readonly<{
  initialCase: ExceptionCase;
  initialPlan: Plan;
  plan002: Readonly<{ id: PlanId; createdAt: string; changes: PlanConditionChanges }>;
  plan003: Readonly<{ id: PlanId; createdAt: string; changes: PlanConditionChanges }>;
  plan001Rejection: FlowCallStep;
  caseAuthorization: FlowCallStep;
  finalApprovals: readonly [FlowCallStep, FlowCallStep, FlowCallStep];
  noSolutionEvidence: Readonly<{
    availableUnitsTomorrow: number;
    requiredMinimumUnitsTomorrow: number;
    compatible: boolean;
  }>;
}>;

export type FlowTraceEntry = Readonly<{
  stepId: string;
  requestId: string;
  actorId: string;
  actorRole: string;
  planId?: string;
  callResult: CallMappingResult;
  bridgeResult: DecisionBridgeResult;
  applicationResult?: DecisionApplicationResult;
}>;

export type PlanRejectionEvidence = Readonly<{
  planId: PlanId;
  actorId: string;
  decision: 'REJECTED';
  violatedRequirementIds: readonly RuleId[];
  validationIssues: readonly RuleViolation[];
  summary: string;
}>;

export type ThreePartyFlowState = Readonly<{
  exceptionCase: ExceptionCase;
  plans: readonly Plan[];
  approvals: readonly Approval[];
  operationHistory: readonly ProcessedOperation[];
  events: readonly DecisionApplicationEvent[];
  planRejectionEvidence: PlanRejectionEvidence | null;
}>;

export type ThreePartyFlowResult =
  | Readonly<{ success: true; value: ThreePartyFlowState & Readonly<{
      trace: readonly FlowTraceEntry[];
      finalPlanId: PlanId;
      finalStatus: 'APPROVED';
      noSolutionEvidence: ThreePartyFlowConfig['noSolutionEvidence'];
      planVersionCreations: readonly Readonly<{ planId: PlanId; version: number; createdAt: string }>[];
    }> }>
  | Readonly<{ success: false; failedStep: string; reason: string;
      partialTrace: readonly FlowTraceEntry[]; lastSafeState: ThreePartyFlowState }>;

const failure = (
  step: string,
  reason: string,
  trace: readonly FlowTraceEntry[],
  state: ThreePartyFlowState,
): ThreePartyFlowResult => ({ success: false, failedStep: step, reason, partialTrace: trace, lastSafeState: state });

const unique = (values: readonly string[]): boolean =>
  values.every((value) => value.trim() !== '') && new Set(values).size === values.length;

export const buildPlanRejectionEvidence = (
  plan: Plan,
  validation: ValidationResult,
  step: FlowCallStep,
  trace: FlowTraceEntry,
): PlanRejectionEvidence | null => {
  if (validation.valid || validation.violations.length === 0) return null;
  if (step.expected.operationType !== 'PLAN_DECISION'
    || step.expected.planId !== plan.id
    || trace.planId !== plan.id
    || trace.requestId !== step.request.requestId
    || !trace.bridgeResult.ready
    || trace.bridgeResult.proposal.operationType !== 'PLAN_DECISION'
    || trace.bridgeResult.proposal.planId !== plan.id
    || trace.bridgeResult.proposal.actorId !== step.expected.actorId
    || trace.bridgeResult.proposal.decision !== 'REJECTED'
    || trace.applicationResult?.applied !== true
    || trace.applicationResult.value.createdRejection?.planId !== plan.id
    || trace.applicationResult.value.createdRejection.actorId !== step.expected.actorId) return null;
  const event = trace.applicationResult.value.proposedEvents.find((candidate) =>
    step.review.action === 'APPLY'
    && candidate.eventId === step.review.eventId
    && candidate.operationId === step.review.operationId
    && candidate.requestId === step.request.requestId
    && candidate.planId === plan.id
    && candidate.actorId === step.expected.actorId
    && candidate.decision === 'REJECTED'
    && candidate.result === 'REJECTION_RECORDED');
  if (event === undefined) return null;
  return {
    planId: plan.id,
    actorId: event.actorId,
    decision: 'REJECTED',
    violatedRequirementIds: validation.violations.map(({ ruleId }) => ruleId),
    validationIssues: validation.violations,
    summary: validation.violations.map(({ message }) => message).join('; '),
  };
};

const runCallStep = async (
  step: FlowCallStep,
  state: ThreePartyFlowState,
): Promise<Readonly<
  | { success: true; state: ThreePartyFlowState; trace: FlowTraceEntry }
  | { success: false; reason: string; trace: FlowTraceEntry }
>> => {
  const callResult = await executeCall(step.provider, step.request, step.receivedAt);
  const bridgeResult = prepareDecisionProposal(callResult, {
    exceptionCase: state.exceptionCase,
    plans: state.plans,
  }, step.expected);
  const traceBase = {
    stepId: step.stepId,
    requestId: step.request.requestId,
    actorId: step.request.actorId,
    actorRole: step.request.actorRole,
    ...(step.request.planId === undefined ? {} : { planId: step.request.planId }),
    callResult,
    bridgeResult,
  };
  if (!callResult.success) return { success: false, reason: callResult.reason, trace: traceBase };
  if (!bridgeResult.ready) return { success: false, reason: bridgeResult.reason, trace: traceBase };

  const applicationResult = applyReviewedDecision(bridgeResult, {
    exceptionCase: state.exceptionCase,
    plans: state.plans,
    approvals: state.approvals,
    operationHistory: state.operationHistory,
    existingEventIds: state.events.map(({ eventId }) => eventId),
  }, step.review);
  const trace = { ...traceBase, applicationResult };
  if (!applicationResult.applied) return { success: false, reason: applicationResult.reason, trace };

  return {
    success: true,
    state: {
      exceptionCase: applicationResult.value.updatedCase,
      plans: applicationResult.value.updatedPlans,
      approvals: applicationResult.value.approvals,
      operationHistory: applicationResult.value.updatedOperationHistory,
      events: [...state.events, ...applicationResult.value.proposedEvents],
      planRejectionEvidence: state.planRejectionEvidence,
    },
    trace,
  };
};

export const runThreePartyFlow = async (
  config: ThreePartyFlowConfig,
): Promise<ThreePartyFlowResult> => {
  let state: ThreePartyFlowState = {
    exceptionCase: config.initialCase,
    plans: [config.initialPlan],
    approvals: [],
    operationHistory: [],
    events: [],
    planRejectionEvidence: null,
  };
  const trace: FlowTraceEntry[] = [];
  const steps = [config.plan001Rejection, config.caseAuthorization, ...config.finalApprovals];
  const operationIds = steps.map(({ review }) => review.operationId);
  const requestIds = steps.map(({ request }) => request.requestId);
  const eventIds = steps.flatMap(({ review }) => review.action === 'APPLY' ? [review.eventId] : []);
  const approvalIds = steps.flatMap(({ review }) =>
    review.action === 'APPLY' && review.approvalId !== undefined ? [review.approvalId] : []);
  if (!unique(operationIds) || !unique(requestIds) || !unique(eventIds) || !unique(approvalIds)) {
    return failure('CONFIGURATION', 'Scenario identifiers must be explicit and unique', trace, state);
  }
  const operationIdentifiers = [...operationIds, ...requestIds, ...eventIds, ...approvalIds];
  if (new Set(operationIdentifiers).size !== operationIdentifiers.length) {
    return failure('CONFIGURATION', 'Scenario identifier categories must not reuse values', trace, state);
  }
  if (config.finalApprovals.map(({ expected }) => expected.actorRole).join(',') !== 'supplier,production,client') {
    return failure('CONFIGURATION', 'Final approvals must follow supplier, production, client order', trace, state);
  }

  const plan001Validation = validatePlan(config.initialCase, config.initialPlan);
  if (plan001Validation.valid || plan001Validation.violations.length === 0) {
    return failure('PLAN_001_VALIDATION_EVIDENCE', 'PLAN-001 lacks domain validation evidence for rejection', trace, state);
  }

  const rejection = await runCallStep(config.plan001Rejection, state);
  trace.push(rejection.trace);
  if (!rejection.success) return failure(config.plan001Rejection.stepId, rejection.reason, trace, state);
  const rejectedPlan = rejection.state.plans.find(({ id }) => id === config.initialPlan.id);
  if (rejectedPlan?.status !== 'REJECTED') return failure('PLAN_001_REJECTION', 'PLAN-001 was not rejected', trace, state);
  const rejectionEvidence = buildPlanRejectionEvidence(
    config.initialPlan, plan001Validation, config.plan001Rejection, rejection.trace,
  );
  if (rejectionEvidence === null) {
    return failure('PLAN_001_REJECTION_EVIDENCE', 'PLAN-001 rejection evidence is missing or contradictory', trace, state);
  }
  state = { ...rejection.state, planRejectionEvidence: rejectionEvidence };

  const plan002Result = createNextPlanVersion(
    rejectedPlan, config.plan002.id, config.plan002.createdAt, config.plan002.changes,
  );
  if (!plan002Result.success) return failure('PLAN_002_CREATION', plan002Result.reason, trace, state);
  const plan002 = plan002Result.plan;
  if (plan002.status !== 'NO_SOLUTION'
    || config.noSolutionEvidence.compatible
    || config.noSolutionEvidence.availableUnitsTomorrow >= config.noSolutionEvidence.requiredMinimumUnitsTomorrow) {
    return failure('PLAN_002_NO_SOLUTION', 'Official no-solution evidence is inconsistent', trace, state);
  }
  if (canApprovePlan(state.exceptionCase, plan002, state.approvals).success) {
    return failure('PLAN_002_NO_SOLUTION', 'PLAN-002 unexpectedly allows approval', trace, state);
  }
  state = { ...state, plans: [...state.plans, plan002] };

  const authorization = await runCallStep(config.caseAuthorization, state);
  trace.push(authorization.trace);
  if (!authorization.success) return failure(config.caseAuthorization.stepId, authorization.reason, trace, state);
  state = authorization.state;

  const plan003Result = createNextPlanVersion(
    plan002, config.plan003.id, config.plan003.createdAt, config.plan003.changes,
  );
  if (!plan003Result.success) return failure('PLAN_003_CREATION', plan003Result.reason, trace, state);
  const plan003 = plan003Result.plan;
  const validation = validatePlan(state.exceptionCase, plan003);
  if (!validation.valid) return failure('PLAN_003_VALIDATION', 'PLAN-003 violates active constraints', trace, state);
  state = { ...state, plans: [...state.plans, plan003] };

  for (const approvalStep of config.finalApprovals) {
    const approval = await runCallStep(approvalStep, state);
    trace.push(approval.trace);
    if (!approval.success) return failure(approvalStep.stepId, approval.reason, trace, state);
    state = approval.state;
  }

  const finalPlan = state.plans.find(({ id }) => id === config.plan003.id);
  if (finalPlan?.status !== 'APPROVED') {
    return failure('FINALIZATION', 'The final plan was not approved by the domain', trace, state);
  }
  return {
    success: true,
    value: {
      ...state,
      trace,
      finalPlanId: finalPlan.id,
      finalStatus: 'APPROVED',
      noSolutionEvidence: config.noSolutionEvidence,
      planVersionCreations: [
        { planId: plan002.id, version: plan002.version, createdAt: plan002Result.createdAt },
        { planId: finalPlan.id, version: finalPlan.version, createdAt: plan003Result.createdAt },
      ],
    },
  };
};

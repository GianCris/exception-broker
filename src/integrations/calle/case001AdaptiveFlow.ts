import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationResult,
  type OrchestrationState,
} from '../../application/adaptiveOrchestrator.js';
import { assessNoSolution, type NoSolutionAssessment } from '../../domain/outcomes.js';
import type { PlanRegistrationAssessment } from '../../domain/planRegistration.js';
import { executeCall } from './adapter.js';
import { prepareDecisionProposal, type DecisionBridgeResult } from './decisionBridge.js';
import type { CallMappingResult } from './types.js';
import type { FlowCallStep, ThreePartyFlowConfig } from './threePartyFlow.js';

export type Case001AdaptiveTraceEntry = Readonly<{
  stepId: string;
  actionType: OrchestrationAction['type'];
  callResult?: CallMappingResult;
  bridgeResult?: DecisionBridgeResult;
  orchestrationResult: OrchestrationResult;
}>;

export type Case001AdaptiveFlowResult =
  | Readonly<{
      success: true;
      state: OrchestrationState;
      trace: readonly Case001AdaptiveTraceEntry[];
      registrationAssessment: PlanRegistrationAssessment;
      noSolutionEvidence: ThreePartyFlowConfig['noSolutionEvidence'];
      noSolutionAssessment: NoSolutionAssessment;
      finalDisposition: Extract<
        Extract<OrchestrationResult, { accepted: true }>['disposition'],
        { type: 'LINEAGE_RESOLVED' }
      >;
    }>
  | Readonly<{
      success: false;
      failedStep: string;
      reason: string;
      state: OrchestrationState;
      trace: readonly Case001AdaptiveTraceEntry[];
    }>;

const failed = (
  failedStep: string,
  reason: string,
  state: OrchestrationState,
  trace: readonly Case001AdaptiveTraceEntry[],
): Case001AdaptiveFlowResult => ({ success: false, failedStep, reason, state, trace });

const executeExternalDecision = async (
  step: FlowCallStep,
  state: OrchestrationState,
): Promise<Readonly<
  | { success: true; state: OrchestrationState; trace: Case001AdaptiveTraceEntry; result: Extract<OrchestrationResult, { accepted: true }> }
  | { success: false; reason: string; trace: Case001AdaptiveTraceEntry }
>> => {
  const callResult = await executeCall(step.provider, step.request, step.receivedAt);
  const bridgeResult = prepareDecisionProposal(callResult, {
    exceptionCase: state.exceptionCase,
    plans: state.plans,
  }, step.expected);
  const orchestrationResult = executeOrchestrationAction(state, {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult,
    review: step.review,
  });
  const trace: Case001AdaptiveTraceEntry = {
    stepId: step.stepId,
    actionType: 'APPLY_REVIEWED_DECISION',
    callResult,
    bridgeResult,
    orchestrationResult,
  };
  return orchestrationResult.accepted
    ? { success: true, state: orchestrationResult.state, trace, result: orchestrationResult }
    : { success: false, reason: orchestrationResult.failure.reason, trace };
};

export const runCase001AdaptiveFlow = async (
  config: ThreePartyFlowConfig,
): Promise<Case001AdaptiveFlowResult> => {
  let state: OrchestrationState = {
    exceptionCase: structuredClone(config.initialCase),
    plans: [],
    planLineages: [],
    approvals: [],
    operationHistory: [],
    events: [],
  };
  const trace: Case001AdaptiveTraceEntry[] = [];

  const registration = executeOrchestrationAction(state, {
    type: 'REGISTER_PLAN_PROPOSAL',
    lineageId: config.lineageId,
    plan: structuredClone(config.initialPlan),
  });
  trace.push({
    stepId: 'REGISTER_PLAN_001',
    actionType: 'REGISTER_PLAN_PROPOSAL',
    orchestrationResult: registration,
  });
  if (!registration.accepted) return failed('REGISTER_PLAN_001', registration.failure.reason, state, trace);
  if (registration.step.actionType !== 'REGISTER_PLAN_PROPOSAL') {
    return failed('REGISTER_PLAN_001', 'REGISTRATION_RESULT_INCONSISTENT', state, trace);
  }
  state = registration.state;
  const registrationAssessment = registration.step.assessment;

  const rejection = await executeExternalDecision(config.plan001Rejection, state);
  trace.push(rejection.trace);
  if (!rejection.success) return failed(config.plan001Rejection.stepId, rejection.reason, state, trace);
  state = rejection.state;

  const plan002 = executeOrchestrationAction(state, {
    type: 'CREATE_SUCCESSOR',
    lineageId: config.lineageId,
    predecessorPlanId: config.initialPlan.id,
    newPlanId: config.plan002.id,
    changes: config.plan002.changes,
  });
  trace.push({ stepId: 'CREATE_PLAN_002', actionType: 'CREATE_SUCCESSOR', orchestrationResult: plan002 });
  if (!plan002.accepted) return failed('CREATE_PLAN_002', plan002.failure.reason, state, trace);
  state = plan002.state;

  const noSolutionEvidence = structuredClone(config.noSolutionEvidence);
  const noSolutionAssessment = assessNoSolution(noSolutionEvidence, 'LEGACY_CASE_001');

  const authorization = await executeExternalDecision(config.caseAuthorization, state);
  trace.push(authorization.trace);
  if (!authorization.success) return failed(config.caseAuthorization.stepId, authorization.reason, state, trace);
  state = authorization.state;

  const plan003 = executeOrchestrationAction(state, {
    type: 'CREATE_SUCCESSOR',
    lineageId: config.lineageId,
    predecessorPlanId: config.plan002.id,
    newPlanId: config.plan003.id,
    changes: config.plan003.changes,
  });
  trace.push({ stepId: 'CREATE_PLAN_003', actionType: 'CREATE_SUCCESSOR', orchestrationResult: plan003 });
  if (!plan003.accepted) return failed('CREATE_PLAN_003', plan003.failure.reason, state, trace);
  state = plan003.state;

  let finalResult: Extract<OrchestrationResult, { accepted: true }> | undefined;
  for (const approvalStep of config.finalApprovals) {
    const approval = await executeExternalDecision(approvalStep, state);
    trace.push(approval.trace);
    if (!approval.success) return failed(approvalStep.stepId, approval.reason, state, trace);
    state = approval.state;
    finalResult = approval.result;
  }
  if (finalResult?.disposition.type !== 'LINEAGE_RESOLVED') {
    return failed('FINALIZATION', 'FINAL_LINEAGE_NOT_RESOLVED', state, trace);
  }

  return {
    success: true,
    state,
    trace,
    registrationAssessment,
    noSolutionEvidence,
    noSolutionAssessment,
    finalDisposition: finalResult.disposition,
  };
};

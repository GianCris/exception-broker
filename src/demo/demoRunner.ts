import type { Approval, Plan } from '../domain/types.js';
import { receivedAtSchema } from '../integrations/calle/schemas.js';
import {
  runThreePartyFlow,
  type FlowCallStep,
  type FlowTraceEntry,
  type ThreePartyFlowConfig,
  type ThreePartyFlowResult,
  type ThreePartyFlowState,
} from '../integrations/calle/threePartyFlow.js';
import type { DemoRunResult, DemoRunnerInput, DemoStep, DemoStepType } from './demoTypes.js';

const unavailableModes = new Set(['LIVE_CALL_E', 'RECORDED_RUN']);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const iso = (value: unknown): value is string => receivedAtSchema.safeParse(value).success;

const blocked = (
  input: DemoRunnerInput,
  reason: 'MODE_NOT_AVAILABLE' | 'INVALID_MODE' | 'INVALID_CONFIGURATION',
  issues?: readonly string[],
): DemoRunResult => ({
  status: 'BLOCKED',
  mode: typeof input.mode === 'string' ? input.mode : 'INVALID',
  ...(nonEmpty(input.runId) ? { runId: input.runId } : {}),
  reason,
  ...(issues === undefined ? {} : { issues }),
});

const scenarioIssues = (scenario: unknown): readonly string[] => {
  if (typeof scenario !== 'object' || scenario === null) return ['scenario is required'];
  const candidate = scenario as Partial<ThreePartyFlowConfig>;
  const issues: string[] = [];
  if (candidate.initialCase === undefined || candidate.initialPlan === undefined) issues.push('initial case and plan are required');
  if (candidate.plan002 === undefined || candidate.plan003 === undefined) issues.push('plan version configuration is required');
  if (candidate.plan001Rejection === undefined || candidate.caseAuthorization === undefined) issues.push('initial call steps are required');
  if (!Array.isArray(candidate.finalApprovals) || candidate.finalApprovals.length !== 3) issues.push('three final approval steps are required');
  if (candidate.noSolutionEvidence === undefined) issues.push('no-solution evidence is required');
  return issues;
};

const eventFor = (trace: FlowTraceEntry | undefined) =>
  trace?.applicationResult?.applied === true ? trace.applicationResult.value.proposedEvents[0] : undefined;

const traceFor = (trace: readonly FlowTraceEntry[], step: FlowCallStep): FlowTraceEntry | undefined =>
  trace.find(({ requestId }) => requestId === step.request.requestId);

const completedStep = (
  type: DemoStepType,
  caseId: string,
  message: string,
  details: Omit<DemoStep, 'type' | 'status' | 'caseId' | 'message'> = {},
): DemoStep => ({ type, status: 'COMPLETED', caseId, message, ...details });

const approvalStep = (
  type: 'SUPPLIER_APPROVED' | 'PRODUCTION_APPROVED' | 'CLIENT_APPROVED',
  scenarioStep: FlowCallStep,
  trace: readonly FlowTraceEntry[],
  approvals: readonly Approval[],
  caseId: string,
): DemoStep | undefined => {
  const entry = traceFor(trace, scenarioStep);
  const event = eventFor(entry);
  const approval = event?.approvalId === undefined
    ? undefined
    : approvals.find(({ approvalId }) => approvalId === event.approvalId);
  if (entry?.applicationResult?.applied !== true || event === undefined || approval?.decision !== 'APPROVED') return undefined;
  return completedStep(type, caseId, `${approval.actorRole} approved the final plan.`, {
    planId: approval.planId, actorId: approval.actorId, requestId: entry.requestId,
    operationId: event.operationId, approvalId: approval.approvalId,
  });
};

const deriveSteps = (
  scenario: ThreePartyFlowConfig,
  trace: readonly FlowTraceEntry[],
  state: ThreePartyFlowState,
  result: ThreePartyFlowResult,
): readonly DemoStep[] => {
  const steps: DemoStep[] = [];
  const caseId = state.exceptionCase.id;
  const rejectionTrace = traceFor(trace, scenario.plan001Rejection);
  const rejectionEvent = eventFor(rejectionTrace);
  const rejectedPlan = state.plans.find(({ id }) => id === scenario.initialPlan.id);
  const rejection = rejectionEvent?.approvalId === undefined ? undefined
    : state.approvals.find(({ approvalId }) => approvalId === rejectionEvent.approvalId);
  if (rejectedPlan?.status === 'REJECTED' && rejection?.decision === 'REJECTED' && rejectionTrace !== undefined && rejectionEvent !== undefined) {
    steps.push(completedStep('PLAN-001_REJECTED', caseId, 'The initial plan was rejected.', {
      planId: rejectedPlan.id, actorId: rejection.actorId, requestId: rejectionTrace.requestId,
      operationId: rejectionEvent.operationId, approvalId: rejection.approvalId,
    }));
  }

  const plan002 = state.plans.find(({ id }) => id === scenario.plan002.id);
  if (plan002?.status === 'NO_SOLUTION'
    && scenario.noSolutionEvidence.compatible === false
    && scenario.noSolutionEvidence.availableUnitsTomorrow < scenario.noSolutionEvidence.requiredMinimumUnitsTomorrow) {
    steps.push(completedStep('PLAN-002_NO_SOLUTION', caseId, 'Active constraints produced no compatible solution.', { planId: plan002.id }));
  }

  const authorizationTrace = traceFor(trace, scenario.caseAuthorization);
  const authorizationEvent = eventFor(authorizationTrace);
  if (authorizationTrace?.applicationResult?.applied === true
    && authorizationEvent?.result === 'CASE_AUTHORIZATION_APPLIED'
    && authorizationEvent.appliedAuthorizationFields.includes('maxSubstituteQuantity')) {
    steps.push(completedStep('CASE_AUTHORIZATION_APPLIED', caseId, 'The reviewed case authorization was applied.', {
      actorId: authorizationEvent.actorId, requestId: authorizationTrace.requestId,
      operationId: authorizationEvent.operationId,
    }));
  }

  const plan003 = state.plans.find(({ id }) => id === scenario.plan003.id);
  const creationEvidence = result.success
    ? result.value.planVersionCreations.some(({ planId }) => planId === scenario.plan003.id)
    : plan003 !== undefined && authorizationEvent?.result === 'CASE_AUTHORIZATION_APPLIED';
  if (plan003 !== undefined && creationEvidence) {
    steps.push(completedStep('PLAN-003_CREATED', caseId, 'The final candidate plan version was created.', { planId: plan003.id }));
  }

  const approvalTypes = {
    supplier: 'SUPPLIER_APPROVED',
    production: 'PRODUCTION_APPROVED',
    client: 'CLIENT_APPROVED',
  } as const;
  for (const scenarioStep of scenario.finalApprovals) {
    const type = approvalTypes[scenarioStep.expected.actorRole];
    const step = approvalStep(type, scenarioStep, trace, state.approvals, caseId);
    if (step !== undefined) steps.push(step);
  }

  if (result.success && plan003?.status === 'APPROVED' && result.value.finalPlanId === plan003.id) {
    steps.push(completedStep('PLAN-003_FINALIZED', caseId, 'The domain finalized the approved plan.', { planId: plan003.id }));
    steps.push(completedStep('CASE_RESOLVED', caseId, 'The case reached its verified resolution.', { planId: plan003.id }));
  }
  return steps;
};

export const runDemo = async (input: DemoRunnerInput): Promise<DemoRunResult> => {
  if (typeof input.mode !== 'string' || (!unavailableModes.has(input.mode) && input.mode !== 'LOCAL_SIMULATION')) {
    return blocked(input, 'INVALID_MODE');
  }
  if (unavailableModes.has(input.mode)) return blocked(input, 'MODE_NOT_AVAILABLE');

  const issues: string[] = [];
  if (!nonEmpty(input.runId)) issues.push('runId is required');
  if (!iso(input.startedAt)) issues.push('startedAt must be a valid ISO date');
  if (!iso(input.completedAt)) issues.push('completedAt must be a valid ISO date');
  if (iso(input.startedAt) && iso(input.completedAt) && Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
    issues.push('completedAt cannot be earlier than startedAt');
  }
  issues.push(...scenarioIssues(input.scenario));
  if (issues.length > 0) return blocked(input, 'INVALID_CONFIGURATION', issues);

  const result = await runThreePartyFlow(input.scenario);
  const trace = result.success ? result.value.trace : result.partialTrace;
  const state = result.success ? result.value : result.lastSafeState;
  const steps = deriveSteps(input.scenario, trace, state, result);
  if (!result.success) return {
    status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: input.runId as string,
    startedAt: input.startedAt as string, completedAt: input.completedAt as string,
    failedStep: result.failedStep, reason: result.reason, partialState: state,
    steps, summary: 'CASE_NOT_RESOLVED',
  };
  const finalPlan: Plan | undefined = result.value.plans.find(({ id }) => id === result.value.finalPlanId);
  if (finalPlan?.status !== 'APPROVED' || steps.at(-1)?.type !== 'CASE_RESOLVED') {
    return {
      status: 'FAILED', mode: 'LOCAL_SIMULATION', runId: input.runId as string,
      startedAt: input.startedAt as string, completedAt: input.completedAt as string,
      failedStep: 'DEMO_COMPLETION', reason: 'The flow did not provide verified resolution evidence',
      partialState: state, steps, summary: 'CASE_NOT_RESOLVED',
    };
  }
  return {
    status: 'COMPLETED', mode: 'LOCAL_SIMULATION', runId: input.runId as string,
    startedAt: input.startedAt as string, completedAt: input.completedAt as string,
    finalCase: result.value.exceptionCase, finalPlans: result.value.plans,
    approvals: result.value.approvals, operationHistory: result.value.operationHistory,
    steps, summary: 'CASE_RESOLVED',
  };
};

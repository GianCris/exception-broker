import { describe, expect, it } from 'vitest';

import { executeOrchestrationAction, type OrchestrationAction } from '../../../src/application/adaptiveOrchestrator.js';
import { validatePlan } from '../../../src/domain/validator.js';
import { createCase001ThreePartyFlowConfig } from '../../../src/integrations/calle/case001ThreePartyFlow.js';
import { runCase001AdaptiveFlow } from '../../../src/integrations/calle/case001AdaptiveFlow.js';
import { MockProvider } from '../../../src/integrations/calle/mockProvider.js';
import { runThreePartyFlow, type ThreePartyFlowConfig } from '../../../src/integrations/calle/threePartyFlow.js';

const providers = (config: ThreePartyFlowConfig): readonly MockProvider[] =>
  [config.plan001Rejection, config.caseAuthorization, ...config.finalApprovals]
    .map(({ provider }) => provider)
    .filter((provider): provider is MockProvider => provider instanceof MockProvider);

const immutableSourceEvidence = (config: ThreePartyFlowConfig): unknown => ({
  initialCase: config.initialCase,
  initialPlan: config.initialPlan,
  lineageId: config.lineageId,
  plan002: config.plan002,
  plan003: config.plan003,
  noSolutionEvidence: config.noSolutionEvidence,
  steps: [config.plan001Rejection, config.caseAuthorization, ...config.finalApprovals].map((step) => ({
    stepId: step.stepId,
    request: step.request,
    receivedAt: step.receivedAt,
    expected: step.expected,
    review: step.review,
  })),
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const freezeStepInputs = (step: ThreePartyFlowConfig['plan001Rejection']): ThreePartyFlowConfig['plan001Rejection'] =>
  Object.freeze({
    ...step,
    request: deepFreeze(step.request),
    expected: deepFreeze(step.expected),
    review: deepFreeze(step.review),
  });

const freezeScenarioInputs = (config: ThreePartyFlowConfig): ThreePartyFlowConfig => Object.freeze({
  ...config,
  initialCase: deepFreeze(config.initialCase),
  initialPlan: deepFreeze(config.initialPlan),
  plan002: deepFreeze(config.plan002),
  plan003: deepFreeze(config.plan003),
  noSolutionEvidence: deepFreeze(config.noSolutionEvidence),
  plan001Rejection: freezeStepInputs(config.plan001Rejection),
  caseAuthorization: freezeStepInputs(config.caseAuthorization),
  finalApprovals: Object.freeze(config.finalApprovals.map(freezeStepInputs)) as ThreePartyFlowConfig['finalApprovals'],
});

const reviewedDecisionAction = (
  bridgeResult: Extract<
    Awaited<ReturnType<typeof runCase001AdaptiveFlow>>,
    { success: true }
  >['trace'][number]['bridgeResult'],
  review: ThreePartyFlowConfig['plan001Rejection']['review'],
): OrchestrationAction => {
  if (bridgeResult === undefined) throw new Error('Expected prepared bridge evidence');
  return { type: 'APPLY_REVIEWED_DECISION', bridgeResult, review };
};

describe('CASE-001 adaptive equivalence adapter', () => {
  it('independently replays the golden path with equivalent authoritative business and audit evidence', async () => {
    const legacyConfig = createCase001ThreePartyFlowConfig();
    const adaptiveConfig = createCase001ThreePartyFlowConfig();
    expect(legacyConfig).not.toBe(adaptiveConfig);
    expect(legacyConfig.initialCase).not.toBe(adaptiveConfig.initialCase);
    expect(legacyConfig.initialPlan).not.toBe(adaptiveConfig.initialPlan);

    const legacy = await runThreePartyFlow(legacyConfig);
    const adaptive = await runCase001AdaptiveFlow(adaptiveConfig);
    expect(legacy.success).toBe(true);
    expect(adaptive.success).toBe(true);
    if (!legacy.success || !adaptive.success) return;

    expect(adaptive.registrationAssessment).toMatchObject({
      planAssessment: {
        outcome: 'PLAN_INVALID',
        validation: { valid: false, violations: [expect.objectContaining({ ruleId: 'R-04' })] },
      },
      physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
    });

    expect(adaptive.state.exceptionCase).toEqual(legacy.value.exceptionCase);
    expect(adaptive.state.exceptionCase.id).toBe(legacy.value.exceptionCase.id);
    expect(adaptive.state.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(100);
    expect(adaptive.state.plans).toEqual(legacy.value.plans);
    expect(adaptive.state.plans.map(({ id, caseId, version, status }) => ({ id, caseId, version, status }))).toEqual([
      { id: 'PLAN-001', caseId: 'CASE-001', version: 1, status: 'REJECTED' },
      { id: 'PLAN-002', caseId: 'CASE-001', version: 2, status: 'NO_SOLUTION' },
      { id: 'PLAN-003', caseId: 'CASE-001', version: 3, status: 'APPROVED' },
    ]);
    expect(adaptive.state.planLineages).toEqual(legacy.value.planLineages);
    expect(adaptive.state.planLineages).toEqual([{
      lineageId: adaptiveConfig.lineageId,
      caseId: adaptiveConfig.initialCase.id,
      planIds: ['PLAN-001', 'PLAN-002', 'PLAN-003'],
    }]);

    expect(adaptive.state.approvals).toEqual(legacy.value.approvals);
    expect(adaptive.state.approvals.map(({ approvalId, actorId, actorRole, planId, decision }) => ({
      approvalId, actorId, actorRole, planId, decision,
    }))).toEqual([
      { approvalId: 'FLOW-APPROVAL-001', actorId: 'client', actorRole: 'client', planId: 'PLAN-001', decision: 'REJECTED' },
      { approvalId: 'FLOW-APPROVAL-002', actorId: 'supplier', actorRole: 'supplier', planId: 'PLAN-003', decision: 'APPROVED' },
      { approvalId: 'FLOW-APPROVAL-003', actorId: 'production', actorRole: 'production', planId: 'PLAN-003', decision: 'APPROVED' },
      { approvalId: 'FLOW-APPROVAL-004', actorId: 'client', actorRole: 'client', planId: 'PLAN-003', decision: 'APPROVED' },
    ]);
    expect(adaptive.state.approvals.some(({ planId }) => planId === 'PLAN-002')).toBe(false);

    expect(adaptive.state.operationHistory).toEqual(legacy.value.operationHistory);
    expect(adaptive.state.operationHistory.map(({ operationId }) => operationId)).toEqual([
      'OPERATION-001', 'OPERATION-002', 'OPERATION-003', 'OPERATION-004', 'OPERATION-005',
    ]);
    expect(adaptive.state.events).toEqual(legacy.value.events);
    expect(adaptive.state.events.map(({ eventId, result }) => ({ eventId, result }))).toEqual([
      { eventId: 'FLOW-EVENT-001', result: 'REJECTION_RECORDED' },
      { eventId: 'FLOW-EVENT-002', result: 'CASE_AUTHORIZATION_APPLIED' },
      { eventId: 'FLOW-EVENT-003', result: 'APPROVAL_RECORDED' },
      { eventId: 'FLOW-EVENT-004', result: 'APPROVAL_RECORDED' },
      { eventId: 'FLOW-EVENT-005', result: 'PLAN_APPROVED' },
    ]);

    const plan001Validation = validatePlan(adaptiveConfig.initialCase, adaptiveConfig.initialPlan);
    const adaptiveRejection = adaptive.state.approvals.find(({ planId, decision }) => planId === 'PLAN-001' && decision === 'REJECTED');
    const adaptiveRejectionEvent = adaptive.state.events.find(({ planId, result }) => planId === 'PLAN-001' && result === 'REJECTION_RECORDED');
    expect(legacy.value.planRejectionEvidence).toEqual({
      planId: adaptiveConfig.initialPlan.id,
      actorId: adaptiveRejectionEvent?.actorId,
      decision: adaptiveRejection?.decision,
      violatedRequirementIds: plan001Validation.violations.map(({ ruleId }) => ruleId),
      validationIssues: plan001Validation.violations,
      summary: plan001Validation.violations.map(({ message }) => message).join('; '),
    });
    expect(adaptiveRejectionEvent).toMatchObject({
      eventId: 'FLOW-EVENT-001', operationId: 'OPERATION-001', requestId: 'REQUEST-001',
      actorId: adaptiveRejection?.actorId, decision: 'REJECTED', result: 'REJECTION_RECORDED',
    });

    expect(adaptive.noSolutionEvidence).toEqual(legacy.value.noSolutionEvidence);
    expect(adaptive.noSolutionAssessment).toEqual(legacy.value.noSolutionAssessment);
    expect(adaptive.noSolutionAssessment).toMatchObject({
      outcome: 'NO_SOLUTION_UNPROVEN', reason: 'LEGACY_EVIDENCE_NOT_EXHAUSTIVE',
    });
    expect(adaptive.state).not.toHaveProperty('noSolutionAssessment');

    expect(adaptive.finalDisposition).toEqual({
      type: 'LINEAGE_RESOLVED',
      scope: { caseId: 'CASE-001', lineageId: adaptiveConfig.lineageId, planId: 'PLAN-003' },
    });
    expect(legacy.value.finalPlanId).toBe('PLAN-003');
    expect(legacy.value.finalStatus).toBe('APPROVED');

    expect(adaptive.trace.map(({ actionType }) => actionType)).toEqual([
      'REGISTER_PLAN_PROPOSAL',
      'APPLY_REVIEWED_DECISION',
      'CREATE_SUCCESSOR',
      'APPLY_REVIEWED_DECISION',
      'CREATE_SUCCESSOR',
      'APPLY_REVIEWED_DECISION',
      'APPLY_REVIEWED_DECISION',
      'APPLY_REVIEWED_DECISION',
    ]);
    expect(adaptive.trace.slice(0, -1).map(({ orchestrationResult }) =>
      orchestrationResult.accepted ? orchestrationResult.disposition.type : 'FAILED'))
      .toEqual(Array(7).fill('AWAITING_EXTERNAL_ACTION'));
    expect(adaptive.trace.at(-1)?.orchestrationResult).toMatchObject({
      accepted: true, disposition: { type: 'LINEAGE_RESOLVED' },
    });
    expect(adaptive.trace.filter(({ callResult }) => callResult !== undefined)).toHaveLength(5);
    expect(providers(legacyConfig).map(({ invocationCount }) => invocationCount)).toEqual([1, 1, 1, 1, 1]);
    expect(providers(adaptiveConfig).map(({ invocationCount }) => invocationCount)).toEqual([1, 1, 1, 1, 1]);
  });

  it('uses independent deterministic inputs and produces identical adaptive results without mutation', async () => {
    const firstConfig = freezeScenarioInputs(createCase001ThreePartyFlowConfig());
    const secondConfig = createCase001ThreePartyFlowConfig();
    const firstBefore = structuredClone(immutableSourceEvidence(firstConfig));
    const secondBefore = structuredClone(immutableSourceEvidence(secondConfig));
    const first = await runCase001AdaptiveFlow(firstConfig);
    const second = await runCase001AdaptiveFlow(secondConfig);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) return;
    expect(first.state).toEqual(second.state);
    expect(first.registrationAssessment).toEqual(second.registrationAssessment);
    expect(first.noSolutionAssessment).toEqual(second.noSolutionAssessment);
    expect(first.finalDisposition).toEqual(second.finalDisposition);
    expect(first.trace.map(({ actionType, orchestrationResult }) => ({ actionType, orchestrationResult })))
      .toEqual(second.trace.map(({ actionType, orchestrationResult }) => ({ actionType, orchestrationResult })));
    expect(immutableSourceEvidence(firstConfig)).toEqual(firstBefore);
    expect(immutableSourceEvidence(secondConfig)).toEqual(secondBefore);
  });

  it('preserves supersession, duplicate-operation, and invalid-plan approval protections', async () => {
    const config = createCase001ThreePartyFlowConfig();
    const adaptive = await runCase001AdaptiveFlow(config);
    expect(adaptive.success).toBe(true);
    if (!adaptive.success) return;

    const finalClientTrace = adaptive.trace.at(-1);
    if (
      finalClientTrace?.bridgeResult?.ready !== true
      || finalClientTrace.bridgeResult.proposal.operationType !== 'PLAN_DECISION'
      || config.finalApprovals[2].review.action !== 'APPLY'
    ) {
      throw new Error('Missing final client evidence');
    }
    const delayed = executeOrchestrationAction(adaptive.state, reviewedDecisionAction({
      ready: true,
      proposal: { ...finalClientTrace.bridgeResult.proposal, planId: 'PLAN-001' },
    }, {
      ...config.finalApprovals[2].review,
      operationId: 'OPERATION-DELAYED',
      eventId: 'FLOW-EVENT-DELAYED',
      approvalId: 'FLOW-APPROVAL-DELAYED',
    }));
    expect(delayed).toMatchObject({ accepted: false, failure: { reason: 'PLAN_SUPERSEDED' } });
    expect(delayed.state).toBe(adaptive.state);

    const supplierTrace = adaptive.trace.find(({ stepId }) => stepId === 'SUPPLIER_APPROVAL');
    if (supplierTrace?.bridgeResult === undefined || config.finalApprovals[0].review.action !== 'APPLY') {
      throw new Error('Missing supplier evidence');
    }
    const duplicateOperation = executeOrchestrationAction(adaptive.state, reviewedDecisionAction(
      supplierTrace.bridgeResult,
      { ...config.finalApprovals[0].review, eventId: 'FLOW-EVENT-DUPLICATE-OPERATION' },
    ));
    expect(duplicateOperation).toMatchObject({ accepted: false, failure: { reason: 'DUPLICATE_OPERATION' } });
    expect(duplicateOperation.state).toBe(adaptive.state);

    const registrationOnly = executeOrchestrationAction({
      exceptionCase: structuredClone(config.initialCase),
      plans: [], planLineages: [], approvals: [], operationHistory: [], events: [],
    }, {
      type: 'REGISTER_PLAN_PROPOSAL', lineageId: config.lineageId, plan: structuredClone(config.initialPlan),
    });
    expect(registrationOnly.accepted).toBe(true);
    if (!registrationOnly.accepted) return;
    const rejectionTrace = adaptive.trace.find(({ stepId }) => stepId === 'PLAN_001_REJECTION');
    if (rejectionTrace?.bridgeResult?.ready !== true || config.plan001Rejection.review.action !== 'APPLY') {
      throw new Error('Missing rejection evidence');
    }
    const invalidApproval = executeOrchestrationAction(registrationOnly.state, reviewedDecisionAction({
      ready: true,
      proposal: { ...rejectionTrace.bridgeResult.proposal, decision: 'APPROVED' },
    }, {
      ...config.plan001Rejection.review,
      operationId: 'OPERATION-INVALID-APPROVAL',
      eventId: 'FLOW-EVENT-INVALID-APPROVAL',
      approvalId: 'FLOW-APPROVAL-INVALID-APPROVAL',
    }));
    expect(invalidApproval).toMatchObject({
      accepted: false,
      failure: { reason: 'PLAN_NOT_APPLICABLE_AFTER_AUTHORIZATION_REVIEW' },
    });
    expect(invalidApproval.state).toBe(registrationOnly.state);
  });
});

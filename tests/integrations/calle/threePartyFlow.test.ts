import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { case001Fixture } from '../../../src/domain/case-001.fixture.js';
import { validatePlan } from '../../../src/domain/validator.js';
import { createCase001ThreePartyFlowConfig } from '../../../src/integrations/calle/case001ThreePartyFlow.js';
import { MockProvider } from '../../../src/integrations/calle/mockProvider.js';
import {
  buildPlanRejectionEvidence,
  runThreePartyFlow,
  type FlowCallStep,
  type ThreePartyFlowConfig,
} from '../../../src/integrations/calle/threePartyFlow.js';

const providers = (config: ThreePartyFlowConfig): readonly MockProvider[] =>
  [config.plan001Rejection, config.caseAuthorization, ...config.finalApprovals]
    .map(({ provider }) => provider)
    .filter((provider): provider is MockProvider => provider instanceof MockProvider);

const approvalIdFor = (step: FlowCallStep): string => {
  if (step.review.action !== 'APPLY' || step.review.approvalId === undefined) {
    throw new Error('Test PLAN_DECISION must provide approvalId');
  }
  return step.review.approvalId;
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const externalResponse = (
  step: FlowCallStep,
  updates: Readonly<Record<string, unknown>> = {},
): unknown => ({
  status: 'completed',
  structuredResult: {
    decision: 'APPROVED', actorId: step.request.actorId, actorRole: step.request.actorRole,
    caseId: step.request.caseId, planId: step.request.planId ?? 'PLAN-002',
    summary: 'Deterministic test response', authorizationChanges: [], clarificationNeeded: false,
    ...updates,
  },
  taskCompleted: true,
  completionConfidence: { score: 0.9, label: 'high' },
  evidence: ['Deterministic evidence'],
});

describe('CASE-001 three-party integration flow', () => {
  it('runs the official flow through every existing integration layer', async () => {
    const config = createCase001ThreePartyFlowConfig();
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.plans.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'PLAN-001', status: 'REJECTED' },
      { id: 'PLAN-002', status: 'NO_SOLUTION' },
      { id: 'PLAN-003', status: 'APPROVED' },
    ]);
    expect(result.value.finalPlanId).toBe('PLAN-003');
    expect(result.value.finalStatus).toBe('APPROVED');
    expect(result.value.noSolutionEvidence).toEqual({
      availableUnitsTomorrow: 250, requiredMinimumUnitsTomorrow: 300, compatible: false,
    });
    expect(result.value.planVersionCreations).toEqual([
      { planId: 'PLAN-002', version: 2, createdAt: '2026-08-04T09:00:00-05:00' },
      { planId: 'PLAN-003', version: 3, createdAt: '2026-08-04T10:01:00-05:00' },
    ]);
    expect(result.value.trace).toHaveLength(5);
    for (const entry of result.value.trace) {
      expect(entry.callResult.success).toBe(true);
      expect(entry.bridgeResult.ready).toBe(true);
      expect(entry.applicationResult?.applied).toBe(true);
    }
    expect(providers(config).map(({ invocationCount }) => invocationCount)).toEqual([1, 1, 1, 1, 1]);
  });

  it('applies the case authorization before PLAN-003 approvals without creating an Approval', async () => {
    const result = await runThreePartyFlow(createCase001ThreePartyFlowConfig());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const client = result.value.exceptionCase.actors.find(({ role }) => role === 'client');
    expect(client?.authorization.maxSubstituteQuantity).toBe(100);
    const authorization = result.value.trace[1]?.applicationResult;
    expect(authorization?.applied).toBe(true);
    if (authorization?.applied) {
      expect(authorization.value.resolutionStatus).toBe('CASE_AUTHORIZATION_APPLIED');
      expect(authorization.value.approvals).toHaveLength(1);
      expect(authorization.value.approvals[0]?.decision).toBe('REJECTED');
    }
    expect(case001Fixture.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(50);
  });

  it('preserves the domain validation evidence linked to the exact PLAN-001 rejection', async () => {
    const config = createCase001ThreePartyFlowConfig();
    const domainValidation = validatePlan(config.initialCase, config.initialPlan);
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value.planRejectionEvidence).toEqual({
      planId: config.initialPlan.id,
      actorId: config.plan001Rejection.expected.actorId,
      decision: 'REJECTED',
      violatedRequirementIds: domainValidation.violations.map(({ ruleId }) => ruleId),
      validationIssues: domainValidation.violations,
      summary: domainValidation.violations.map(({ message }) => message).join('; '),
    });
    expect(result.value.planRejectionEvidence?.violatedRequirementIds).toEqual(['R-04']);
    expect(result.value.planRejectionEvidence?.validationIssues).toEqual([
      expect.objectContaining({
        ruleId: 'R-04', field: 'substituteQuantityTomorrow', actorRole: 'client',
        expected: 50, actual: 100,
      }),
    ]);
  });

  it('finds rejection evidence by semantic event identity despite insertion and reordering', async () => {
    const config = createCase001ThreePartyFlowConfig();
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const trace = result.value.trace.find(({ requestId }) =>
      requestId === config.plan001Rejection.request.requestId);
    const appliedResult = trace?.applicationResult;
    expect(appliedResult?.applied).toBe(true);
    if (trace === undefined || appliedResult?.applied !== true) return;
    const required = appliedResult.value.proposedEvents.find(({ eventId }) =>
      config.plan001Rejection.review.action === 'APPLY'
      && eventId === config.plan001Rejection.review.eventId);
    expect(required).toBeDefined();
    if (required === undefined) return;
    const unrelated = {
      ...required,
      eventId: 'OTHER-REJECTION-EVENT', operationId: 'OTHER-REJECTION-OPERATION',
      requestId: 'OTHER-REJECTION-REQUEST', planId: config.plan002.id,
    };
    const validation = validatePlan(config.initialCase, config.initialPlan);
    const withEvents = (events: typeof appliedResult.value.proposedEvents) => ({
      ...trace,
      applicationResult: {
        applied: true as const,
        value: { ...appliedResult.value, proposedEvents: events },
      },
    });
    const expected = result.value.planRejectionEvidence;
    expect(buildPlanRejectionEvidence(config.initialPlan, validation, config.plan001Rejection, withEvents([unrelated, required]))).toEqual(expected);
    expect(buildPlanRejectionEvidence(config.initialPlan, validation, config.plan001Rejection, withEvents([required, unrelated]))).toEqual(expected);
  });

  it('fails conservatively when domain rejection evidence is absent', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const config = {
      ...base,
      initialPlan: {
        ...base.initialPlan,
        originalQuantityTomorrow: 250,
        substituteQuantityTomorrow: 50,
        originalQuantityLater: 100,
        supplierAbsorbedCost: 25,
      },
    };
    expect(validatePlan(config.initialCase, config.initialPlan).valid).toBe(true);
    expect(await runThreePartyFlow(config)).toMatchObject({
      success: false, failedStep: 'PLAN_001_VALIDATION_EVIDENCE',
      lastSafeState: { planRejectionEvidence: null },
    });
    expect(providers(config).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('rejects contradictory rejection evidence instead of associating another event', async () => {
    const config = createCase001ThreePartyFlowConfig();
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const trace = result.value.trace.find(({ requestId }) => requestId === config.plan001Rejection.request.requestId);
    if (trace?.applicationResult?.applied !== true) throw new Error('Expected applied rejection trace');
    const contradictory = {
      ...trace,
      applicationResult: {
        applied: true as const,
        value: {
          ...trace.applicationResult.value,
          proposedEvents: trace.applicationResult.value.proposedEvents.map((event) => ({
            ...event, actorId: 'ACTOR-CONTRADICTORY',
          })),
        },
      },
    };
    expect(buildPlanRejectionEvidence(
      config.initialPlan,
      validatePlan(config.initialCase, config.initialPlan),
      config.plan001Rejection,
      contradictory,
    )).toBeNull();
  });

  it('never finalizes PLAN-003 before the third real actor approval', async () => {
    const result = await runThreePartyFlow(createCase001ThreePartyFlowConfig());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const statuses = result.value.trace.slice(2).map(({ applicationResult }) => {
      if (applicationResult?.applied !== true) return undefined;
      return applicationResult.value.updatedPlans.find(({ id }) => id === 'PLAN-003')?.status;
    });
    expect(statuses).toEqual(['PENDING_APPROVAL', 'PENDING_APPROVAL', 'APPROVED']);
    expect(result.value.approvals.filter(({ planId }) => planId === 'PLAN-003').map(({ actorRole }) => actorRole))
      .toEqual(['supplier', 'production', 'client']);
  });

  it('keeps requestId, operationId, approvalId, and eventId explicit and unique', async () => {
    const result = await runThreePartyFlow(createCase001ThreePartyFlowConfig());
    expect(result.success).toBe(true);
    if (!result.success) return;
    const requestIds = result.value.trace.map(({ requestId }) => requestId);
    const operationIds = result.value.operationHistory.map(({ operationId }) => operationId);
    const approvalIds = result.value.approvals.map(({ approvalId }) => approvalId);
    const eventIds = result.value.events.map(({ eventId }) => eventId);
    for (const ids of [requestIds, operationIds, approvalIds, eventIds]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(new Set([...requestIds, ...operationIds, ...approvalIds, ...eventIds]).size)
      .toBe(requestIds.length + operationIds.length + approvalIds.length + eventIds.length);
  });

  it.each([
    ['operationId', (config: ThreePartyFlowConfig) => ({
      ...config,
      finalApprovals: [config.finalApprovals[0], config.finalApprovals[1], {
        ...config.finalApprovals[2], review: {
          ...config.finalApprovals[2].review,
          operationId: config.finalApprovals[0].review.operationId,
        },
      }] as const,
    })],
    ['requestId', (config: ThreePartyFlowConfig) => ({
      ...config,
      finalApprovals: [config.finalApprovals[0], config.finalApprovals[1], {
        ...config.finalApprovals[2], request: {
          ...config.finalApprovals[2].request,
          requestId: config.finalApprovals[0].request.requestId,
        },
      }] as const,
    })],
    ['approvalId', (config: ThreePartyFlowConfig) => ({
      ...config,
      finalApprovals: [config.finalApprovals[0], config.finalApprovals[1], {
        ...config.finalApprovals[2], review: {
          ...config.finalApprovals[2].review,
          approvalId: approvalIdFor(config.finalApprovals[0]),
        },
      }] as const,
    })],
  ] as const)('stops before any provider call for duplicate %s', async (_label, alter) => {
    const config = alter(createCase001ThreePartyFlowConfig()) as ThreePartyFlowConfig;
    const result = await runThreePartyFlow(config);
    expect(result).toMatchObject({ success: false, failedStep: 'CONFIGURATION' });
    expect(providers(config).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('stops at a provider failure and preserves the initial state', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const config = {
      ...base,
      plan001Rejection: {
        ...base.plan001Rejection,
        provider: new MockProvider({ type: 'operational-error', kind: 'NETWORK_FAILURE' }),
      },
    };
    const result = await runThreePartyFlow(config);
    expect(result).toMatchObject({ success: false, failedStep: 'PLAN_001_REJECTION' });
    if (!result.success) {
      expect(result.lastSafeState.plans).toEqual([base.initialPlan]);
      expect(result.lastSafeState.approvals).toEqual([]);
    }
  });

  it('stops on structuredResult null without continuing to later providers', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const config = {
      ...base,
      plan001Rejection: {
        ...base.plan001Rejection,
        provider: new MockProvider({ type: 'response', payload: {
          status: 'completed', structuredResult: null, taskCompleted: false,
          completionConfidence: { score: 0.5, label: 'low' }, evidence: [],
        } }),
      },
    };
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(false);
    expect(providers(config).slice(1).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('stops on an unknown authorization field before PLAN-003 exists', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const config = {
      ...base,
      caseAuthorization: {
        ...base.caseAuthorization,
        provider: new MockProvider({ type: 'response', payload: externalResponse(base.caseAuthorization, {
          authorizationChanges: [{ field: 'unknownAuthorization', newValue: 100 }],
        }) }),
      },
    };
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedStep).toBe('CLIENT_CASE_AUTHORIZATION');
      expect(result.lastSafeState.plans.map(({ id }) => id)).toEqual(['PLAN-001', 'PLAN-002']);
      expect(result.lastSafeState.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity).toBe(50);
    }
  });

  it('preserves two approvals but never claims resolution when the third provider fails', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const failedThird = {
      ...base.finalApprovals[2],
      provider: new MockProvider({ type: 'operational-error', kind: 'TIMEOUT' }),
    };
    const config = { ...base, finalApprovals: [base.finalApprovals[0], base.finalApprovals[1], failedThird] as const };
    const result = await runThreePartyFlow(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.lastSafeState.approvals.filter(({ planId }) => planId === 'PLAN-003')).toHaveLength(2);
      expect(result.lastSafeState.plans.find(({ id }) => id === 'PLAN-003')?.status).toBe('PENDING_APPROVAL');
    }
  });

  it('rejects final approvals configured out of the official actor order', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const config = { ...base, finalApprovals: [base.finalApprovals[2], base.finalApprovals[1], base.finalApprovals[0]] as const };
    expect(await runThreePartyFlow(config)).toMatchObject({ success: false, failedStep: 'CONFIGURATION' });
  });

  it('is deterministic and does not mutate its explicit scenario input', async () => {
    const firstConfig = deepFreeze(createCase001ThreePartyFlowConfig());
    const before = JSON.stringify(firstConfig);
    const first = await runThreePartyFlow(firstConfig);
    const second = await runThreePartyFlow(createCase001ThreePartyFlowConfig());
    expect(first).toEqual(second);
    expect(JSON.stringify(firstConfig)).toBe(before);
  });

  it('contains no real provider, SDK, network, secret, React, ID, or timestamp generation', () => {
    const source = [
      'src/integrations/calle/threePartyFlow.ts',
      'src/integrations/calle/case001ThreePartyFlow.ts',
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/CallEProvider|@call-e\/calle|CALLE_API_KEY|fetch\s*\(|axios|react/i);
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|randomUUID|setTimeout/);
    expect(readFileSync('src/integrations/calle/threePartyFlow.ts', 'utf8')).not.toContain("'R-04'");
  });
});

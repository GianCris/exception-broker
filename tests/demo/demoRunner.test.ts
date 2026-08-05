import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runDemo } from '../../src/demo/demoRunner.js';
import { createCase001ThreePartyFlowConfig } from '../../src/integrations/calle/case001ThreePartyFlow.js';
import { MockProvider } from '../../src/integrations/calle/mockProvider.js';
import type { FlowCallStep, ThreePartyFlowConfig } from '../../src/integrations/calle/threePartyFlow.js';

const input = (scenario = createCase001ThreePartyFlowConfig()) => ({
  mode: 'LOCAL_SIMULATION', scenario, runId: 'DEMO-RUN-001',
  startedAt: '2026-08-04T07:55:00-05:00', completedAt: '2026-08-04T13:05:00-05:00',
} as const);

const providers = (scenario: ThreePartyFlowConfig): readonly MockProvider[] =>
  [scenario.plan001Rejection, scenario.caseAuthorization, ...scenario.finalApprovals]
    .map(({ provider }) => provider)
    .filter((provider): provider is MockProvider => provider instanceof MockProvider);

const failStep = (step: FlowCallStep): FlowCallStep => ({
  ...step,
  provider: new MockProvider({ type: 'operational-error', kind: 'NETWORK_FAILURE' }),
});

const validResponse = (step: FlowCallStep): unknown => ({
  status: 'completed',
  structuredResult: {
    decision: 'APPROVED', actorId: step.request.actorId, actorRole: step.request.actorRole,
    caseId: step.request.caseId, planId: step.request.planId ?? 'PLAN-002',
    summary: 'Deterministic response', authorizationChanges: [], clarificationNeeded: false,
  },
  taskCompleted: true,
  completionConfidence: { score: 0.9, label: 'high' },
  evidence: ['Deterministic evidence'],
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

describe('safe deterministic demo runner', () => {
  it('completes LOCAL_SIMULATION with nine evidence-backed steps in order', async () => {
    const result = await runDemo(input());
    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    expect(result.steps.map(({ type }) => type)).toEqual([
      'PLAN-001_REJECTED', 'PLAN-002_NO_SOLUTION', 'CASE_AUTHORIZATION_APPLIED',
      'PLAN-003_CREATED', 'SUPPLIER_APPROVED', 'PRODUCTION_APPROVED', 'CLIENT_APPROVED',
      'PLAN-003_FINALIZED', 'CASE_RESOLVED',
    ]);
    expect(result.finalPlans.map(({ status }) => status)).toEqual(['REJECTED', 'NO_SOLUTION', 'APPROVED']);
    expect(result.summary).toBe('CASE_RESOLVED');
    const finalApprovals = result.approvals.filter(({ planId }) => planId === 'PLAN-003');
    expect(finalApprovals.map(({ actorRole }) => actorRole)).toEqual(['supplier', 'production', 'client']);
    expect(new Set(finalApprovals.map(({ approvalId }) => approvalId)).size).toBe(3);
  });

  it('keeps request, operation, and approval identifiers distinct', async () => {
    const result = await runDemo(input());
    expect(result.status).toBe('COMPLETED');
    if (result.status !== 'COMPLETED') return;
    const requestIds = result.steps.flatMap(({ requestId }) => requestId === undefined ? [] : [requestId]);
    const operationIds = result.steps.flatMap(({ operationId }) => operationId === undefined ? [] : [operationId]);
    const approvalIds = result.steps.flatMap(({ approvalId }) => approvalId === undefined ? [] : [approvalId]);
    expect(new Set([...requestIds, ...operationIds, ...approvalIds]).size)
      .toBe(requestIds.length + operationIds.length + approvalIds.length);
  });

  it.each([
    ['supplier', 0, ['PRODUCTION_APPROVED', 'CLIENT_APPROVED']],
    ['production', 1, ['CLIENT_APPROVED']],
    ['client', 2, []],
  ] as const)('stops on %s failure and never marks future approvals or resolution', async (_role, index, absent) => {
    const base = createCase001ThreePartyFlowConfig();
    const approvals = [...base.finalApprovals] as [FlowCallStep, FlowCallStep, FlowCallStep];
    approvals[index] = failStep(approvals[index]);
    const scenario = { ...base, finalApprovals: approvals };
    const result = await runDemo(input(scenario));
    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    const types = result.steps.map(({ type }) => type);
    for (const type of absent) expect(types).not.toContain(type);
    expect(types).not.toContain('PLAN-003_FINALIZED');
    expect(types).not.toContain('CASE_RESOLVED');
    expect(result.partialState.plans.find(({ id }) => id === 'PLAN-003')?.status).toBe('PENDING_APPROVAL');
    expect(result.summary).toBe('CASE_NOT_RESOLVED');
  });

  it('preserves Supplier and Production approvals when Client fails', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const scenario = { ...base, finalApprovals: [base.finalApprovals[0], base.finalApprovals[1], failStep(base.finalApprovals[2])] as const };
    const result = await runDemo(input(scenario));
    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.steps.map(({ type }) => type)).toContain('SUPPLIER_APPROVED');
    expect(result.steps.map(({ type }) => type)).toContain('PRODUCTION_APPROVED');
    expect(result.partialState.approvals.filter(({ planId }) => planId === 'PLAN-003')).toHaveLength(2);
  });

  it('stops authorization failure before PLAN-003 exists', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const scenario = { ...base, caseAuthorization: failStep(base.caseAuthorization) };
    const result = await runDemo(input(scenario));
    expect(result.status).toBe('FAILED');
    if (result.status !== 'FAILED') return;
    expect(result.steps.map(({ type }) => type)).toEqual(['PLAN-001_REJECTED', 'PLAN-002_NO_SOLUTION']);
    expect(result.partialState.plans.some(({ id }) => id === 'PLAN-003')).toBe(false);
    expect(providers(scenario).slice(2).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('reports Mapper, Bridge, and Decision Application failures without later steps', async () => {
    const mapperBase = createCase001ThreePartyFlowConfig();
    const mapperScenario = {
      ...mapperBase,
      plan001Rejection: {
        ...mapperBase.plan001Rejection,
        provider: new MockProvider({ type: 'response', payload: {
          status: 'completed', structuredResult: null, taskCompleted: false,
          completionConfidence: undefined, evidence: [],
        } }),
      },
    };
    expect(await runDemo(input(mapperScenario))).toMatchObject({ status: 'FAILED', steps: [] });
    expect(providers(mapperScenario).slice(1).every(({ invocationCount }) => invocationCount === 0)).toBe(true);

    const bridgeBase = createCase001ThreePartyFlowConfig();
    const bridgeScenario = {
      ...bridgeBase,
      plan001Rejection: {
        ...bridgeBase.plan001Rejection,
        expected: { ...bridgeBase.plan001Rejection.expected, actorId: 'ACTOR-NOT-EXPECTED' },
      },
    } as ThreePartyFlowConfig;
    expect(await runDemo(input(bridgeScenario))).toMatchObject({ status: 'FAILED', steps: [] });
    expect(providers(bridgeScenario).slice(1).every(({ invocationCount }) => invocationCount === 0)).toBe(true);

    const applicationBase = createCase001ThreePartyFlowConfig();
    const applicationScenario = {
      ...applicationBase,
      caseAuthorization: {
        ...applicationBase.caseAuthorization,
        review: { ...applicationBase.caseAuthorization.review, authorizationReviews: [] },
      },
    } as ThreePartyFlowConfig;
    const applicationResult = await runDemo(input(applicationScenario));
    expect(applicationResult).toMatchObject({
      status: 'FAILED', steps: [{ type: 'PLAN-001_REJECTED' }, { type: 'PLAN-002_NO_SOLUTION' }],
    });
    expect(providers(applicationScenario).slice(2).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('does not mistake an externally valid payload for a direct domain result', async () => {
    const base = createCase001ThreePartyFlowConfig();
    const supplier = base.finalApprovals[0];
    const scenario = {
      ...base,
      finalApprovals: [{ ...supplier, provider: new MockProvider({ type: 'response', payload: validResponse(supplier) }) }, base.finalApprovals[1], base.finalApprovals[2]] as const,
    };
    const result = await runDemo(input(scenario));
    expect(result.status).toBe('COMPLETED');
  });

  it.each(['LIVE_CALL_E', 'RECORDED_RUN'] as const)('blocks unavailable mode %s without executing providers', async (mode) => {
    const scenario = createCase001ThreePartyFlowConfig();
    const result = await runDemo({ ...input(scenario), mode });
    expect(result).toMatchObject({ status: 'BLOCKED', mode, reason: 'MODE_NOT_AVAILABLE' });
    expect(providers(scenario).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('fails closed on an unknown runtime mode without simulation fallback', async () => {
    const scenario = createCase001ThreePartyFlowConfig();
    expect(await runDemo({ ...input(scenario), mode: 'ALMOST_LOCAL' })).toMatchObject({
      status: 'BLOCKED', reason: 'INVALID_MODE',
    });
    expect(providers(scenario).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it.each([
    [{ runId: '' }, 'runId is required'],
    [{ startedAt: 'not-a-date' }, 'startedAt must be a valid ISO date'],
    [{ completedAt: 'not-a-date' }, 'completedAt must be a valid ISO date'],
    [{ startedAt: '2026-08-05T00:00:00Z', completedAt: '2026-08-04T00:00:00Z' }, 'completedAt cannot be earlier than startedAt'],
  ] as const)('blocks invalid run configuration before providers execute', async (change, issue) => {
    const scenario = createCase001ThreePartyFlowConfig();
    const result = await runDemo({ ...input(scenario), ...change });
    expect(result).toMatchObject({ status: 'BLOCKED', reason: 'INVALID_CONFIGURATION' });
    if (result.status === 'BLOCKED') expect(result.issues).toContain(issue);
    expect(providers(scenario).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('blocks an incomplete scenario before executing any available provider', async () => {
    const scenario = createCase001ThreePartyFlowConfig();
    const incomplete = { ...scenario, finalApprovals: [] } as unknown as ThreePartyFlowConfig;
    expect(await runDemo(input(incomplete))).toMatchObject({ status: 'BLOCKED', reason: 'INVALID_CONFIGURATION' });
    expect(providers(scenario).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('reports duplicate identifiers and incorrect order as controlled failures before provider calls', async () => {
    const duplicateBase = createCase001ThreePartyFlowConfig();
    const duplicate = {
      ...duplicateBase,
      finalApprovals: [duplicateBase.finalApprovals[0], duplicateBase.finalApprovals[1], {
        ...duplicateBase.finalApprovals[2], review: {
          ...duplicateBase.finalApprovals[2].review,
          operationId: duplicateBase.finalApprovals[0].review.operationId,
        },
      }] as const,
    };
    const duplicateResult = await runDemo(input(duplicate));
    expect(duplicateResult).toMatchObject({ status: 'FAILED', failedStep: 'CONFIGURATION' });
    expect(providers(duplicate).every(({ invocationCount }) => invocationCount === 0)).toBe(true);

    const orderBase = createCase001ThreePartyFlowConfig();
    const wrongOrder = { ...orderBase, finalApprovals: [orderBase.finalApprovals[2], orderBase.finalApprovals[1], orderBase.finalApprovals[0]] as const };
    expect(await runDemo(input(wrongOrder))).toMatchObject({ status: 'FAILED', failedStep: 'CONFIGURATION' });
    expect(providers(wrongOrder).every(({ invocationCount }) => invocationCount === 0)).toBe(true);
  });

  it('is deterministic, does not mutate input, and works with frozen data', async () => {
    const frozen = deepFreeze(input());
    const before = JSON.stringify(frozen);
    const first = await runDemo(frozen);
    const second = await runDemo(input());
    expect(first).toEqual(second);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('invokes every deterministic provider at most once and emits no sensitive values', async () => {
    const scenario = createCase001ThreePartyFlowConfig();
    const result = await runDemo(input(scenario));
    expect(providers(scenario).map(({ invocationCount }) => invocationCount)).toEqual([1, 1, 1, 1, 1]);
    expect(JSON.stringify(result)).not.toMatch(/CALLE_API_KEY|phoneNumber|\+12025550123/i);
  });

  it('contains no real provider, environment, network, React, secret, ID, or date generation', () => {
    const source = ['src/demo/demoRunner.ts', 'src/demo/demoTypes.ts']
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/CallEProvider|CALLE_API_KEY|process\.env|fetch\s*\(|axios|react|@call-e\/calle/i);
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|randomUUID|setTimeout/);
  });
});

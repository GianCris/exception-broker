import { describe, expect, it } from 'vitest';
import { DecisionAcquisitionSession } from '../../src/application/decisionAcquisitionSession.js';
import { createOperatorRequest, createOperatorScenario } from '../../src/sandbox/operatorScenario.js';
import { MockProvider } from '../../src/integrations/calle/mockProvider.js';
import { operationEffects, presentAttempt } from '../../src/presentation/decisionTraceViewModel.js';

const setup = () => {
  const scenario = createOperatorScenario();
  return { scenario, session: new DecisionAcquisitionSession(scenario.state, scenario.request, scenario.receivedAt) };
};
const command = (scenario: ReturnType<typeof createOperatorScenario>) => ({ ...scenario.reviewMetadata, action: 'APPLY' as const, authorizationReviews: [] });

describe('Operator acquisition session through existing controls', () => {
  it.each(['APPROVED', 'REJECTED'] as const)('%s is mapped, retained, explicitly reviewed and applied', async (decision) => {
    const { scenario, session } = setup();
    const provider = new MockProvider({ type: 'response', payload: { ...scenario.response, structuredResult: { ...scenario.response.structuredResult, decision } } });
    const before = session.state;
    const acquired = await session.acquire(provider);
    expect(acquired.status).toBe('REVIEWABLE');
    if (acquired.status !== 'REVIEWABLE') throw new Error('Expected review');
    expect(acquired.bridge.proposal.decision).toBe(decision);
    expect(acquired.bridge.reviewTarget).toEqual(acquired.bridge.proposal);
    expect(session.state).toBe(before);
    const reviewed = session.review(command(scenario));
    if (reviewed.status !== 'REVIEWED') throw new Error('Expected application');
    expect(reviewed.result.accepted).toBe(true);
    expect(session.state.plans[0]?.status).toBe(decision);
    expect(session.state.approvals.at(-1)).toMatchObject({ actorId: scenario.request.actorId, planId: scenario.request.planId, decision });
    expect(session.state.events.at(-1)?.requestId).toBe(scenario.request.requestId);
    expect(presentAttempt(reviewed.result, scenario.request.planId!).label).toBe(decision === 'APPROVED' ? 'ALLOW' : 'REJECTED');
    if (decision === 'APPROVED') expect(reviewed.result).toMatchObject({ disposition: { type: 'LINEAGE_RESOLVED', scope: { caseId: scenario.request.caseId, planId: scenario.request.planId } } });
    else expect(reviewed.result).toMatchObject({ disposition: { type: 'AWAITING_EXTERNAL_ACTION' }, step: { applicationResolutionStatus: 'PLAN_REJECTED' } });
    expect(session.review(command(scenario))).toEqual({ status: 'NOT_AVAILABLE', reason: 'REVIEW_NOT_AVAILABLE' });
    expect(provider.invocationCount).toBe(1);
  });

  it('clarification is a Bridge-ready safe stop, not an application', async () => {
    const { scenario, session } = setup();
    const before = session.state;
    expect(await session.acquire(new MockProvider({ type: 'response', payload: { ...scenario.response, structuredResult: {
      ...scenario.response.structuredResult, decision: 'NEEDS_CLARIFICATION', clarificationNeeded: true,
    } } }))).toMatchObject({ status: 'STOPPED', stage: 'CLARIFICATION', bridge: { ready: true } });
    expect(session.review(command(scenario)).status).toBe('NOT_AVAILABLE');
    expect(session.state).toBe(before);
  });

  it.each([null, {}, { status: 'completed', structuredResult: null, taskCompleted: true, completionConfidence: null, evidence: [] }])('unusable response stops: %j', async (payload) => {
    const { session, scenario } = setup();
    const before = session.state;
    expect(await session.acquire(new MockProvider({ type: 'response', payload }))).toMatchObject({ status: 'STOPPED', stage: 'MAPPING', mapping: { success: false, retryable: false } });
    expect(session.review(command(scenario)).status).toBe('NOT_AVAILABLE');
    expect(session.state).toBe(before);
  });

  it('preserves operational error classification and consumes the failed attempt', async () => {
    const { session } = setup();
    const provider = new MockProvider({ type: 'operational-error', kind: 'OPERATION_REJECTED' });
    expect(await session.acquire(provider)).toMatchObject({ status: 'STOPPED', stage: 'PROVIDER', kind: 'OPERATION_REJECTED', mapping: {
      reason: 'Call provider rejected the operation', retryable: false, issues: ['Provider operational error: OPERATION_REJECTED'],
    } });
    expect(await session.acquire(provider)).toMatchObject({ status: 'NOT_AVAILABLE' });
    expect(provider.invocationCount).toBe(1);
  });

  it.each(['caseId', 'planId', 'actorId', 'actorRole'] as const)('rejects provider %s mismatch', async (field) => {
    const { scenario, session } = setup();
    const provider = new MockProvider({ type: 'response', payload: { ...scenario.response, structuredResult: {
      ...scenario.response.structuredResult, [field]: field === 'actorRole' ? 'supplier' : 'OTHER-IDENTITY',
    } } });
    expect(await session.acquire(provider)).toMatchObject({ status: 'STOPPED', stage: 'MAPPING', mapping: { reason: `Decision ${field} does not match request` } });
    expect(session.state.approvals).toHaveLength(2);
  });

  it('Bridge failure remains stopped, distinct from a successful mapping', async () => {
    const scenario = createOperatorScenario();
    const state = { ...scenario.state, plans: [] };
    const session = new DecisionAcquisitionSession(state, scenario.request, scenario.receivedAt);
    expect(await session.acquire(scenario.provider)).toMatchObject({ status: 'STOPPED', stage: 'BRIDGE', bridge: { ready: false, reason: 'Expected plan does not exist in the current context' } });
  });

  it('DISCARD uses the existing bound path with exact zero effects', async () => {
    const { scenario, session } = setup();
    await session.acquire(scenario.provider);
    const before = session.state;
    const reviewed = session.review({ action: 'DISCARD', operationId: 'DISCARD', reviewedAt: scenario.reviewMetadata.reviewedAt, reviewedBy: 'operator' });
    expect(reviewed).toMatchObject({ status: 'REVIEWED', result: { accepted: false, failure: { reason: 'DISCARDED_BY_REVIEWER' } } });
    expect(session.state).toBe(before);
  });

  it('uses CURRENT state when an explicit successor is created after acquisition', async () => {
    const { scenario, session } = setup();
    await session.acquire(scenario.provider);
    const advanced = session.executePlanAction({ type: 'CREATE_SUCCESSOR', lineageId: scenario.state.planLineages[0]!.lineageId,
      predecessorPlanId: scenario.state.plans[0]!.id, newPlanId: 'PLAN-OPERATOR-NEXT' as typeof scenario.state.plans[0]['id'], changes: {} });
    expect(advanced.accepted).toBe(true);
    const before = session.state;
    expect(session.review(command(scenario))).toMatchObject({ status: 'REVIEWED', result: { accepted: false, failure: { reason: 'PLAN_SUPERSEDED' } } });
    expect(session.state).toBe(before);
  });

  it('physical shortfall blocks through Application with no new records or state replacement', async () => {
    const scenario = createOperatorScenario();
    const state = structuredClone(scenario.state);
    const supply = state.exceptionCase.actors[0]!.constraints[0]!;
    if (supply.type !== 'SUPPLY') throw new Error('Supply required');
    supply.substituteQuantity = 100;
    const session = new DecisionAcquisitionSession(state, scenario.request, scenario.receivedAt);
    await session.acquire(scenario.provider);
    const before = session.state;
    const reviewed = session.review(command(scenario));
    if (reviewed.status !== 'REVIEWED') throw new Error('Expected review');
    expect(reviewed.result).toMatchObject({ accepted: false, failure: { reason: 'PLAN_PHYSICALLY_INFEASIBLE', issues: ['SUBSTITUTE_SUPPLY_EXCEEDED'] } });
    expect(session.state).toBe(before);
    expect(operationEffects(before, session.state)).toMatchObject({ decisions: [], operations: [], events: [], sameState: true });
    expect(presentAttempt(reviewed.result, scenario.request.planId!).label).toBe('BLOCK');
  });

  it('rejects concurrent and subsequent acquisition before invoking a second provider', async () => {
    const { scenario, session } = setup();
    const first = session.acquire(scenario.provider);
    expect(await session.acquire(scenario.provider)).toEqual({ status: 'NOT_AVAILABLE', reason: 'ACQUISITION_ALREADY_ATTEMPTED' });
    await first;
    expect(await session.acquire(scenario.provider)).toMatchObject({ status: 'NOT_AVAILABLE' });
    expect(scenario.provider.invocationCount).toBe(1);
  });

  it('unexpected errors also consume the attempt without reinterpretation', async () => {
    const { session } = setup();
    const error = new Error('programming failure');
    const provider = new MockProvider({ type: 'internal-error', error });
    await expect(session.acquire(provider)).rejects.toBe(error);
    expect(await session.acquire(provider)).toMatchObject({ status: 'NOT_AVAILABLE' });
    expect(provider.invocationCount).toBe(1);
  });

  it('owns independent frozen state, request and review content; callers cannot substitute B for A', async () => {
    const { scenario, session } = setup();
    expect(session.state).not.toBe(scenario.state);
    const result = await session.acquire(scenario.provider);
    if (result.status !== 'REVIEWABLE') throw new Error('Review required');
    expect(() => Object.assign(result.bridge.proposal, { summary: 'B' })).toThrow();
    expect(() => Object.assign(result.bridge.reviewTarget, { requestId: 'B' })).toThrow();
    expect(() => Object.assign(session.request, { objective: 'B' })).toThrow();
    expect(result.bridge.proposal.summary).toBe(scenario.response.structuredResult.summary);
  });

  it('unchanged logical request retains V1, while material changes cannot silently reuse it', () => {
    const request = createOperatorRequest();
    expect(createOperatorRequest(structuredClone(request))).toEqual(request);
    expect(request.requestId).toBe('REQUEST-OPERATOR-SANDBOX-CLIENT-V1');
    for (const change of [{ objective: 'Changed task' }, { context: 'Changed facts' }, { phoneNumber: '+15555550456' }, { requestId: 'REQUEST-OPERATOR-SANDBOX-CLIENT-V2' }]) {
      expect(() => createOperatorRequest({ ...request, ...change })).toThrow('explicitly reviewed request version');
    }
  });
});

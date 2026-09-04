import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  CALLE_TESTING_HOTLINE,
  LIVE_ALLOWED_DECISIONS,
  LIVE_REQUEST_DEFINITION,
  createLiveRequest,
  runLiveOperatorSandbox,
  type LiveDependencies,
} from '../../scripts/operator-sandbox-live.js';
import { MockProvider } from '../../src/integrations/calle/mockProvider.js';
import type { CallProvider } from '../../src/integrations/calle/provider.js';
import type { CallRequest } from '../../src/integrations/calle/types.js';
import { OPERATOR_SANDBOX_FACTS, createOperatorScenario, type OperatorSandboxFacts } from '../../src/sandbox/operatorScenario.js';

const completed = (decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION' = 'APPROVED') => ({
  id: 'TEST-INTERACTION-NOT-LIVE', status: 'completed', taskCompleted: true,
  structuredResult: { decision, caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX',
    actorId: 'ACTOR-OPERATOR-CLIENT', actorRole: 'client', summary: `Synthetic ${decision}`,
    authorizationChanges: [], clarificationNeeded: decision === 'NEEDS_CLARIFICATION' },
  completionConfidence: { score: 1, label: 'deterministic fake' }, evidence: ['Synthetic evidence'],
});

const fixture = (answers: string[] = []) => {
  const output: string[] = [];
  const reads = vi.fn<() => string | undefined>(() => 'fake-credential-never-sent');
  const provider = new MockProvider({ type: 'response', payload: completed() });
  const factory = vi.fn((_secret: string, _allowed: typeof LIVE_ALLOWED_DECISIONS): CallProvider => provider);
  const dependencies: LiveDependencies = {
    io: { write: (line) => output.push(line), ask: vi.fn(async () => answers.shift()) },
    interactiveTerminal: true,
    arguments: [],
    identity: vi.fn(() => 'IDENTITY-1'),
    now: vi.fn(() => '2027-08-01T12:00:00Z'),
    readSecret: reads,
    providerFactory: factory,
  };
  return { output, reads, provider, factory, dependencies };
};
const confirm = (id = 'IDENTITY-1') => `CALL REQUEST-OPERATOR-LIVE-${id}`;

describe('Operator Sandbox live composition (offline fakes only)', () => {
  it('derives operational state and live context coherently from immutable shared facts', () => {
    expect(Object.isFrozen(OPERATOR_SANDBOX_FACTS)).toBe(true);
    const facts: OperatorSandboxFacts = Object.freeze({
      ...OPERATOR_SANDBOX_FACTS, requestedQuantity: 510, originalQuantity: 360,
    });
    const scenario = createOperatorScenario(facts);
    const live = createLiveRequest('REQUEST-FACTS-TEST', '2027-08-01T12:00:00Z', CALLE_TESTING_HOTLINE, facts);
    expect(scenario.state.exceptionCase.requestedQuantity).toBe(510);
    expect(scenario.state.plans[0]).toMatchObject({ originalQuantityTomorrow: 360, substituteQuantityTomorrow: 150 });
    expect(scenario.request.context).toContain('510 units');
    expect(scenario.request.context).toContain('360 original and 150 substitute');
    expect(live.context).toContain('510 units');
    expect(live.context).toContain('360 original and 150 substitute');
    expect(live).toMatchObject({ requestId: 'REQUEST-FACTS-TEST', phoneNumber: CALLE_TESTING_HOTLINE,
      objective: expect.stringContaining('return exactly one decision'), expectedDecisionSchema: { name: 'exception-broker-phone-decision', version: 1 } });
    expect(live).not.toBe(scenario.request);
  });

  it('stops without TTY before identity, secret, provider construction or invocation', async () => {
    const item = fixture();
    item.dependencies = { ...item.dependencies, interactiveTerminal: false };
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.dependencies.identity).not.toHaveBeenCalled();
    expect(item.reads).not.toHaveBeenCalled();
    expect(item.factory).not.toHaveBeenCalled();
    expect(item.provider.invocationCount).toBe(0);
  });

  it.each([undefined, '', 'yes', ' LIVE '])('requires exact LIVE acknowledgement: %j', async (acknowledgement) => {
    const item = fixture(acknowledgement === undefined ? [] : [acknowledgement]);
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.dependencies.identity).not.toHaveBeenCalled();
    expect(item.reads).not.toHaveBeenCalled();
    expect(item.factory).not.toHaveBeenCalled();
  });

  it('rejects additional arguments before every gate', async () => {
    const item = fixture(['LIVE', confirm()]);
    item.dependencies = { ...item.dependencies, arguments: ['--yes'] };
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.dependencies.io.ask).not.toHaveBeenCalled();
    expect(item.reads).not.toHaveBeenCalled();
  });

  it('creates one fresh identity per independent session and one frozen explicit request each', async () => {
    let number = 0;
    const identity = vi.fn(() => `IDENTITY-${++number}`);
    const captured: CallRequest[] = [];
    const requestFactory = vi.fn((id: string, at: string) => {
      const request = createLiveRequest(id, at);
      captured.push(request);
      return request;
    });
    for (const id of ['IDENTITY-1', 'IDENTITY-2']) {
      const item = fixture(['LIVE', confirm(id), 'INVALID']);
      item.dependencies = { ...item.dependencies, identity, requestFactory };
      await runLiveOperatorSandbox(item.dependencies);
    }
    expect(identity).toHaveBeenCalledTimes(2);
    expect(requestFactory).toHaveBeenCalledTimes(2);
    expect(captured.map(({ requestId }) => requestId)).toEqual(['REQUEST-OPERATOR-LIVE-IDENTITY-1', 'REQUEST-OPERATOR-LIVE-IDENTITY-2']);
    expect(captured.every((request) => Object.isFrozen(request) && Object.isFrozen(request.expectedDecisionSchema))).toBe(true);
  });

  it('rejects a non-allowlisted frozen request before secret access', async () => {
    const item = fixture(['LIVE']);
    item.dependencies = { ...item.dependencies, requestFactory: (id, at) => createLiveRequest(id, at, '+15555550123') };
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.reads).not.toHaveBeenCalled();
    expect(item.factory).not.toHaveBeenCalled();
    expect(item.output.join('\n')).toContain('not the allowlisted CALL-E testing hotline');
  });

  it('shows and protects every executable request field before exact acquisition confirmation', async () => {
    const item = fixture(['LIVE', 'INVALID']);
    let request: CallRequest | undefined;
    item.dependencies = { ...item.dependencies, requestFactory: (id, at) => (request = createLiveRequest(id, at)) };
    await runLiveOperatorSandbox(item.dependencies);
    const output = item.output.join('\n');
    for (const field of [LIVE_REQUEST_DEFINITION, request!.requestId, CALLE_TESTING_HOTLINE, request!.caseId,
      request!.planId!, request!.actorId, request!.actorRole, request!.objective, request!.context, request!.createdAt,
      JSON.stringify(request!.expectedDecisionSchema), confirm()]) expect(output).toContain(field);
    expect(() => Object.assign(request!, { objective: 'changed after display' })).toThrow();
    expect(() => Object.assign(request!.expectedDecisionSchema, { version: 2 })).toThrow();
    expect(item.reads).not.toHaveBeenCalled();
    expect(item.factory).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'CALL WRONG', 'call REQUEST-OPERATOR-LIVE-IDENTITY-1'])(
    'invalid exact confirmation %j reads no secret', async (authorization) => {
      const item = fixture(authorization === undefined ? ['LIVE'] : ['LIVE', authorization]);
      await runLiveOperatorSandbox(item.dependencies);
      expect(item.reads).not.toHaveBeenCalled();
      expect(item.factory).not.toHaveBeenCalled();
      expect(item.provider.invocationCount).toBe(0);
    },
  );

  it('reads a missing secret once after confirmation, then constructs/invokes nothing', async () => {
    const item = fixture(['LIVE', confirm()]);
    item.reads.mockReturnValue(undefined);
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.reads).toHaveBeenCalledTimes(1);
    expect(item.factory).not.toHaveBeenCalled();
    expect(item.provider.invocationCount).toBe(0);
  });

  it('uses exact frozen request, restricted decisions and SAME session path exactly once', async () => {
    const item = fixture(['LIVE', confirm(), 'APPLY']);
    let frozenRequest: CallRequest | undefined;
    item.dependencies = { ...item.dependencies, requestFactory: (id, at) => (frozenRequest = createLiveRequest(id, at)) };
    await runLiveOperatorSandbox(item.dependencies);
    expect(item.reads).toHaveBeenCalledTimes(1);
    expect(item.factory).toHaveBeenCalledExactlyOnceWith('fake-credential-never-sent', LIVE_ALLOWED_DECISIONS);
    expect(item.provider.invocationCount).toBe(1);
    expect(item.provider.lastRequest).not.toBe(frozenRequest);
    expect(item.provider.lastRequest).toEqual(frozenRequest);
    const output = item.output.join('\n');
    expect(output.indexOf('Acquisition receipt')).toBeLessThan(output.indexOf('Exact retained review'));
    expect(output).toContain('Source: LIVE / CALL-E. Completion confidence is informational, not authority.');
    expect(output).toContain('LINEAGE_RESOLVED');
    expect(output).toContain('TEST-INTERACTION-NOT-LIVE');
    expect(output).toContain('not authority to execute');
    expect(output).not.toContain('fake-credential-never-sent');
    expect(output).toContain('Reviewer identity is local and unauthenticated');
    expect(output).toContain('local process clock');
    expect(output).toContain('not externally attested');
    expect(output).not.toContain('timestamps are synthetic sandbox metadata');
  });

  it('resolves one post-provider receipt timestamp and reuses it for receipt, proposal and ReviewTarget', async () => {
    const item = fixture(['LIVE', confirm(), 'DISCARD']);
    const times = ['2027-08-01T12:00:00Z', '2027-08-01T12:01:00Z', '2027-08-01T12:02:00Z'];
    let providerReturned = false;
    const now = vi.fn(() => {
      const value = times.shift()!;
      if (value === '2027-08-01T12:01:00Z') expect(providerReturned).toBe(true);
      return value;
    });
    const provider: CallProvider = { executeCall: vi.fn(async () => { providerReturned = true; return completed(); }) };
    item.dependencies = { ...item.dependencies, now, providerFactory: () => provider };
    await runLiveOperatorSandbox(item.dependencies);
    const output = item.output.join('\n');
    expect(now).toHaveBeenCalledTimes(3);
    expect(output).toContain('"receivedAt":"2027-08-01T12:01:00Z"');
    expect(output).toContain('Received at: "2027-08-01T12:01:00Z"');
    expect(Date.parse('2027-08-01T12:00:00Z')).toBeLessThanOrEqual(Date.parse('2027-08-01T12:01:00Z'));
    expect(Date.parse('2027-08-01T12:01:00Z')).toBeLessThanOrEqual(Date.parse('2027-08-01T12:02:00Z'));
  });

  it('does not repair impossible review chronology and existing Application fails closed', async () => {
    const item = fixture(['LIVE', confirm(), 'APPLY']);
    const times = ['2027-08-01T12:00:00Z', '2027-08-01T12:02:00Z', '2027-08-01T12:01:00Z'];
    item.dependencies = { ...item.dependencies, now: vi.fn(() => times.shift()!) };
    await runLiveOperatorSandbox(item.dependencies);
    const output = item.output.join('\n');
    expect(output).toContain('REVIEW_TIMESTAMP_PRECEDES_PROPOSAL');
    expect(output).toContain('0 decisions (0 APPROVED / 0 REJECTED), 0 operations, 0 events');
    expect(output).toContain('same state reference');
  });

  it('clarification emits receipt then stops without application or retry', async () => {
    const item = fixture(['LIVE', confirm()]);
    const provider = new MockProvider({ type: 'response', payload: completed('NEEDS_CLARIFICATION') });
    item.dependencies = { ...item.dependencies, providerFactory: () => provider };
    await runLiveOperatorSandbox(item.dependencies);
    expect(provider.invocationCount).toBe(1);
    expect(item.output.join('\n')).toContain('"stoppedStage":"CLARIFICATION"');
    expect(item.output.join('\n')).not.toContain('Exact retained review');
    expect(item.dependencies.io.ask).toHaveBeenCalledTimes(2);
  });

  it('provider operational failure is an explicit receipt/stopped result with no retry', async () => {
    const item = fixture(['LIVE', confirm()]);
    const provider = new MockProvider({ type: 'operational-error', kind: 'OPERATION_REJECTED' });
    item.dependencies = { ...item.dependencies, providerFactory: () => provider };
    await runLiveOperatorSandbox(item.dependencies);
    expect(provider.invocationCount).toBe(1);
    const output = item.output.join('\n');
    expect(output).toContain('"stoppedStage":"PROVIDER"');
    expect(output).toContain('OPERATION_REJECTED');
    expect(output).not.toContain('"receivedAt"');
  });

  it('offline command remains a separate mock-only composition without live activation', () => {
    const offline = readFileSync('scripts/operator-sandbox.ts', 'utf8');
    const live = readFileSync('scripts/operator-sandbox-live.ts', 'utf8');
    expect(offline).not.toMatch(/CallEProvider|CALLE_API_KEY|CALLE_TESTING_HOTLINE|operator:sandbox:live/);
    expect(live).toContain('new CallEProvider');
    expect(live).not.toContain('CALLE_TEST_PHONE');
  });
});

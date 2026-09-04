import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '../../src/integrations/calle/mockProvider.js';
import { formatExactReview, runOperatorSandbox } from '../../scripts/operator-sandbox.js';
import { createOperatorScenario } from '../../src/sandbox/operatorScenario.js';
import { DecisionAcquisitionSession } from '../../src/application/decisionAcquisitionSession.js';

const ioFor = (answers: (string | undefined)[]) => {
  const output: string[] = [];
  return { output, write: (text: string) => { output.push(text); }, ask: vi.fn(async () => answers.shift()) };
};

describe('Offline operator shell', () => {
  afterEach(() => vi.restoreAllMocks());
  it('requires acquisition confirmation and shows complete review BEFORE asking APPLY', async () => {
    const scenario = createOperatorScenario();
    const io = ioFor(['ACQUIRE', 'APPLY']);
    io.ask.mockImplementation(async () => {
      if (scenario.provider.invocationCount === 0) return 'ACQUIRE';
      expect(io.output.join('\n')).toContain('Exact retained review');
      expect(io.output.join('\n')).toContain(scenario.response.structuredResult.summary);
      expect(io.output.join('\n')).toContain(scenario.response.evidence[0]);
      return 'APPLY';
    });
    await runOperatorSandbox(io, scenario);
    const output = io.output.join('\n');
    expect(output).toContain('SANDBOX MODE');
    expect(output).toContain('OFFLINE / MOCK');
    expect(output).toContain('"label":"ALLOW"');
    expect(output).toContain('LINEAGE_RESOLVED');
    expect(output).toContain('1 decisions (1 APPROVED / 0 REJECTED), 1 operations, 1 events');
    expect(scenario.provider.invocationCount).toBe(1);
  });

  it.each([undefined, '', 'NO', 'APPLY'])('no acquisition for %j', async (choice) => {
    const scenario = createOperatorScenario();
    const io = ioFor([choice]);
    await runOperatorSandbox(io, scenario);
    expect(scenario.provider.invocationCount).toBe(0);
    expect(io.output.join('\n')).toContain('acquisition not authorized');
  });

  it('explicit DISCARD is a normal discard with zero effects', async () => {
    const review = vi.spyOn(DecisionAcquisitionSession.prototype, 'review');
    const io = ioFor(['ACQUIRE', 'DISCARD']);
    await runOperatorSandbox(io);
    expect(review).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'DISCARD' }));
    expect(io.output.join('\n')).toContain('"label":"DISCARDED"');
    expect(io.output.join('\n')).toContain('0 decisions (0 APPROVED / 0 REJECTED), 0 operations, 0 events');
    expect(io.output.join('\n')).toContain('same state reference');
  });

  const invalidInputs = [undefined, '', 'yes', ' APPLY ', 'INPUT_FAILURE'] as const;
  it.each(invalidInputs)('main review %j stops without submitting any review', async (choice) => {
    const scenario = createOperatorScenario();
    const review = vi.spyOn(DecisionAcquisitionSession.prototype, 'review');
    const acquire = vi.spyOn(DecisionAcquisitionSession.prototype, 'acquire');
    const io = ioFor(['ACQUIRE', choice]);
    if (choice === 'INPUT_FAILURE') io.ask.mockResolvedValueOnce('ACQUIRE').mockRejectedValueOnce(new Error('cancelled'));
    await runOperatorSandbox(io, scenario);
    expect(review).not.toHaveBeenCalled();
    expect((acquire.mock.contexts[0] as DecisionAcquisitionSession).state).toEqual(scenario.state);
    expect(scenario.provider.invocationCount).toBe(1);
    expect(io.output.join('\n')).toContain('No valid operator review was submitted. No application occurred. Zero new effects.');
    expect(io.output.join('\n')).not.toContain('"label":"DISCARDED"');
  });

  const authorizationScenario = () => {
    const scenario = createOperatorScenario();
    scenario.provider = new MockProvider({ type: 'response', payload: {
      ...scenario.response, structuredResult: { ...scenario.response.structuredResult, authorizationChanges: [
        { field: 'maxSubstituteQuantity', newValue: 190, reason: 'Synthetic field review' },
        { field: 'maxAbsorbableAdditionalCost', newValue: 110, reason: 'Second synthetic field review' },
      ] },
    } });
    return scenario;
  };

  it.each(['APPLY', 'DISCARD'] as const)('retains explicit authorization %s for every field', async (action) => {
    const scenario = authorizationScenario();
    const review = vi.spyOn(DecisionAcquisitionSession.prototype, 'review');
    const io = ioFor(['ACQUIRE', 'APPLY', action, action]);
    await runOperatorSandbox(io, scenario);
    expect(review).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'APPLY', authorizationReviews: [
      { field: 'maxSubstituteQuantity', action }, { field: 'maxAbsorbableAdditionalCost', action },
    ] }));
    const client = (review.mock.contexts[0] as DecisionAcquisitionSession).state.exceptionCase.actors.find(({ role }) => role === 'client');
    expect(client?.authorization.maxSubstituteQuantity).toBe(action === 'APPLY' ? 190 : 180);
    expect(client?.authorization.maxAbsorbableAdditionalCost).toBe(action === 'APPLY' ? 110 : 100);
    expect(io.output.join('\n')).toContain('"label":"ALLOW"');
  });

  it.each(invalidInputs.flatMap((input) => [ [input, false], [input, true] ] as const))(
    'authorization input %j after partial collection %j submits nothing', async (input, partial) => {
      const scenario = authorizationScenario();
      const review = vi.spyOn(DecisionAcquisitionSession.prototype, 'review');
      const acquire = vi.spyOn(DecisionAcquisitionSession.prototype, 'acquire');
      const answers = ['ACQUIRE', 'APPLY', ...(partial ? ['APPLY'] : []), input];
      const io = ioFor(answers);
      io.ask.mockImplementation(async () => {
        const next = answers.shift();
        if (next === 'INPUT_FAILURE') throw new Error('cancelled');
        return next;
      });
      await runOperatorSandbox(io, scenario);
      expect(review).not.toHaveBeenCalled();
      expect((acquire.mock.contexts[0] as DecisionAcquisitionSession).state).toEqual(scenario.state);
      expect(scenario.provider.invocationCount).toBe(1);
      expect(io.output.join('\n')).toContain('No valid operator review was submitted. No application occurred. Zero new effects.');
      expect(io.output.join('\n')).not.toContain('"label":"DISCARDED"');
    },
  );

  it('cancelled I/O defaults to no acquisition', async () => {
    const scenario = createOperatorScenario();
    const io = ioFor([]);
    io.ask.mockRejectedValue(new Error('closed input'));
    await runOperatorSandbox(io, scenario);
    expect(scenario.provider.invocationCount).toBe(0);
  });

  it('displays every bound field, authorization detail and ordered evidence without control-sequence injection', async () => {
    const scenario = createOperatorScenario();
    scenario.response.structuredResult.summary = 'Complete summary';
    const session = new DecisionAcquisitionSession(scenario.state, scenario.request, scenario.receivedAt);
    const acquired = await session.acquire(scenario.provider);
    if (acquired.status !== 'REVIEWABLE') throw new Error('Review required');
    const target = { ...acquired.bridge.reviewTarget, evidence: ['first\nline', '\u001b[31msecond'], proposedAuthorizationChanges: [{
      field: 'maxSubstituteQuantity' as const, currentInternalValue: 180, proposedNewValue: 190,
      externalPreviousValue: 170, reason: 'Because requested', requiresReview: true as const,
    }] };
    const output = formatExactReview(target);
    for (const item of [target.requestId, target.caseId, target.actorId, target.actorRole, target.decision,
      target.summary, target.receivedAt, target.reviewState, target.operationType, '180', '190', '170', 'Because requested', 'maxSubstituteQuantity', 'requires review: true']) {
      expect(output).toContain(item);
    }
    expect(output).toContain(JSON.stringify(target.completionConfidence.label));
    expect(output).toContain('Confidence score: 1');
    expect(output).toContain('informational, not authority');
    expect(output.indexOf('first\\nline')).toBeLessThan(output.indexOf('\\u001b[31msecond'));
    expect(output).not.toContain('\u001b');
  });

  it('new shell/composition contain no live provider, credential or network entry point', () => {
    const shell = readFileSync('scripts/operator-sandbox.ts', 'utf8');
    const scenario = readFileSync('src/sandbox/operatorScenario.ts', 'utf8');
    const coordinator = readFileSync('src/application/decisionAcquisitionSession.ts', 'utf8');
    expect(shell + scenario + coordinator).not.toMatch(/process\.env|CALLE_API_KEY|CALLE_TEST_PHONE|new CallEProvider|from ['"][^'"]*callEProvider|fetch\s*\(|https?:\/\//);
    expect(shell).toContain('accepts no flags');
    expect(coordinator).not.toMatch(/assessPhysicalFeasibility|validatePlan|MockProvider|CASE-OPERATOR|180|150/);
  });
});

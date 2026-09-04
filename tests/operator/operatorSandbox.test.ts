import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { formatExactReview, runOperatorSandbox } from '../../scripts/operator-sandbox.js';
import { createOperatorScenario } from '../../src/sandbox/operatorScenario.js';
import { DecisionAcquisitionSession } from '../../src/application/decisionAcquisitionSession.js';

const ioFor = (answers: (string | undefined)[]) => {
  const output: string[] = [];
  return { output, write: (text: string) => { output.push(text); }, ask: vi.fn(async () => answers.shift()) };
};

describe('Offline operator shell', () => {
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

  it.each(['DISCARD', undefined, '', 'yes'])('post-result %j is a normal discard with zero effects', async (choice) => {
    const io = ioFor(['ACQUIRE', choice]);
    await runOperatorSandbox(io);
    expect(io.output.join('\n')).toContain('"label":"DISCARDED"');
    expect(io.output.join('\n')).toContain('0 decisions (0 APPROVED / 0 REJECTED), 0 operations, 0 events');
    expect(io.output.join('\n')).toContain('same state reference');
  });

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

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  LIVE_CONFIRMATION,
  runCalleLiveSmokeTest,
  type SmokeEnvironmentReader,
  type SmokeProviderFactory,
} from '../../../scripts/calle-live-smoke-test.js';
import { ProviderOperationalError, type CallProvider } from '../../../src/integrations/calle/provider.js';
import type { CallRequest } from '../../../src/integrations/calle/types.js';

const explicitArgs = [
  '--execute',
  '--request-id', 'REQ-LIVE-SMOKE-001',
  '--created-at', '2026-08-06T16:00:00.000Z',
  '--received-at', '2026-08-06T16:10:00.000Z',
] as const;

const validEnvironment = {
  CALLE_LIVE_CONFIRM: LIVE_CONFIRMATION,
  CALLE_API_KEY: 'test-only-placeholder',
  CALLE_TEST_PHONE: '+12025550126',
} as const;

const terminalResponse = () => ({
  status: 'completed',
  structuredResult: {
    decision: 'APPROVED',
    actorId: 'ACTOR-CALLE-TEST-HOTLINE',
    actorRole: 'client',
    caseId: 'CASE-CALLE-SMOKE',
    planId: 'PLAN-CALLE-SMOKE',
    summary: 'The test line explicitly confirmed clear audio.',
    authorizationChanges: [],
    clarificationNeeded: false,
  },
  taskCompleted: true,
  completionConfidence: { score: 0.9, label: 'high' },
  evidence: ['The test line explicitly confirmed it could hear clearly.'],
});

const environmentReader = (
  values: Partial<Record<keyof typeof validEnvironment, string | undefined>> = validEnvironment,
) => vi.fn<SmokeEnvironmentReader>((name) => values[name]);

const providerFactory = (provider: CallProvider) =>
  vi.fn<SmokeProviderFactory>(() => provider);

const run = async ({
  args = explicitArgs,
  environment = environmentReader(),
  provider = { executeCall: vi.fn(async (_request: CallRequest) => terminalResponse()) },
  write = vi.fn(),
}: Readonly<{
  args?: readonly string[];
  environment?: ReturnType<typeof environmentReader>;
  provider?: CallProvider;
  write?: ReturnType<typeof vi.fn>;
}> = {}) => {
  const createProvider = providerFactory(provider);
  const result = await runCalleLiveSmokeTest({
    args,
    readEnvironment: environment,
    createProvider,
    write,
  });
  return { result, environment, provider, createProvider, write };
};

describe('manual CALL-E live smoke-test guard', () => {
  it.each([
    ['no authorization', [], undefined],
    ['confirmation only', [], LIVE_CONFIRMATION],
    ['execute only', ['--execute'], undefined],
    ['empty confirmation', ['--execute'], ''],
    ['almost correct confirmation', ['--execute'], 'YES_CALL_CALLE_TEST_HOTLIN'],
    ['confirmation with spaces', ['--execute'], ` ${LIVE_CONFIRMATION} `],
    ['different casing', ['--execute'], LIVE_CONFIRMATION.toLowerCase()],
    ['similar argument', ['--execute=true'], LIVE_CONFIRMATION],
  ] as const)('stays in dry run with %s', async (_name, args, confirmation) => {
    const environment = environmentReader({
      ...validEnvironment,
      CALLE_LIVE_CONFIRM: confirmation,
    });
    const executeProviderCall = vi.fn(async (_request: CallRequest) => terminalResponse());
    const { result, createProvider } = await run({
      args,
      environment,
      provider: { executeCall: executeProviderCall },
    });

    expect(result).toMatchObject({ mode: 'DRY_RUN', exitCode: 0 });
    expect(environment).toHaveBeenCalledWith('CALLE_LIVE_CONFIRM');
    expect(environment).not.toHaveBeenCalledWith('CALLE_API_KEY');
    expect(environment).not.toHaveBeenCalledWith('CALLE_TEST_PHONE');
    expect(createProvider).not.toHaveBeenCalled();
    expect(executeProviderCall).not.toHaveBeenCalled();
  });

  it('reports a clear safe dry run without exposing configuration', async () => {
    const write = vi.fn();
    const { result } = await run({ args: [], environment: environmentReader({}), write });
    expect(result.message).toContain('required');
    expect(write.mock.calls.flat().join('\n')).toContain('DRY RUN');
    expect(write.mock.calls.flat().join('\n')).toContain('No call will be made');
  });

  it('requires both exact authorization gates before reading secret-bearing values', async () => {
    const environment = environmentReader();
    await run({ environment });
    expect(environment.mock.calls.map(([name]) => name)).toEqual([
      'CALLE_LIVE_CONFIRM',
      'CALLE_API_KEY',
      'CALLE_TEST_PHONE',
    ]);
  });

  it('invokes the injected provider exactly once and preserves explicit identifiers and dates', async () => {
    const executeProviderCall = vi.fn(async (_request: CallRequest) => terminalResponse());
    const { result, createProvider } = await run({
      provider: { executeCall: executeProviderCall },
    });

    expect(createProvider).toHaveBeenCalledOnce();
    expect(executeProviderCall).toHaveBeenCalledOnce();
    const callRequest = executeProviderCall.mock.calls[0]?.[0];
    expect(callRequest).toMatchObject({
      requestId: 'REQ-LIVE-SMOKE-001',
      createdAt: '2026-08-06T16:00:00.000Z',
      phoneNumber: '+12025550126',
    });
    expect(result).toMatchObject({
      mode: 'LIVE',
      exitCode: 0,
      result: {
        success: true,
        value: {
          requestId: 'REQ-LIVE-SMOKE-001',
          createdAt: '2026-08-06T16:00:00.000Z',
          receivedAt: '2026-08-06T16:10:00.000Z',
        },
      },
    });
  });

  it.each([
    ['empty API key', { ...validEnvironment, CALLE_API_KEY: '' }, explicitArgs],
    ['empty phone', { ...validEnvironment, CALLE_TEST_PHONE: '' }, explicitArgs],
    ['invalid phone', { ...validEnvironment, CALLE_TEST_PHONE: '202-555-0126' }, explicitArgs],
    ['empty requestId', validEnvironment, ['--execute', '--request-id', '', '--created-at', '2026-08-06T16:00:00.000Z', '--received-at', '2026-08-06T16:10:00.000Z']],
    ['invalid createdAt', validEnvironment, ['--execute', '--request-id', 'REQ-1', '--created-at', 'not-a-date', '--received-at', '2026-08-06T16:10:00.000Z']],
    ['invalid receivedAt', validEnvironment, ['--execute', '--request-id', 'REQ-1', '--created-at', '2026-08-06T16:00:00.000Z', '--received-at', 'not-a-date']],
  ] as const)('fails before provider construction for %s', async (_name, values, args) => {
    const executeProviderCall = vi.fn(async (_request: CallRequest) => terminalResponse());
    const { result, createProvider } = await run({
      args,
      environment: environmentReader(values),
      provider: { executeCall: executeProviderCall },
    });
    expect(result).toMatchObject({ mode: 'LIVE', exitCode: 1 });
    expect(createProvider).not.toHaveBeenCalled();
    expect(executeProviderCall).not.toHaveBeenCalled();
  });

  it('passes a valid response through executeCall and the W3-01 mapper', async () => {
    const { result } = await run();
    expect(result.result).toMatchObject({
      success: true,
      value: {
        decision: 'APPROVED',
        evidence: terminalResponse().evidence,
        completionConfidence: terminalResponse().completionConfidence,
      },
    });
  });

  it.each([
    ['structuredResult null', { ...terminalResponse(), structuredResult: null }],
    ['ambiguous decision', { ...terminalResponse(), structuredResult: { ...terminalResponse().structuredResult, decision: 'probably' } }],
    ['incomplete payload', { status: 'completed', structuredResult: {} }],
  ] as const)('fails safely for %s without fabricating evidence or confidence', async (_name, payload) => {
    const { result } = await run({ provider: { executeCall: async () => payload } });
    expect(result).toMatchObject({ mode: 'LIVE', exitCode: 1, result: { success: false } });
    expect(result.result).not.toHaveProperty('evidence');
    expect(result.result).not.toHaveProperty('completionConfidence');
  });

  it('returns an operational failure without retrying', async () => {
    const executeProviderCall = vi.fn(async (_request: CallRequest) => {
      throw new ProviderOperationalError('TIMEOUT');
    });
    const { result } = await run({ provider: { executeCall: executeProviderCall } });
    expect(result.result).toMatchObject({ success: false, retryable: true });
    expect(executeProviderCall).toHaveBeenCalledOnce();
  });

  it('does not hide unexpected internal errors', async () => {
    const defect = new TypeError('Injected internal defect');
    await expect(run({ provider: { executeCall: async () => { throw defect; } } })).rejects.toBe(defect);
  });

  it('never prints the API key or phone number', async () => {
    const write = vi.fn();
    await run({ write });
    const output = write.mock.calls.flat().join('\n');
    expect(output).not.toContain(validEnvironment.CALLE_API_KEY);
    expect(output).not.toContain(validEnvironment.CALLE_TEST_PHONE);
  });

  it('has no import-time environment reads, calls, browser imports, generated IDs, or generated dates', () => {
    const source = readFileSync('scripts/calle-live-smoke-test.ts', 'utf8');
    const beforeMainGuard = source.split('if (mainModuleUrl === import.meta.url)')[0] ?? source;
    expect(beforeMainGuard).not.toMatch(/process\.env\.CALLE_API_KEY|process\.env\.CALLE_TEST_PHONE/);
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|setTimeout|fetch\s*\(/);
    expect(source).not.toMatch(/react/i);
    expect(source.match(/executeCall\(provider,/g)).toHaveLength(1);
  });
});

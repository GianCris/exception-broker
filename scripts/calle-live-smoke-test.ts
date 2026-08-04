import { pathToFileURL } from 'node:url';

import { executeCall } from '../src/integrations/calle/adapter.js';
import { CallEProvider } from '../src/integrations/calle/callEProvider.js';
import { PHONE_DECISION_SCHEMA, createCallRequest } from '../src/integrations/calle/contract.js';
import { receivedAtSchema } from '../src/integrations/calle/schemas.js';
import type { CallMappingResult, CallRequest } from '../src/integrations/calle/types.js';
import type { CallProvider } from '../src/integrations/calle/provider.js';

export const LIVE_CONFIRMATION = 'YES_CALL_CALLE_TEST_HOTLINE';

const smokeDecisions = ['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION'] as const;

type EnvironmentName =
  | 'CALLE_LIVE_CONFIRM'
  | 'CALLE_API_KEY'
  | 'CALLE_TEST_PHONE';

export type SmokeEnvironmentReader = (name: EnvironmentName) => string | undefined;
export type SmokeProviderFactory = (apiKey: string) => CallProvider;

export type SmokeRunResult = Readonly<{
  mode: 'DRY_RUN' | 'LIVE';
  exitCode: 0 | 1;
  message: string;
  result?: CallMappingResult;
}>;

export type SmokeDependencies = Readonly<{
  args: readonly string[];
  readEnvironment: SmokeEnvironmentReader;
  createProvider: SmokeProviderFactory;
  write: (message: string) => void;
}>;

type ExplicitInputs = Readonly<{
  requestId: string | undefined;
  createdAt: string | undefined;
  receivedAt: string | undefined;
}>;

const readOption = (args: readonly string[], name: string): string | undefined => {
  const matchingIndex = args.findIndex((argument) => argument === name);
  return matchingIndex === -1 ? undefined : args[matchingIndex + 1];
};

const explicitInputsFrom = (args: readonly string[]): ExplicitInputs => ({
  requestId: readOption(args, '--request-id'),
  createdAt: readOption(args, '--created-at'),
  receivedAt: readOption(args, '--received-at'),
});

const dryRun = (message: string, write: SmokeDependencies['write']): SmokeRunResult => {
  write(`DRY RUN: ${message}`);
  write('No call will be made and no balance will be consumed.');
  return { mode: 'DRY_RUN', exitCode: 0, message };
};

const validationFailure = (message: string, write: SmokeDependencies['write']): SmokeRunResult => {
  write(`LIVE validation failed: ${message}`);
  write('No call was made.');
  return { mode: 'LIVE', exitCode: 1, message };
};

const smokeRequest = (
  phoneNumber: string,
  inputs: Required<ExplicitInputs>,
): CallRequest => createCallRequest({
  requestId: inputs.requestId,
  caseId: 'CASE-CALLE-SMOKE',
  planId: 'PLAN-CALLE-SMOKE',
  actorId: 'ACTOR-CALLE-TEST-HOTLINE',
  actorRole: 'client',
  phoneNumber,
  objective: [
    'Introduce this as an Exception Broker technical connection test.',
    'Ask whether the test line can hear clearly, request a brief explicit answer, and end the call.',
  ].join(' '),
  context: [
    'Return APPROVED only if the line explicitly confirms it can hear clearly.',
    'Return REJECTED if it explicitly cannot hear or declines to continue.',
    'Return NEEDS_CLARIFICATION when the answer is ambiguous or insufficient.',
  ].join(' '),
  expectedDecisionSchema: PHONE_DECISION_SCHEMA,
  createdAt: inputs.createdAt,
});

export const runCalleLiveSmokeTest = async (
  dependencies: SmokeDependencies,
): Promise<SmokeRunResult> => {
  const executeAuthorized = dependencies.args.includes('--execute');
  const confirmation = dependencies.readEnvironment('CALLE_LIVE_CONFIRM');

  if (!executeAuthorized && confirmation !== LIVE_CONFIRMATION) {
    return dryRun('Exact confirmation and --execute are both required.', dependencies.write);
  }
  if (!executeAuthorized) {
    return dryRun('Missing exact --execute argument.', dependencies.write);
  }
  if (confirmation !== LIVE_CONFIRMATION) {
    return dryRun('Missing exact CALLE_LIVE_CONFIRM confirmation.', dependencies.write);
  }

  // Secret-bearing values are intentionally read only after both authorization gates pass.
  const apiKey = dependencies.readEnvironment('CALLE_API_KEY');
  const phoneNumber = dependencies.readEnvironment('CALLE_TEST_PHONE');
  const inputs = explicitInputsFrom(dependencies.args);

  if (apiKey === undefined || apiKey.trim() === '') {
    return validationFailure('CALLE_API_KEY is required.', dependencies.write);
  }
  if (phoneNumber === undefined || phoneNumber.trim() === '') {
    return validationFailure('CALLE_TEST_PHONE is required.', dependencies.write);
  }
  if (inputs.requestId === undefined || inputs.requestId.trim() === '') {
    return validationFailure('--request-id is required.', dependencies.write);
  }
  if (inputs.createdAt === undefined) {
    return validationFailure('--created-at is required.', dependencies.write);
  }
  if (inputs.receivedAt === undefined) {
    return validationFailure('--received-at is required.', dependencies.write);
  }
  if (!receivedAtSchema.safeParse(inputs.createdAt).success) {
    return validationFailure('--created-at must be a valid ISO timestamp.', dependencies.write);
  }
  if (!receivedAtSchema.safeParse(inputs.receivedAt).success) {
    return validationFailure('--received-at must be a valid ISO timestamp.', dependencies.write);
  }

  let request: CallRequest;
  try {
    request = smokeRequest(phoneNumber, {
      requestId: inputs.requestId,
      createdAt: inputs.createdAt,
      receivedAt: inputs.receivedAt,
    });
  } catch {
    return validationFailure('CALLE_TEST_PHONE must use E.164 format.', dependencies.write);
  }

  const provider = dependencies.createProvider(apiKey);
  dependencies.write(`LIVE: executing one authorized smoke-test request (${request.requestId}).`);
  const result = await executeCall(provider, request, inputs.receivedAt);

  if (result.success) {
    dependencies.write(`Result: success=true decision=${result.value.decision}`);
  } else {
    dependencies.write(`Result: success=false reason=${result.reason} retryable=${String(result.retryable)}`);
  }

  return {
    mode: 'LIVE',
    exitCode: result.success ? 0 : 1,
    message: result.success ? 'Smoke test completed.' : 'Smoke test failed safely.',
    result,
  };
};

const defaultDependencies = (): SmokeDependencies => ({
  args: process.argv.slice(2),
  readEnvironment: (name) => process.env[name],
  createProvider: (apiKey) => new CallEProvider({
    apiKeySource: () => apiKey,
    allowedDecisions: smokeDecisions,
  }),
  write: (message) => process.stdout.write(`${message}\n`),
});

const mainModuleUrl = process.argv[1] === undefined
  ? undefined
  : pathToFileURL(process.argv[1]).href;

if (mainModuleUrl === import.meta.url) {
  runCalleLiveSmokeTest(defaultDependencies())
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write('Unexpected internal smoke-test error. No retry was attempted.\n');
      process.exitCode = 1;
    });
}

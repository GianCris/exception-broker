import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { runOperatorSandbox, type OperatorIO } from './operator-sandbox.js';
import { createCallRequest } from '../src/integrations/calle/contract.js';
import { CallEProvider } from '../src/integrations/calle/callEProvider.js';
import type { CallProvider } from '../src/integrations/calle/provider.js';
import type { CallRequest } from '../src/integrations/calle/types.js';
import { createOperatorScenario, OPERATOR_SANDBOX_FACTS, renderClientDecisionPolicy, type OperatorSandboxFacts } from '../src/sandbox/operatorScenario.js';
import type { AcquisitionResult } from '../src/application/decisionAcquisitionSession.js';

export const LIVE_REQUEST_DEFINITION = 'OPERATOR-LIVE-V2';
export const CALLE_TESTING_HOTLINE = '+12763229632';
export const LIVE_ACKNOWLEDGEMENT = 'LIVE';
export const LIVE_ALLOWED_DECISIONS = ['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION'] as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const createLiveRequest = (requestId: string, createdAt: string, destination = CALLE_TESTING_HOTLINE, facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS): CallRequest =>
  deepFreeze(createCallRequest({
    requestId,
    caseId: facts.caseId,
    planId: facts.planId,
    actorId: facts.clientActorId,
    actorRole: 'client',
    phoneNumber: destination,
    objective: 'Ask the automated testing agent to role-play only as the synthetic Client, neutrally evaluate the stated proposal against the stated Client policy, give a brief reason, and return exactly one decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION. No authorization change is requested.',
    context: `Synthetic sandbox test only; no real customer authority or external effect. ${renderClientDecisionPolicy(facts)}`,
    expectedDecisionSchema: { name: 'exception-broker-phone-decision', version: 1 },
    createdAt,
  }));

const asRecord = (input: unknown): Record<string, unknown> | undefined =>
  typeof input === 'object' && input !== null ? input as Record<string, unknown> : undefined;

class ReceiptProvider implements CallProvider {
  readonly #delegate: CallProvider;
  returned: unknown;
  invoked = 0;
  constructor(delegate: CallProvider) { this.#delegate = delegate; }
  async executeCall(request: CallRequest): Promise<unknown> {
    if (this.invoked !== 0) throw new Error('The live sandbox permits one provider invocation');
    this.invoked += 1;
    const returned = await this.#delegate.executeCall(request);
    this.returned = returned;
    return returned;
  }
}

const receipt = (request: CallRequest, provider: ReceiptProvider, result: AcquisitionResult) => {
  const raw = asRecord(provider.returned);
  const confidence = asRecord(raw?.completionConfidence);
  const interactionKey = raw === undefined ? undefined : ['callId', 'call_id', 'taskId', 'task_id', 'id']
    .find((key) => typeof raw[key] === 'string' && String(raw[key]).length > 0);
  return {
    requestDefinition: LIVE_REQUEST_DEFINITION,
    requestId: request.requestId,
    source: 'CALL-E',
    target: 'official testing hotline',
    ...(interactionKey === undefined ? {} : { providerInteraction: { field: interactionKey, value: raw![interactionKey] } }),
    providerStatus: raw?.status,
    taskCompleted: raw?.taskCompleted,
    completionConfidence: confidence === undefined ? undefined : { score: confidence.score, label: confidence.label },
    ...(result.status === 'REVIEWABLE' || (result.status === 'STOPPED' && result.stage === 'CLARIFICATION')
      ? { receivedAt: result.bridge.proposal.receivedAt } : {}),
    acquisitionStatus: result.status,
    ...(result.status === 'STOPPED' ? { stoppedStage: result.stage } : {}),
    note: 'Session-local acquisition provenance; not authority to execute.',
  };
};

export type LiveDependencies = Readonly<{
  io: OperatorIO;
  interactiveTerminal: boolean;
  arguments: readonly string[];
  identity: () => string;
  now: () => string;
  readSecret: () => string | undefined;
  providerFactory: (apiKey: string, allowedDecisions: typeof LIVE_ALLOWED_DECISIONS) => CallProvider;
  requestFactory?: (requestId: string, createdAt: string) => CallRequest;
}>;

const safeAnswer = async (io: OperatorIO, prompt: string) => {
  try { return await io.ask(prompt); } catch { return undefined; }
};

const stopped = (io: OperatorIO, reason: string) => {
  io.write(`LIVE WAIT / STOPPED — ${reason}. No live provider invocation occurred.`);
};

export const runLiveOperatorSandbox = async (dependencies: LiveDependencies) => {
  const { io } = dependencies;
  if (dependencies.arguments.length !== 0) return stopped(io, 'additional arguments are not supported');
  if (!dependencies.interactiveTerminal) return stopped(io, 'an interactive terminal is required');
  if (await safeAnswer(io, 'Type LIVE to acknowledge that this command can place one real outbound test call: ') !== LIVE_ACKNOWLEDGEMENT) {
    return stopped(io, 'live mode was not acknowledged');
  }

  const requestId = `REQUEST-OPERATOR-LIVE-${dependencies.identity()}`;
  const request = (dependencies.requestFactory ?? createLiveRequest)(requestId, dependencies.now());
  if (!Object.isFrozen(request) || !Object.isFrozen(request.expectedDecisionSchema)) {
    return stopped(io, 'the complete request is not deeply frozen');
  }
  if (request.phoneNumber !== CALLE_TESTING_HOTLINE) return stopped(io, 'destination is not the allowlisted CALL-E testing hotline');
  const confirmation = `CALL ${request.requestId}`;
  io.write([
    'LIVE CALL — FINAL AUTHORIZATION',
    `Request definition: ${LIVE_REQUEST_DEFINITION}`,
    `Acquisition ID: ${request.requestId}`,
    'Target: CALL-E official testing hotline',
    `Phone: ${request.phoneNumber}`,
    `Case: ${request.caseId}`,
    `Plan: ${request.planId ?? '(none)'}`,
    `Actor: ${request.actorId}`,
    `Role: ${request.actorRole}`,
    `Objective: ${request.objective}`,
    `Context: ${request.context}`,
    `Created at: ${request.createdAt}`,
    `Expected decision schema: ${JSON.stringify(request.expectedDecisionSchema)}`,
    `Type exactly ${confirmation} to authorize this one acquisition.`,
  ].join('\n'));
  if (await safeAnswer(io, 'Exact live-call authorization: ') !== confirmation) {
    return stopped(io, 'exact acquisition confirmation was not supplied');
  }

  const apiKey = dependencies.readSecret();
  if (apiKey === undefined || apiKey.length === 0) return stopped(io, 'CALL-E credential is unavailable after authorization');
  const provider = new ReceiptProvider(dependencies.providerFactory(apiKey, LIVE_ALLOWED_DECISIONS));
  const scenario = { ...createOperatorScenario(), request, receivedAt: dependencies.now };
  await runOperatorSandbox(io, scenario, {
    source: 'LIVE / CALL-E', acquisitionPreauthorized: true, provider,
    afterAcquire: (result) => io.write(`Acquisition receipt: ${JSON.stringify(receipt(request, provider, result))}`),
    reviewMetadata: () => ({
      operationId: `OPERATION-${request.requestId}`,
      eventId: `EVENT-${request.requestId}`,
      approvalId: `APPROVAL-${request.requestId}`,
      reviewedBy: 'LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED',
      reviewedAt: dependencies.now(),
    }),
  });
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runLiveOperatorSandbox({
      io: { write: (text) => process.stdout.write(`${text}\n`), ask: (prompt) => terminal.question(prompt) },
      interactiveTerminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
      arguments: process.argv.slice(2), identity: randomUUID, now: () => new Date().toISOString(),
      readSecret: () => process.env.CALLE_API_KEY,
      providerFactory: (apiKey, allowedDecisions) => new CallEProvider({ apiKeySource: () => apiKey, allowedDecisions }),
    });
  } catch { process.stderr.write('Unexpected live sandbox failure; stopped without retry.\n'); process.exitCode = 1; }
  finally { terminal.close(); }
}

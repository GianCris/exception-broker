import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../../src/application/adaptiveOrchestrator.js';
import { assessPhysicalFeasibility } from '../../../src/domain/physicalFeasibility.js';
import { exceptionCaseSchema, planSchema } from '../../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase } from '../../../src/domain/types.js';
import { validatePlan } from '../../../src/domain/validator.js';
import { executeCall } from '../../../src/integrations/calle/adapter.js';
import { CallEProvider } from '../../../src/integrations/calle/callEProvider.js';
import { PHONE_DECISION_SCHEMA, createCallRequest } from '../../../src/integrations/calle/contract.js';
import {
  createReadyDecisionBridgeResult,
  prepareDecisionProposal,
  type DecisionBridgeResult,
} from '../../../src/integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../../../src/integrations/calle/decisionApplication.js';
import {
  ProviderOperationalError,
  type CallProvider,
} from '../../../src/integrations/calle/provider.js';
import type { CallMappingResult, CallRequest } from '../../../src/integrations/calle/types.js';

const LIVE_MODE = 'MANUAL_LIVE_RUN';
const LIVE_CONFIRMATION = 'YES_RUN_REAL_CALL_E_E2E';
const DEDICATED_LIVE_TEST_SELECTION = 'CALLE_LIVE_E2E_DEDICATED_SELECTION';
const CASE_ID = 'CASE-CALLE-LIVE-E2E';
const PLAN_ID = 'PLAN-CALLE-LIVE-E2E';
const LINEAGE_ID = 'LINEAGE-CALLE-LIVE-E2E';
const CLIENT_ID = 'ACTOR-CALLE-LIVE-CLIENT';
const TARGET_AT = '2027-07-01T17:00:00-05:00';
const LATER_AT = '2027-07-02T17:00:00-05:00';
const CALL_CREATED_AT = '2027-07-01T16:50:00-05:00';
const CALL_RECEIVED_AT = '2027-07-01T16:58:00-05:00';
const REVIEWED_AT = '2027-07-01T16:59:00-05:00';

type EnvironmentName =
  | 'CALLE_LIVE_E2E_MODE'
  | 'CALLE_LIVE_E2E_CONFIRM'
  | 'CALLE_API_KEY'
  | 'CALLE_TEST_PHONE';

type EnvironmentReader = (name: EnvironmentName) => string | undefined;

type LiveConfiguration = Readonly<
  | {
    authorized: false;
    reason:
      | 'DEDICATED_MANUAL_TEST_SELECTION_REQUIRED'
      | 'LIVE_MODE_REQUIRED'
      | 'LIVE_CONFIRMATION_REQUIRED';
  }
  | { authorized: true; apiKey: string; phoneNumber: string }
>;

type VitestSelectionConfiguration = Readonly<{
  testNamePattern?: RegExp;
}>;

const hasDedicatedLiveTestSelection = (
  configuration: VitestSelectionConfiguration | undefined,
): boolean => configuration?.testNamePattern?.source === DEDICATED_LIVE_TEST_SELECTION;

const readLiveConfiguration = (
  dedicatedLiveTestSelected: boolean,
  readEnvironment: EnvironmentReader,
): LiveConfiguration => {
  if (!dedicatedLiveTestSelected) {
    return { authorized: false, reason: 'DEDICATED_MANUAL_TEST_SELECTION_REQUIRED' };
  }
  if (readEnvironment('CALLE_LIVE_E2E_MODE') !== LIVE_MODE) {
    return { authorized: false, reason: 'LIVE_MODE_REQUIRED' };
  }
  if (readEnvironment('CALLE_LIVE_E2E_CONFIRM') !== LIVE_CONFIRMATION) {
    return { authorized: false, reason: 'LIVE_CONFIRMATION_REQUIRED' };
  }
  const apiKey = readEnvironment('CALLE_API_KEY');
  const phoneNumber = readEnvironment('CALLE_TEST_PHONE');
  if (apiKey === undefined || apiKey.trim() === '') throw new Error('CALLE_API_KEY is required after live authorization');
  if (phoneNumber === undefined || phoneNumber.trim() === '') throw new Error('CALLE_TEST_PHONE is required after live authorization');
  return { authorized: true, apiKey, phoneNumber };
};

const vitestSelectionConfiguration = (
  globalThis as { __vitest_worker__?: { config?: VitestSelectionConfiguration } }
).__vitest_worker__?.config;
const dedicatedLiveTestSelected = hasDedicatedLiveTestSelection(vitestSelectionConfiguration);
const manualLiveRunSelected =
  dedicatedLiveTestSelected
  && process.env.CALLE_LIVE_E2E_MODE === LIVE_MODE
  && process.env.CALLE_LIVE_E2E_CONFIRM === LIVE_CONFIRMATION;

type HarnessPhase =
  | 'RECORDING_PROVIDER_ENTERED'
  | 'DELEGATE_INVOCATION_STARTED'
  | 'DELEGATE_RETURNED'
  | 'DELEGATE_THREW'
  | 'EXECUTE_CALL_RETURNED'
  | 'EXECUTE_CALL_THREW'
  | 'MAPPING_SUCCESS_OBSERVED'
  | 'MAPPING_FAILURE_OBSERVED';

type SanitizedThrownError = Readonly<{
  type: string;
  category?: string;
}>;

const sanitizeThrownError = (error: unknown): SanitizedThrownError => {
  if (error instanceof ProviderOperationalError) {
    return { type: error.name, category: error.kind };
  }
  if (error instanceof Error) return { type: error.name || 'Error' };
  return { type: typeof error };
};

class RecordingCallProvider implements CallProvider {
  readonly #delegate: CallProvider;
  invocationCount = 0;
  delegateReturned = false;
  delegateThrew = false;
  providerLevelResult: unknown;
  thrownError: SanitizedThrownError | undefined;
  readonly phases: HarnessPhase[] = [];

  constructor(delegate: CallProvider) {
    this.#delegate = delegate;
  }

  recordPhase(phase: HarnessPhase): void {
    this.phases.push(phase);
  }

  async executeCall(request: CallRequest): Promise<unknown> {
    this.recordPhase('RECORDING_PROVIDER_ENTERED');
    if (this.invocationCount !== 0) throw new Error('Live proof permits exactly one provider invocation');
    this.invocationCount += 1;
    this.recordPhase('DELEGATE_INVOCATION_STARTED');
    try {
      const result = await this.#delegate.executeCall(request);
      this.providerLevelResult = result;
      this.delegateReturned = true;
      this.recordPhase('DELEGATE_RETURNED');
      return result;
    } catch (error: unknown) {
      this.delegateThrew = true;
      this.thrownError = sanitizeThrownError(error);
      this.recordPhase('DELEGATE_THREW');
      throw error;
    }
  }
}

const mappingFailureProjection = (
  result: Extract<CallMappingResult, { success: false }>,
): Readonly<Record<string, unknown>> => ({
  success: false,
  reason: result.reason,
  retryable: result.retryable,
  ...(result.externalStatus === undefined ? {} : { externalStatus: result.externalStatus }),
  ...(result.issues === undefined ? {} : { issues: [...result.issues] }),
});

const maskPhone = (phone: string): string => {
  const suffix = phone.slice(-4);
  return `${phone.slice(0, Math.min(2, phone.length))}${'•'.repeat(Math.max(0, phone.length - suffix.length - 2))}${suffix}`;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

const providerProofProjection = (value: unknown): Readonly<Record<string, unknown>> => {
  const record = asRecord(value);
  if (record === undefined) return { responseType: typeof value };
  const structured = asRecord(record.structuredResult);
  const interactionKey = ['callId', 'call_id', 'taskId', 'task_id', 'id']
    .find((key) => typeof record[key] === 'string' && String(record[key]).trim() !== '');
  return {
    status: record.status,
    structuredResult: structured === undefined ? record.structuredResult : {
      decision: structured.decision,
      caseId: structured.caseId,
      planId: structured.planId,
      actorId: structured.actorId,
      actorRole: structured.actorRole,
      clarificationNeeded: structured.clarificationNeeded,
      authorizationChangeCount: Array.isArray(structured.authorizationChanges)
        ? structured.authorizationChanges.length
        : undefined,
    },
    taskCompleted: record.taskCompleted,
    completionConfidence: record.completionConfidence,
    evidenceCount: Array.isArray(record.evidence) ? record.evidence.length : undefined,
    ...(interactionKey === undefined ? {} : {
      providerInteraction: { field: interactionKey, value: record[interactionKey] },
    }),
  };
};

const recordingProofProjection = (
  provider: RecordingCallProvider,
): Readonly<Record<string, unknown>> => ({
  invocationCount: provider.invocationCount,
  delegateReturned: provider.delegateReturned,
  delegateThrew: provider.delegateThrew,
  ...(provider.thrownError === undefined ? {} : { thrownError: provider.thrownError }),
  phases: [...provider.phases],
  ...(provider.delegateReturned
    ? { providerLevelEvidence: providerProofProjection(provider.providerLevelResult) }
    : {}),
});

const safeCase = (): ExceptionCase => exceptionCaseSchema.parse({
  id: CASE_ID,
  status: 'CASE_CREATED',
  requestedQuantity: 500,
  targetDeliveryDate: TARGET_AT,
  actors: [
    {
      id: 'ACTOR-CALLE-LIVE-SUPPLIER',
      role: 'supplier',
      constraints: [{
        type: 'SUPPLY',
        originalQuantity: 350,
        substituteQuantity: 150,
        deliveryDate: TARGET_AT,
        substituteUnitAdditionalCost: 0.5,
      }],
      authorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: 500,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
    {
      id: 'ACTOR-CALLE-LIVE-PRODUCTION',
      role: 'production',
      constraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: 500,
        deliveryDate: TARGET_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
      authorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: 500,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
    {
      id: CLIENT_ID,
      role: 'client',
      constraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: 500,
        deliveryDate: TARGET_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
      authorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: 180,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
  ],
});

const safePlan = () => planSchema.parse({
  id: PLAN_ID,
  caseId: CASE_ID,
  status: 'PENDING_APPROVAL',
  version: 1,
  originalQuantityTomorrow: 350,
  substituteQuantityTomorrow: 150,
  originalQuantityLater: 0,
  laterDeliveryDate: LATER_AT,
  clientAdditionalCost: 0,
  supplierAbsorbedCost: 75,
  productionAbsorbedCost: 0,
});

const emptyState = (exceptionCase: ExceptionCase): OrchestrationState => ({
  exceptionCase,
  plans: [],
  planLineages: [],
  approvals: [],
  operationHistory: [],
  events: [],
});

const localApproval = (
  state: OrchestrationState,
  role: Exclude<ActorRole, 'client'>,
  token: string,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = state.exceptionCase.actors.find((candidate) => candidate.role === role);
  if (actor === undefined) throw new Error(`Missing local ${role}`);
  const bridgeResult: DecisionBridgeResult = createReadyDecisionBridgeResult({
      operationType: 'PLAN_DECISION',
      requestId: `REQUEST-CALLE-LIVE-${token}`,
      caseId: CASE_ID,
      planId: PLAN_ID,
      actorId: actor.id,
      actorRole: role,
      decision: 'APPROVED',
      summary: `Deterministic local ${role} pre-approval`,
      proposedAuthorizationChanges: [],
      evidence: ['Deterministic local setup decision'],
      completionConfidence: { score: 1, label: 'deterministic-local' },
      receivedAt: '2027-07-01T16:40:00-05:00',
      requiresReview: true,
      reviewState: 'DECISION_REVIEW_REQUIRED',
    });
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult,
    review: bindReviewCommand({
      action: 'APPLY',
      operationId: `OPERATION-CALLE-LIVE-${token}`,
      reviewedBy: 'REVIEWER-CALLE-LIVE-LOCAL-SETUP',
      reviewedAt: '2027-07-01T16:41:00-05:00',
      eventId: `EVENT-CALLE-LIVE-${token}`,
      approvalId: `APPROVAL-CALLE-LIVE-${token}`,
      authorizationReviews: [],
    }, bridgeResult.reviewTarget),
  };
};

const prepareLocalState = (): OrchestrationState => {
  const exceptionCase = safeCase();
  const plan = safePlan();
  expect(validatePlan(exceptionCase, plan)).toEqual({ valid: true, violations: [] });
  expect(assessPhysicalFeasibility(exceptionCase, plan).outcome).toBe('PHYSICALLY_FEASIBLE');

  const registration = executeOrchestrationAction(emptyState(exceptionCase), {
    type: 'REGISTER_PLAN_PROPOSAL',
    lineageId: LINEAGE_ID,
    plan,
  });
  if (!registration.accepted) throw new Error(`Registration failed: ${registration.failure.reason}`);
  expect(registration.step).toMatchObject({
    assessment: {
      planAssessment: { outcome: 'PLAN_VALID' },
      physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
    },
  });

  const supplier = executeOrchestrationAction(
    registration.state,
    localApproval(registration.state, 'supplier', 'SUPPLIER'),
  );
  if (!supplier.accepted) throw new Error(`Supplier setup approval failed: ${supplier.failure.reason}`);
  const production = executeOrchestrationAction(
    supplier.state,
    localApproval(supplier.state, 'production', 'PRODUCTION'),
  );
  if (!production.accepted) throw new Error(`Production setup approval failed: ${production.failure.reason}`);
  expect(production.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
  expect(production.state.approvals.map(({ actorRole }) => actorRole)).toEqual(['supplier', 'production']);
  return production.state;
};

const callRequest = (phoneNumber: string): CallRequest => createCallRequest({
  requestId: 'REQUEST-CALLE-LIVE-CLIENT-REAL-V3',
  caseId: CASE_ID,
  planId: PLAN_ID,
  actorId: CLIENT_ID,
  actorRole: 'client',
  phoneNumber,
  objective: [
    "You are calling CALL-E's official automated testing hotline for a synthetic Exception Broker hackathon proof.",
    `Ask the automated general-purpose test agent to role-play only as the synthetic Client for ${PLAN_ID}.`,
    'Ask it to evaluate the synthetic proposal facts against the synthetic Client policy, briefly state its reason, and choose exactly one decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION.',
    'No authorization change is requested. Once the reason and one outcome are clearly stated, conclude the interaction.',
  ].join(' '),
  context: [
    'The automated test agent has no real customer authority, and this interaction has no real-world operational effect.',
    'Synthetic Client policy: APPROVED if every required condition is satisfied; REJECTED if any stated hard condition is violated; NEEDS_CLARIFICATION only if information required to evaluate the conditions is missing or ambiguous.',
    `Required conditions: substitute quantity must not exceed 180 units; Client additional cost must not exceed 100; all 500 units must be delivered by ${TARGET_AT}.`,
    `Proposal facts for synthetic case ${CASE_ID}: 350 original and 150 substitute units are proposed for ${TARGET_AT}; total additional substitute cost is 75, allocated as Client 0, Supplier 75, and Production 0.`,
    'Evaluate the policy and facts independently; do not infer or favor any outcome.',
  ].join(' '),
  expectedDecisionSchema: PHONE_DECISION_SCHEMA,
  createdAt: CALL_CREATED_AT,
});

const promptForPostResultReview = async (): Promise<'APPLY' | 'DISCARD'> => {
  const usesProcessTerminal = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const input = usesProcessTerminal
    ? process.stdin
    : createReadStream(process.platform === 'win32' ? 'CONIN$' : '/dev/tty');
  const output = usesProcessTerminal
    ? process.stdout
    : createWriteStream(process.platform === 'win32' ? 'CONOUT$' : '/dev/tty');
  const interface_ = createInterface({ input, output });
  try {
    const answer = await interface_.question(
      '\nPOST-RESULT REVIEW: Type APPLY to apply this exact proposal; anything else DISCARD: ',
    );
    return answer.trim() === 'APPLY' ? 'APPLY' : 'DISCARD';
  } catch {
    return 'DISCARD';
  } finally {
    interface_.close();
    if (!usesProcessTerminal) {
      input.destroy();
      output.end();
    }
  }
};

describe('CALL-E live end-to-end proof harness', () => {
  it('requires deliberate test selection, live mode, and exact confirmation before reading credentials', () => {
    expect(hasDedicatedLiveTestSelection(undefined)).toBe(false);
    expect(hasDedicatedLiveTestSelection({})).toBe(false);
    expect(hasDedicatedLiveTestSelection({ testNamePattern: /CALL-E/ })).toBe(false);
    expect(hasDedicatedLiveTestSelection({
      testNamePattern: /CALLE_LIVE_E2E_DEDICATED_SELECTION/,
    })).toBe(true);

    const allLiveValues: Partial<Record<EnvironmentName, string>> = {
      CALLE_LIVE_E2E_MODE: LIVE_MODE,
      CALLE_LIVE_E2E_CONFIRM: LIVE_CONFIRMATION,
      CALLE_API_KEY: 'configured-but-must-not-be-read',
      CALLE_TEST_PHONE: 'configured-phone-must-not-be-read',
    };
    const ordinarySuite = vi.fn<EnvironmentReader>((name) => allLiveValues[name]);
    expect(readLiveConfiguration(false, ordinarySuite)).toEqual({
      authorized: false,
      reason: 'DEDICATED_MANUAL_TEST_SELECTION_REQUIRED',
    });
    expect(ordinarySuite).not.toHaveBeenCalled();

    const credentialsOnlyValues: Partial<Record<EnvironmentName, string>> = {
      CALLE_API_KEY: 'configured-but-must-not-be-read',
      CALLE_TEST_PHONE: 'configured-phone-must-not-be-read',
    };
    const dedicatedWithoutMode = vi.fn<EnvironmentReader>((name) => credentialsOnlyValues[name]);
    expect(readLiveConfiguration(true, dedicatedWithoutMode)).toEqual({
      authorized: false,
      reason: 'LIVE_MODE_REQUIRED',
    });
    expect(dedicatedWithoutMode).not.toHaveBeenCalledWith('CALLE_API_KEY');
    expect(dedicatedWithoutMode).not.toHaveBeenCalledWith('CALLE_TEST_PHONE');

    const modeWithoutConfirmationValues: Partial<Record<EnvironmentName, string>> = {
      CALLE_LIVE_E2E_MODE: LIVE_MODE,
      ...credentialsOnlyValues,
    };
    const dedicatedWithoutConfirmation = vi.fn<EnvironmentReader>(
      (name) => modeWithoutConfirmationValues[name],
    );
    expect(readLiveConfiguration(true, dedicatedWithoutConfirmation)).toEqual({
      authorized: false,
      reason: 'LIVE_CONFIRMATION_REQUIRED',
    });
    expect(dedicatedWithoutConfirmation).not.toHaveBeenCalledWith('CALLE_API_KEY');
    expect(dedicatedWithoutConfirmation).not.toHaveBeenCalledWith('CALLE_TEST_PHONE');

    const fullyAuthorized = vi.fn<EnvironmentReader>((name) => allLiveValues[name]);
    expect(readLiveConfiguration(true, fullyAuthorized)).toEqual({
      authorized: true,
      apiKey: 'configured-but-must-not-be-read',
      phoneNumber: 'configured-phone-must-not-be-read',
    });
    expect(fullyAuthorized.mock.calls.map(([name]) => name)).toEqual([
      'CALLE_LIVE_E2E_MODE',
      'CALLE_LIVE_E2E_CONFIRM',
      'CALLE_API_KEY',
      'CALLE_TEST_PHONE',
    ]);
  });

  it('records provider returns and sanitized thrown categories without changing behavior', async () => {
    expect(callRequest('+15555550123').requestId).toBe('REQUEST-CALLE-LIVE-CLIENT-REAL-V3');

    const returnedResult = { status: 'failed', structuredResult: null };
    const returnedProvider = new RecordingCallProvider({
      executeCall: vi.fn(async () => returnedResult),
    });
    await expect(returnedProvider.executeCall(callRequest('+15555550123'))).resolves.toBe(returnedResult);
    expect(recordingProofProjection(returnedProvider)).toEqual({
      invocationCount: 1,
      delegateReturned: true,
      delegateThrew: false,
      phases: ['RECORDING_PROVIDER_ENTERED', 'DELEGATE_INVOCATION_STARTED', 'DELEGATE_RETURNED'],
      providerLevelEvidence: {
        status: 'failed',
        structuredResult: null,
        taskCompleted: undefined,
        completionConfidence: undefined,
        evidenceCount: undefined,
      },
    });

    const originalError = new ProviderOperationalError('NETWORK_FAILURE');
    const thrownProvider = new RecordingCallProvider({
      executeCall: vi.fn(async () => {
        throw originalError;
      }),
    });
    await expect(thrownProvider.executeCall(callRequest('+15555550123'))).rejects.toBe(originalError);
    expect(recordingProofProjection(thrownProvider)).toEqual({
      invocationCount: 1,
      delegateReturned: false,
      delegateThrew: true,
      thrownError: { type: 'ProviderOperationalError', category: 'NETWORK_FAILURE' },
      phases: ['RECORDING_PROVIDER_ENTERED', 'DELEGATE_INVOCATION_STARTED', 'DELEGATE_THREW'],
    });

    const secret = 'must-not-appear-in-diagnostics';
    expect(JSON.stringify(sanitizeThrownError(new Error(secret)))).not.toContain(secret);
    expect(mappingFailureProjection({
      success: false,
      reason: 'Call provider network failure',
      retryable: true,
      issues: ['Provider operational error: NETWORK_FAILURE'],
    })).toEqual({
      success: false,
      reason: 'Call provider network failure',
      retryable: true,
      issues: ['Provider operational error: NETWORK_FAILURE'],
    });
  });

  it.skipIf(!manualLiveRunSelected)(
    `${DEDICATED_LIVE_TEST_SELECTION} places exactly one real CALL-E call and applies only the post-result reviewed decision`,
    async () => {
      const configuration = readLiveConfiguration(
        dedicatedLiveTestSelected,
        (name) => process.env[name],
      );
      if (!configuration.authorized) throw new Error(`Live execution not authorized: ${configuration.reason}`);

      const state = prepareLocalState();
      const request = callRequest(configuration.phoneNumber);
      const realProvider = new CallEProvider({
        apiKeySource: () => configuration.apiKey,
        allowedDecisions: ['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION'],
      });
      const recordingProvider = new RecordingCallProvider(realProvider);

      process.stdout.write(`\n${JSON.stringify({
        stage: 'LIVE CALL-E',
        requestId: request.requestId,
        caseId: request.caseId,
        planId: request.planId,
        actorId: request.actorId,
        actorRole: request.actorRole,
        maskedDestination: maskPhone(request.phoneNumber),
      }, null, 2)}\n`);

      let mapped: CallMappingResult;
      try {
        mapped = await executeCall(recordingProvider, request, CALL_RECEIVED_AT);
        recordingProvider.recordPhase('EXECUTE_CALL_RETURNED');
        recordingProvider.recordPhase(mapped.success
          ? 'MAPPING_SUCCESS_OBSERVED'
          : 'MAPPING_FAILURE_OBSERVED');
      } catch (error: unknown) {
        recordingProvider.recordPhase('EXECUTE_CALL_THREW');
        process.stdout.write(`${JSON.stringify({
          stage: 'CALL-E provider diagnostic',
          recording: recordingProofProjection(recordingProvider),
          executeCallError: sanitizeThrownError(error),
        }, null, 2)}\n`);
        throw error;
      }
      expect(recordingProvider.invocationCount).toBe(1);
      process.stdout.write(`${JSON.stringify({
        stage: 'CALL-E provider diagnostic',
        recording: recordingProofProjection(recordingProvider),
      }, null, 2)}\n`);
      if (!mapped.success) {
        process.stdout.write(`${JSON.stringify({
          stage: 'CALL-E mapping failure',
          mapping: mappingFailureProjection(mapped),
        }, null, 2)}\n`);
        throw new Error(`Live CALL-E mapping stopped safely: ${mapped.reason}`);
      }
      expect(mapped.success).toBe(true);
      expect(mapped.value).toMatchObject({
        requestId: request.requestId,
        caseId: CASE_ID,
        planId: PLAN_ID,
        actorId: CLIENT_ID,
        actorRole: 'client',
        receivedAt: CALL_RECEIVED_AT,
      });
      process.stdout.write(`${JSON.stringify({
        stage: 'mapped Exception Broker evidence',
        requestId: mapped.value.requestId,
        caseId: mapped.value.caseId,
        planId: mapped.value.planId,
        actorId: mapped.value.actorId,
        actorRole: mapped.value.actorRole,
        decision: mapped.value.decision,
        completionConfidence: mapped.value.completionConfidence,
        evidenceCount: mapped.value.evidence.length,
        receivedAt: mapped.value.receivedAt,
      }, null, 2)}\n`);

      const bridgeResult = prepareDecisionProposal(mapped, {
        exceptionCase: state.exceptionCase,
        plans: state.plans,
      }, {
        operationType: 'PLAN_DECISION',
        caseId: CASE_ID,
        planId: PLAN_ID,
        actorId: CLIENT_ID,
        actorRole: 'client',
      });
      expect(bridgeResult.ready).toBe(true);
      if (!bridgeResult.ready) throw new Error(`Decision Bridge stopped safely: ${bridgeResult.reason}`);
      expect(bridgeResult.proposal).toMatchObject({
        operationType: 'PLAN_DECISION',
        caseId: CASE_ID,
        planId: PLAN_ID,
        actorId: CLIENT_ID,
        actorRole: 'client',
        decision: mapped.value.decision,
        requiresReview: true,
      });
      process.stdout.write(`${JSON.stringify({
        stage: 'Decision Bridge review proposal',
        ready: true,
        operationType: bridgeResult.proposal.operationType,
        caseId: bridgeResult.proposal.caseId,
        planId: bridgeResult.proposal.operationType === 'PLAN_DECISION'
          ? bridgeResult.proposal.planId
          : undefined,
        actorId: bridgeResult.proposal.actorId,
        actorRole: bridgeResult.proposal.actorRole,
        decision: bridgeResult.proposal.decision,
        requiresReview: bridgeResult.proposal.requiresReview,
        reviewState: bridgeResult.proposal.reviewState,
        evidenceCount: bridgeResult.proposal.evidence.length,
      }, null, 2)}\n`);

      if (mapped.value.decision === 'NEEDS_CLARIFICATION') {
        expect(state.approvals.map(({ actorRole }) => actorRole)).toEqual(['supplier', 'production']);
        expect(state.plans.find(({ id }) => id === PLAN_ID)?.status).toBe('PENDING_APPROVAL');
        expect(state.operationHistory).toHaveLength(2);
        expect(state.events).toHaveLength(2);
        process.stdout.write(`${JSON.stringify({
          stage: 'Exception Broker safe stop',
          runtimePipelineReached: 'DECISION_BRIDGE',
          applicationReached: false,
          safeStopReason: 'CLARIFICATION_REQUIRED',
          decision: mapped.value.decision,
          caseId: mapped.value.caseId,
          planId: mapped.value.planId,
          actorId: mapped.value.actorId,
          actorRole: mapped.value.actorRole,
        }, null, 2)}\n`);
        return;
      }
      const postResultReview = await promptForPostResultReview();
      if (postResultReview !== 'APPLY') {
        expect(state.approvals.map(({ actorRole }) => actorRole)).toEqual(['supplier', 'production']);
        throw new Error('Live proof discarded after review; no real CALL-E decision was applied');
      }

      const operationId = 'OPERATION-CALLE-LIVE-CLIENT-REAL';
      const eventId = 'EVENT-CALLE-LIVE-CLIENT-REAL';
      const approvalId = 'APPROVAL-CALLE-LIVE-CLIENT-REAL';
      const application = executeOrchestrationAction(state, {
        type: 'APPLY_REVIEWED_DECISION',
        bridgeResult,
        review: bindReviewCommand({
          action: 'APPLY',
          operationId,
          reviewedBy: 'REVIEWER-CALLE-LIVE-HUMAN',
          reviewedAt: REVIEWED_AT,
          eventId,
          approvalId,
          authorizationReviews: [],
        }, bridgeResult.reviewTarget),
      });
      expect(application.accepted).toBe(true);
      if (!application.accepted) throw new Error(`Exception Broker stopped safely: ${application.failure.reason}`);

      const finalPlan = application.state.plans.find(({ id }) => id === PLAN_ID);
      const appliedDecision = application.state.approvals.find(({ approvalId: id }) => id === approvalId);
      expect(appliedDecision).toMatchObject({
        caseId: CASE_ID,
        planId: PLAN_ID,
        actorId: CLIENT_ID,
        actorRole: 'client',
        decision: mapped.value.decision,
      });
      expect(application.state.operationHistory.some(({ operationId: id }) => id === operationId)).toBe(true);
      expect(application.state.events.some((event) =>
        event.eventId === eventId
        && event.operationId === operationId
        && event.requestId === mapped.value.requestId
        && event.approvalId === approvalId)).toBe(true);

      if (mapped.value.decision === 'APPROVED') {
        expect(finalPlan?.status).toBe('APPROVED');
        expect(application.disposition).toEqual({
          type: 'LINEAGE_RESOLVED',
          scope: { caseId: CASE_ID, lineageId: LINEAGE_ID, planId: PLAN_ID },
        });
      } else {
        expect(mapped.value.decision).toBe('REJECTED');
        expect(finalPlan?.status).toBe('REJECTED');
        expect(application.disposition).toEqual({ type: 'AWAITING_EXTERNAL_ACTION' });
        expect(application.state.plans).toHaveLength(1);
      }

      process.stdout.write(`${JSON.stringify({
        stage: 'Exception Broker authoritative result',
        disposition: application.disposition,
        planStatus: finalPlan?.status,
        appliedDecision: appliedDecision?.decision,
        operationId,
        eventId,
        approvalId,
      }, null, 2)}\n`);
    },
    300_000,
  );
});

import { createHash } from 'node:crypto';

import type { Call } from '@call-e/calle';

import { buildCallEInput } from '../integrations/calle/callEProvider.js';
import { mapCalleResponseForContext } from '../integrations/calle/mapper.js';
import { phoneDecisionSchema } from '../integrations/calle/schemas.js';
import type { CallRequest } from '../integrations/calle/types.js';
import type { AcquisitionCallGateway } from './calleGateway.js';
import {
  acquisitionCreateSchema,
  isTerminalStatus,
  type AcquisitionCreateInput,
  type AcquisitionRecord,
  type CreateAcquisitionResult,
  type PersistedDecisionContext,
  type PollAcquisitionResult,
  type SanitizedAttempt,
  type SanitizedCall,
  type SanitizedRecipient,
  type SanitizedTranscriptTurn,
} from './contracts.js';
import { evaluateAcquisitionGuard, hashClientToken, type AcquisitionGuardPolicy } from './guardrails.js';
import type { AcquisitionStore } from './store.js';

export type AcquisitionClock = () => string;
export type AcquisitionDelay = (milliseconds: number) => Promise<void>;

export type AcquisitionServiceOptions = Readonly<{
  store: AcquisitionStore;
  gateway: AcquisitionCallGateway;
  policy: AcquisitionGuardPolicy;
  clock?: AcquisitionClock;
  delay?: AcquisitionDelay;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}>;

const defaultClock: AcquisitionClock = () => new Date().toISOString();
const defaultDelay: AcquisitionDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const maskPhone = (phone: string) => `${phone.slice(0, 3)}${'*'.repeat(Math.max(4, phone.length - 5))}${phone.slice(-2)}`;
const safeText = (value: string | null, maximum = 1_000): string | null => {
  if (value === null) return null;
  return value
    .slice(0, maximum)
    .replace(/Bearer\s+\S+/gi, '[redacted credential]')
    .replace(/\+[1-9]\d{7,14}/g, '[redacted phone]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted email]');
};

const sanitizePrimitive = (value: string | number | boolean) =>
  typeof value === 'string' ? (safeText(value) ?? '') : value;

const sanitizeTurn = (turn: Call['recipients'][number]['attempts'][number]['transcriptTurns'][number]): SanitizedTranscriptTurn => ({
  offsetSeconds: turn.offset_seconds,
  speaker: turn.speaker,
  text: safeText(turn.text, 1_000) ?? '',
});

const sanitizeAttempt = (attempt: Call['recipients'][number]['attempts'][number]): SanitizedAttempt => ({
  id: attempt.id,
  status: attempt.status,
  startedAt: attempt.startedAt,
  completedAt: attempt.completedAt,
  summary: safeText(attempt.summary),
  transcriptTurns: attempt.transcriptTurns.map(sanitizeTurn),
  providerCallId: attempt.providerCallId,
  failureCode: safeText(attempt.failureCode, 120),
  failureMessage: safeText(attempt.failureMessage),
});

const sanitizeRecipient = (recipient: Call['recipients'][number]): SanitizedRecipient => ({
  id: recipient.id,
  status: recipient.status,
  summary: safeText(recipient.summary),
  attempts: recipient.attempts.map(sanitizeAttempt),
});

const sanitizeCall = (call: Call): SanitizedCall => {
  const decision = phoneDecisionSchema.safeParse(call.structuredResult);
  const structuredResult = decision.success ? {
    ...decision.data,
    summary: safeText(decision.data.summary) ?? '',
    authorizationChanges: decision.data.authorizationChanges.map((change) => ({
      ...change,
      field: safeText(change.field, 200) ?? '',
      newValue: sanitizePrimitive(change.newValue),
      ...(change.previousValue === undefined ? {} : { previousValue: sanitizePrimitive(change.previousValue) }),
      ...(change.reason === undefined ? {} : { reason: safeText(change.reason, 1_000) ?? '' }),
    })),
  } : null;
  return {
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence === null ? null : { ...call.completionConfidence },
    summary: safeText(call.summary),
    evidence: call.evidence.map((item) => safeText(item, 1_000) ?? ''),
    structuredResult,
    createdAt: call.createdAt,
    completedAt: call.completedAt,
    failureCode: safeText(call.failureCode, 120),
    failureMessage: safeText(call.failureMessage),
    recipients: call.recipients.map(sanitizeRecipient),
  };
};

const fingerprintFor = (input: AcquisitionCreateInput): string => createHash('sha256')
  .update(JSON.stringify({ phoneNumber: input.phoneNumber, request: input.request }), 'utf8')
  .digest('hex');

export const acquisitionRequestDefinitionFingerprint = (request: Readonly<{ caseId: string; planId?: string | undefined; actorId: string; actorRole: string;
  objective: string; context: string; expectedDecisionSchema: unknown }>): string => createHash('sha256')
  .update(JSON.stringify({ caseId: request.caseId, planId: request.planId, actorId: request.actorId, actorRole: request.actorRole,
    objective: request.objective, context: request.context, expectedDecisionSchema: request.expectedDecisionSchema }), 'utf8')
  .digest('hex');

const contextFor = (request: AcquisitionCreateInput['request']): PersistedDecisionContext => ({
  requestId: request.requestId,
  createdAt: request.createdAt,
  caseId: request.caseId,
  ...(request.planId === undefined ? {} : { planId: request.planId }),
  actorId: request.actorId,
  actorRole: request.actorRole,
});

const safeProviderFailure = 'CALL-E provider operation failed safely';

export class AcquisitionService {
  readonly #store: AcquisitionStore;
  readonly #gateway: AcquisitionCallGateway;
  readonly #policy: AcquisitionGuardPolicy;
  readonly #clock: AcquisitionClock;
  readonly #delay: AcquisitionDelay;
  readonly #pollIntervalMs: number;
  readonly #pollTimeoutMs: number;
  readonly #creates = new Map<string, Promise<CreateAcquisitionResult>>();
  #creationQueue: Promise<void> = Promise.resolve();

  constructor(options: AcquisitionServiceOptions) {
    this.#store = options.store;
    this.#gateway = options.gateway;
    this.#policy = options.policy;
    this.#clock = options.clock ?? defaultClock;
    this.#delay = options.delay ?? defaultDelay;
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.#pollTimeoutMs = options.pollTimeoutMs ?? 60_000;
    if (this.#pollIntervalMs <= 0 || this.#pollTimeoutMs < this.#pollIntervalMs) throw new Error('Invalid polling bounds');
  }

  async get(acquisitionId: string, clientToken: string): Promise<AcquisitionRecord | undefined> {
    const record = await this.#store.get(acquisitionId);
    return record?.clientTokenHash === hashClientToken(clientToken) ? record : undefined;
  }

  async create(input: unknown): Promise<CreateAcquisitionResult> {
    const parsed = acquisitionCreateSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, code: 'INVALID_INPUT', reason: 'Invalid acquisition request' };
    const acquisition = parsed.data;
    const current = this.#creates.get(acquisition.acquisitionId);
    if (current !== undefined) return current;

    const operation = this.#enqueueCreate(acquisition).finally(() => this.#creates.delete(acquisition.acquisitionId));
    this.#creates.set(acquisition.acquisitionId, operation);
    return operation;
  }

  #enqueueCreate(input: AcquisitionCreateInput): Promise<CreateAcquisitionResult> {
    const result = this.#creationQueue.then(() => this.#create(input));
    this.#creationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async #create(input: AcquisitionCreateInput): Promise<CreateAcquisitionResult> {
    const fingerprint = fingerprintFor(input);
    const existing = await this.#store.get(input.acquisitionId);
    if (existing !== undefined) {
      if (existing.requestFingerprint !== fingerprint || existing.clientTokenHash !== hashClientToken(input.clientToken)) {
        return { accepted: false, code: 'INVALID_INPUT', reason: 'Acquisition id is already bound to different request content' };
      }
      if (existing.status === 'creating' && existing.callId === null) {
        const callRequest: CallRequest = { ...input.request, phoneNumber: input.phoneNumber };
        try {
          const call = await this.#gateway.create(buildCallEInput(callRequest), existing.idempotencyKey, input.clientToken);
          return { accepted: true, record: await this.#recordCall(existing, call), existing: true };
        } catch (_error: unknown) {
          return { accepted: true, record: await this.#recordProviderCreateFailure(existing), existing: true };
        }
      }
      return { accepted: true, record: existing, existing: true };
    }

    const now = this.#clock();
    const guard = evaluateAcquisitionGuard(input, await this.#store.list(), this.#policy, now);
    if (guard !== undefined) return guard;

    const idempotencyKey = `exception-broker-acquisition-v1:${input.acquisitionId}`;
    const initial: AcquisitionRecord = {
      acquisitionId: input.acquisitionId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      requestDefinitionFingerprint: acquisitionRequestDefinitionFingerprint(input.request),
      clientTokenHash: hashClientToken(input.clientToken),
      authorizationConfirmed: true,
      maskedRecipient: maskPhone(input.phoneNumber),
      decisionContext: contextFor(input.request),
      status: 'creating',
      callId: null,
      createdAt: now,
      updatedAt: now,
      terminalAt: null,
      providerEvidence: null,
      normalizedResult: null,
      normalizationStatus: 'PENDING',
      safeStopReason: null,
      handoffState: 'NOT_READY',
    };
    await this.#store.put(initial);

    const callRequest: CallRequest = { ...input.request, phoneNumber: input.phoneNumber };
    try {
      const call = await this.#gateway.create(buildCallEInput(callRequest), idempotencyKey, input.clientToken);
      const record = await this.#recordCall(initial, call);
      return { accepted: true, record, existing: false };
    } catch (_error: unknown) {
      const failed = await this.#recordProviderCreateFailure(initial);
      return { accepted: true, record: failed, existing: false };
    }
  }

  async poll(acquisitionId: string, clientToken: string): Promise<PollAcquisitionResult> {
    let record = await this.#store.get(acquisitionId);
    if (record === undefined || record.clientTokenHash !== hashClientToken(clientToken)) {
      return { found: false, code: 'NOT_FOUND', reason: 'Acquisition was not found' };
    }
    if (record.callId === null || isTerminalStatus(record.status)) return { found: true, record };
    const callId = record.callId;

    const maximumAttempts = Math.ceil(this.#pollTimeoutMs / this.#pollIntervalMs);
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      try {
        const call = await this.#gateway.get(callId, clientToken);
        record = await this.#recordCall(record, call);
      } catch (_error: unknown) {
        return { found: false, code: 'PROVIDER_FAILURE', reason: safeProviderFailure };
      }
      if (isTerminalStatus(record.status)) return { found: true, record };
      if (attempt + 1 < maximumAttempts) await this.#delay(this.#pollIntervalMs);
    }
    return { found: false, code: 'POLL_TIMEOUT', reason: 'Bounded CALL-E polling timed out' };
  }

  async refresh(acquisitionId: string, clientToken: string): Promise<PollAcquisitionResult> {
    const record = await this.#store.get(acquisitionId);
    if (record === undefined || record.clientTokenHash !== hashClientToken(clientToken)) {
      return { found: false, code: 'NOT_FOUND', reason: 'Acquisition was not found' };
    }
    if (record.callId === null || isTerminalStatus(record.status)) return { found: true, record };

    try {
      const call = await this.#gateway.get(record.callId, clientToken);
      return { found: true, record: await this.#recordCall(record, call) };
    } catch (_error: unknown) {
      return { found: false, code: 'PROVIDER_FAILURE', reason: safeProviderFailure };
    }
  }

  async #recordProviderCreateFailure(previous: AcquisitionRecord): Promise<AcquisitionRecord> {
    const updatedAt = this.#clock();
    const failed: AcquisitionRecord = {
      ...previous,
      status: 'failed',
      updatedAt,
      terminalAt: updatedAt,
      normalizationStatus: 'SAFE_STOP',
      safeStopReason: safeProviderFailure,
      handoffState: 'SAFE_STOP',
    };
    await this.#store.put(failed);
    return failed;
  }

  async #recordCall(previous: AcquisitionRecord, call: Call): Promise<AcquisitionRecord> {
    const updatedAt = this.#clock();
    const sanitized = sanitizeCall(call);
    let record: AcquisitionRecord = {
      ...previous,
      callId: call.id,
      status: call.status,
      updatedAt,
      terminalAt: isTerminalStatus(call.status) ? (call.completedAt ?? updatedAt) : null,
      providerEvidence: sanitized,
    };

    if (isTerminalStatus(call.status)) {
      const mapped = mapCalleResponseForContext(previous.decisionContext, sanitized, updatedAt);
      if (mapped.success && (mapped.value.decision === 'APPROVED' || mapped.value.decision === 'REJECTED')) {
        record = { ...record, normalizedResult: mapped.value, normalizationStatus: 'USABLE', safeStopReason: null, handoffState: 'READY_FOR_REVIEW' };
      } else {
        const reason = mapped.success
          ? `Decision ${mapped.value.decision} requires a safe stop before review`
          : mapped.reason;
        record = { ...record, normalizedResult: mapped.success ? mapped.value : null, normalizationStatus: 'SAFE_STOP', safeStopReason: reason, handoffState: 'SAFE_STOP' };
      }
    }
    await this.#store.put(record);
    return record;
  }
}

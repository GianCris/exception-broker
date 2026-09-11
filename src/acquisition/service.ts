import { createHash } from 'node:crypto';

import type { Call } from '@call-e/calle';

import { buildCallEInput } from '../integrations/calle/callEProvider.js';
import { mapCalleResponseForContext } from '../integrations/calle/mapper.js';
import { phoneDecisionSchema } from '../integrations/calle/schemas.js';
import type { CallRequest } from '../integrations/calle/types.js';
import { ProviderNotDispatchedError, type AcquisitionCallGateway } from './calleGateway.js';
import {
  acquisitionCreateSchema,
  isTerminalStatus,
  type AcquisitionCreateInput,
  type AcquisitionRecord,
  type AcquisitionTechnicalFailure,
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
  /** Breathing room before the single bounded create reconciliation reuses the idempotency key. */
  reconcileDelayMs?: number;
  onConnectionActiveChange?: (connectionId: string, active: boolean) => void;
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

/**
 * Lifetime ceiling on provider create requests for one acquisition: the initial dispatch, one
 * automatic same-key reconciliation inside that request, and one later explicit reconciliation.
 * Past it the acquisition stays protected and ambiguous rather than dialling again, because
 * CALL-E may have accepted any of them.
 */
const maximumCreateDispatches = 3;
/** Dispatches a single create/reconcile request may spend, so a manual retry can never spend two. */
const dispatchesPerRequest = 2;

/**
 * Provider error text is untrusted and may embed credentials the transcript redaction never
 * anticipated, so diagnostics get a stricter pass than conversation content: the shared
 * redaction first, then credential-shaped and long opaque values.
 */
const diagnosticText = (value: string | null, maximum = 300): string | null => {
  const safe = safeText(value, maximum);
  if (safe === null) return null;
  const redacted = safe
    .replace(/\b(?:api[-_]?key|authorization|token|secret|password)\b\s*[:=]\s*\S+/gi, '[redacted credential]')
    .replace(/\b(?:sk|pk|key|tok|secret)[-_][A-Za-z0-9._-]{6,}/gi, '[redacted credential]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted opaque value]');
  return redacted.trim() === '' ? null : redacted;
};

/**
 * Reads only well-known, safe fields. The raw error object, its `details` and its stack are
 * never persisted or exposed, because they can carry request headers and credentials.
 */
const failureDiagnostics = (error: unknown): Readonly<{ code: string | null; message: string | null }> => {
  if (error instanceof ProviderNotDispatchedError) return { code: error.reason, message: null };
  const code = typeof (error as { code?: unknown })?.code === 'string' ? diagnosticText((error as { code: string }).code, 120) : null;
  const name = error instanceof Error ? diagnosticText(error.name, 120) : null;
  return { code: code ?? name, message: error instanceof Error ? diagnosticText(error.message) : null };
};

export class AcquisitionService {
  readonly #store: AcquisitionStore;
  readonly #gateway: AcquisitionCallGateway;
  readonly #policy: AcquisitionGuardPolicy;
  readonly #clock: AcquisitionClock;
  readonly #delay: AcquisitionDelay;
  readonly #pollIntervalMs: number;
  readonly #pollTimeoutMs: number;
  readonly #reconcileDelayMs: number;
  readonly #onConnectionActiveChange: (connectionId: string, active: boolean) => void;
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
    this.#reconcileDelayMs = options.reconcileDelayMs ?? 1_000;
    this.#onConnectionActiveChange = options.onConnectionActiveChange ?? (() => undefined);
    if (this.#pollIntervalMs <= 0 || this.#pollTimeoutMs < this.#pollIntervalMs) throw new Error('Invalid polling bounds');
  }

  async get(acquisitionId: string, clientToken: string): Promise<AcquisitionRecord | undefined> {
    const record = await this.#store.get(acquisitionId);
    return record?.clientTokenHash === hashClientToken(clientToken) ? record : undefined;
  }

  async getActive(clientToken: string): Promise<AcquisitionRecord | undefined> {
    const clientHash = hashClientToken(clientToken);
    return (await this.#store.list()).find((record) => record.clientTokenHash === clientHash && !isTerminalStatus(record.status));
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
      // The server-owned idempotency key and verified fingerprint make this the same logical
      // attempt, never a second call and never another Hosted slot.
      if (existing.status === 'creating' && existing.callId === null) {
        this.#onConnectionActiveChange(input.clientToken, true);
        return { ...await this.#dispatchCreate(existing, input), existing: true };
      }
      return { accepted: true, record: existing, existing: true };
    }

    const now = this.#clock();
    const records = await this.#store.list();
    const recovery = input.recoveryOfAcquisitionId === undefined
      ? undefined
      : this.#resolveTechnicalRecovery(input, records);
    if (recovery?.rejection !== undefined) return recovery.rejection;
    // A recovery acquisition already exists for that failure: return it instead of dialling again.
    if (recovery?.claimed !== undefined) return { accepted: true, record: recovery.claimed, existing: true };

    const guard = evaluateAcquisitionGuard(input, records, this.#policy, now, recovery !== undefined);
    if (guard !== undefined) return guard;

    const idempotencyKey = `exception-broker-acquisition-v1:${input.acquisitionId}`;
    const initial: AcquisitionRecord = {
      acquisitionId: input.acquisitionId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      requestDefinitionFingerprint: acquisitionRequestDefinitionFingerprint(input.request),
      clientTokenHash: hashClientToken(input.clientToken),
      accessMode: input.accessMode,
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
      ...(recovery?.original === undefined ? {} : { recoveryOfAcquisitionId: recovery.original.acquisitionId }),
    };
    // This single write is the durable claim on the one recovery allowance: it lands before any
    // provider dispatch, so a crash can never release the allowance for a second phone call.
    await this.#store.put(initial);
    if (recovery?.original !== undefined) {
      await this.#store.put({ ...recovery.original, recoveredByAcquisitionId: initial.acquisitionId, updatedAt: now });
    }
    this.#onConnectionActiveChange(input.clientToken, true);

    return { ...await this.#dispatchCreate(initial, input), existing: false };
  }

  /**
   * Verifies a claimed Hosted technical recovery entirely server-side. The browser flag alone
   * never relaxes quota: ownership, access mode and a provider-identified terminal failure must
   * all hold, and the allowance is proven spent by durable lineage rather than session memory.
   *
   * Claim coordination assumes the current single-writer deployment: one AcquisitionService owns
   * the store, and #creationQueue serializes the read-then-claim window. Running several writer
   * processes against one store would need a compare-and-set claim instead.
   */
  #resolveTechnicalRecovery(
    input: AcquisitionCreateInput,
    records: readonly AcquisitionRecord[],
  ): Readonly<{ original?: AcquisitionRecord; claimed?: AcquisitionRecord; rejection?: Extract<CreateAcquisitionResult, { accepted: false }> }> {
    const rejection = { accepted: false, code: 'INVALID_INPUT', reason: 'Recovery is not available for that acquisition' } as const;
    const original = records.find((record) => record.acquisitionId === input.recoveryOfAcquisitionId);
    if (original === undefined || original.clientTokenHash !== hashClientToken(input.clientToken)) return { rejection };
    if (input.accessMode !== 'HOSTED_DEMO' || original.accessMode !== 'HOSTED_DEMO') return { rejection };
    // Only a genuine technical failure of an accepted provider call earns the extra attempt.
    if (original.status !== 'failed' || original.technicalFailure?.acceptance !== 'PROVIDER_IDENTIFIED') return { rejection };
    // One allowance per failure, never a chain: a recovery cannot itself be recovered.
    if (original.recoveryOfAcquisitionId !== undefined) return { rejection };
    const claimed = records.find((record) => record.recoveryOfAcquisitionId === original.acquisitionId);
    return claimed === undefined ? { original } : { claimed };
  }

  /**
   * One bounded reconciliation is attempted with the SAME persisted idempotency key and the same
   * deterministic provider payload, so CALL-E collapses a lost-response duplicate into the
   * original call instead of dialling twice.
   */
  async #dispatchCreate(record: AcquisitionRecord, input: AcquisitionCreateInput): Promise<Readonly<{ accepted: true; record: AcquisitionRecord }>> {
    const spent = record.technicalFailure?.attempts ?? 0;
    const allowed = Math.min(dispatchesPerRequest, maximumCreateDispatches - spent);
    // The persisted counter is authoritative: an exhausted or already-closed acquisition is
    // returned untouched rather than dialling again or restating its ambiguity as resolved.
    if (allowed <= 0 || record.technicalFailure?.reconciliationAvailable === false) return { accepted: true, record };

    const callRequest: CallRequest = { ...input.request, phoneNumber: input.phoneNumber };
    const providerInput = buildCallEInput(callRequest, ['APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION']);
    let dispatched = 0;
    let failure: unknown;
    // Acceptance knowledge is monotonic: once any dispatch for this acquisition — this
    // invocation or an earlier one — left the process ambiguously, a later proven-local refusal
    // must never downgrade that back to DEFINITELY_NOT_SENT.
    let ambiguityObserved = record.technicalFailure?.acceptance === 'UNKNOWN';

    for (let attempt = 0; attempt < allowed; attempt += 1) {
      dispatched += 1;
      try {
        const call = await this.#gateway.create(providerInput, record.idempotencyKey, input.clientToken);
        return { accepted: true, record: await this.#recordCall(record, call, input.clientToken) };
      } catch (error: unknown) {
        failure = error;
        if (!(error instanceof ProviderNotDispatchedError)) ambiguityObserved = true;
        // Nothing left this process, so reconciliation cannot discover anything new.
        if (error instanceof ProviderNotDispatchedError) break;
        if (attempt + 1 < allowed) await this.#delay(this.#reconcileDelayMs);
      }
    }

    const observedAt = this.#clock();
    const diagnostics = failureDiagnostics(failure);
    const notDispatched = !ambiguityObserved && failure instanceof ProviderNotDispatchedError;
    const attempts = spent + dispatched;
    const technicalFailure: AcquisitionTechnicalFailure = {
      stage: 'CREATE',
      acceptance: notDispatched ? 'DEFINITELY_NOT_SENT' : 'UNKNOWN',
      reconciliationAvailable: !notDispatched && attempts < maximumCreateDispatches,
      attempts,
      ...diagnostics,
      observedAt,
    };
    return {
      accepted: true,
      record: notDispatched
        ? await this.#recordCreateNotDispatched(record, input.clientToken, technicalFailure)
        : await this.#recordAcceptanceUnknown(record, technicalFailure, observedAt),
    };
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
        record = await this.#recordCall(record, call, clientToken);
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
      return { found: true, record: await this.#recordCall(record, call, clientToken) };
    } catch (_error: unknown) {
      return { found: false, code: 'PROVIDER_FAILURE', reason: safeProviderFailure };
    }
  }

  /**
   * Proven local pre-dispatch refusal: terminal, and no provider operation was ever spent.
   * A technical stop is not a business disposition, so normalization never runs and the record
   * carries no SAFE_STOP verdict — only the diagnostics that explain the technical cause.
   */
  async #recordCreateNotDispatched(previous: AcquisitionRecord, clientToken: string, technicalFailure: AcquisitionTechnicalFailure): Promise<AcquisitionRecord> {
    const updatedAt = technicalFailure.observedAt;
    const failed: AcquisitionRecord = {
      ...previous,
      status: 'failed',
      updatedAt,
      terminalAt: updatedAt,
      normalizedResult: null,
      normalizationStatus: 'PENDING',
      safeStopReason: null,
      handoffState: 'NOT_READY',
      technicalFailure,
    };
    await this.#store.put(failed);
    this.#onConnectionActiveChange(clientToken, false);
    return failed;
  }

  /**
   * Ambiguous acceptance is NOT a provider outcome, so the lifecycle stays non-terminal: the
   * acquisition keeps its identity, the connection stays locked against a second independent
   * call, and the same idempotency key remains available for reconciliation.
   */
  async #recordAcceptanceUnknown(previous: AcquisitionRecord, technicalFailure: AcquisitionTechnicalFailure, updatedAt: string): Promise<AcquisitionRecord> {
    const pending: AcquisitionRecord = { ...previous, status: 'creating', callId: null, updatedAt, terminalAt: null, technicalFailure };
    await this.#store.put(pending);
    return pending;
  }

  async #recordCall(previous: AcquisitionRecord, call: Call, clientToken: string): Promise<AcquisitionRecord> {
    const updatedAt = this.#clock();
    const sanitized = sanitizeCall(call);
    // CALL-E answered with a call identity, so any earlier ambiguity is now resolved and its
    // stale diagnostics must not survive into the record.
    const { technicalFailure: _resolved, ...base } = previous;
    let record: AcquisitionRecord = {
      ...base,
      callId: call.id,
      status: call.status,
      updatedAt,
      terminalAt: isTerminalStatus(call.status) ? (call.completedAt ?? updatedAt) : null,
      providerEvidence: sanitized,
      // A provider-terminal technical outcome keeps whatever CALL-E actually returned — including
      // nothing — rather than inventing failure semantics the provider never sent.
      ...(call.status === 'failed' || call.status === 'canceled' ? { technicalFailure: {
        stage: 'PROVIDER_TERMINAL' as const,
        acceptance: 'PROVIDER_IDENTIFIED' as const,
        reconciliationAvailable: false,
        attempts: previous.technicalFailure?.attempts ?? 1,
        code: diagnosticText(sanitized.failureCode, 120),
        message: diagnosticText(sanitized.failureMessage),
        observedAt: updatedAt,
      } } : {}),
    };

    // Only a completed call carries a business result, so only a completed call may reach the
    // decision mapper. Technical terminal outcomes never become a business SAFE_STOP.
    if (call.status === 'completed') {
      const mapped = mapCalleResponseForContext(previous.decisionContext, sanitized, updatedAt);
      if (mapped.success && (mapped.value.decision === 'APPROVED' || mapped.value.decision === 'REJECTED')) {
        record = { ...record, normalizedResult: mapped.value, normalizationStatus: 'USABLE', safeStopReason: null, handoffState: 'READY_FOR_REVIEW' };
      } else {
        const reason = mapped.success
          ? `Decision ${mapped.value.decision} requires a safe stop before review`
          : mapped.reason;
        record = { ...record, normalizedResult: mapped.success ? mapped.value : null, normalizationStatus: 'SAFE_STOP', safeStopReason: reason, handoffState: 'SAFE_STOP' };
      }
    } else if (isTerminalStatus(call.status)) {
      record = { ...record, normalizedResult: null, normalizationStatus: 'PENDING', safeStopReason: null, handoffState: 'NOT_READY' };
    }
    await this.#store.put(record);
    if (isTerminalStatus(record.status)) this.#onConnectionActiveChange(clientToken, false);
    return record;
  }
}

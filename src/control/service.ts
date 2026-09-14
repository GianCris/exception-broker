import { createHash } from 'node:crypto';
import { executeOrchestrationAction, type OrchestrationResult, type OrchestrationState } from '../application/adaptiveOrchestrator.js';
import type { AcquisitionRecord } from '../acquisition/contracts.js';
import { acquisitionRequestDefinitionFingerprint, type AcquisitionService } from '../acquisition/service.js';
import { bindReviewCommand } from '../integrations/calle/decisionApplication.js';
import { prepareDecisionProposal, reviewTargetsEqual, type DecisionBridgeResult, type ReviewTarget } from '../integrations/calle/decisionBridge.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, OPERATOR_SANDBOX_OBJECTIVE, operatorSandboxContext } from '../sandbox/operatorDefinition.js';
import { createOperatorControlledState } from '../sandbox/operatorContext.js';
import type { LiveControlReceipt, LiveControlResult, LiveControlReviewMetadata, LiveControlSession, SourceAcquisitionBinding } from './contracts.js';
import { toPublicLiveControlRecord } from './contracts.js';
import type { LiveControlStore } from './store.js';

type Clock = () => string;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const constraintProjection = (constraint: OrchestrationState['exceptionCase']['actors'][number]['constraints'][number]) => constraint.type === 'SUPPLY'
  ? { type: constraint.type, originalQuantity: constraint.originalQuantity, substituteQuantity: constraint.substituteQuantity,
      deliveryDate: constraint.deliveryDate, substituteUnitAdditionalCost: constraint.substituteUnitAdditionalCost }
  : { type: constraint.type, minimumRequiredQuantity: constraint.minimumRequiredQuantity, deliveryDate: constraint.deliveryDate,
      allowsOriginalAndSubstituteMix: constraint.allowsOriginalAndSubstituteMix };
const canonicalContextProjection = (state: OrchestrationState) => {
  return {
    definitionId: OPERATOR_SANDBOX_DEFINITION.definitionId, definitionVersion: OPERATOR_SANDBOX_DEFINITION.definitionVersion,
    exceptionCase: { id: state.exceptionCase.id, status: state.exceptionCase.status, requestedQuantity: state.exceptionCase.requestedQuantity,
      targetDeliveryDate: state.exceptionCase.targetDeliveryDate, actors: [...state.exceptionCase.actors].sort((left, right) => compareText(left.id, right.id)).map((actor) => ({
        id: actor.id, role: actor.role,
        authorization: { maxAbsorbableAdditionalCost: actor.authorization.maxAbsorbableAdditionalCost, maxSubstituteQuantity: actor.authorization.maxSubstituteQuantity,
          latestAcceptedDeliveryDate: actor.authorization.latestAcceptedDeliveryDate },
        constraints: actor.constraints.map(constraintProjection).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
      })) },
    plans: [...state.plans].sort((left, right) => compareText(`${left.id}:${left.version}`, `${right.id}:${right.version}`)).map((plan) => ({ ...plan })),
    lineages: [...state.planLineages].sort((left, right) => compareText(left.lineageId, right.lineageId)).map((lineage) => ({
      lineageId: lineage.lineageId, caseId: lineage.caseId, planIds: [...lineage.planIds],
    })),
    prerequisites: [...state.approvals].sort((left, right) => compareText(`${left.actorId}:${left.actorRole}:${left.planId}`, `${right.actorId}:${right.actorRole}:${right.planId}`)).map((approval) => ({
      caseId: approval.caseId, planId: approval.planId, actorId: approval.actorId, actorRole: approval.actorRole, decision: approval.decision,
    })),
    processedOperations: [...state.operationHistory].map(({ operationId, caseId }) => ({ operationId, caseId })).sort((left, right) => compareText(left.operationId, right.operationId)),
    existingEventIds: state.events.map(({ eventId }) => eventId).sort(compareText),
  };
};
export const controlledContextFingerprint = (state: OrchestrationState) => hash(canonicalContextProjection(state));
export const operatorSandboxContextFingerprint = () => controlledContextFingerprint(createOperatorControlledState());
const normalizedProjection = (record: AcquisitionRecord) => {
  const value = record.normalizedResult!;
  return { requestId: value.requestId, createdAt: value.createdAt, receivedAt: value.receivedAt, caseId: value.caseId, planId: value.planId,
    actorId: value.actorId, actorRole: value.actorRole, decision: value.decision, summary: value.summary,
    authorizationChanges: value.authorizationChanges.map((change) => ({ field: change.field, ...(change.externalPreviousValue === undefined ? {} : { externalPreviousValue: change.externalPreviousValue }), newValue: change.newValue, ...(change.reason === undefined ? {} : { reason: change.reason }) })),
    evidence: [...value.evidence], completionConfidence: { score: value.completionConfidence.score, label: value.completionConfidence.label } };
};
const sourceBindingFor = (record: AcquisitionRecord): SourceAcquisitionBinding => ({
  acquisitionId: record.acquisitionId, callId: record.callId!, requestId: record.normalizedResult!.requestId,
  receivedAt: record.normalizedResult!.receivedAt, terminalAt: record.terminalAt!, caseId: record.normalizedResult!.caseId,
  planId: record.normalizedResult!.planId, actorId: record.normalizedResult!.actorId, actorRole: record.normalizedResult!.actorRole,
  normalizedDecisionFingerprint: hash(normalizedProjection(record)),
});
export const sourceBindingsEqual = (left: SourceAcquisitionBinding, right: SourceAcquisitionBinding) =>
  left.acquisitionId === right.acquisitionId
  && left.callId === right.callId
  && left.requestId === right.requestId
  && left.receivedAt === right.receivedAt
  && left.terminalAt === right.terminalAt
  && left.caseId === right.caseId
  && left.planId === right.planId
  && left.actorId === right.actorId
  && left.actorRole === right.actorRole
  && left.normalizedDecisionFingerprint === right.normalizedDecisionFingerprint;
const contextBindingIsCurrent = (session: LiveControlSession) => session.contextFingerprint === operatorSandboxContextFingerprint()
  && session.definitionId === OPERATOR_SANDBOX_DEFINITION.definitionId
  && session.definitionVersion === OPERATOR_SANDBOX_DEFINITION.definitionVersion;
const expected = () => ({ operationType: 'PLAN_DECISION' as const, caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, actorRole: 'client' as const });
const context = () => { const state = createOperatorControlledState(); return { state, bridgeContext: { exceptionCase: state.exceptionCase, plans: state.plans } }; };
const canonicalRequestDefinitionFingerprint = () => acquisitionRequestDefinitionFingerprint({ caseId: OPERATOR_SANDBOX_FACTS.caseId,
  planId: OPERATOR_SANDBOX_FACTS.planId, actorId: OPERATOR_SANDBOX_FACTS.clientActorId,
  actorRole: OPERATOR_SANDBOX_DEFINITION.actorRole, objective: OPERATOR_SANDBOX_OBJECTIVE, context: operatorSandboxContext(), expectedDecisionSchema: OPERATOR_SANDBOX_DEFINITION.expectedDecisionSchema });
const bridgeFor = (record: AcquisitionRecord): DecisionBridgeResult => prepareDecisionProposal({ success: true, value: record.normalizedResult! }, context().bridgeContext, expected());
const eligibilityFailure = (record: AcquisitionRecord): LiveControlResult | undefined => {
  if (record.status !== 'completed' || record.normalizationStatus !== 'USABLE' || record.handoffState !== 'READY_FOR_REVIEW' || record.normalizedResult === null || record.callId === null || record.terminalAt === null) return { accepted: false, code: 'NOT_ELIGIBLE', reason: 'Acquisition is not ready for exact review' };
  const identity = record.decisionContext;
  if (identity.caseId !== OPERATOR_SANDBOX_FACTS.caseId || identity.planId !== OPERATOR_SANDBOX_FACTS.planId || identity.actorId !== OPERATOR_SANDBOX_FACTS.clientActorId || identity.actorRole !== 'client') return { accepted: false, code: 'BINDING_INVALID', reason: 'Acquisition context does not match the controlled definition' };
  if (record.requestDefinitionFingerprint !== canonicalRequestDefinitionFingerprint()) return { accepted: false, code: 'BINDING_INVALID', reason: 'Acquisition request does not match the controlled definition' };
  if (record.normalizedResult.authorizationChanges.length > 0) return { accepted: false, code: 'BRIDGE_REJECTED', reason: 'Authorization changes require a separately reviewed workflow' };
  return undefined;
};
const counts = (state: OrchestrationState) => ({ decisions: state.approvals.length, operations: state.operationHistory.length, events: state.events.length });
const receiptFor = (before: OrchestrationState, result: OrchestrationResult): LiveControlReceipt => {
  const after = result.state; const prior = counts(before); const current = counts(after);
  if (!result.accepted) {
    const reason = result.failure.reason; const disposition = reason === 'PLAN_PHYSICALLY_INFEASIBLE' ? 'BLOCK' : reason === 'PHYSICAL_FEASIBILITY_UNPROVEN' ? 'WAIT' : 'TECHNICAL_STOP';
    return { disposition, reason, planStatus: before.plans.find(({ id }) => id === OPERATOR_SANDBOX_FACTS.planId)?.status ?? 'UNKNOWN', before: prior, effects: { decisions: 0, operations: 0, events: 0 } };
  }
  const resolution = result.step.actionType === 'APPLY_REVIEWED_DECISION' ? result.step.applicationResolutionStatus : 'PENDING_APPROVALS';
  const disposition = resolution === 'PLAN_APPROVED' ? 'ALLOW' : resolution === 'PLAN_REJECTED' ? 'PLAN_REJECTED' : 'WAIT';
  return { disposition, reason: resolution, planStatus: after.plans.find(({ id }) => id === OPERATOR_SANDBOX_FACTS.planId)?.status ?? 'UNKNOWN', before: prior,
    effects: { decisions: current.decisions - prior.decisions, operations: current.operations - prior.operations, events: current.events - prior.events },
    ...(result.accepted && result.disposition.type === 'LINEAGE_RESOLVED' ? { resolutionScope: result.disposition.scope } : {}) };
};

export class LiveControlService {
  readonly #acquisitions: AcquisitionService; readonly #store: LiveControlStore; readonly #clock: Clock;
  readonly #handoffs = new Map<string, Promise<LiveControlResult>>(); readonly #reviews = new Map<string, Promise<LiveControlResult>>();
  constructor(options: Readonly<{ acquisitions: AcquisitionService; store: LiveControlStore; clock?: Clock }>) { this.#acquisitions = options.acquisitions; this.#store = options.store; this.#clock = options.clock ?? (() => new Date().toISOString()); }
  async create(acquisitionId: string, token: string): Promise<LiveControlResult> {
    const pending = this.#handoffs.get(acquisitionId); if (pending) return pending;
    const operation = this.#create(acquisitionId, token).finally(() => this.#handoffs.delete(acquisitionId)); this.#handoffs.set(acquisitionId, operation); return operation;
  }
  async #create(acquisitionId: string, token: string): Promise<LiveControlResult> {
    const record = await this.#acquisitions.get(acquisitionId, token); if (!record) return { accepted: false, code: 'NOT_FOUND', reason: 'Control session not found' };
    const failure = eligibilityFailure(record); if (failure) return failure;
    const binding = sourceBindingFor(record); const id = `CONTROL-${acquisitionId}`; const existing = await this.#store.get(id);
    if (existing) {
      if (!sourceBindingsEqual(existing.sourceBinding, binding)) return { accepted: false, code: 'BINDING_INVALID', reason: 'Source acquisition binding changed' };
      return contextBindingIsCurrent(existing) ? { accepted: true, record: toPublicLiveControlRecord(existing), existing: true } : { accepted: false, code: 'CONTEXT_STALE', reason: 'Controlled context definition changed' };
    }
    const bridge = bridgeFor(record); if (!bridge.ready) return { accepted: false, code: 'BRIDGE_REJECTED', reason: bridge.reason };
    const session: LiveControlSession = { controlSessionId: id, acquisitionId, definitionId: OPERATOR_SANDBOX_DEFINITION.definitionId, definitionVersion: OPERATOR_SANDBOX_DEFINITION.definitionVersion,
      contextFingerprint: operatorSandboxContextFingerprint(), sourceBinding: binding, provenance: { acquisition: 'LIVE_CALLE', operationalContext: 'CONTROLLED_SANDBOX_CONTEXT', externalExecution: 'NONE' }, status: 'AWAITING_REVIEW', reviewTarget: bridge.reviewTarget,
      caseId: OPERATOR_SANDBOX_FACTS.caseId, planId: OPERATOR_SANDBOX_FACTS.planId, planVersion: 1, actorId: OPERATOR_SANDBOX_FACTS.clientActorId, actorRole: 'client', createdAt: this.#clock() };
    await this.#store.put(session); return { accepted: true, record: toPublicLiveControlRecord(session), existing: false };
  }
  async get(id: string, token: string): Promise<LiveControlResult> {
    const session = await this.#loadAuthorized(id, token);
    return session === undefined ? { accepted: false, code: 'NOT_FOUND', reason: 'Control session not found' } : { accepted: true, record: toPublicLiveControlRecord(session), existing: true };
  }
  async #loadAuthorized(id: string, token: string): Promise<LiveControlSession | undefined> {
    const session = await this.#store.get(id); if (!session) return undefined;
    const source = await this.#acquisitions.get(session.acquisitionId, token); if (!source || source.normalizedResult === null || !sourceBindingsEqual(session.sourceBinding, sourceBindingFor(source))) return undefined;
    return session;
  }
  async review(id: string, token: string, action: unknown): Promise<LiveControlResult> {
    if (action !== 'APPLY' && action !== 'DISCARD') return { accepted: false, code: 'REVIEW_CONFLICT', reason: 'Review action must be APPLY or DISCARD' };
    const pending = this.#reviews.get(id); if (pending) { const result = await pending; return result.accepted && result.record.review?.action === action ? result : { accepted: false, code: 'REVIEW_CONFLICT', reason: 'Control session review intent conflicts' }; }
    const operation = this.#review(id, token, action).finally(() => this.#reviews.delete(id)); this.#reviews.set(id, operation); return operation;
  }
  async #review(id: string, token: string, action: 'APPLY' | 'DISCARD'): Promise<LiveControlResult> {
    const session = await this.#loadAuthorized(id, token); if (session === undefined) return { accepted: false, code: 'NOT_FOUND', reason: 'Control session not found' };
    if (session.status === 'TERMINAL') return session.review?.action === action ? { accepted: true, record: toPublicLiveControlRecord(session), existing: true } : { accepted: false, code: 'REVIEW_CONFLICT', reason: 'Control session was already reviewed with another action' };
    if (session.status === 'REVIEWING' && session.review?.action !== action) return session.review === undefined
      ? { accepted: false, code: 'REVIEW_INCOMPLETE', reason: 'The owned review intent has no recoverable metadata' }
      : { accepted: false, code: 'REVIEW_CONFLICT', reason: 'Control session has a different owned review intent' };
    if (!contextBindingIsCurrent(session)) return { accepted: false, code: 'CONTEXT_STALE', reason: 'Controlled context definition changed' };
    const source = await this.#acquisitions.get(session.acquisitionId, token); if (!source || source.normalizedResult === null || !sourceBindingsEqual(session.sourceBinding, sourceBindingFor(source))) return { accepted: false, code: 'NOT_FOUND', reason: 'Control session not found' };
    const bridge = bridgeFor(source); if (!bridge.ready || !reviewTargetsEqual(bridge.reviewTarget, session.reviewTarget as ReviewTarget)) return { accepted: false, code: 'BINDING_INVALID', reason: 'Exact review target no longer matches its source' };
    const metadata: LiveControlReviewMetadata = session.status === 'REVIEWING' ? session.review! : { action, operationId: `OPERATION-${id}`, eventId: `EVENT-${id}`, approvalId: `APPROVAL-${id}`, reviewedAt: this.#clock(), reviewer: 'LOCAL-SANDBOX-OPERATOR-NOT-AUTHENTICATED' };
    const claimed: LiveControlSession = session.status === 'REVIEWING' ? session : { ...session, status: 'REVIEWING', review: metadata }; if (session.status !== 'REVIEWING') await this.#store.put(claimed);
    const resolved = context();
    if (action === 'DISCARD') { const terminal: LiveControlSession = { ...claimed, status: 'TERMINAL', receipt: { disposition: 'DISCARDED', reason: 'DISCARDED_BY_REVIEWER', planStatus: resolved.state.plans[0]?.status ?? 'UNKNOWN', before: counts(resolved.state), effects: { decisions: 0, operations: 0, events: 0 } } }; await this.#store.put(terminal); return { accepted: true, record: toPublicLiveControlRecord(terminal), existing: true }; }
    const command = bindReviewCommand({ action: 'APPLY', operationId: metadata.operationId, eventId: metadata.eventId, approvalId: metadata.approvalId, reviewedBy: metadata.reviewer, reviewedAt: metadata.reviewedAt, authorizationReviews: [] }, bridge.reviewTarget);
    const applied = executeOrchestrationAction(resolved.state, { type: 'APPLY_REVIEWED_DECISION', bridgeResult: bridge, review: command });
    const terminal: LiveControlSession = { ...claimed, status: 'TERMINAL', receipt: receiptFor(resolved.state, applied) }; await this.#store.put(terminal); return { accepted: true, record: toPublicLiveControlRecord(terminal), existing: true };
  }
}

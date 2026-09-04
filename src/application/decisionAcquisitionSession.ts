import { executeOrchestrationAction, type OrchestrationAction, type OrchestrationState } from './adaptiveOrchestrator.js';
import { executeCall } from '../integrations/calle/adapter.js';
import { createCallRequest } from '../integrations/calle/contract.js';
import { prepareDecisionProposal, type DecisionBridgeResult } from '../integrations/calle/decisionBridge.js';
import { bindReviewCommand, type UnboundReviewCommand } from '../integrations/calle/decisionApplication.js';
import { ProviderOperationalError, type CallProvider, type ProviderOperationalErrorKind } from '../integrations/calle/provider.js';
import type { CallMappingResult, CallRequest } from '../integrations/calle/types.js';

const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export type AcquisitionResult =
  | Readonly<{ status: 'REVIEWABLE'; bridge: Extract<DecisionBridgeResult, { ready: true }> }>
  | Readonly<{ status: 'STOPPED'; stage: 'MAPPING'; mapping: Extract<CallMappingResult, { success: false }> }>
  | Readonly<{ status: 'STOPPED'; stage: 'PROVIDER'; kind: ProviderOperationalErrorKind; mapping: Extract<CallMappingResult, { success: false }> }>
  | Readonly<{ status: 'STOPPED'; stage: 'BRIDGE'; bridge: Extract<DecisionBridgeResult, { ready: false }> }>
  | Readonly<{ status: 'STOPPED'; stage: 'CLARIFICATION'; bridge: Extract<DecisionBridgeResult, { ready: true }> }>
  | Readonly<{ status: 'NOT_AVAILABLE'; reason: 'ACQUISITION_ALREADY_ATTEMPTED' }>;

/** One owned, in-memory plan-decision session. No shell I/O, credentials, retries or scenario policy. */
export class DecisionAcquisitionSession {
  readonly #request: CallRequest;
  readonly #receivedAt: string;
  #state: OrchestrationState;
  #phase: 'READY' | 'ACQUIRING' | 'STOPPED' | 'AWAITING_REVIEW' | 'TERMINAL' = 'READY';
  #bridge: Extract<DecisionBridgeResult, { ready: true }> | undefined;

  constructor(state: OrchestrationState, request: CallRequest, receivedAt: string) {
    this.#request = freeze(createCallRequest(request));
    if (this.request.planId === undefined) throw new Error('A plan-bound request is required');
    this.#state = freeze(structuredClone(state));
    this.#receivedAt = receivedAt;
  }

  get state(): OrchestrationState { return this.#state; }
  get request(): CallRequest { return this.#request; }
  get phase() { return this.#phase; }

  async acquire(provider: CallProvider): Promise<AcquisitionResult> {
    if (this.#phase !== 'READY') return { status: 'NOT_AVAILABLE', reason: 'ACQUISITION_ALREADY_ATTEMPTED' };
    // Consume the attempt synchronously, including failures and concurrent callers.
    this.#phase = 'ACQUIRING';
    try {
      let operationalKind: ProviderOperationalErrorKind | undefined;
      const mapped = await executeCall({ executeCall: async (request) => {
        try { return await provider.executeCall(request); }
        catch (error) {
          if (error instanceof ProviderOperationalError) operationalKind = error.kind;
          throw error; // executeCall remains responsible for the existing failure mapping.
        }
      } }, this.request, this.#receivedAt);
      if (!mapped.success) {
        this.#phase = 'STOPPED';
        if (operationalKind !== undefined) return freeze({ status: 'STOPPED', stage: 'PROVIDER', kind: operationalKind, mapping: mapped });
        return freeze({ status: 'STOPPED', stage: 'MAPPING', mapping: mapped });
      }
      const bridge = prepareDecisionProposal(mapped, this.#state, {
        operationType: 'PLAN_DECISION', caseId: this.request.caseId, planId: this.request.planId!,
        actorId: this.request.actorId, actorRole: this.request.actorRole,
      });
      if (!bridge.ready) {
        this.#phase = 'STOPPED';
        return freeze({ status: 'STOPPED', stage: 'BRIDGE', bridge });
      }
      this.#bridge = freeze(bridge);
      if (bridge.proposal.decision === 'NEEDS_CLARIFICATION') {
        this.#phase = 'STOPPED';
        return freeze({ status: 'STOPPED', stage: 'CLARIFICATION', bridge });
      }
      this.#phase = 'AWAITING_REVIEW';
      return freeze({ status: 'REVIEWABLE', bridge });
    } catch (error) {
      this.#phase = 'STOPPED';
      throw error;
    }
  }

  /** Explicit external plan actions may advance currentness; never done automatically. */
  executePlanAction(action: Exclude<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }>) {
    const result = executeOrchestrationAction(this.#state, action);
    this.#state = freeze(result.state);
    return result;
  }

  review(command: UnboundReviewCommand) {
    if (this.#phase !== 'AWAITING_REVIEW' || this.#bridge === undefined) {
      return { status: 'NOT_AVAILABLE', reason: 'REVIEW_NOT_AVAILABLE' } as const;
    }
    this.#phase = 'TERMINAL';
    const before = this.#state;
    const result = executeOrchestrationAction(before, {
      type: 'APPLY_REVIEWED_DECISION', bridgeResult: this.#bridge,
      review: bindReviewCommand(command, this.#bridge.reviewTarget),
    });
    this.#state = freeze(result.state);
    return { status: 'REVIEWED', before, result } as const;
  }
}

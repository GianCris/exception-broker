import { executeOrchestrationAction, type OrchestrationState } from '../application/adaptiveOrchestrator.js';
import { exceptionCaseSchema, planSchema } from '../domain/schemas.js';
import { createCallRequest, PHONE_DECISION_SCHEMA } from '../integrations/calle/contract.js';
import { createReadyDecisionBridgeResult } from '../integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../integrations/calle/decisionApplication.js';
import { MockProvider } from '../integrations/calle/mockProvider.js';

export type OperatorSandboxFacts = Readonly<{
  caseId: string; planId: string; clientActorId: string;
  requestedQuantity: number; targetDeliveryDate: string;
  originalQuantity: number; substituteQuantity: number;
  substituteAuthorizationLimit: number; clientAdditionalCost: number;
  clientCostLimit: number; supplierAbsorbedCost: number;
  laterDeliveryDate: string;
}>;

export const OPERATOR_SANDBOX_FACTS: OperatorSandboxFacts = Object.freeze({
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', clientActorId: 'ACTOR-OPERATOR-CLIENT',
  requestedQuantity: 500, targetDeliveryDate: '2027-07-01T17:00:00-05:00',
  originalQuantity: 350, substituteQuantity: 150, substituteAuthorizationLimit: 180,
  clientAdditionalCost: 0, clientCostLimit: 100, supplierAbsorbedCost: 75,
  laterDeliveryDate: '2027-07-02T17:00:00-05:00',
});

export const renderOperatorFacts = (facts: OperatorSandboxFacts) =>
  `${facts.requestedQuantity} units due ${facts.targetDeliveryDate}; proposal ${facts.originalQuantity} original and ${facts.substituteQuantity} substitute units; substitute limit ${facts.substituteAuthorizationLimit}; Client cost ${facts.clientAdditionalCost} with limit ${facts.clientCostLimit}; Supplier absorbs ${facts.supplierAbsorbedCost}`;

const requestFor = (facts: OperatorSandboxFacts) => createCallRequest({
  requestId: 'REQUEST-OPERATOR-SANDBOX-CLIENT-V1', caseId: facts.caseId, planId: facts.planId, actorId: facts.clientActorId, actorRole: 'client',
  phoneNumber: '+15555550123', // Inert mock destination; this shell has no live composition.
  objective: 'Obtain one synthetic Client decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION. No authorization change is requested.',
  context: `Synthetic sandbox only: ${renderOperatorFacts(facts)}. No real customer authority or external execution.`,
  expectedDecisionSchema: PHONE_DECISION_SCHEMA, createdAt: '2027-07-01T16:50:00-05:00',
});
const requestV1 = requestFor(OPERATOR_SANDBOX_FACTS);

/** V1 supports only this frozen logical request. Changes require a reviewed new definition/key.
 * Exact retries of identical content retain the key; sessions expose no retry command.
 * This is not a persistent or cross-process request registry.
 */
export const createOperatorRequest = (input: unknown = requestV1, facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS) => {
  const parsed = createCallRequest(input);
  if (JSON.stringify(parsed) !== JSON.stringify(requestFor(facts))) {
    throw new Error('Unsupported request content: define an explicitly reviewed request version and key');
  }
  return Object.freeze({ ...parsed, expectedDecisionSchema: Object.freeze({ ...parsed.expectedDecisionSchema }) });
};

export const createOperatorScenario = (facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS) => {
  const authorization = { maxAbsorbableAdditionalCost: facts.clientCostLimit, maxSubstituteQuantity: facts.requestedQuantity, latestAcceptedDeliveryDate: facts.laterDeliveryDate };
  const minimum = { type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: facts.requestedQuantity, deliveryDate: facts.targetDeliveryDate, allowsOriginalAndSubstituteMix: true };
  const exceptionCase = exceptionCaseSchema.parse({ id: facts.caseId, status: 'CASE_CREATED', requestedQuantity: facts.requestedQuantity, targetDeliveryDate: facts.targetDeliveryDate,
    actors: [
      { id: 'ACTOR-OPERATOR-SUPPLIER', role: 'supplier', authorization, constraints: [{ type: 'SUPPLY', originalQuantity: facts.originalQuantity, substituteQuantity: facts.substituteQuantity, deliveryDate: facts.targetDeliveryDate, substituteUnitAdditionalCost: 0.5 }] },
      { id: 'ACTOR-OPERATOR-PRODUCTION', role: 'production', authorization, constraints: [minimum] },
      { id: facts.clientActorId, role: 'client', authorization: { ...authorization, maxSubstituteQuantity: facts.substituteAuthorizationLimit }, constraints: [minimum] },
    ],
  });
  const plan = planSchema.parse({ id: facts.planId, caseId: facts.caseId, status: 'PENDING_APPROVAL', version: 1,
    originalQuantityTomorrow: facts.originalQuantity, substituteQuantityTomorrow: facts.substituteQuantity, originalQuantityLater: 0,
    laterDeliveryDate: facts.laterDeliveryDate, clientAdditionalCost: facts.clientAdditionalCost, supplierAbsorbedCost: facts.supplierAbsorbedCost, productionAbsorbedCost: 0 });
  const registered = executeOrchestrationAction({ exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [] }, {
    type: 'REGISTER_PLAN_PROPOSAL', lineageId: 'LINEAGE-OPERATOR-SANDBOX', plan,
  });
  if (!registered.accepted) throw new Error(registered.failure.reason);
  let state: OrchestrationState = registered.state;
  for (const role of ['supplier', 'production'] as const) {
    const actor = exceptionCase.actors.find((candidate) => candidate.role === role)!;
    const bridge = createReadyDecisionBridgeResult({ operationType: 'PLAN_DECISION', caseId: facts.caseId, planId: facts.planId, actorId: actor.id, actorRole: role,
      requestId: `REQUEST-OPERATOR-SETUP-${role}`, decision: 'APPROVED', summary: `Synthetic ${role} setup approval`,
      proposedAuthorizationChanges: [], evidence: ['Synthetic pre-recorded sandbox setup, not acquired from CALL-E'],
      completionConfidence: { score: 1, label: 'synthetic' }, receivedAt: '2027-07-01T16:40:00-05:00',
      requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' });
    const applied = executeOrchestrationAction(state, { type: 'APPLY_REVIEWED_DECISION', bridgeResult: bridge,
      review: bindReviewCommand({ action: 'APPLY', operationId: `OPERATOR-SETUP-${role}`, eventId: `OPERATOR-EVENT-${role}`,
        approvalId: `OPERATOR-APPROVAL-${role}`, reviewedBy: 'SYNTHETIC-SETUP-REVIEWER', reviewedAt: '2027-07-01T16:41:00-05:00', authorizationReviews: [] }, bridge.reviewTarget) });
    if (!applied.accepted) throw new Error(applied.failure.reason);
    state = applied.state;
  }
  const request = createOperatorRequest(requestFor(facts), facts);
  const response = { status: 'completed', taskCompleted: true,
    structuredResult: { decision: 'APPROVED', caseId: facts.caseId, planId: facts.planId, actorId: facts.clientActorId, actorRole: 'client',
      summary: `Approve ${facts.originalQuantity} original and ${facts.substituteQuantity} substitute units under the stated synthetic conditions.`,
      authorizationChanges: [], clarificationNeeded: false },
    completionConfidence: { score: 1, label: 'deterministic mock; not authority' }, evidence: ['Explicit synthetic Client decision; no phone call occurred.'] };
  return { state, request, response, provider: new MockProvider({ type: 'response', payload: response }),
    receivedAt: '2027-07-01T16:58:00-05:00',
    reviewMetadata: { operationId: 'OPERATOR-CLIENT-OPERATION', eventId: 'OPERATOR-CLIENT-EVENT', approvalId: 'OPERATOR-CLIENT-APPROVAL',
      reviewedBy: 'LOCAL-SANDBOX-OPERATOR', reviewedAt: '2027-07-01T16:59:00-05:00' } };
};

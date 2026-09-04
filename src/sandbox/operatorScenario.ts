import { executeOrchestrationAction, type OrchestrationState } from '../application/adaptiveOrchestrator.js';
import { exceptionCaseSchema, planSchema } from '../domain/schemas.js';
import { createCallRequest, PHONE_DECISION_SCHEMA } from '../integrations/calle/contract.js';
import { createReadyDecisionBridgeResult } from '../integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../integrations/calle/decisionApplication.js';
import { MockProvider } from '../integrations/calle/mockProvider.js';

const targetAt = '2027-07-01T17:00:00-05:00';
const laterAt = '2027-07-02T17:00:00-05:00';
const caseId = 'CASE-OPERATOR-SANDBOX';
const planId = 'PLAN-OPERATOR-SANDBOX';
const actorId = 'ACTOR-OPERATOR-CLIENT';
const requestV1 = createCallRequest({
  requestId: 'REQUEST-OPERATOR-SANDBOX-CLIENT-V1', caseId, planId, actorId, actorRole: 'client',
  phoneNumber: '+15555550123', // Inert mock destination; this shell has no live composition.
  objective: 'Obtain one synthetic Client decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION. No authorization change is requested.',
  context: `Synthetic sandbox only: 500 units due ${targetAt}; proposal 350 original and 150 substitute; substitute limit 180; Client additional cost 0, limit 100; Supplier absorbs 75. No real customer authority or external execution.`,
  expectedDecisionSchema: PHONE_DECISION_SCHEMA, createdAt: '2027-07-01T16:50:00-05:00',
});

/** V1 supports only this frozen logical request. Changes require a reviewed new definition/key.
 * Exact retries of identical content retain the key; sessions expose no retry command.
 * This is not a persistent or cross-process request registry.
 */
export const createOperatorRequest = (input: unknown = requestV1) => {
  const parsed = createCallRequest(input);
  if (JSON.stringify(parsed) !== JSON.stringify(requestV1)) {
    throw new Error('Unsupported request content: define an explicitly reviewed request version and key');
  }
  return Object.freeze({ ...parsed, expectedDecisionSchema: Object.freeze({ ...parsed.expectedDecisionSchema }) });
};

export const createOperatorScenario = () => {
  const authorization = { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 500, latestAcceptedDeliveryDate: laterAt };
  const minimum = { type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 500, deliveryDate: targetAt, allowsOriginalAndSubstituteMix: true };
  const exceptionCase = exceptionCaseSchema.parse({ id: caseId, status: 'CASE_CREATED', requestedQuantity: 500, targetDeliveryDate: targetAt,
    actors: [
      { id: 'ACTOR-OPERATOR-SUPPLIER', role: 'supplier', authorization, constraints: [{ type: 'SUPPLY', originalQuantity: 350, substituteQuantity: 150, deliveryDate: targetAt, substituteUnitAdditionalCost: 0.5 }] },
      { id: 'ACTOR-OPERATOR-PRODUCTION', role: 'production', authorization, constraints: [minimum] },
      { id: actorId, role: 'client', authorization: { ...authorization, maxSubstituteQuantity: 180 }, constraints: [minimum] },
    ],
  });
  const plan = planSchema.parse({ id: planId, caseId, status: 'PENDING_APPROVAL', version: 1,
    originalQuantityTomorrow: 350, substituteQuantityTomorrow: 150, originalQuantityLater: 0,
    laterDeliveryDate: laterAt, clientAdditionalCost: 0, supplierAbsorbedCost: 75, productionAbsorbedCost: 0 });
  const registered = executeOrchestrationAction({ exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [] }, {
    type: 'REGISTER_PLAN_PROPOSAL', lineageId: 'LINEAGE-OPERATOR-SANDBOX', plan,
  });
  if (!registered.accepted) throw new Error(registered.failure.reason);
  let state: OrchestrationState = registered.state;
  for (const role of ['supplier', 'production'] as const) {
    const actor = exceptionCase.actors.find((candidate) => candidate.role === role)!;
    const bridge = createReadyDecisionBridgeResult({ operationType: 'PLAN_DECISION', caseId, planId, actorId: actor.id, actorRole: role,
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
  const request = createOperatorRequest();
  const response = { status: 'completed', taskCompleted: true,
    structuredResult: { decision: 'APPROVED', caseId, planId, actorId, actorRole: 'client',
      summary: 'Approve 350 original and 150 substitute units under the stated synthetic conditions.',
      authorizationChanges: [], clarificationNeeded: false },
    completionConfidence: { score: 1, label: 'deterministic mock; not authority' }, evidence: ['Explicit synthetic Client decision; no phone call occurred.'] };
  return { state, request, response, provider: new MockProvider({ type: 'response', payload: response }),
    receivedAt: '2027-07-01T16:58:00-05:00',
    reviewMetadata: { operationId: 'OPERATOR-CLIENT-OPERATION', eventId: 'OPERATOR-CLIENT-EVENT', approvalId: 'OPERATOR-CLIENT-APPROVAL',
      reviewedBy: 'LOCAL-SANDBOX-OPERATOR', reviewedAt: '2027-07-01T16:59:00-05:00' } };
};

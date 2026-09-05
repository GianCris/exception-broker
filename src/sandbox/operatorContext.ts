import { executeOrchestrationAction, type OrchestrationState } from '../application/adaptiveOrchestrator.js';
import { exceptionCaseSchema, planSchema } from '../domain/schemas.js';
import { createReadyDecisionBridgeResult } from '../integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../integrations/calle/decisionApplication.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, type OperatorSandboxFacts } from './operatorDefinition.js';

/** Deterministic, versioned controlled context. It performs no acquisition/provider work. */
export const createOperatorControlledState = (facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS): OrchestrationState => {
  const authorization = { maxAbsorbableAdditionalCost: facts.clientCostLimit, maxSubstituteQuantity: facts.requestedQuantity, latestAcceptedDeliveryDate: facts.laterDeliveryDate };
  const minimum = { type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: facts.requestedQuantity, deliveryDate: facts.targetDeliveryDate, allowsOriginalAndSubstituteMix: true };
  const exceptionCase = exceptionCaseSchema.parse({ id: facts.caseId, status: 'CASE_CREATED', requestedQuantity: facts.requestedQuantity, targetDeliveryDate: facts.targetDeliveryDate,
    actors: [
      { id: OPERATOR_SANDBOX_DEFINITION.supplierActorId, role: 'supplier', authorization, constraints: [{ type: 'SUPPLY', originalQuantity: facts.originalQuantity, substituteQuantity: facts.substituteQuantity, deliveryDate: facts.targetDeliveryDate, substituteUnitAdditionalCost: 0.5 }] },
      { id: OPERATOR_SANDBOX_DEFINITION.productionActorId, role: 'production', authorization, constraints: [minimum] },
      { id: facts.clientActorId, role: 'client', authorization: { ...authorization, maxSubstituteQuantity: facts.substituteAuthorizationLimit }, constraints: [minimum] },
    ],
  });
  const plan = planSchema.parse({ id: facts.planId, caseId: facts.caseId, status: 'PENDING_APPROVAL', version: 1,
    originalQuantityTomorrow: facts.originalQuantity, substituteQuantityTomorrow: facts.substituteQuantity, originalQuantityLater: 0,
    laterDeliveryDate: facts.laterDeliveryDate, clientAdditionalCost: facts.clientAdditionalCost, supplierAbsorbedCost: facts.supplierAbsorbedCost, productionAbsorbedCost: 0 });
  const registered = executeOrchestrationAction({ exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [] }, { type: 'REGISTER_PLAN_PROPOSAL', lineageId: OPERATOR_SANDBOX_DEFINITION.lineageId, plan });
  if (!registered.accepted) throw new Error(registered.failure.reason);
  let state: OrchestrationState = registered.state;
  for (const role of ['supplier', 'production'] as const) {
    const actor = exceptionCase.actors.find((candidate) => candidate.role === role)!;
    const bridge = createReadyDecisionBridgeResult({ operationType: 'PLAN_DECISION', caseId: facts.caseId, planId: facts.planId, actorId: actor.id, actorRole: role,
      requestId: `REQUEST-OPERATOR-SETUP-${role}`, decision: 'APPROVED', summary: `Synthetic ${role} setup approval`, proposedAuthorizationChanges: [], evidence: ['Synthetic pre-recorded sandbox setup, not acquired from CALL-E'], completionConfidence: { score: 1, label: 'synthetic' }, receivedAt: '2027-07-01T16:40:00-05:00', requiresReview: true, reviewState: 'DECISION_REVIEW_REQUIRED' });
    const applied = executeOrchestrationAction(state, { type: 'APPLY_REVIEWED_DECISION', bridgeResult: bridge, review: bindReviewCommand({ action: 'APPLY', operationId: `OPERATOR-SETUP-${role}`, eventId: `OPERATOR-EVENT-${role}`, approvalId: `OPERATOR-APPROVAL-${role}`, reviewedBy: 'SYNTHETIC-SETUP-REVIEWER', reviewedAt: '2027-07-01T16:41:00-05:00', authorizationReviews: [] }, bridge.reviewTarget) });
    if (!applied.accepted) throw new Error(applied.failure.reason);
    state = applied.state;
  }
  return state;
};

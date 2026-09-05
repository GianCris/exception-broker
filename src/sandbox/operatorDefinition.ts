export type OperatorSandboxFacts = Readonly<{
  caseId: string; planId: string; clientActorId: string;
  requestedQuantity: number; targetDeliveryDate: string;
  originalQuantity: number; substituteQuantity: number;
  substituteAuthorizationLimit: number; clientAdditionalCost: number;
  clientCostLimit: number; supplierAbsorbedCost: number;
  laterDeliveryDate: string;
}>;

export const OPERATOR_SANDBOX_DEFINITION = Object.freeze({
  definitionId: 'OPERATOR_SANDBOX', definitionVersion: 1,
  lineageId: 'LINEAGE-OPERATOR-SANDBOX', supplierActorId: 'ACTOR-OPERATOR-SUPPLIER',
  productionActorId: 'ACTOR-OPERATOR-PRODUCTION', actorRole: 'client' as const,
  expectedDecisionSchema: Object.freeze({ name: 'exception-broker-phone-decision' as const, version: 1 as const }),
});

export const OPERATOR_SANDBOX_FACTS: OperatorSandboxFacts = Object.freeze({
  caseId: 'CASE-OPERATOR-SANDBOX', planId: 'PLAN-OPERATOR-SANDBOX', clientActorId: 'ACTOR-OPERATOR-CLIENT',
  requestedQuantity: 500, targetDeliveryDate: '2027-07-01T17:00:00-05:00',
  originalQuantity: 350, substituteQuantity: 150, substituteAuthorizationLimit: 180,
  clientAdditionalCost: 0, clientCostLimit: 100, supplierAbsorbedCost: 75,
  laterDeliveryDate: '2027-07-02T17:00:00-05:00',
});

export const renderOperatorFacts = (facts: OperatorSandboxFacts) =>
  `${facts.requestedQuantity} units due ${facts.targetDeliveryDate}; proposal ${facts.originalQuantity} original and ${facts.substituteQuantity} substitute units; substitute limit ${facts.substituteAuthorizationLimit}; Client cost ${facts.clientAdditionalCost} with limit ${facts.clientCostLimit}; Supplier absorbs ${facts.supplierAbsorbedCost}`;

/** Synthetic Client policy for acquisition only; downstream execution controls remain independent. */
export const renderClientDecisionPolicy = (facts: OperatorSandboxFacts) => [
  `Required Client conditions: deliver ${facts.requestedQuantity} total units by ${facts.targetDeliveryDate};`,
  `use no more than ${facts.substituteAuthorizationLimit} substitute units;`,
  `and charge the Client no more than ${facts.clientCostLimit} additional cost.`,
  `Proposal facts: ${facts.originalQuantity} original units, ${facts.substituteQuantity} substitute units, and ${facts.clientAdditionalCost} Client additional cost.`,
  `Supplier absorbed cost ${facts.supplierAbsorbedCost} is proposal context, not a Client hard condition.`,
  'Return APPROVED only when every required Client condition is satisfied.',
  'Return REJECTED when any stated hard Client condition is violated.',
  'Return NEEDS_CLARIFICATION only when information necessary to evaluate those conditions is missing or ambiguous.',
  'Evaluate neutrally; no outcome is preferred. Give a brief reason and exactly one decision.',
].join(' ');

export const OPERATOR_SANDBOX_OBJECTIVE = 'Obtain one synthetic Client decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION. No authorization change is requested.';
export const operatorSandboxContext = (facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS) =>
  `Synthetic sandbox test only; no real customer authority or external effect. ${renderClientDecisionPolicy(facts)}`;

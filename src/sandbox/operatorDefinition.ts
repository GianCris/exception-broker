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
  'Follow this sequence before accepting a final decision.',
  'First, identify that the purpose is a controlled decision on the stated recovery proposal.',
  `Then present the exact proposal: ${facts.originalQuantity} original units, ${facts.substituteQuantity} substitute units, ${facts.clientAdditionalCost} additional Client cost, ${facts.requestedQuantity} total units, delivered by ${facts.targetDeliveryDate}.`,
  `Then present the hard Client conditions: no more than ${facts.substituteAuthorizationLimit} substitute units, no more than ${facts.clientCostLimit} additional Client cost, and ${facts.requestedQuantity} total units delivered by ${facts.targetDeliveryDate}.`,
  `Supplier absorbed cost ${facts.supplierAbsorbedCost} is proposal context, not a Client hard condition.`,
  'Only after presenting the proposal and conditions, ask for exactly one decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION.',
  'If the recipient gives a decision before hearing those terms, present only the missing terms and ask once again for the decision on that exact proposal.',
  'Return APPROVED only when every required Client condition is satisfied.',
  'Return REJECTED when any stated hard Client condition is violated.',
  'Return NEEDS_CLARIFICATION only when information necessary to evaluate those conditions is missing or ambiguous.',
  'After that explicit answer, accept APPROVED, REJECTED, or NEEDS_CLARIFICATION as final. Never try to convert one outcome into another.',
  'Evaluate neutrally; no outcome is preferred and you must not persuade or pressure the recipient.',
  'If no reason was given, ask at most once for a brief reason. If a reason was already given, do not ask again. Do not infer or request an authorization change.',
  'Then finish promptly. Do not repeat the proposal to seek a different answer.',
  'If the recipient becomes silent, make at most two brief connection checks and then terminate safely. Never enter a hold loop or repeatedly say you will wait.',
].join(' ');

export const OPERATOR_SANDBOX_OBJECTIVE = 'Conduct a neutral synthetic Client decision acquisition for the controlled recovery proposal. Present the proposal and hard conditions before obtaining exactly one decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION. No authorization change is requested.';
export const operatorSandboxContext = (facts: OperatorSandboxFacts = OPERATOR_SANDBOX_FACTS) =>
  `Synthetic sandbox test only; no real customer authority or external effect. ${renderClientDecisionPolicy(facts)}`;

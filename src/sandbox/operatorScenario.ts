import { createCallRequest, PHONE_DECISION_SCHEMA } from '../integrations/calle/contract.js';
import { MockProvider } from '../integrations/calle/mockProvider.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, renderClientDecisionPolicy, renderOperatorFacts, type OperatorSandboxFacts } from './operatorDefinition.js';
import { createOperatorControlledState } from './operatorContext.js';
export { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, renderClientDecisionPolicy, renderOperatorFacts, type OperatorSandboxFacts } from './operatorDefinition.js';

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
  const state = createOperatorControlledState(facts);
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

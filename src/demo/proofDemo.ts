import { assembleTrustedOperationalState, type EvidenceAssemblyResult, type OperationalEvidence, type EvidenceAuthorityPolicy } from '../application/evidenceBoundary.js';
import { executeOrchestrationAction, type OrchestrationResult, type OrchestrationState } from '../application/adaptiveOrchestrator.js';
import type { ActorRole, Plan } from '../domain/types.js';
import { actorIdSchema, caseIdSchema, planSchema } from '../domain/schemas.js';
import { prepareDecisionProposal, type DecisionBridgeResult } from '../integrations/calle/decisionBridge.js';
import { bindReviewCommand, type ReviewCommand } from '../integrations/calle/decisionApplication.js';

export type ProofScenario = 'H01' | 'H02' | 'H03';
export const proofScenarios = [
  { id: 'H02', title: 'Short physical supply', description: 'Review an approval against independently trusted facts.' },
  { id: 'H01', title: 'Sufficient physical supply', description: 'Independent control: the same rules can allow recovery.' },
  { id: 'H03', title: 'Conflicting supply claims', description: 'Independent scenario: physical truth cannot be established.' },
] as const;
const effectiveAt = '2027-06-10T17:00:00-05:00';
const deliveryAt = '2027-06-11T17:00:00-05:00';
const laterAt = '2027-06-12T17:00:00-05:00';
export const proofReceivedAt = '2027-06-10T22:05:00Z';
export const proofReviewedAt = '2027-06-10T22:06:00Z';
export const proofReviewer = 'DEMO-REVIEWER';
const roles: readonly ActorRole[] = ['client', 'production', 'supplier'];

// Freeze only locally owned demo inputs/results; no persistent or network state.
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const createProofInputs = (scenario: ProofScenario) => {
  const caseId = caseIdSchema.parse(`CASE-PROOF-${scenario}`);
  const actorId = (role: ActorRole) => actorIdSchema.parse(`ACTOR-PROOF-${scenario}-${role}`);
  const staticAuthorization = { maxAbsorbableAdditionalCost: 100, maxSubstituteQuantity: 500, latestAcceptedDeliveryDate: laterAt };
  const minimum = { type: 'MINIMUM_DELIVERY', minimumRequiredQuantity: 500, deliveryDate: deliveryAt, allowsOriginalAndSubstituteMix: true } as const;
  const baseline = {
    caseId, status: 'CASE_CREATED', actors: [
      { actorId: actorId('supplier'), role: 'supplier', staticConstraints: [], staticAuthorization },
      { actorId: actorId('production'), role: 'production', staticConstraints: [minimum], staticAuthorization },
      { actorId: actorId('client'), role: 'client', staticConstraints: [minimum] },
    ],
  } as const;
  const authorityPolicy: EvidenceAuthorityPolicy = { caseId, authorities: {
    COMMERCIAL_ORDER: 'SOURCE-ERP-DEMO', CLIENT_AUTHORIZATION: 'SOURCE-ERP-DEMO', PHYSICAL_SUPPLY: 'SOURCE-WMS-DEMO',
  } };
  const supply = (quantity: number, suffix: string): OperationalEvidence => ({
    evidenceId: `SUPPLY-${scenario}-${suffix}`, caseId, sourceId: authorityPolicy.authorities.PHYSICAL_SUPPLY,
    factKind: 'PHYSICAL_SUPPLY', observedAt: suffix === 'B' ? '2027-06-10T21:58:00Z' : '2027-06-10T21:57:00Z', effectiveAt: '2027-06-10T22:00:00Z',
    payload: { supplierActorId: actorId('supplier'), supplies: [{ type: 'SUPPLY', originalQuantity: 350, substituteQuantity: quantity, deliveryDate: deliveryAt, substituteUnitAdditionalCost: 0.5 }] },
  });
  const evidence: readonly OperationalEvidence[] = [
    { evidenceId: `ORDER-${scenario}`, caseId, sourceId: authorityPolicy.authorities.COMMERCIAL_ORDER, factKind: 'COMMERCIAL_ORDER', observedAt: '2027-06-10T21:55:00Z', effectiveAt,
      payload: { requestedQuantity: 500, targetDeliveryDate: deliveryAt } },
    { evidenceId: `AUTH-${scenario}`, caseId, sourceId: authorityPolicy.authorities.CLIENT_AUTHORIZATION, factKind: 'CLIENT_AUTHORIZATION', observedAt: '2027-06-10T21:56:00Z', effectiveAt,
      payload: { authorization: { ...staticAuthorization, maxSubstituteQuantity: 180 } } },
    ...(scenario === 'H03' ? [supply(150, 'A'), supply(100, 'B')] : [supply(scenario === 'H01' ? 150 : 100, 'A')]),
  ];
  const plan = planSchema.parse({ id: `PLAN-PROOF-${scenario}`, caseId, status: 'PENDING_APPROVAL', version: 1,
    originalQuantityTomorrow: 350, substituteQuantityTomorrow: 150, originalQuantityLater: 0,
    laterDeliveryDate: laterAt, clientAdditionalCost: 0, supplierAbsorbedCost: 75, productionAbsorbedCost: 0 });
  return freeze({ scenario, effectiveAt, baseline, authorityPolicy, evidence, plan, lineageId: `LINEAGE-PROOF-${scenario}` });
};

export type ProofAttempt = Readonly<{
  before: OrchestrationState;
  result: OrchestrationResult;
  review: ReviewCommand;
}>;
export type ProofSession = Readonly<{
  inputs: ReturnType<typeof createProofInputs>;
  assembly: EvidenceAssemblyResult;
  state?: OrchestrationState;
  registration?: OrchestrationResult;
  bridge?: DecisionBridgeResult;
  attempts: readonly ProofAttempt[];
  roleIndex: number;
  stopped: boolean;
}>;

const proposalFor = (state: OrchestrationState, plan: Plan, actorRole: ActorRole): DecisionBridgeResult => {
  const actor = state.exceptionCase.actors.find(({ role }) => role === actorRole);
  if (actor === undefined) return { ready: false, reason: 'Demo actor unavailable' };
  // Explicit synthetic normalized input, not a CALL-E invocation or recorded live response.
  return prepareDecisionProposal({ success: true, value: {
    requestId: `REQUEST-${plan.id}-${actorRole}`, createdAt: '2027-06-10T22:04:00Z', receivedAt: proofReceivedAt,
    caseId: state.exceptionCase.id, planId: plan.id, actorId: actor.id, actorRole, decision: 'APPROVED',
    summary: 'Approve the proposed recovery: 350 original units and 150 substitutes.',
    authorizationChanges: [], evidence: ['Synthetic external decision supplied for this deterministic proof; not a live call.'],
    completionConfidence: { score: 1, label: 'synthetic fixture' },
  } }, { exceptionCase: state.exceptionCase, plans: state.plans }, {
    operationType: 'PLAN_DECISION', caseId: state.exceptionCase.id, planId: plan.id, actorId: actor.id, actorRole,
  });
};

export const prepareProof = (scenario: ProofScenario): ProofSession => {
  const inputs = createProofInputs(scenario);
  const assembly = assembleTrustedOperationalState(inputs);
  const base = { inputs, assembly, attempts: [], roleIndex: 0, stopped: true } as const;
  if (assembly.status !== 'ACCEPTED') return freeze(base);
  const registration = executeOrchestrationAction({ exceptionCase: assembly.exceptionCase, plans: [], planLineages: [], approvals: [], operationHistory: [], events: [] }, {
    type: 'REGISTER_PLAN_PROPOSAL', lineageId: inputs.lineageId, plan: inputs.plan,
  });
  if (!registration.accepted) return freeze({ ...base, registration, state: registration.state });
  const bridge = proposalFor(registration.state, inputs.plan, roles[0]!);
  return freeze({ ...base, registration, state: registration.state, bridge, stopped: !bridge.ready });
};

export const reviewProof = (session: ProofSession, action: 'APPLY' | 'DISCARD'): ProofSession => {
  if (session.stopped || session.state === undefined || session.bridge?.ready !== true) return session;
  const { bridge, state } = session;
  const token = `${session.inputs.plan.id}-${bridge.proposal.actorRole}`;
  const review = bindReviewCommand(action === 'APPLY' ? {
    action, operationId: `OPERATION-${token}`, eventId: `EVENT-${token}`, approvalId: `APPROVAL-${token}`,
    reviewedBy: proofReviewer, reviewedAt: proofReviewedAt, authorizationReviews: [],
  } : { action, operationId: `OPERATION-${token}`, reviewedBy: proofReviewer, reviewedAt: proofReviewedAt, reason: 'Discarded in local proof review' }, bridge.reviewTarget);
  const result = executeOrchestrationAction(state, { type: 'APPLY_REVIEWED_DECISION', bridgeResult: bridge, review });
  const attempts = [...session.attempts, { before: state, result, review }];
  const roleIndex = session.roleIndex + 1;
  const nextRole = roles[roleIndex];
  const continueReview = result.accepted && result.disposition.type === 'AWAITING_EXTERNAL_ACTION' && nextRole !== undefined;
  return freeze({ ...session, state: result.state, attempts, roleIndex, stopped: !continueReview,
    ...(continueReview ? { bridge: proposalFor(result.state, session.inputs.plan, nextRole) } : {}),
  });
};

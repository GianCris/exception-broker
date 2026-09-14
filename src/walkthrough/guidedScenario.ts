import { createProofInputs, type ProofScenario } from '../demo/proofDemo.js';
import { controlDate } from '../presentation/controlSurfaceViewModel.js';

/**
 * The Guided Walkthrough's factual source of truth.
 *
 * This is a SIMULATED scenario: the conversation, the provider-style evidence and the
 * structured result are written here, and nothing in this module contacts CALL-E, the
 * acquisition service or any network. What it is NOT is a second set of operational
 * facts — every canonical quantity, authority limit and date is derived from the existing
 * deterministic H02 proof inputs, so the walkthrough and the Control proof can never
 * disagree.
 *
 * The scenario also keeps the product's semantic boundaries intact. Decision terms,
 * current authorization and operational reality are three different layers established by
 * three different sources. The conversation may mention the authorization limit, but it
 * never becomes the authority for it: the controlled evidence does. Teaching that
 * separation is the point of the walkthrough.
 */

export const guidedScenarioSource = 'SIMULATED_GUIDED_SCENARIO' as const;
export const guidedControlScenario: ProofScenario = 'H02';

/** Which layer established a fact. These are not interchangeable sources of truth. */
export type GuidedFactLayer = 'DECISION_TERMS' | 'CURRENT_AUTHORIZATION' | 'OPERATIONAL_REALITY';
export type GuidedFact = Readonly<{
  id: string; layer: GuidedFactLayer; label: string; value: string; establishedBy: string;
}>;
export type GuidedTurn = Readonly<{ offsetSeconds: number; speaker: 'bot' | 'user'; text: string }>;
export type GuidedStructuredResult = Readonly<{
  decision: 'APPROVED'; summary: string;
  originalUnits: number; substituteUnits: number; totalUnits: number;
  additionalClientCost: number; maxSubstituteQuantity: number; targetDeliveryDate: string;
}>;

const inputs = createProofInputs(guidedControlScenario);
const order = inputs.evidence.find((entry) => entry.factKind === 'COMMERCIAL_ORDER');
const authorization = inputs.evidence.find((entry) => entry.factKind === 'CLIENT_AUTHORIZATION');
const supply = inputs.evidence.find((entry) => entry.factKind === 'PHYSICAL_SUPPLY');
if (order === undefined || authorization === undefined || supply === undefined) {
  throw new Error('Guided scenario requires the deterministic H02 order, authorization and supply evidence');
}

const targetDeliveryDate = order.payload.targetDeliveryDate;
const month = controlDate(targetDeliveryDate).split(',')[0] ?? 'Not stated';

/**
 * Canonical facts. Everything the walkthrough shows or says is interpolated from here, so
 * the transcript, the simulated result, the review target and the Broker evaluation are
 * reading the same numbers rather than independent literals.
 */
export const guidedCanonicalFacts = {
  caseId: inputs.plan.caseId,
  planId: inputs.plan.id,
  planVersion: inputs.plan.version,
  requestedTotalUnits: order.payload.requestedQuantity,
  originalUnits: inputs.plan.originalQuantityTomorrow,
  substituteUnits: inputs.plan.substituteQuantityTomorrow,
  additionalClientCost: inputs.plan.clientAdditionalCost,
  authorizedSubstitutes: authorization.payload.authorization.maxSubstituteQuantity,
  availableSubstitutes: supply.payload.supplies[0]?.substituteQuantity ?? 0,
  targetDeliveryDate,
  /** "June 11, 2027" — for product surfaces. */
  targetDeliveryLabel: controlDate(targetDeliveryDate),
  /** "June 11" — how a person says it out loud. Same instant, so it cannot drift. */
  targetDeliverySpoken: month,
  authorizationSourceId: authorization.sourceId,
  supplySourceId: supply.sourceId,
} as const;

const facts = guidedCanonicalFacts;

/** The three layers, kept explicitly distinct. */
export const guidedFactLayers: readonly GuidedFact[] = [
  { id: 'requested-total', layer: 'DECISION_TERMS', label: 'Requested total', value: `${facts.requestedTotalUnits} units`, establishedBy: 'Acquired decision terms' },
  { id: 'original-units', layer: 'DECISION_TERMS', label: 'Original units', value: `${facts.originalUnits}`, establishedBy: 'Acquired decision terms' },
  { id: 'substitute-units', layer: 'DECISION_TERMS', label: 'Substitute units required', value: `${facts.substituteUnits}`, establishedBy: 'Acquired decision terms' },
  { id: 'client-cost', layer: 'DECISION_TERMS', label: 'Additional client cost', value: `${facts.additionalClientCost} (demo cost units)`, establishedBy: 'Acquired decision terms' },
  { id: 'target-date', layer: 'DECISION_TERMS', label: 'Target date', value: facts.targetDeliveryLabel, establishedBy: 'Acquired decision terms' },
  { id: 'authorized-substitutes', layer: 'CURRENT_AUTHORIZATION', label: 'Client authorization', value: `Up to ${facts.authorizedSubstitutes} substitutes`, establishedBy: facts.authorizationSourceId },
  { id: 'available-substitutes', layer: 'OPERATIONAL_REALITY', label: 'Trusted substitute availability', value: `${facts.availableSubstitutes}`, establishedBy: facts.supplySourceId },
] as const;

/**
 * A short, plausible operational conversation. Written, not returned by a provider — the
 * surface labels it simulated at every step. Quantities, the cost commitment, the date and
 * the authorization ceiling are interpolated from the canonical facts.
 */
export const guidedConversationTurns: readonly GuidedTurn[] = [
  { offsetSeconds: 0, speaker: 'bot', text: `Hi, this is CALL-E calling for Exception Broker about your order of ${facts.requestedTotalUnits} units for the ${facts.targetDeliverySpoken} delivery. Do you have two minutes?` },
  { offsetSeconds: 8, speaker: 'user', text: 'Yes, go ahead.' },
  { offsetSeconds: 12, speaker: 'bot', text: `Thank you. Production can only confirm ${facts.originalUnits} of the original units for that date. The recovery plan covers the remaining ${facts.substituteUnits} with the approved substitute part, so the full ${facts.requestedTotalUnits} still lands on ${facts.targetDeliverySpoken}.` },
  { offsetSeconds: 31, speaker: 'user', text: 'Okay. And what does that cost us?' },
  { offsetSeconds: 36, speaker: 'bot', text: 'Nothing additional on your side. The supplier absorbs the substitute difference, so your cost stays where it is.' },
  { offsetSeconds: 45, speaker: 'user', text: `Just to be clear, that's ${facts.substituteUnits} substitutes, not more?` },
  { offsetSeconds: 51, speaker: 'bot', text: `Correct — ${facts.originalUnits} original and ${facts.substituteUnits} substitute, ${facts.requestedTotalUnits} in total. Your standing authorization allows up to ${facts.authorizedSubstitutes} substitutes, so this sits inside it.` },
  { offsetSeconds: 66, speaker: 'user', text: `Right, we can't go past ${facts.authorizedSubstitutes} on substitutes. Let me think… no, ${facts.substituteUnits} is fine.` },
  { offsetSeconds: 78, speaker: 'bot', text: `Understood. Can you confirm you approve the recovery plan as described — ${facts.originalUnits} original, ${facts.substituteUnits} substitute, no additional cost, delivered ${facts.targetDeliverySpoken}?` },
  { offsetSeconds: 92, speaker: 'user', text: 'Yes, approved.' },
  { offsetSeconds: 96, speaker: 'bot', text: 'Thank you. I will record that as an approval of the proposed plan. Exception Broker reviews the exact decision before anything is applied.' },
] as const;

/** Provider-style evidence items. Simulated, and always labelled as such by the surface. */
export const guidedSimulatedEvidence: readonly string[] = [
  `Recipient approved the recovery plan: ${facts.originalUnits} original units and ${facts.substituteUnits} substitute units.`,
  `Recipient confirmed no additional client cost for the substitute units.`,
  `Recipient restated the standing substitute ceiling of ${facts.authorizedSubstitutes} units.`,
  `Recipient confirmed the ${facts.targetDeliverySpoken} delivery target.`,
] as const;

/** The simulated structured result the conversation would have produced. */
export const guidedSimulatedStructuredResult: GuidedStructuredResult = {
  decision: 'APPROVED',
  summary: `Approve the proposed recovery: ${facts.originalUnits} original units and ${facts.substituteUnits} substitutes.`,
  originalUnits: facts.originalUnits,
  substituteUnits: facts.substituteUnits,
  totalUnits: facts.requestedTotalUnits,
  additionalClientCost: facts.additionalClientCost,
  maxSubstituteQuantity: facts.authorizedSubstitutes,
  targetDeliveryDate: facts.targetDeliveryDate,
};

export type GuidedScenario = Readonly<{
  id: string;
  source: typeof guidedScenarioSource;
  canonicalFacts: typeof guidedCanonicalFacts;
  factLayers: readonly GuidedFact[];
  conversationTurns: readonly GuidedTurn[];
  simulatedProviderEvidence: readonly string[];
  simulatedStructuredResult: GuidedStructuredResult;
  normalizedDecision: 'APPROVED';
  /** The controlled operational context and review target this scenario hands over to. */
  operationalContext: Readonly<{ controlScenario: ProofScenario; caseId: string; planId: string; planVersion: number }>;
  /**
   * Test oracles only. The application never renders these: it runs the real deterministic
   * Broker evaluation and shows whatever that returns. "No external execution" is the
   * invariant — local controlled proof records are legitimate and are not counted here.
   */
  expectedDisposition: 'BLOCK';
  expectedExternalExecutions: 0;
}>;

export const guidedScenario: GuidedScenario = {
  id: 'GUIDED-WALKTHROUGH-SHORT-SUPPLY',
  source: guidedScenarioSource,
  canonicalFacts: guidedCanonicalFacts,
  factLayers: guidedFactLayers,
  conversationTurns: guidedConversationTurns,
  simulatedProviderEvidence: guidedSimulatedEvidence,
  simulatedStructuredResult: guidedSimulatedStructuredResult,
  normalizedDecision: 'APPROVED',
  operationalContext: {
    controlScenario: guidedControlScenario,
    caseId: facts.caseId,
    planId: facts.planId,
    planVersion: facts.planVersion,
  },
  expectedDisposition: 'BLOCK',
  expectedExternalExecutions: 0,
};

export type GuidedScenarioIssue = Readonly<{ code: string; message: string }>;

/**
 * Scenario coherence, checked from the data rather than asserted in prose. Used by the
 * tests and cheap enough to be callable anywhere.
 */
export const validateGuidedScenario = (scenario: GuidedScenario = guidedScenario): readonly GuidedScenarioIssue[] => {
  const issues: GuidedScenarioIssue[] = [];
  const canonical = scenario.canonicalFacts;
  const result = scenario.simulatedStructuredResult;
  const fail = (code: string, message: string) => issues.push({ code, message });
  const spoken = canonical.targetDeliverySpoken;
  const said = (fragment: string) => scenario.conversationTurns.some((turn) => turn.text.includes(fragment));

  if (canonical.originalUnits + canonical.substituteUnits !== canonical.requestedTotalUnits) {
    fail('QUANTITY_MATH', `${canonical.originalUnits} + ${canonical.substituteUnits} must equal ${canonical.requestedTotalUnits}`);
  }
  if (canonical.substituteUnits > canonical.authorizedSubstitutes) fail('AUTHORITY_EXCEEDED', 'Decision terms must sit inside the current authorization');
  if (canonical.availableSubstitutes >= canonical.substituteUnits) fail('SUPPLY_NOT_SHORT', 'The teaching scenario requires operational reality to fall short');
  if (result.totalUnits !== canonical.requestedTotalUnits) fail('RESULT_TOTAL', 'Simulated result total must match canonical total');
  if (result.originalUnits !== canonical.originalUnits) fail('RESULT_ORIGINAL', 'Simulated result original units must match canonical');
  if (result.substituteUnits !== canonical.substituteUnits) fail('RESULT_SUBSTITUTE', 'Simulated result substitute units must match canonical');
  if (result.additionalClientCost !== canonical.additionalClientCost) fail('RESULT_COST', 'Simulated result cost must match canonical');
  if (result.maxSubstituteQuantity !== canonical.authorizedSubstitutes) fail('RESULT_AUTHORIZATION', 'Simulated result authorization must match canonical');
  if (result.targetDeliveryDate !== canonical.targetDeliveryDate) fail('RESULT_DATE', 'Simulated result target date must match canonical');
  if (result.decision !== scenario.normalizedDecision) fail('RESULT_DECISION', 'Simulated result and normalized decision must agree');
  if (scenario.source !== guidedScenarioSource) fail('SOURCE', 'Guided scenario must declare a simulated source');
  if (scenario.conversationTurns.length < 8 || scenario.conversationTurns.length > 12) fail('TURN_COUNT', 'The conversation stays between 8 and 12 raw turns');
  for (const [index, turn] of scenario.conversationTurns.entries()) {
    const previous = scenario.conversationTurns[index - 1];
    if (previous !== undefined && turn.offsetSeconds <= previous.offsetSeconds) fail('TURN_ORDER', `Turn ${index} must advance in time`);
  }
  if (!said(`${canonical.requestedTotalUnits} units`)) fail('SAID_TOTAL', 'The conversation must state the requested total');
  if (!said(`${canonical.originalUnits} original`)) fail('SAID_ORIGINAL', 'The conversation must state the original units');
  if (!said(`${canonical.substituteUnits} substitute`)) fail('SAID_SUBSTITUTE', 'The conversation must state the substitute units');
  if (!said(`up to ${canonical.authorizedSubstitutes} substitutes`)) fail('SAID_AUTHORIZATION', 'The conversation must state the authorization ceiling');
  if (!said(spoken)) fail('SAID_DATE', 'The conversation must state the target delivery date');
  if (!said('no additional cost') && !said('Nothing additional')) fail('SAID_COST', 'The conversation must establish that no additional client cost applies');
  if (!said('approved')) fail('SAID_APPROVAL', 'The conversation must reach an explicit approval');
  const layers = new Set(scenario.factLayers.map((fact) => fact.layer));
  for (const layer of ['DECISION_TERMS', 'CURRENT_AUTHORIZATION', 'OPERATIONAL_REALITY'] as const) {
    if (!layers.has(layer)) fail('MISSING_LAYER', `The scenario must keep the ${layer} layer distinct`);
  }
  return issues;
};

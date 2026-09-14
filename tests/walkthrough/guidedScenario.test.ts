import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { prepareProof, reviewProof, createProofInputs } from '../../src/demo/proofDemo.js';
import { createDecisionControlView } from '../../src/presentation/decisionTraceViewModel.js';
import { createControlSurfaceModel } from '../../src/presentation/controlSurfaceViewModel.js';
import { guidedScenario, guidedScenarioSource, validateGuidedScenario } from '../../src/walkthrough/guidedScenario.js';
import { guidedStepCount, guidedWalkthroughSteps } from '../../src/walkthrough/guidedFlow.js';

const facts = guidedScenario.canonicalFacts;
const said = (fragment: string) => guidedScenario.conversationTurns.filter((turn) => turn.text.includes(fragment));

describe('Guided scenario consistency', () => {
  it('is internally coherent by its own validator', () => {
    expect(validateGuidedScenario()).toEqual([]);
  });

  it('derives every canonical fact from the deterministic H02 proof inputs', () => {
    const inputs = createProofInputs('H02');
    const order = inputs.evidence.find((entry) => entry.factKind === 'COMMERCIAL_ORDER')!;
    const authorization = inputs.evidence.find((entry) => entry.factKind === 'CLIENT_AUTHORIZATION')!;
    const supply = inputs.evidence.find((entry) => entry.factKind === 'PHYSICAL_SUPPLY')!;
    expect(facts.requestedTotalUnits).toBe(order.payload.requestedQuantity);
    expect(facts.originalUnits).toBe(inputs.plan.originalQuantityTomorrow);
    expect(facts.substituteUnits).toBe(inputs.plan.substituteQuantityTomorrow);
    expect(facts.additionalClientCost).toBe(inputs.plan.clientAdditionalCost);
    expect(facts.authorizedSubstitutes).toBe(authorization.payload.authorization.maxSubstituteQuantity);
    expect(facts.availableSubstitutes).toBe(supply.payload.supplies[0]!.substituteQuantity);
    expect(facts.targetDeliveryDate).toBe(order.payload.targetDeliveryDate);
    expect(facts.caseId).toBe(inputs.plan.caseId);
    expect(facts.planId).toBe(inputs.plan.id);
  });

  it('states the canonical quantity math', () => {
    expect(facts.originalUnits).toBe(350);
    expect(facts.substituteUnits).toBe(150);
    expect(facts.requestedTotalUnits).toBe(500);
    expect(facts.originalUnits + facts.substituteUnits).toBe(facts.requestedTotalUnits);
  });

  it('keeps decision terms, current authorization and operational reality as separate layers', () => {
    const layerOf = (id: string) => guidedScenario.factLayers.find((fact) => fact.id === id)?.layer;
    expect(layerOf('substitute-units')).toBe('DECISION_TERMS');
    expect(layerOf('authorized-substitutes')).toBe('CURRENT_AUTHORIZATION');
    expect(layerOf('available-substitutes')).toBe('OPERATIONAL_REALITY');
    // Authority and physical supply are established by different sources, never each other.
    const authority = guidedScenario.factLayers.find((fact) => fact.id === 'authorized-substitutes')!;
    const reality = guidedScenario.factLayers.find((fact) => fact.id === 'available-substitutes')!;
    expect(authority.establishedBy).not.toBe(reality.establishedBy);
    expect(authority.establishedBy).toBe('SOURCE-ERP-DEMO');
    expect(reality.establishedBy).toBe('SOURCE-WMS-DEMO');
    // The conversation is not the authority for the ceiling, even though it mentions it.
    expect(authority.establishedBy).not.toMatch(/conversation|transcript/i);
  });

  it('keeps authorization consistent across conversation, simulated result and review target', () => {
    expect(facts.authorizedSubstitutes).toBe(180);
    expect(said(`up to ${facts.authorizedSubstitutes} substitutes`).length).toBeGreaterThan(0);
    expect(guidedScenario.simulatedStructuredResult.maxSubstituteQuantity).toBe(180);
    const model = createControlSurfaceModel(prepareProof('H02'));
    expect(model.proposal?.lines.find((line) => line.label === 'Client authorization')?.value).toBe('Up to 180 substitutes');
  });

  it('keeps the target date consistent across conversation, simulated result and review target', () => {
    expect(facts.targetDeliveryLabel).toBe('June 11, 2027');
    expect(facts.targetDeliverySpoken).toBe('June 11');
    expect(said(facts.targetDeliverySpoken).length).toBeGreaterThan(0);
    expect(guidedScenario.simulatedStructuredResult.targetDeliveryDate).toBe(facts.targetDeliveryDate);
    const model = createControlSurfaceModel(prepareProof('H02'));
    expect(model.proposal?.lines.find((line) => line.label === 'Target date')?.value).toBe(facts.targetDeliveryLabel);
  });

  it('keeps cost consistent and free of additional client cost', () => {
    expect(facts.additionalClientCost).toBe(0);
    expect(guidedScenario.simulatedStructuredResult.additionalClientCost).toBe(0);
    expect(said('Nothing additional').length).toBeGreaterThan(0);
    const model = createControlSurfaceModel(prepareProof('H02'));
    expect(model.proposal?.lines.find((line) => line.label === 'Additional client cost')?.value).toMatch(/^0 /);
  });

  it('reads like an operational conversation that establishes the decision terms', () => {
    expect(guidedScenario.conversationTurns.length).toBeGreaterThanOrEqual(8);
    expect(guidedScenario.conversationTurns.length).toBeLessThanOrEqual(12);
    expect(said(`${facts.requestedTotalUnits} units`).length).toBeGreaterThan(0);
    expect(said(`${facts.originalUnits} original`).length).toBeGreaterThan(0);
    expect(said(`${facts.substituteUnits} substitute`).length).toBeGreaterThan(0);
    expect(said('approved').length).toBeGreaterThan(0);
    // Human, not a fixture: a clarification, a hesitation, and a confirmation.
    expect(said('Just to be clear').length).toBe(1);
    expect(said('Let me think').length).toBe(1);
    expect(guidedScenario.conversationTurns.some((turn) => turn.speaker === 'user' && /^Yes, approved\.$/.test(turn.text))).toBe(true);
    expect(guidedScenario.conversationTurns.some((turn) => /hereby approve exactly/i.test(turn.text))).toBe(false);
    expect(guidedScenario.conversationTurns.filter((turn) => turn.speaker === 'bot').length).toBeGreaterThan(2);
    expect(guidedScenario.conversationTurns.filter((turn) => turn.speaker === 'user').length).toBeGreaterThan(2);
  });

  it('declares a simulated source and normalizes to APPROVED', () => {
    expect(guidedScenario.source).toBe(guidedScenarioSource);
    expect(guidedScenario.source).toBe('SIMULATED_GUIDED_SCENARIO');
    expect(guidedScenario.normalizedDecision).toBe('APPROVED');
    expect(guidedScenario.simulatedStructuredResult.decision).toBe('APPROVED');
    // Simulated material never claims to have been observed or returned by a provider.
    for (const item of guidedScenario.simulatedProviderEvidence) expect(item).not.toMatch(/observed|CALL-E returned|provider returned/i);
  });

  it('hands over to the deterministic H02 control context', () => {
    expect(guidedScenario.operationalContext.controlScenario).toBe('H02');
    expect(guidedScenario.operationalContext.caseId).toBe('CASE-PROOF-H02');
    expect(guidedScenario.operationalContext.planId).toBe('PLAN-PROOF-H02');
  });
});

describe('Guided scenario against the real Broker', () => {
  it('produces BLOCK from the actual deterministic evaluation, matching the expected oracle', () => {
    const applied = reviewProof(prepareProof('H02'), 'APPLY');
    const control = createDecisionControlView(applied);
    const model = createControlSurfaceModel(applied);
    // The disposition comes from the Broker, and only then is compared with the oracle.
    expect(control.disposition).toBe('BLOCK');
    expect(control.disposition).toBe(guidedScenario.expectedDisposition);
    expect(model.disposition.label).toBe('BLOCK');
    expect(model.disposition.code).toBe('PLAN_PHYSICALLY_INFEASIBLE');
    expect(model.disposition.headline).toBe(`${facts.substituteUnits - facts.availableSubstitutes} required substitute units are unavailable.`);
  });

  it('keeps the acquired decision APPROVED after the application is blocked', () => {
    const applied = reviewProof(prepareProof('H02'), 'APPLY');
    const model = createControlSurfaceModel(applied);
    expect(model.decision.label).toBe('APPROVED');
    expect(model.decision.note).toBe('Decision fixed and usable.');
    expect(model.disposition.label).not.toBe('REJECTED');
  });

  it('measures required against available and reports no external execution', () => {
    const model = createControlSurfaceModel(reviewProof(prepareProof('H02'), 'APPLY'));
    expect(model.reality.kind).toBe('MEASURED');
    if (model.reality.kind !== 'MEASURED') throw new Error('H02 must measure operational reality');
    expect(model.reality.required).toBe(facts.substituteUnits);
    expect(model.reality.available).toBe(facts.availableSubstitutes);
    expect(model.reality.causal).toBe('Authority is sufficient. Physical supply is not.');
    expect(model.disposition.supporting).toMatch(/No external execution/);
    expect(guidedScenario.expectedExternalExecutions).toBe(0);
  });

  it('never lets the expected oracle reach the rendering path', () => {
    for (const file of ['src/ui/GuidedWalkthroughExperience.tsx', 'src/ui/ProofExperience.tsx', 'src/ui/ControlInstrument.tsx', 'src/presentation/controlSurfaceViewModel.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/expectedDisposition|expectedExternalExecutions/);
    }
  });
});

describe('Guided walkthrough flow contract', () => {
  it('has exactly six instructional moments, in order, ending without a next step', () => {
    expect(guidedStepCount).toBe(6);
    expect(guidedWalkthroughSteps.map((step) => step.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(guidedWalkthroughSteps.map((step) => step.stepId)).toEqual(['conversation', 'decision', 'handoff', 'review', 'apply', 'outcome']);
    expect(guidedWalkthroughSteps.at(-1)?.nextStep).toBeUndefined();
    for (const step of guidedWalkthroughSteps.slice(0, -1)) expect(step.nextStep).toBeDefined();
  });

  it('asks for a real action exactly where the product does the work', () => {
    const kinds = Object.fromEntries(guidedWalkthroughSteps.map((step) => [step.stepId, step.requiredAction.kind]));
    expect(kinds).toEqual({
      conversation: 'ACKNOWLEDGE', decision: 'ACKNOWLEDGE',
      handoff: 'REAL_ACTION', review: 'REAL_ACTION', apply: 'REAL_ACTION',
      outcome: 'NONE',
    });
  });

  it('points each step at a stable semantic target that the product actually renders', () => {
    expect(guidedWalkthroughSteps.map((step) => step.spotlightTarget))
      .toEqual(['conversation', 'decision', 'continue-control', 'review-proposal', 'apply-reviewed', 'disposition']);
    const sources = ['src/ui/GuidedWalkthroughExperience.tsx', 'src/ui/ProofExperience.tsx', 'src/ui/ControlInstrument.tsx']
      .map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const step of guidedWalkthroughSteps) expect(sources).toContain(`data-walkthrough-target="${step.spotlightTarget}"`);
  });

  it('keeps instruction separate from scenario facts', () => {
    const flow = readFileSync('src/walkthrough/guidedFlow.ts', 'utf8');
    // No quantities, dates or dispositions are restated in the teaching layer.
    expect(flow).not.toMatch(/\b(350|150|500|180|100)\b/);
    // It may mention the scenario module in prose, but it never imports or reads from it.
    expect(flow).not.toMatch(/^import .*guidedScenario/m);
    expect(flow).not.toMatch(/canonicalFacts\./);
  });
});

import { describe, expect, it } from 'vitest';

import {
  executeOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationState,
} from '../../src/application/adaptiveOrchestrator.js';
import { assembleTrustedOperationalState } from '../../src/application/evidenceBoundary.js';
import { assessPhysicalFeasibility } from '../../src/domain/physicalFeasibility.js';
import { exceptionCaseSchema, planSchema } from '../../src/domain/schemas.js';
import type { ActorRole, ExceptionCase, Plan } from '../../src/domain/types.js';
import { validatePlan } from '../../src/domain/validator.js';
import { createReadyDecisionBridgeResult, type DecisionBridgeResult } from '../../src/integrations/calle/decisionBridge.js';
import { bindReviewCommand } from '../../src/integrations/calle/decisionApplication.js';

const REQUESTED_EFFECTIVE_AT = '2027-06-10T17:00:00-05:00';
const EQUIVALENT_EFFECTIVE_AT = '2027-06-10T22:00:00Z';
const TARGET_DELIVERY_AT = '2027-06-11T17:00:00-05:00';
const LATER_DELIVERY_AT = '2027-06-12T17:00:00-05:00';
const REQUESTED_QUANTITY = 500;
const ORIGINAL_QUANTITY = 350;
const SUBSTITUTE_QUANTITY = 150;
const CLIENT_SUBSTITUTE_AUTHORIZATION = 180;
const SUBSTITUTE_UNIT_ADDITIONAL_COST = 0.5;
const SOURCE_ERP = 'SOURCE-ERP-PPV2';
const SOURCE_WMS = 'SOURCE-WMS-PPV2';

type Scenario = 'H01' | 'H02' | 'H03-A' | 'H03-B';

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const stableBaseline = (scenario: Scenario) => ({
  caseId: `CASE-PPV2-${scenario}`,
  status: 'CASE_CREATED',
  actors: [
    {
      actorId: `SUPPLIER-PPV2-${scenario}`,
      role: 'supplier',
      staticConstraints: [],
      staticAuthorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: REQUESTED_QUANTITY,
        latestAcceptedDeliveryDate: LATER_DELIVERY_AT,
      },
    },
    {
      actorId: `PRODUCTION-PPV2-${scenario}`,
      role: 'production',
      staticConstraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: REQUESTED_QUANTITY,
        deliveryDate: TARGET_DELIVERY_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
      staticAuthorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: REQUESTED_QUANTITY,
        latestAcceptedDeliveryDate: LATER_DELIVERY_AT,
      },
    },
    {
      actorId: `CLIENT-PPV2-${scenario}`,
      role: 'client',
      staticConstraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: REQUESTED_QUANTITY,
        deliveryDate: TARGET_DELIVERY_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
    },
  ],
} as const);

const authorityPolicy = (caseId: string) => ({
  caseId,
  authorities: {
    COMMERCIAL_ORDER: SOURCE_ERP,
    CLIENT_AUTHORIZATION: SOURCE_ERP,
    PHYSICAL_SUPPLY: SOURCE_WMS,
  },
} as const);

const orderEvidence = (caseId: string) => ({
  evidenceId: `EVIDENCE-ORDER-${caseId}`,
  sourceId: SOURCE_ERP,
  caseId,
  factKind: 'COMMERCIAL_ORDER',
  observedAt: '2027-06-10T21:55:00Z',
  effectiveAt: EQUIVALENT_EFFECTIVE_AT,
  payload: {
    requestedQuantity: REQUESTED_QUANTITY,
    targetDeliveryDate: TARGET_DELIVERY_AT,
  },
} as const);

const authorizationEvidence = (caseId: string) => ({
  evidenceId: `EVIDENCE-AUTHORIZATION-${caseId}`,
  sourceId: SOURCE_ERP,
  caseId,
  factKind: 'CLIENT_AUTHORIZATION',
  observedAt: '2027-06-10T21:56:00Z',
  effectiveAt: REQUESTED_EFFECTIVE_AT,
  payload: {
    authorization: {
      maxAbsorbableAdditionalCost: 100,
      maxSubstituteQuantity: CLIENT_SUBSTITUTE_AUTHORIZATION,
      latestAcceptedDeliveryDate: LATER_DELIVERY_AT,
    },
  },
} as const);

const supplyEvidence = (caseId: string, substituteSupply: number, evidenceIdSuffix = '') => ({
  evidenceId: `EVIDENCE-SUPPLY-${caseId}${evidenceIdSuffix}`,
  sourceId: SOURCE_WMS,
  caseId,
  factKind: 'PHYSICAL_SUPPLY',
  observedAt: evidenceIdSuffix === '' ? '2027-06-10T21:57:00Z' : '2027-06-10T21:58:00Z',
  effectiveAt: EQUIVALENT_EFFECTIVE_AT,
  payload: {
    supplierActorId: `SUPPLIER-PPV2-${caseId.replace('CASE-PPV2-', '')}`,
    supplies: [{
      type: 'SUPPLY',
      originalQuantity: ORIGINAL_QUANTITY,
      substituteQuantity: substituteSupply,
      deliveryDate: TARGET_DELIVERY_AT,
      substituteUnitAdditionalCost: SUBSTITUTE_UNIT_ADDITIONAL_COST,
    }],
  },
} as const);

const scenarioFixture = (scenario: Scenario, physical: 'SUPPORTED' | 'SHORT' | 'MISSING' | 'CONFLICT') => {
  const baseline = stableBaseline(scenario);
  const commonEvidence = [orderEvidence(baseline.caseId), authorizationEvidence(baseline.caseId)];
  const physicalEvidence = physical === 'MISSING'
    ? []
    : physical === 'CONFLICT'
      ? [supplyEvidence(baseline.caseId, 150, '-A'), supplyEvidence(baseline.caseId, 100, '-B')]
      : [supplyEvidence(baseline.caseId, physical === 'SUPPORTED' ? 150 : 100)];
  const plan = {
    id: `PLAN-PPV2-${scenario}`,
    caseId: baseline.caseId,
    status: 'PENDING_APPROVAL',
    version: 1,
    originalQuantityTomorrow: ORIGINAL_QUANTITY,
    substituteQuantityTomorrow: SUBSTITUTE_QUANTITY,
    originalQuantityLater: 0,
    laterDeliveryDate: LATER_DELIVERY_AT,
    clientAdditionalCost: 0,
    supplierAbsorbedCost: SUBSTITUTE_QUANTITY * SUBSTITUTE_UNIT_ADDITIONAL_COST,
    productionAbsorbedCost: 0,
  } as const;

  expect(planSchema.safeParse(plan).success).toBe(true);
  return deepFreeze({
    requestedEffectiveAt: REQUESTED_EFFECTIVE_AT,
    baseline,
    authorityPolicy: authorityPolicy(baseline.caseId),
    evidence: [...commonEvidence, ...physicalEvidence],
    plan,
    lineageId: `LINEAGE-PPV2-${scenario}`,
  });
};

const emptyState = (exceptionCase: ExceptionCase): OrchestrationState => ({
  exceptionCase,
  plans: [],
  planLineages: [],
  approvals: [],
  operationHistory: [],
  events: [],
});

const reviewedApproval = (
  state: OrchestrationState,
  planId: string,
  actorRole: ActorRole,
  token: string,
): Extract<OrchestrationAction, { type: 'APPLY_REVIEWED_DECISION' }> => {
  const actor = state.exceptionCase.actors.find(({ role }) => role === actorRole);
  if (actor === undefined) throw new Error(`Missing ${actorRole} actor`);
  const bridgeResult: DecisionBridgeResult = createReadyDecisionBridgeResult({
      operationType: 'PLAN_DECISION',
      requestId: `REQUEST-PPV2-${token}`,
      caseId: state.exceptionCase.id,
      planId,
      actorId: actor.id,
      actorRole,
      decision: 'APPROVED',
      summary: 'Explicit reviewed PPv2 approval',
      proposedAuthorizationChanges: [],
      evidence: ['Explicit external reviewed decision'],
      completionConfidence: { score: 1, label: 'high' },
      receivedAt: '2027-06-10T22:05:00Z',
      requiresReview: true,
      reviewState: 'DECISION_REVIEW_REQUIRED',
    });
  return {
    type: 'APPLY_REVIEWED_DECISION',
    bridgeResult,
    review: bindReviewCommand({
      action: 'APPLY',
      operationId: `OPERATION-PPV2-${token}`,
      reviewedBy: 'REVIEWER-PPV2',
      reviewedAt: '2027-06-10T22:10:00Z',
      eventId: `EVENT-PPV2-${token}`,
      approvalId: `APPROVAL-PPV2-${token}`,
      authorizationReviews: [],
    }, bridgeResult.reviewTarget),
  };
};

const assemble = (fixture: ReturnType<typeof scenarioFixture>) => assembleTrustedOperationalState({
  effectiveAt: fixture.requestedEffectiveAt,
  baseline: fixture.baseline,
  authorityPolicy: fixture.authorityPolicy,
  evidence: fixture.evidence,
});

const physicalClaims = (fixture: ReturnType<typeof scenarioFixture>) => fixture.evidence.filter(
  (claim): claim is ReturnType<typeof supplyEvidence> => claim.factKind === 'PHYSICAL_SUPPLY',
);

const assertProvenance = (result: Extract<ReturnType<typeof assemble>, { status: 'ACCEPTED' }>) => {
  expect(result.provenance.COMMERCIAL_ORDER).toEqual([
    expect.objectContaining({ sourceId: SOURCE_ERP, factKind: 'COMMERCIAL_ORDER' }),
  ]);
  expect(result.provenance.CLIENT_AUTHORIZATION).toEqual([
    expect.objectContaining({ sourceId: SOURCE_ERP, factKind: 'CLIENT_AUTHORIZATION' }),
  ]);
  expect(result.provenance.PHYSICAL_SUPPLY).toEqual([
    expect.objectContaining({ sourceId: SOURCE_WMS, factKind: 'PHYSICAL_SUPPLY' }),
  ]);
};

describe('Product Proof v2 — heterogeneous evidence', () => {
  it('H01 EXECUTE: assembles coherent evidence and resolves the safe exact plan', () => {
    const fixture = scenarioFixture('H01', 'SUPPORTED');
    const assembly = assemble(fixture);
    expect(assembly.status).toBe('ACCEPTED');
    if (assembly.status !== 'ACCEPTED') throw new Error(`H01 assembly failed: ${assembly.status}`);

    expect(exceptionCaseSchema.safeParse(assembly.exceptionCase).success).toBe(true);
    assertProvenance(assembly);
    expect(assembly.exceptionCase).toMatchObject({
      id: 'CASE-PPV2-H01',
      requestedQuantity: REQUESTED_QUANTITY,
      targetDeliveryDate: TARGET_DELIVERY_AT,
    });
    expect(assembly.exceptionCase.actors.find(({ role }) => role === 'client')?.authorization.maxSubstituteQuantity)
      .toBe(CLIENT_SUBSTITUTE_AUTHORIZATION);

    const registration = executeOrchestrationAction(emptyState(assembly.exceptionCase), {
      type: 'REGISTER_PLAN_PROPOSAL',
      lineageId: fixture.lineageId,
      plan: fixture.plan,
    });
    expect(registration).toMatchObject({
      accepted: true,
      disposition: { type: 'AWAITING_EXTERNAL_ACTION' },
      step: {
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: { outcome: 'PHYSICALLY_FEASIBLE' },
        },
      },
    });
    if (!registration.accepted) throw new Error(`H01 registration failed: ${registration.failure.reason}`);
    const registeredPlan = registration.state.plans.find(({ id }) => id === fixture.plan.id)!;
    expect(validatePlan(registration.state.exceptionCase, registeredPlan)).toEqual({ valid: true, violations: [] });
    expect(assessPhysicalFeasibility(registration.state.exceptionCase, registeredPlan).outcome).toBe('PHYSICALLY_FEASIBLE');

    const client = executeOrchestrationAction(registration.state, reviewedApproval(registration.state, fixture.plan.id, 'client', 'H01-CLIENT'));
    expect(client).toMatchObject({ accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' } });
    if (!client.accepted) throw new Error(client.failure.reason);
    const production = executeOrchestrationAction(client.state, reviewedApproval(client.state, fixture.plan.id, 'production', 'H01-PRODUCTION'));
    expect(production).toMatchObject({ accepted: true, disposition: { type: 'AWAITING_EXTERNAL_ACTION' } });
    if (!production.accepted) throw new Error(production.failure.reason);
    const supplier = executeOrchestrationAction(production.state, reviewedApproval(production.state, fixture.plan.id, 'supplier', 'H01-SUPPLIER'));

    expect(supplier).toMatchObject({
      accepted: true,
      disposition: {
        type: 'LINEAGE_RESOLVED',
        scope: { caseId: fixture.baseline.caseId, lineageId: fixture.lineageId, planId: fixture.plan.id },
      },
    });
    if (!supplier.accepted) throw new Error(supplier.failure.reason);
    expect(supplier.state.plans.find(({ id }) => id === fixture.plan.id)?.status).toBe('APPROVED');
    expect(supplier.state.approvals).toHaveLength(3);
    expect(supplier.state.approvals.map(({ actorRole }) => actorRole)).toEqual(['client', 'production', 'supplier']);
    expect(supplier.state.approvals.every(({ planId }) => planId === fixture.plan.id)).toBe(true);
    expect(supplier.state.plans).toHaveLength(1);
    expect(supplier.state.planLineages[0]?.planIds).toEqual([fixture.plan.id]);
    expect(supplier.state.events.map(({ result }) => result)).toEqual(['APPROVAL_RECORDED', 'APPROVAL_RECORDED', 'PLAN_APPROVED']);
    expect(JSON.stringify(supplier)).not.toContain('NO_SOLUTION_PROVEN');
  });

  it('H02 BLOCK: accepts trustworthy facts but blocks the substitute-supply shortfall atomically', () => {
    const fixture = scenarioFixture('H02', 'SHORT');
    const assembly = assemble(fixture);
    expect(assembly.status).toBe('ACCEPTED');
    if (assembly.status !== 'ACCEPTED') throw new Error(`H02 assembly failed: ${assembly.status}`);

    assertProvenance(assembly);
    const clientAuthorization = assembly.exceptionCase.actors.find(({ role }) => role === 'client')!.authorization.maxSubstituteQuantity;
    const trustedSupply = assembly.exceptionCase.actors.find(({ role }) => role === 'supplier')!.constraints
      .find(({ type }) => type === 'SUPPLY');
    expect(clientAuthorization).toBe(180);
    expect(SUBSTITUTE_QUANTITY).toBeLessThanOrEqual(clientAuthorization);
    expect(trustedSupply).toMatchObject({ originalQuantity: 350, substituteQuantity: 100 });
    if (trustedSupply?.type !== 'SUPPLY') throw new Error('H02 trusted SUPPLY missing');
    expect(ORIGINAL_QUANTITY).toBeLessThanOrEqual(trustedSupply.originalQuantity);
    expect(SUBSTITUTE_QUANTITY).toBeGreaterThan(trustedSupply.substituteQuantity);

    const registration = executeOrchestrationAction(emptyState(assembly.exceptionCase), {
      type: 'REGISTER_PLAN_PROPOSAL', lineageId: fixture.lineageId, plan: fixture.plan,
    });
    expect(registration).toMatchObject({
      accepted: true,
      step: {
        assessment: {
          planAssessment: { outcome: 'PLAN_VALID' },
          physicalFeasibilityAssessment: {
            outcome: 'PHYSICALLY_INFEASIBLE',
            violations: [expect.objectContaining({
              code: 'SUBSTITUTE_SUPPLY_EXCEEDED',
              planField: 'substituteQuantityTomorrow',
              requiredQuantity: 150,
              availableQuantity: 100,
            })],
          },
        },
      },
    });
    if (!registration.accepted) throw new Error(`H02 registration failed: ${registration.failure.reason}`);
    const before = registration.state;
    const approval = executeOrchestrationAction(before, reviewedApproval(before, fixture.plan.id, 'client', 'H02-CLIENT'));

    expect(approval).toMatchObject({
      accepted: false,
      failure: {
        source: 'DECISION_APPLICATION',
        reason: 'PLAN_PHYSICALLY_INFEASIBLE',
        issues: ['SUBSTITUTE_SUPPLY_EXCEEDED'],
      },
    });
    expect(approval.state).toBe(before);
    expect(before.approvals).toEqual([]);
    expect(before.operationHistory).toEqual([]);
    expect(before.events).toEqual([]);
    expect(before.plans.find(({ id }) => id === fixture.plan.id)?.status).toBe('PENDING_APPROVAL');
    expect(before.exceptionCase.actors.find(({ role }) => role === 'client')!.authorization.maxSubstituteQuantity).toBe(180);
    expect(JSON.stringify(approval)).not.toContain('LINEAGE_RESOLVED');
    expect(JSON.stringify(approval)).not.toContain('NO_SOLUTION_PROVEN');
  });

  it('H03-A WAIT: missing physical evidence emits no trusted case and never reaches the executor', () => {
    const fixture = scenarioFixture('H03-A', 'MISSING');
    const assembly = assemble(fixture);

    expect(assembly).toMatchObject({ status: 'MISSING_EVIDENCE', missingFactKinds: ['PHYSICAL_SUPPLY'] });
    expect('exceptionCase' in assembly).toBe(false);
    expect('provenance' in assembly).toBe(false);
    expect(JSON.stringify(assembly)).not.toMatch(/PHYSICALLY_INFEASIBLE|APPROVED|NO_SOLUTION_PROVEN/);
    // No trusted ExceptionCase exists, so this scenario intentionally performs no registration or reviewed decision.
  });

  it('H03-B WAIT: conflicting physical claims are not selected, merged, or sent to the executor', () => {
    const fixture = scenarioFixture('H03-B', 'CONFLICT');
    const assembly = assemble(fixture);

    expect(assembly).toMatchObject({
      status: 'CONFLICTING_EVIDENCE',
      issues: [{ code: 'AUTHORITATIVE_CLAIMS_CONFLICT', factKind: 'PHYSICAL_SUPPLY' }],
    });
    expect('exceptionCase' in assembly).toBe(false);
    expect('provenance' in assembly).toBe(false);
    expect(physicalClaims(fixture).map(({ payload }) => payload.supplies[0]?.substituteQuantity))
      .toEqual([150, 100]);
    expect(JSON.stringify(assembly)).not.toMatch(/PHYSICALLY_INFEASIBLE|APPROVED|NO_SOLUTION_PROVEN/);
    // No trusted ExceptionCase exists, so latest-wins and downstream execution are impossible by construction.
  });

  it('holds the frozen causal design constant except for the physical evidence condition', () => {
    const h01 = scenarioFixture('H01', 'SUPPORTED');
    const h02 = scenarioFixture('H02', 'SHORT');
    const h03Missing = scenarioFixture('H03-A', 'MISSING');
    const h03Conflict = scenarioFixture('H03-B', 'CONFLICT');
    const common = (fixture: ReturnType<typeof scenarioFixture>) => ({
      requestedEffectiveAt: fixture.requestedEffectiveAt,
      authoritySources: fixture.authorityPolicy.authorities,
      order: fixture.evidence.find(({ factKind }) => factKind === 'COMMERCIAL_ORDER')?.payload,
      authorization: fixture.evidence.find(({ factKind }) => factKind === 'CLIENT_AUTHORIZATION')?.payload,
      plan: {
        original: fixture.plan.originalQuantityTomorrow,
        substitute: fixture.plan.substituteQuantityTomorrow,
        later: fixture.plan.originalQuantityLater,
        costs: [fixture.plan.clientAdditionalCost, fixture.plan.supplierAbsorbedCost, fixture.plan.productionAbsorbedCost],
      },
      stableSemantics: fixture.baseline.actors.map(({ role, staticConstraints, ...actor }) => ({
        role,
        staticConstraints,
        staticAuthorization: 'staticAuthorization' in actor ? actor.staticAuthorization : undefined,
      })),
    });

    expect(common(h02)).toEqual(common(h01));
    expect(common(h03Missing)).toEqual(common(h01));
    expect(common(h03Conflict)).toEqual(common(h01));
    expect(physicalClaims(h01)[0]?.payload.supplies[0]?.substituteQuantity).toBe(150);
    expect(physicalClaims(h02)[0]?.payload.supplies[0]?.substituteQuantity).toBe(100);
    expect(physicalClaims(h03Missing)).toHaveLength(0);
    expect(physicalClaims(h03Conflict)).toHaveLength(2);
  });
});

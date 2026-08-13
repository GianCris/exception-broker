import { describe, expect, it } from 'vitest';

import {
  assembleTrustedOperationalState,
  type EvidenceAssemblyResult,
} from '../../src/application/evidenceBoundary.js';
import { exceptionCaseSchema } from '../../src/domain/schemas.js';

const EFFECTIVE_AT = '2027-01-15T12:00:00Z';
const TARGET_AT = '2027-01-16T12:00:00Z';
const LATER_AT = '2027-01-17T12:00:00Z';

const baseline = {
  caseId: 'CASE-EVIDENCE-V1',
  status: 'CASE_CREATED',
  actors: [
    {
      actorId: 'ACTOR-SUPPLIER',
      role: 'supplier',
      staticConstraints: [],
      staticAuthorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: 500,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
    {
      actorId: 'ACTOR-PRODUCTION',
      role: 'production',
      staticConstraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: 500,
        deliveryDate: TARGET_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
      staticAuthorization: {
        maxAbsorbableAdditionalCost: 100,
        maxSubstituteQuantity: 500,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
    {
      actorId: 'ACTOR-CLIENT',
      role: 'client',
      staticConstraints: [{
        type: 'MINIMUM_DELIVERY',
        minimumRequiredQuantity: 500,
        deliveryDate: TARGET_AT,
        allowsOriginalAndSubstituteMix: true,
      }],
    },
  ],
} as const;

const authorityPolicy = {
  caseId: baseline.caseId,
  authorities: {
    COMMERCIAL_ORDER: 'SOURCE-COMMERCIAL',
    CLIENT_AUTHORIZATION: 'SOURCE-AUTHORIZATION',
    PHYSICAL_SUPPLY: 'SOURCE-SUPPLY',
  },
} as const;

const evidence = [
  {
    evidenceId: 'EVIDENCE-ORDER',
    sourceId: authorityPolicy.authorities.COMMERCIAL_ORDER,
    caseId: baseline.caseId,
    factKind: 'COMMERCIAL_ORDER',
    observedAt: '2027-01-15T11:55:00Z',
    effectiveAt: EFFECTIVE_AT,
    payload: { requestedQuantity: 500, targetDeliveryDate: TARGET_AT },
  },
  {
    evidenceId: 'EVIDENCE-AUTHORIZATION',
    sourceId: authorityPolicy.authorities.CLIENT_AUTHORIZATION,
    caseId: baseline.caseId,
    factKind: 'CLIENT_AUTHORIZATION',
    observedAt: '2027-01-15T11:56:00Z',
    effectiveAt: EFFECTIVE_AT,
    payload: {
      authorization: {
        maxAbsorbableAdditionalCost: 75,
        maxSubstituteQuantity: 180,
        latestAcceptedDeliveryDate: LATER_AT,
      },
    },
  },
  {
    evidenceId: 'EVIDENCE-SUPPLY',
    sourceId: authorityPolicy.authorities.PHYSICAL_SUPPLY,
    caseId: baseline.caseId,
    factKind: 'PHYSICAL_SUPPLY',
    observedAt: '2027-01-15T11:57:00Z',
    effectiveAt: EFFECTIVE_AT,
    payload: {
      supplierActorId: 'ACTOR-SUPPLIER',
      supplies: [
        {
          type: 'SUPPLY',
          originalQuantity: 350,
          substituteQuantity: 150,
          deliveryDate: TARGET_AT,
          substituteUnitAdditionalCost: 0.5,
        },
      ],
    },
  },
] as const;

const clone = <T>(value: T): T => structuredClone(value);
const deepFreeze = <T>(value: T): Readonly<T> => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};
const assemble = (overrides: Readonly<{
  effectiveAt?: unknown;
  baseline?: unknown;
  authorityPolicy?: unknown;
  evidence?: readonly unknown[];
}> = {}): EvidenceAssemblyResult => assembleTrustedOperationalState({
  effectiveAt: overrides.effectiveAt ?? EFFECTIVE_AT,
  baseline: overrides.baseline ?? baseline,
  authorityPolicy: overrides.authorityPolicy ?? authorityPolicy,
  evidence: overrides.evidence ?? evidence,
});

const expectAccepted = (result: EvidenceAssemblyResult) => {
  expect(result.status).toBe('ACCEPTED');
  if (result.status !== 'ACCEPTED') throw new Error(`Expected ACCEPTED, received ${result.status}`);
  return result;
};

const expectNoCase = (result: EvidenceAssemblyResult) => {
  expect('exceptionCase' in result).toBe(false);
};

describe('Evidence Boundary v1 accepted assembly and provenance', () => {
  it('assembles a valid trusted case from the three authoritative facts', () => {
    const result = expectAccepted(assemble());

    expect(exceptionCaseSchema.safeParse(result.exceptionCase).success).toBe(true);
    expect(result.exceptionCase).toMatchObject({
      id: baseline.caseId,
      status: baseline.status,
      requestedQuantity: 500,
      targetDeliveryDate: TARGET_AT,
    });
    expect(result.authorityBasis).toEqual(authorityPolicy.authorities);
    expect(result.temporalBasis).toEqual({ effectiveAt: EFFECTIVE_AT });
  });

  it('retains auditable evidence references per fact without copying payloads', () => {
    const result = expectAccepted(assemble());

    expect(result.provenance.COMMERCIAL_ORDER).toEqual([{
      evidenceId: 'EVIDENCE-ORDER',
      sourceId: 'SOURCE-COMMERCIAL',
      factKind: 'COMMERCIAL_ORDER',
      observedAt: '2027-01-15T11:55:00Z',
      effectiveAt: EFFECTIVE_AT,
    }]);
    expect(result.provenance.CLIENT_AUTHORIZATION[0]).toMatchObject({ evidenceId: 'EVIDENCE-AUTHORIZATION', sourceId: 'SOURCE-AUTHORIZATION' });
    expect(result.provenance.PHYSICAL_SUPPLY[0]).toMatchObject({ evidenceId: 'EVIDENCE-SUPPLY', sourceId: 'SOURCE-SUPPLY' });
    expect(JSON.stringify(result.provenance)).not.toContain('requestedQuantity');
    expect(JSON.stringify(result.provenance)).not.toContain('supplies');
    expect('provenance' in result.exceptionCase).toBe(false);
  });

  it('matches equivalent-offset effective instants', () => {
    const offsetEvidence = evidence.map((item) => ({ ...clone(item), effectiveAt: '2027-01-15T07:00:00-05:00' }));
    expect(assemble({ evidence: offsetEvidence }).status).toBe('ACCEPTED');
  });

  it('accepts agreeing authoritative claims as corroboration without summing values', () => {
    const corroboration = { ...clone(evidence[0]), evidenceId: 'EVIDENCE-ORDER-2', observedAt: '2027-01-15T11:59:00Z' };
    const result = expectAccepted(assemble({ evidence: [...evidence, corroboration] }));

    expect(result.exceptionCase.requestedQuantity).toBe(500);
    expect(result.provenance.COMMERCIAL_ORDER.map(({ evidenceId }) => evidenceId)).toEqual(['EVIDENCE-ORDER', 'EVIDENCE-ORDER-2']);
  });

  it('preserves the accepted physical SUPPLY record set exactly', () => {
    const result = expectAccepted(assemble());
    const supplier = result.exceptionCase.actors.find(({ role }) => role === 'supplier');

    expect(supplier?.constraints).toEqual(evidence[2].payload.supplies);
  });
});

describe('Evidence Boundary v1 missing evidence', () => {
  it.each([
    'COMMERCIAL_ORDER',
    'CLIENT_AUTHORIZATION',
    'PHYSICAL_SUPPLY',
  ] as const)('reports missing %s evidence', (factKind) => {
    const result = assemble({ evidence: evidence.filter((item) => item.factKind !== factKind) });

    expect(result).toMatchObject({ status: 'MISSING_EVIDENCE', missingFactKinds: [factKind] });
    expectNoCase(result);
  });

  it('treats evidence for another effective instant as unusable rather than replacement', () => {
    const otherSnapshotOrder = { ...clone(evidence[0]), effectiveAt: '2027-01-15T13:00:00Z' };
    const result = assemble({ evidence: [otherSnapshotOrder, evidence[1], evidence[2]] });

    expect(result).toMatchObject({ status: 'MISSING_EVIDENCE', missingFactKinds: ['COMMERCIAL_ORDER'] });
  });
});

describe('Evidence Boundary v1 conflicts', () => {
  it.each([
    ['COMMERCIAL_ORDER', () => ({ ...clone(evidence[0]), evidenceId: 'ORDER-CONFLICT', payload: { ...evidence[0].payload, requestedQuantity: 501 } })],
    ['CLIENT_AUTHORIZATION', () => ({ ...clone(evidence[1]), evidenceId: 'AUTH-CONFLICT', payload: { authorization: { ...evidence[1].payload.authorization, maxSubstituteQuantity: 181 } } })],
    ['PHYSICAL_SUPPLY', () => ({ ...clone(evidence[2]), evidenceId: 'SUPPLY-CONFLICT', payload: { ...clone(evidence[2].payload), supplies: [{ ...evidence[2].payload.supplies[0], substituteQuantity: 149 }] } })],
  ] as const)('rejects disagreeing authoritative %s claims', (factKind, makeConflict) => {
    const conflict = makeConflict();
    const result = assemble({ evidence: [...evidence, conflict] });

    expect(result).toMatchObject({ status: 'CONFLICTING_EVIDENCE', issues: [{ factKind }] });
    expectNoCase(result);
  });

  it('does not use different observedAt values as a replacement rule', () => {
    const conflict = {
      ...clone(evidence[0]),
      evidenceId: 'ORDER-NEWER-OBSERVATION',
      observedAt: '2027-01-15T11:59:59Z',
      payload: { ...evidence[0].payload, requestedQuantity: 600 },
    };

    expect(assemble({ evidence: [...evidence, conflict] }).status).toBe('CONFLICTING_EVIDENCE');
  });
});

describe('Evidence Boundary v1 authority enforcement', () => {
  it.each([
    'COMMERCIAL_ORDER',
    'CLIENT_AUTHORIZATION',
    'PHYSICAL_SUPPLY',
  ] as const)('rejects an unauthorized %s claim even with authoritative evidence present', (factKind) => {
    const claim = evidence.find((item) => item.factKind === factKind)!;
    const unauthorized = { ...clone(claim), evidenceId: `UNAUTHORIZED-${factKind}`, sourceId: 'SOURCE-UNAUTHORIZED' };
    const result = assemble({ evidence: [...evidence, unauthorized] });

    expect(result).toMatchObject({ status: 'UNSUPPORTED_EVIDENCE', issues: [{ code: 'SOURCE_NOT_AUTHORITATIVE', factKind }] });
    expectNoCase(result);
  });

  it('rejects an unsupported source/fact combination', () => {
    const wrongAuthority = { ...clone(evidence[0]), sourceId: authorityPolicy.authorities.PHYSICAL_SUPPLY };
    expect(assemble({ evidence: [wrongAuthority, evidence[1], evidence[2]] }).status).toBe('UNSUPPORTED_EVIDENCE');
  });

  it('rejects unsupported fact kinds', () => {
    const unsupported = { ...clone(evidence[0]), evidenceId: 'EVIDENCE-UNKNOWN', factKind: 'PLAN_PROPOSAL' };
    expect(assemble({ evidence: [...evidence, unsupported] }).status).toBe('UNSUPPORTED_EVIDENCE');
  });

  it('rejects evidence belonging to another case', () => {
    const foreign = { ...clone(evidence[0]), caseId: 'CASE-OTHER' };
    expect(assemble({ evidence: [foreign, evidence[1], evidence[2]] }).status).toBe('UNSUPPORTED_EVIDENCE');
  });
});

describe('Evidence Boundary v1 identity and stable configuration integrity', () => {
  it('rejects malformed evidence without partial state', () => {
    const malformed = { ...clone(evidence[0]), observedAt: undefined };
    const result = assemble({ evidence: [malformed, evidence[1], evidence[2]] });
    expect(result.status).toBe('INVALID_EVIDENCE');
    expectNoCase(result);
  });

  it('rejects malformed stable configuration', () => {
    const malformed = { ...clone(baseline), status: 'NOT_A_CASE_STATUS' };
    expect(assemble({ baseline: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it('rejects malformed authority policy', () => {
    const malformed = { caseId: baseline.caseId, authorities: { COMMERCIAL_ORDER: 'SOURCE-COMMERCIAL' } };
    expect(assemble({ authorityPolicy: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it('rejects one evidenceId identifying different contents', () => {
    const collision = { ...clone(evidence[0]), payload: { ...evidence[0].payload, requestedQuantity: 999 } };
    expect(assemble({ evidence: [...evidence, collision] }).status).toBe('INVALID_EVIDENCE');
  });

  it('deduplicates an exact duplicate envelope and retains one provenance reference', () => {
    const result = expectAccepted(assemble({ evidence: [...evidence, clone(evidence[0])] }));
    expect(result.provenance.COMMERCIAL_ORDER).toHaveLength(1);
    expect(result.exceptionCase.requestedQuantity).toBe(500);
  });

  it('rejects duplicate actor IDs', () => {
    const malformed = clone(baseline) as unknown as { actors: Array<{ actorId: string }> };
    malformed.actors[1]!.actorId = malformed.actors[0]!.actorId;
    expect(assemble({ baseline: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it.each(['supplier', 'production', 'client'] as const)('rejects a baseline missing the %s role', (missingRole) => {
    const malformed = { ...clone(baseline), actors: baseline.actors.filter(({ role }) => role !== missingRole) };
    expect(assemble({ baseline: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it('rejects dynamic SUPPLY in the stable supplier baseline', () => {
    const malformed = clone(baseline) as unknown as { actors: Array<Record<string, unknown>> };
    const supplier = malformed.actors.find(({ role }) => role === 'supplier')!;
    supplier.staticConstraints = clone(evidence[2].payload.supplies);
    expect(assemble({ baseline: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it('rejects competing dynamic Client authorization in the baseline', () => {
    const malformed = clone(baseline) as unknown as { actors: Array<Record<string, unknown>> };
    const client = malformed.actors.find(({ role }) => role === 'client')!;
    client.staticAuthorization = clone(evidence[1].payload.authorization);
    expect(assemble({ baseline: malformed }).status).toBe('INVALID_EVIDENCE');
  });

  it('rejects physical evidence for a supplier other than the configured supplier', () => {
    const malformed = { ...clone(evidence[2]), payload: { ...clone(evidence[2].payload), supplierActorId: 'ACTOR-OTHER' } };
    expect(assemble({ evidence: [evidence[0], evidence[1], malformed] }).status).toBe('INVALID_EVIDENCE');
  });
});

describe('Evidence Boundary v1 temporal semantics', () => {
  it('accepts identical effective-instant text', () => {
    expect(assemble({ effectiveAt: EFFECTIVE_AT }).status).toBe('ACCEPTED');
  });

  it('does not match the same calendar day at a different instant', () => {
    expect(assemble({ effectiveAt: '2027-01-15T13:00:00Z' })).toMatchObject({ status: 'MISSING_EVIDENCE' });
  });

  it.each([
    ['malformed observedAt', { ...clone(evidence[0]), observedAt: 'not-an-instant' }],
    ['malformed effectiveAt', { ...clone(evidence[0]), effectiveAt: 'not-an-instant' }],
  ])('rejects %s', (_label, malformed) => {
    expect(assemble({ evidence: [malformed, evidence[1], evidence[2]] }).status).toBe('INVALID_EVIDENCE');
  });

  it('does not let another effective instant conflict with or replace the requested snapshot', () => {
    const other = {
      ...clone(evidence[0]),
      evidenceId: 'ORDER-OTHER-SNAPSHOT',
      effectiveAt: '2027-01-16T12:00:00Z',
      payload: { ...evidence[0].payload, requestedQuantity: 999 },
    };
    const result = expectAccepted(assemble({ evidence: [...evidence, other] }));
    expect(result.exceptionCase.requestedQuantity).toBe(500);
    expect(result.provenance.COMMERCIAL_ORDER).toHaveLength(1);
  });
});

describe('Product Proof v2 evidence-boundary semantics', () => {
  it('H01 accepts independently supplied commercial, authorization, and physical facts', () => {
    const result = expectAccepted(assemble());
    const client = result.exceptionCase.actors.find(({ role }) => role === 'client')!;
    const supplier = result.exceptionCase.actors.find(({ role }) => role === 'supplier')!;

    expect(result.exceptionCase.requestedQuantity).toBe(500);
    expect(client.authorization.maxSubstituteQuantity).toBe(180);
    expect(supplier.constraints).toEqual(evidence[2].payload.supplies);
  });

  it('H02 accepts authorization 180 and physical supply 100 as facts without classifying a plan', () => {
    const supply100 = {
      ...clone(evidence[2]),
      payload: {
        ...clone(evidence[2].payload),
        supplies: [{ ...evidence[2].payload.supplies[0], originalQuantity: 0, substituteQuantity: 100 }],
      },
    };
    const result = expectAccepted(assemble({ evidence: [evidence[0], evidence[1], supply100] }));
    const supplier = result.exceptionCase.actors.find(({ role }) => role === 'supplier')!;

    expect(result.exceptionCase.actors.find(({ role }) => role === 'client')!.authorization.maxSubstituteQuantity).toBe(180);
    expect(supplier.constraints[0]).toMatchObject({ type: 'SUPPLY', substituteQuantity: 100 });
    expect(JSON.stringify(result)).not.toMatch(/PHYSICALLY_|PLAN_(VALID|INVALID)/);
  });

  it('H03 returns MISSING_EVIDENCE and emits no case when physical evidence is absent', () => {
    const result = assemble({ evidence: [evidence[0], evidence[1]] });
    expect(result).toMatchObject({ status: 'MISSING_EVIDENCE', missingFactKinds: ['PHYSICAL_SUPPLY'] });
    expectNoCase(result);
  });

  it('H03 returns CONFLICTING_EVIDENCE and emits no case when physical claims disagree', () => {
    const conflicting = {
      ...clone(evidence[2]),
      evidenceId: 'SUPPLY-H03-CONFLICT',
      payload: { ...clone(evidence[2].payload), supplies: [{ ...evidence[2].payload.supplies[0], substituteQuantity: 100 }] },
    };
    const result = assemble({ evidence: [...evidence, conflicting] });
    expect(result).toMatchObject({ status: 'CONFLICTING_EVIDENCE', issues: [{ factKind: 'PHYSICAL_SUPPLY' }] });
    expectNoCase(result);
  });
});

describe('Evidence Boundary v1 purity and determinism', () => {
  it('does not mutate deeply frozen inputs and is deterministic', () => {
    const frozenBaseline = deepFreeze(clone(baseline));
    const frozenPolicy = deepFreeze(clone(authorityPolicy));
    const frozenEvidence = deepFreeze(clone(evidence));
    const before = JSON.stringify({ frozenBaseline, frozenPolicy, frozenEvidence });

    const first = assembleTrustedOperationalState({ effectiveAt: EFFECTIVE_AT, baseline: frozenBaseline, authorityPolicy: frozenPolicy, evidence: frozenEvidence });
    const second = assembleTrustedOperationalState({ effectiveAt: EFFECTIVE_AT, baseline: frozenBaseline, authorityPolicy: frozenPolicy, evidence: frozenEvidence });

    expect(first).toEqual(second);
    expect(JSON.stringify({ frozenBaseline, frozenPolicy, frozenEvidence })).toBe(before);
    expect(JSON.stringify(first)).not.toMatch(/UUID|Date\.now|random/i);
  });
});

import { describe, expect, it } from 'vitest';

import { case001Plan001 } from '../../src/domain/case-001.simulation.js';
import { planIdSchema } from '../../src/domain/schemas.js';
import {
  createPlanLineage,
  createSuccessorPlan,
  getCurrentPlan,
  isPlanCurrent,
  validatePlanDecisionFreshness,
  validatePlanLineageCollection,
  type PlanLineage,
} from '../../src/domain/planLineage.js';
import type { Plan, PlanStatus } from '../../src/domain/types.js';

const id = (value: string) => planIdSchema.parse(value);
const plan = (planId: string, version: number, status: PlanStatus = 'PENDING_APPROVAL'): Plan => ({
  ...structuredClone(case001Plan001), id: id(planId), version, status,
});
const lineage = (lineageId: string, ...planIds: string[]): PlanLineage => ({
  lineageId, caseId: case001Plan001.caseId,
  planIds: planIds.map(id) as [Plan['id'], ...Plan['id'][]],
});
const changes = (status: PlanStatus = 'PENDING_APPROVAL') => ({ status });

describe('plan lineage collection validation', () => {
  it.each([
    ['duplicate lineage ID', [lineage('L', 'A'), lineage('L', 'B')], [plan('A', 1), plan('B', 1)]],
    ['one plan in two lineages', [lineage('L1', 'A'), lineage('L2', 'A')], [plan('A', 1)]],
    ['a missing referenced plan', [lineage('L', 'MISSING')], []],
    ['a repeated plan inside a lineage', [lineage('L', 'A', 'A')], [plan('A', 1)]],
    ['skipped versions', [lineage('L', 'A', 'B')], [plan('A', 1), plan('B', 3)]],
    ['repeated versions', [lineage('L', 'A', 'B')], [plan('A', 1), plan('B', 1)]],
  ])('rejects %s', (_name, lineages, plans) => {
    expect(validatePlanLineageCollection(lineages, plans).valid).toBe(false);
  });

  it('rejects empty IDs, empty lineages, wrong cases, and duplicate plan records globally', () => {
    const otherCase = { ...plan('B', 2), caseId: id('OTHER') as never };
    expect(validatePlanLineageCollection([{ ...lineage('L', 'A'), lineageId: '' }], [plan('A', 1)]).valid).toBe(false);
    expect(validatePlanLineageCollection([{ lineageId: 'L', caseId: case001Plan001.caseId, planIds: [] as never }], []).valid).toBe(false);
    expect(validatePlanLineageCollection([lineage('L', 'A', 'B')], [plan('A', 1), otherCase]).valid).toBe(false);
    expect(validatePlanLineageCollection([], [plan('A', 1), plan('A', 1)]).valid).toBe(false);
  });
});

describe('lineage mutations', () => {
  it('creates a collection-owned lineage, derives its case, and preserves inputs', () => {
    const plans = Object.freeze([Object.freeze(plan('A', 1))]);
    const lineages = Object.freeze([] as PlanLineage[]);
    const result = createPlanLineage(lineages, plans, 'L', id('A'));
    expect(result).toMatchObject({ success: true, lineage: { lineageId: 'L', planIds: [id('A')] } });
    if (!result.success) return;
    expect(result.lineage.caseId).toBe(plans[0]!.caseId);
    expect(result.lineages.at(-1)).toBe(result.lineage);
    expect(lineages).toEqual([]);
    expect(plans[0]!.status).toBe('PENDING_APPROVAL');
  });

  it('rejects duplicate lineage IDs and plans already assigned', () => {
    const plans = [plan('A', 1), plan('B', 1)];
    const existing = [lineage('L', 'A')];
    expect(createPlanLineage(existing, plans, 'L', id('B'))).toMatchObject({ success: false, reason: 'LINEAGE_ID_ALREADY_EXISTS' });
    expect(createPlanLineage(existing, plans, 'L2', id('A'))).toMatchObject({ success: false, reason: 'PLAN_ALREADY_ASSIGNED' });
  });

  it.each([
    ['DRAFT', 'INVALIDATED'],
    ['PENDING_APPROVAL', 'INVALIDATED'],
    ['REJECTED', 'REJECTED'],
    ['NO_SOLUTION', 'NO_SOLUTION'],
  ] as const)('creates a successor from %s and leaves predecessor %s', (status, historicalStatus) => {
    const original = Object.freeze(plan('A', 1, status));
    const lineages = Object.freeze([Object.freeze(lineage('L', 'A'))]);
    const plans = Object.freeze([original]);
    const first = createSuccessorPlan('L', lineages, plans, id('A'), id('B'), changes());
    expect(first).toMatchObject({ success: true, plan: { id: id('B'), version: 2 }, lineage: { planIds: [id('A'), id('B')] } });
    if (!first.success) return;
    expect(first.plans.find(({ id: planId }) => planId === id('A'))?.status).toBe(historicalStatus);
    expect(first.lineages.find(({ lineageId }) => lineageId === 'L')).toBe(first.lineage);
    expect(original.status).toBe(status);
    expect(lineages[0]!.planIds).toEqual([id('A')]);
  });

  it.each(['INVALIDATED', 'APPROVED'] as const)('rejects a successor from %s', (status) => {
    expect(createSuccessorPlan('L', [lineage('L', 'A')], [plan('A', 1, status)], id('A'), id('B'), changes()))
      .toMatchObject({ success: false, reason: 'PREDECESSOR_STATUS_NOT_ELIGIBLE' });
  });

  it('rejects a stale predecessor, a second successor attempt, and reused IDs', () => {
    const first = createSuccessorPlan('L', [lineage('L', 'A')], [plan('A', 1)], id('A'), id('B'), changes());
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(createSuccessorPlan('L', first.lineages, first.plans, id('A'), id('C'), changes())).toMatchObject({ success: false, reason: 'PLAN_SUPERSEDED' });
    expect(createSuccessorPlan('L', first.lineages, first.plans, id('B'), id('A'), changes())).toMatchObject({ success: false, reason: 'PLAN_ID_ALREADY_EXISTS' });
  });

  it('is deterministic and rejects a caller-requested wrong version change', () => {
    const args = ['L', [lineage('L', 'A')], [plan('A', 1)], id('A'), id('B'), { version: 99 } as never] as const;
    expect(createSuccessorPlan(...args)).toEqual(createSuccessorPlan(...args));
    const result = createSuccessorPlan(...args);
    expect(result).toMatchObject({ success: true, plan: { version: 2 } });
  });
});

describe('plan decision freshness', () => {
  const plans = [plan('A', 1, 'REJECTED'), plan('B', 2, 'NO_SOLUTION')];
  const lineages = [lineage('L', 'A', 'B')];

  it('uses the lineage tip, not the numerically highest unassigned plan', () => {
    const higher = plan('Z', 99);
    expect(getCurrentPlan(lineages[0]!, [...plans, higher])?.id).toBe(id('B'));
    expect(isPlanCurrent(lineages[0]!, id('B'))).toBe(true);
    expect(validatePlanDecisionFreshness(lineages, [...plans, higher], plans[0]!.caseId, id('B'))).toMatchObject({ valid: true });
    expect(validatePlanDecisionFreshness(lineages, [...plans, higher], plans[0]!.caseId, id('Z'))).toMatchObject({ valid: false, reason: 'PLAN_LINEAGE_NOT_FOUND' });
  });

  it('rejects superseded, missing, ambiguous, invalid, and case-mismatched targets', () => {
    expect(validatePlanDecisionFreshness(lineages, plans, plans[0]!.caseId, id('A'))).toMatchObject({ valid: false, reason: 'PLAN_SUPERSEDED' });
    expect(validatePlanDecisionFreshness(lineages, plans, plans[0]!.caseId, id('X'))).toMatchObject({ valid: false, reason: 'PLAN_NOT_FOUND' });
    expect(validatePlanDecisionFreshness([...lineages, lineage('L2', 'B')], plans, plans[0]!.caseId, id('B'))).toMatchObject({ valid: false, reason: 'PLAN_LINEAGE_AMBIGUOUS' });
    expect(validatePlanDecisionFreshness([lineage('L', 'A', 'B')], [plan('A', 1), plan('B', 3)], plans[0]!.caseId, id('B'))).toMatchObject({ valid: false, reason: 'PLAN_LINEAGE_INVALID' });
    expect(validatePlanDecisionFreshness(lineages, plans, id('OTHER') as never, id('B'))).toMatchObject({ valid: false, reason: 'PLAN_LINEAGE_CASE_MISMATCH' });
  });
});

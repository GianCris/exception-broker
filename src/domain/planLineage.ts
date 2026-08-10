import type { CaseId, Plan, PlanId, PlanStatus } from './types.js';
import {
  createPlanVersion,
  invalidatePreviousPlan,
  type PlanConditionChanges,
} from './versioning.js';

export type PlanLineageId = string;

export type PlanLineage = Readonly<{
  lineageId: PlanLineageId;
  caseId: CaseId;
  planIds: readonly [PlanId, ...PlanId[]];
}>;

export type PlanLineageCollectionIssue = Readonly<{
  code:
    | 'DUPLICATE_PLAN_ID'
    | 'EMPTY_LINEAGE_ID'
    | 'DUPLICATE_LINEAGE_ID'
    | 'EMPTY_LINEAGE'
    | 'DUPLICATE_PLAN_IN_LINEAGE'
    | 'PLAN_NOT_FOUND'
    | 'PLAN_CASE_MISMATCH'
    | 'PLAN_VERSION_NOT_CONSECUTIVE'
    | 'PLAN_LINEAGE_AMBIGUOUS';
  message: string;
}>;

export type PlanLineageCollectionValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; issues: readonly PlanLineageCollectionIssue[] }>;

export const validatePlanLineageCollection = (
  lineages: readonly PlanLineage[],
  plans: readonly Plan[],
): PlanLineageCollectionValidation => {
  const issues: PlanLineageCollectionIssue[] = [];
  const plansById = new Map<PlanId, Plan>();
  const duplicatePlanIds = new Set<PlanId>();

  for (const plan of plans) {
    if (plansById.has(plan.id)) duplicatePlanIds.add(plan.id);
    else plansById.set(plan.id, plan);
  }
  for (const planId of duplicatePlanIds) {
    issues.push({ code: 'DUPLICATE_PLAN_ID', message: `Plan ID ${planId} is duplicated` });
  }

  const lineageIds = new Set<string>();
  const memberships = new Map<PlanId, string>();
  for (const lineage of lineages) {
    if (typeof lineage.lineageId !== 'string' || lineage.lineageId.trim() === '') {
      issues.push({ code: 'EMPTY_LINEAGE_ID', message: 'Lineage ID must be non-empty' });
    } else if (lineageIds.has(lineage.lineageId)) {
      issues.push({ code: 'DUPLICATE_LINEAGE_ID', message: `Lineage ID ${lineage.lineageId} is duplicated` });
    } else lineageIds.add(lineage.lineageId);

    if (!Array.isArray(lineage.planIds) || lineage.planIds.length === 0) {
      issues.push({ code: 'EMPTY_LINEAGE', message: `Lineage ${lineage.lineageId} has no plans` });
      continue;
    }

    const localIds = new Set<PlanId>();
    let previous: Plan | undefined;
    for (const planId of lineage.planIds) {
      if (localIds.has(planId)) {
        issues.push({ code: 'DUPLICATE_PLAN_IN_LINEAGE', message: `Plan ${planId} repeats in lineage ${lineage.lineageId}` });
      }
      localIds.add(planId);

      const priorMembership = memberships.get(planId);
      if (priorMembership !== undefined && priorMembership !== lineage.lineageId) {
        issues.push({ code: 'PLAN_LINEAGE_AMBIGUOUS', message: `Plan ${planId} belongs to multiple lineages` });
      } else memberships.set(planId, lineage.lineageId);

      const plan = duplicatePlanIds.has(planId) ? undefined : plansById.get(planId);
      if (plan === undefined) {
        issues.push({ code: 'PLAN_NOT_FOUND', message: `Plan ${planId} cannot be resolved uniquely` });
        previous = undefined;
        continue;
      }
      if (plan.caseId !== lineage.caseId) {
        issues.push({ code: 'PLAN_CASE_MISMATCH', message: `Plan ${planId} belongs to a different case` });
      }
      if (previous !== undefined && plan.version !== previous.version + 1) {
        issues.push({ code: 'PLAN_VERSION_NOT_CONSECUTIVE', message: `Plan ${planId} does not follow the preceding version` });
      }
      previous = plan;
    }
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
};

export const getCurrentPlan = (lineage: PlanLineage, plans: readonly Plan[]): Plan | undefined => {
  const currentId = lineage.planIds[lineage.planIds.length - 1];
  const matches = plans.filter(({ id }) => id === currentId);
  return matches.length === 1 ? matches[0] : undefined;
};

export const isPlanCurrent = (lineage: PlanLineage, planId: PlanId): boolean =>
  lineage.planIds[lineage.planIds.length - 1] === planId;

type MutationFailure = Readonly<{ success: false; reason: string; issues?: readonly string[] }>;

export type CreatePlanLineageResult =
  | Readonly<{ success: true; lineage: PlanLineage; lineages: readonly PlanLineage[] }>
  | MutationFailure;

const validationFailure = (validation: Extract<PlanLineageCollectionValidation, { valid: false }>): MutationFailure => ({
  success: false,
  reason: 'PLAN_LINEAGE_COLLECTION_INVALID',
  issues: validation.issues.map(({ code, message }) => `${code}: ${message}`),
});

export const createPlanLineage = (
  lineages: readonly PlanLineage[],
  plans: readonly Plan[],
  lineageId: PlanLineageId,
  initialPlanId: PlanId,
): CreatePlanLineageResult => {
  const validation = validatePlanLineageCollection(lineages, plans);
  if (!validation.valid) return validationFailure(validation);
  if (typeof lineageId !== 'string' || lineageId.trim() === '') return { success: false, reason: 'LINEAGE_ID_REQUIRED' };
  if (lineages.some((item) => item.lineageId === lineageId)) return { success: false, reason: 'LINEAGE_ID_ALREADY_EXISTS' };
  const matches = plans.filter(({ id }) => id === initialPlanId);
  if (matches.length !== 1) return { success: false, reason: matches.length === 0 ? 'PLAN_NOT_FOUND' : 'PLAN_AMBIGUOUS' };
  if (lineages.some(({ planIds }) => planIds.includes(initialPlanId))) return { success: false, reason: 'PLAN_ALREADY_ASSIGNED' };

  const lineage: PlanLineage = { lineageId, caseId: matches[0]!.caseId, planIds: [initialPlanId] };
  const updated = [...lineages, lineage];
  const finalValidation = validatePlanLineageCollection(updated, plans);
  return finalValidation.valid ? { success: true, lineage, lineages: updated } : validationFailure(finalValidation);
};

const successorEligibleStatuses: readonly PlanStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'NO_SOLUTION'];

export type CreateSuccessorPlanResult =
  | Readonly<{ success: true; plan: Plan; lineage: PlanLineage; plans: readonly Plan[]; lineages: readonly PlanLineage[] }>
  | MutationFailure;

export const createSuccessorPlan = (
  lineageId: PlanLineageId,
  lineages: readonly PlanLineage[],
  plans: readonly Plan[],
  predecessorPlanId: PlanId,
  newPlanId: PlanId,
  changes: PlanConditionChanges,
): CreateSuccessorPlanResult => {
  const validation = validatePlanLineageCollection(lineages, plans);
  if (!validation.valid) return validationFailure(validation);
  const lineageMatches = lineages.filter((item) => item.lineageId === lineageId);
  if (lineageMatches.length !== 1) return { success: false, reason: lineageMatches.length === 0 ? 'PLAN_LINEAGE_NOT_FOUND' : 'PLAN_LINEAGE_AMBIGUOUS' };
  const lineage = lineageMatches[0]!;
  const predecessorMatches = plans.filter(({ id }) => id === predecessorPlanId);
  if (predecessorMatches.length !== 1) return { success: false, reason: predecessorMatches.length === 0 ? 'PLAN_NOT_FOUND' : 'PLAN_AMBIGUOUS' };
  if (!lineage.planIds.includes(predecessorPlanId)) return { success: false, reason: 'PLAN_NOT_IN_LINEAGE' };
  if (!isPlanCurrent(lineage, predecessorPlanId)) return { success: false, reason: 'PLAN_SUPERSEDED' };
  const predecessor = predecessorMatches[0]!;
  if (!successorEligibleStatuses.includes(predecessor.status)) return { success: false, reason: 'PREDECESSOR_STATUS_NOT_ELIGIBLE' };
  if (plans.some(({ id }) => id === newPlanId)) return { success: false, reason: 'PLAN_ID_ALREADY_EXISTS' };

  const created = createPlanVersion(predecessor, newPlanId, changes);
  if (!created.success) return created;
  if (created.plan.version !== predecessor.version + 1) return { success: false, reason: 'PLAN_VERSION_NOT_CONSECUTIVE' };
  const historicalPredecessor = predecessor.status === 'DRAFT' || predecessor.status === 'PENDING_APPROVAL'
    ? invalidatePreviousPlan(predecessor)
    : predecessor;
  const updatedPlans = plans.map((item) => item.id === predecessor.id ? historicalPredecessor : item).concat(created.plan);
  const updatedLineage: PlanLineage = { ...lineage, planIds: [...lineage.planIds, created.plan.id] as [PlanId, ...PlanId[]] };
  const updatedLineages = lineages.map((item) => item === lineage ? updatedLineage : item);
  const finalValidation = validatePlanLineageCollection(updatedLineages, updatedPlans);
  return finalValidation.valid
    ? { success: true, plan: created.plan, lineage: updatedLineage, plans: updatedPlans, lineages: updatedLineages }
    : validationFailure(finalValidation);
};

export type PlanDecisionFreshnessFailure =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_LINEAGE_NOT_FOUND'
  | 'PLAN_LINEAGE_AMBIGUOUS'
  | 'PLAN_LINEAGE_INVALID'
  | 'PLAN_LINEAGE_CASE_MISMATCH'
  | 'PLAN_SUPERSEDED';

export type PlanDecisionFreshnessResult =
  | Readonly<{ valid: true; lineage: PlanLineage; plan: Plan }>
  | Readonly<{ valid: false; reason: PlanDecisionFreshnessFailure; issues?: readonly string[] }>;

export const validatePlanDecisionFreshness = (
  lineages: readonly PlanLineage[],
  plans: readonly Plan[],
  caseId: CaseId,
  planId: PlanId,
): PlanDecisionFreshnessResult => {
  const validation = validatePlanLineageCollection(lineages, plans);
  if (!validation.valid) {
    const ambiguous = validation.issues.some(({ code }) => code === 'PLAN_LINEAGE_AMBIGUOUS');
    return { valid: false, reason: ambiguous ? 'PLAN_LINEAGE_AMBIGUOUS' : 'PLAN_LINEAGE_INVALID', issues: validation.issues.map(({ code, message }) => `${code}: ${message}`) };
  }
  const plan = plans.find(({ id }) => id === planId);
  if (plan === undefined) return { valid: false, reason: 'PLAN_NOT_FOUND' };
  const memberships = lineages.filter(({ planIds }) => planIds.includes(planId));
  if (memberships.length === 0) return { valid: false, reason: 'PLAN_LINEAGE_NOT_FOUND' };
  if (memberships.length > 1) return { valid: false, reason: 'PLAN_LINEAGE_AMBIGUOUS' };
  const lineage = memberships[0]!;
  if (lineage.caseId !== caseId || plan.caseId !== caseId) return { valid: false, reason: 'PLAN_LINEAGE_CASE_MISMATCH' };
  if (!isPlanCurrent(lineage, planId)) return { valid: false, reason: 'PLAN_SUPERSEDED' };
  return { valid: true, lineage, plan };
};

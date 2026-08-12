import { classifyPlanValidation, type PlanAssessment } from './outcomes.js';
import {
  createPlanLineage,
  validatePlanLineageCollection,
  type PlanLineage,
  type PlanLineageId,
} from './planLineage.js';
import {
  assessPhysicalFeasibility,
  type PhysicalFeasibilityAssessment,
} from './physicalFeasibility.js';
import { exceptionCaseSchema, planSchema } from './schemas.js';
import type { ExceptionCase, Plan } from './types.js';
import { validatePlan } from './validator.js';

export type PlanRegistrationFailureReason =
  | 'EXCEPTION_CASE_INVALID'
  | 'PLAN_SCHEMA_INVALID'
  | 'PLAN_CASE_MISMATCH'
  | 'PLAN_ID_ALREADY_EXISTS'
  | 'PLAN_ALREADY_ASSIGNED'
  | 'LINEAGE_ID_REQUIRED'
  | 'LINEAGE_ID_ALREADY_EXISTS'
  | 'EXISTING_COLLECTION_INVALID'
  | 'INITIAL_PLAN_VERSION_UNSUPPORTED'
  | 'INITIAL_PLAN_STATUS_UNSUPPORTED'
  | 'PLAN_ASSESSMENT_INTEGRITY_FAILURE'
  | 'REGISTRATION_INTEGRITY_FAILURE';

export type PlanRegistrationAssessment = Readonly<{
  planAssessment: PlanAssessment;
  physicalFeasibilityAssessment: PhysicalFeasibilityAssessment;
}>;

export type RegisterInitialPlanProposalResult =
  | Readonly<{
      success: true;
      plan: Plan;
      lineage: PlanLineage;
      plans: readonly Plan[];
      lineages: readonly PlanLineage[];
      assessment: PlanRegistrationAssessment;
    }>
  | Readonly<{
      success: false;
      reason: PlanRegistrationFailureReason;
      issues?: readonly string[];
    }>;

const collectionIssues = (
  validation: Extract<ReturnType<typeof validatePlanLineageCollection>, { valid: false }>,
): readonly string[] => validation.issues.map(({ code, message }) => `${code}: ${message}`);

export const registerInitialPlanProposal = (
  exceptionCase: ExceptionCase,
  lineages: readonly PlanLineage[],
  plans: readonly Plan[],
  lineageId: PlanLineageId,
  proposal: unknown,
): RegisterInitialPlanProposalResult => {
  const parsedCase = exceptionCaseSchema.safeParse(exceptionCase);
  if (!parsedCase.success) {
    return { success: false, reason: 'EXCEPTION_CASE_INVALID', issues: parsedCase.error.issues.map(({ message }) => message) };
  }

  const existing = validatePlanLineageCollection(lineages, plans);
  if (!existing.valid) {
    return { success: false, reason: 'EXISTING_COLLECTION_INVALID', issues: collectionIssues(existing) };
  }

  const parsedPlan = planSchema.safeParse(proposal);
  if (!parsedPlan.success) {
    return { success: false, reason: 'PLAN_SCHEMA_INVALID', issues: parsedPlan.error.issues.map(({ message }) => message) };
  }
  if (typeof proposal !== 'object' || proposal === null
    || !('id' in proposal) || proposal.id !== parsedPlan.data.id
    || !('caseId' in proposal) || proposal.caseId !== parsedPlan.data.caseId) {
    return { success: false, reason: 'PLAN_SCHEMA_INVALID', issues: ['Plan identity must already be canonical'] };
  }
  const plan = parsedPlan.data;

  if (plan.caseId !== parsedCase.data.id) return { success: false, reason: 'PLAN_CASE_MISMATCH' };
  if (typeof lineageId !== 'string' || lineageId.trim() === '') return { success: false, reason: 'LINEAGE_ID_REQUIRED' };
  if (lineages.some(({ lineageId: existingId }) => existingId === lineageId)) {
    return { success: false, reason: 'LINEAGE_ID_ALREADY_EXISTS' };
  }
  if (lineages.some(({ planIds }) => planIds.includes(plan.id))) {
    return { success: false, reason: 'PLAN_ALREADY_ASSIGNED' };
  }
  if (plans.some(({ id }) => id === plan.id)) return { success: false, reason: 'PLAN_ID_ALREADY_EXISTS' };
  if (plan.version !== 1) return { success: false, reason: 'INITIAL_PLAN_VERSION_UNSUPPORTED' };
  if (plan.status !== 'DRAFT' && plan.status !== 'PENDING_APPROVAL') {
    return { success: false, reason: 'INITIAL_PLAN_STATUS_UNSUPPORTED' };
  }

  let planAssessment: ReturnType<typeof classifyPlanValidation>;
  let physicalFeasibilityAssessment: PhysicalFeasibilityAssessment;
  try {
    planAssessment = classifyPlanValidation(plan.id, validatePlan(parsedCase.data, plan));
    physicalFeasibilityAssessment = assessPhysicalFeasibility(parsedCase.data, plan);
  } catch {
    return { success: false, reason: 'PLAN_ASSESSMENT_INTEGRITY_FAILURE' };
  }
  if (!planAssessment.success) {
    return { success: false, reason: 'PLAN_ASSESSMENT_INTEGRITY_FAILURE', issues: [planAssessment.reason] };
  }

  const updatedPlans = [...plans, plan];
  const createdLineage = createPlanLineage(lineages, updatedPlans, lineageId, plan.id);
  if (!createdLineage.success) {
    return { success: false, reason: 'REGISTRATION_INTEGRITY_FAILURE', issues: [createdLineage.reason, ...(createdLineage.issues ?? [])] };
  }
  const finalValidation = validatePlanLineageCollection(createdLineage.lineages, updatedPlans);
  if (!finalValidation.valid) {
    return { success: false, reason: 'REGISTRATION_INTEGRITY_FAILURE', issues: collectionIssues(finalValidation) };
  }

  return {
    success: true,
    plan,
    lineage: createdLineage.lineage,
    plans: updatedPlans,
    lineages: createdLineage.lineages,
    assessment: {
      planAssessment: planAssessment.assessment,
      physicalFeasibilityAssessment,
    },
  };
};

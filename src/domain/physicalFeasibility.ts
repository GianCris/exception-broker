import { compareIsoInstants, sameIsoInstant } from './dateTime.js';
import { exceptionCaseSchema, planSchema } from './schemas.js';
import type { ActorId, CaseId, ExceptionCase, Plan } from './types.js';

export type PhysicalQuantityType = 'ORIGINAL' | 'SUBSTITUTE';
export type PhysicalPlanField =
  | 'originalQuantityTomorrow'
  | 'substituteQuantityTomorrow'
  | 'originalQuantityLater';

export type PhysicalFeasibilityCode =
  | 'PHYSICAL_SUPPLY_MISSING'
  | 'PHYSICAL_SUPPLY_AMBIGUOUS'
  | 'PHYSICAL_SUPPLY_STATE_INVALID'
  | 'PHYSICAL_PLAN_STATE_INVALID'
  | 'EARLIER_SUPPLY_REQUIRES_RESERVATION_EVIDENCE'
  | 'SUPPLY_COMPONENT_REUSE_REQUIRED'
  | 'ORIGINAL_SUPPLY_EXCEEDED'
  | 'SUBSTITUTE_SUPPLY_EXCEEDED'
  | 'SUPPLY_AVAILABLE_TOO_LATE';

export type PhysicalFeasibilityDetail = Readonly<{
  code: PhysicalFeasibilityCode;
  caseId?: CaseId;
  supplierActorId?: ActorId;
  planField?: PhysicalPlanField;
  quantityType?: PhysicalQuantityType;
  requiredQuantity?: number;
  availableQuantity?: number;
  requiredInstant?: string;
  availableInstant?: string;
}>;

export type PhysicalRequirementCheck = Readonly<{
  caseId: CaseId;
  supplierActorId: ActorId;
  planField: PhysicalPlanField;
  quantityType: PhysicalQuantityType;
  requiredQuantity: number;
  availableQuantity: number;
  requiredInstant: string;
  availableInstant: string;
}>;

export type PhysicalFeasibilityAssessment =
  | Readonly<{ outcome: 'PHYSICALLY_FEASIBLE'; checks: readonly PhysicalRequirementCheck[] }>
  | Readonly<{ outcome: 'PHYSICALLY_INFEASIBLE'; violations: readonly PhysicalFeasibilityDetail[] }>
  | Readonly<{ outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN'; issues: readonly PhysicalFeasibilityDetail[] }>;

type Requirement = Readonly<{
  planField: PhysicalPlanField;
  quantityType: PhysicalQuantityType;
  requiredQuantity: number;
  requiredInstant: string;
}>;

export const assessPhysicalFeasibility = (
  exceptionCase: ExceptionCase,
  plan: Plan,
): PhysicalFeasibilityAssessment => {
  const parsedCase = exceptionCaseSchema.safeParse(exceptionCase);
  if (!parsedCase.success) return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_SUPPLY_STATE_INVALID' }] };
  const parsedPlan = planSchema.safeParse(plan);
  if (!parsedPlan.success) return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_PLAN_STATE_INVALID', caseId: parsedCase.data.id }] };
  if (parsedPlan.data.caseId !== parsedCase.data.id) return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_PLAN_STATE_INVALID', caseId: parsedCase.data.id }] };

  const supplier = parsedCase.data.actors.find(({ role }) => role === 'supplier');
  if (supplier === undefined) return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{ code: 'PHYSICAL_SUPPLY_STATE_INVALID', caseId: parsedCase.data.id }] };
  const supplies = supplier.constraints.filter((constraint) => constraint.type === 'SUPPLY');
  const requirements: Requirement[] = [
    { planField: 'originalQuantityTomorrow', quantityType: 'ORIGINAL', requiredQuantity: parsedPlan.data.originalQuantityTomorrow, requiredInstant: parsedCase.data.targetDeliveryDate },
    { planField: 'substituteQuantityTomorrow', quantityType: 'SUBSTITUTE', requiredQuantity: parsedPlan.data.substituteQuantityTomorrow, requiredInstant: parsedCase.data.targetDeliveryDate },
    { planField: 'originalQuantityLater', quantityType: 'ORIGINAL', requiredQuantity: parsedPlan.data.originalQuantityLater, requiredInstant: parsedPlan.data.laterDeliveryDate },
  ].filter(({ requiredQuantity }) => requiredQuantity > 0) as Requirement[];

  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index]!;
    if (requirements.slice(index + 1).some((candidate) =>
      candidate.quantityType === requirement.quantityType
      && sameIsoInstant(candidate.requiredInstant, requirement.requiredInstant))) {
      return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues: [{
        code: 'SUPPLY_COMPONENT_REUSE_REQUIRED', caseId: parsedCase.data.id,
        supplierActorId: supplier.id, planField: requirement.planField,
        quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity,
        requiredInstant: requirement.requiredInstant,
      }] };
    }
  }

  const checks: PhysicalRequirementCheck[] = [];
  const violations: PhysicalFeasibilityDetail[] = [];
  const issues: PhysicalFeasibilityDetail[] = [];

  for (const requirement of requirements) {
    const quantity = (supply: (typeof supplies)[number]): number => requirement.quantityType === 'ORIGINAL'
      ? supply.originalQuantity
      : supply.substituteQuantity;
    const relevant = supplies.filter((supply) => quantity(supply) > 0);
    const dated = relevant.map((supply) => ({ supply, comparison: compareIsoInstants(supply.deliveryDate, requirement.requiredInstant) }));
    if (dated.some(({ comparison }) => !comparison.valid)) {
      issues.push({ code: 'PHYSICAL_SUPPLY_STATE_INVALID', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant });
      continue;
    }
    const exact = dated.filter(({ comparison }) => comparison.valid && comparison.order === 0);
    if (exact.length > 1) {
      issues.push({ code: 'PHYSICAL_SUPPLY_AMBIGUOUS', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant });
      continue;
    }
    if (exact.length === 0) {
      const earlier = dated.filter(({ comparison }) => comparison.valid && comparison.order < 0);
      const later = dated.filter(({ comparison }) => comparison.valid && comparison.order > 0);
      if (earlier.length === 1) {
        issues.push({ code: 'EARLIER_SUPPLY_REQUIRES_RESERVATION_EVIDENCE', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant, availableInstant: earlier[0]!.supply.deliveryDate });
      } else if (earlier.length > 1) {
        issues.push({ code: 'PHYSICAL_SUPPLY_AMBIGUOUS', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant });
      } else if (later.length === 1) {
        violations.push({ code: 'SUPPLY_AVAILABLE_TOO_LATE', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, availableQuantity: quantity(later[0]!.supply), requiredInstant: requirement.requiredInstant, availableInstant: later[0]!.supply.deliveryDate });
      } else if (later.length > 1) {
        issues.push({ code: 'PHYSICAL_SUPPLY_AMBIGUOUS', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant });
      } else {
        issues.push({ code: 'PHYSICAL_SUPPLY_MISSING', caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, requiredInstant: requirement.requiredInstant });
      }
      continue;
    }
    const matched = exact[0]!.supply;
    const availableQuantity = quantity(matched);
    const detail = { caseId: parsedCase.data.id, supplierActorId: supplier.id, planField: requirement.planField, quantityType: requirement.quantityType, requiredQuantity: requirement.requiredQuantity, availableQuantity, requiredInstant: requirement.requiredInstant, availableInstant: matched.deliveryDate } as const;
    if (availableQuantity < requirement.requiredQuantity) {
      violations.push({ ...detail, code: requirement.quantityType === 'ORIGINAL' ? 'ORIGINAL_SUPPLY_EXCEEDED' : 'SUBSTITUTE_SUPPLY_EXCEEDED' });
    } else checks.push(detail);
  }

  if (issues.length > 0) return { outcome: 'PHYSICAL_FEASIBILITY_UNPROVEN', issues };
  if (violations.length > 0) return { outcome: 'PHYSICALLY_INFEASIBLE', violations };
  return { outcome: 'PHYSICALLY_FEASIBLE', checks };
};

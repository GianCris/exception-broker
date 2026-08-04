import { planSchema } from './schemas.js';
import type { Plan, PlanId } from './types.js';

export type PlanConditionChanges = Readonly<
  Partial<
    Pick<
      Plan,
      | 'status'
      | 'originalQuantityTomorrow'
      | 'substituteQuantityTomorrow'
      | 'originalQuantityLater'
      | 'laterDeliveryDate'
      | 'clientAdditionalCost'
      | 'supplierAbsorbedCost'
      | 'productionAbsorbedCost'
    >
  >
>;

export type CreatePlanVersionResult =
  | Readonly<{
      success: true;
      plan: Plan;
      createdAt: string;
    }>
  | Readonly<{
      success: false;
      reason: string;
    }>;

export const createNextPlanVersion = (
  previousPlan: Plan,
  newPlanId: PlanId,
  createdAt: string,
  changes: PlanConditionChanges,
): CreatePlanVersionResult => {
  if (newPlanId === previousPlan.id) {
    return {
      success: false,
      reason: 'A new plan version requires a new planId',
    };
  }

  const plan = planSchema.parse({
    ...previousPlan,
    ...changes,
    id: newPlanId,
    caseId: previousPlan.caseId,
    version: previousPlan.version + 1,
  });

  // Plan has no createdAt field in the approved model; W1-03 returns it as
  // explicit creation metadata instead of mutating the Plan contract.
  return { success: true, plan, createdAt };
};

export const invalidatePreviousPlan = (plan: Plan): Plan => ({
  ...plan,
  status: 'INVALIDATED',
});

import { z } from 'zod';

const idSchema = z.string().trim().min(1);
const quantitySchema = z.number().int().nonnegative();
const additionalCostSchema = z.number().nonnegative();
const deliveryDateSchema = z.string().datetime({ offset: true });

export const caseIdSchema = idSchema.brand<'CaseId'>();
export const planIdSchema = idSchema.brand<'PlanId'>();
export const actorIdSchema = idSchema.brand<'ActorId'>();
export const approvalIdSchema = idSchema.brand<'ApprovalId'>();

export const actorRoleSchema = z.enum(['supplier', 'production', 'client']);

export const caseStatusSchema = z.enum([
  'CASE_CREATED',
  'COLLECTING_CONSTRAINTS',
  'GENERATING_PLAN',
  'PENDING_APPROVAL',
  'REJECTED',
  'REVALIDATING',
  'NO_COMPATIBLE_SOLUTION',
  'AUTHORIZATION_UPDATED',
  'GENERATING_NEW_VERSION',
  'APPROVED',
]);

export const planStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'NO_SOLUTION',
  'APPROVED',
  'INVALIDATED',
]);

const supplyConstraintSchema = z
  .object({
    type: z.literal('SUPPLY'),
    originalQuantity: quantitySchema,
    substituteQuantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    substituteUnitAdditionalCost: additionalCostSchema,
  })
  .strict();

const minimumDeliveryConstraintSchema = z
  .object({
    type: z.literal('MINIMUM_DELIVERY'),
    minimumRequiredQuantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    allowsOriginalAndSubstituteMix: z.boolean(),
  })
  .strict();

export const constraintSchema = z.discriminatedUnion('type', [
  supplyConstraintSchema,
  minimumDeliveryConstraintSchema,
]);

export const authorizationSchema = z
  .object({
    maxAbsorbableAdditionalCost: additionalCostSchema,
    maxSubstituteQuantity: quantitySchema,
    latestAcceptedDeliveryDate: deliveryDateSchema,
  })
  .strict();

export const actorSchema = z
  .object({
    id: actorIdSchema,
    role: actorRoleSchema,
    constraints: z.array(constraintSchema).min(1),
    authorization: authorizationSchema,
  })
  .strict();

export const exceptionCaseSchema = z
  .object({
    id: caseIdSchema,
    status: caseStatusSchema,
    requestedQuantity: quantitySchema,
    targetDeliveryDate: deliveryDateSchema,
    actors: z.array(actorSchema).length(3),
  })
  .strict()
  .superRefine(({ actors }, context) => {
    const roles = new Set(actors.map(({ role }) => role));

    if (roles.size !== 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Actors must have exactly one supplier, production, and client',
        path: ['actors'],
      });
    }
  });

export const planSchema = z
  .object({
    id: planIdSchema,
    caseId: caseIdSchema,
    status: planStatusSchema,
    version: z.number().int().positive(),
    originalQuantityTomorrow: quantitySchema,
    substituteQuantityTomorrow: quantitySchema,
    originalQuantityLater: quantitySchema,
    laterDeliveryDate: deliveryDateSchema,
    clientAdditionalCost: additionalCostSchema,
    supplierAbsorbedCost: additionalCostSchema,
    productionAbsorbedCost: additionalCostSchema,
  })
  .strict();

export const transitionSchema = z
  .object({
    caseId: caseIdSchema,
    fromStatus: caseStatusSchema,
    toStatus: caseStatusSchema,
    triggeredByActorId: actorIdSchema.optional(),
    reason: z.string().trim().min(1),
    planId: planIdSchema.optional(),
    createdAt: deliveryDateSchema,
  })
  .strict();

export const approvalDecisionSchema = z.enum([
  'APPROVED',
  'REJECTED',
  'PENDING',
  'NEEDS_CLARIFICATION',
]);

export const approvalSchema = z
  .object({
    approvalId: approvalIdSchema,
    caseId: caseIdSchema,
    planId: planIdSchema,
    actorId: actorIdSchema,
    actorRole: actorRoleSchema,
    decision: approvalDecisionSchema,
    createdAt: deliveryDateSchema,
  })
  .strict();

export const callResultSchema = z
  .object({
    caseId: caseIdSchema,
    actorId: actorIdSchema,
    successful: z.boolean(),
    constraints: z.array(constraintSchema),
    authorization: authorizationSchema,
    createdAt: deliveryDateSchema,
  })
  .strict();

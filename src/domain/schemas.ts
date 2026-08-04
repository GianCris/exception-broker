import { z } from 'zod';

const idSchema = z.string().trim().min(1);
const quantitySchema = z.number().int().nonnegative();
const additionalCostSchema = z.number().nonnegative();
const deliveryDateSchema = z.string().datetime({ offset: true });

export const caseIdSchema = idSchema.brand<'CaseId'>();
export const planIdSchema = idSchema.brand<'PlanId'>();
export const actorIdSchema = idSchema.brand<'ActorId'>();

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

export const constraintSchema = z
  .object({
    quantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    additionalCost: additionalCostSchema,
  })
  .strict();

export const authorizationSchema = z
  .object({
    quantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    additionalCost: additionalCostSchema,
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
    quantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    additionalCost: additionalCostSchema,
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
    quantity: quantitySchema,
    deliveryDate: deliveryDateSchema,
    additionalCost: additionalCostSchema,
  })
  .strict();

export const approvalSchema = z
  .object({
    planId: planIdSchema,
    actorId: actorIdSchema,
    approved: z.boolean(),
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


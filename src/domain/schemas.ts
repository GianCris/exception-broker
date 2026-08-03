import { z } from 'zod';

const nonEmptyId = z.string().trim().min(1);
const nonEmptyText = z.string().trim().min(1);
const quantity = z.number().int().nonnegative();
const cost = z.number().nonnegative();

export const partyRoleSchema = z.enum([
  'requester',
  'supplier',
  'carrier',
]);

export const caseStatusSchema = z.enum([
  'open',
  'in_review',
  'resolved',
  'closed',
]);

export const contactSchema = z
  .object({
    name: nonEmptyText,
    phone: nonEmptyText,
  })
  .strict();

export const partySchema = z
  .object({
    id: nonEmptyId,
    role: partyRoleSchema,
    organizationName: nonEmptyText,
    contact: contactSchema,
  })
  .strict();

export const exceptionItemSchema = z
  .object({
    id: nonEmptyId,
    sku: nonEmptyId,
    description: nonEmptyText,
    requestedQuantity: quantity,
    availableQuantity: quantity,
    unitCost: cost,
  })
  .strict();

export const exceptionCaseSchema = z
  .object({
    id: nonEmptyId,
    status: caseStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    requiredBy: z.string().datetime({ offset: true }),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    parties: z.array(partySchema).min(1),
    items: z.array(exceptionItemSchema).min(1),
  })
  .strict();


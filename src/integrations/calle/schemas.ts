import { z } from 'zod';

import {
  actorIdSchema,
  actorRoleSchema,
  approvalDecisionSchema,
  caseIdSchema,
  planIdSchema,
} from '../../domain/schemas.js';

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const jsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const expectedDecisionSchemaSchema = z.object({
  name: z.literal('exception-broker-phone-decision'),
  version: z.literal(1),
}).strict();

export const callRequestSchema = z.object({
  requestId: nonEmptyStringSchema,
  caseId: caseIdSchema,
  planId: planIdSchema.optional(),
  actorId: actorIdSchema,
  actorRole: actorRoleSchema,
  phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Phone number must use E.164 format'),
  objective: nonEmptyStringSchema,
  context: nonEmptyStringSchema,
  expectedDecisionSchema: expectedDecisionSchemaSchema,
  createdAt: isoDateTimeSchema,
}).strict();

export const authorizationChangeSchema = z.object({
  field: nonEmptyStringSchema,
  previousValue: jsonPrimitiveSchema.optional(),
  newValue: jsonPrimitiveSchema,
  reason: nonEmptyStringSchema.optional(),
}).passthrough();

export const phoneDecisionSchema = z.object({
  decision: approvalDecisionSchema,
  actorId: actorIdSchema,
  actorRole: actorRoleSchema,
  caseId: caseIdSchema,
  planId: planIdSchema,
  summary: nonEmptyStringSchema,
  authorizationChanges: z.array(authorizationChangeSchema),
  clarificationNeeded: z.boolean(),
}).passthrough();

export const completionConfidenceSchema = z.object({
  score: z.number().finite().min(0).max(1),
  label: nonEmptyStringSchema,
}).strict();

export const calleStatusSchema = z.enum([
  'queued',
  'in_progress',
  'completed',
  'failed',
  'canceled',
]);

export const calleTerminalResponseSchema = z.object({
  status: calleStatusSchema,
  structuredResult: z.unknown().nullable(),
  taskCompleted: z.boolean().nullable(),
  completionConfidence: completionConfidenceSchema.nullable(),
  evidence: z.array(nonEmptyStringSchema),
}).passthrough();

export const receivedAtSchema = isoDateTimeSchema;

import { callRequestSchema } from './schemas.js';
import type { CallRequest, ExpectedDecisionSchema } from './types.js';

export const PHONE_DECISION_SCHEMA: ExpectedDecisionSchema = Object.freeze({
  name: 'exception-broker-phone-decision',
  version: 1,
});

export const validateCallRequest = (input: unknown) =>
  callRequestSchema.safeParse(input);

export const createCallRequest = (input: unknown): CallRequest =>
  callRequestSchema.parse(input);

import type { z } from 'zod';

import type {
  caseStatusSchema,
  contactSchema,
  exceptionCaseSchema,
  exceptionItemSchema,
  partyRoleSchema,
  partySchema,
} from './schemas.js';

export type PartyRole = z.infer<typeof partyRoleSchema>;
export type CaseStatus = z.infer<typeof caseStatusSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type Party = z.infer<typeof partySchema>;
export type ExceptionItem = z.infer<typeof exceptionItemSchema>;
export type ExceptionCase = z.infer<typeof exceptionCaseSchema>;


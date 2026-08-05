import { z } from 'zod';

import { caseIdSchema } from './schemas.js';
import type { CaseId } from './types.js';

const processedOperationSchema = z.object({
  operationId: z.string().trim().min(1),
  caseId: caseIdSchema,
  processedAt: z.string().datetime({ offset: true }),
}).strict();
const operationIdSchema = z.string().trim().min(1);

export type ProcessedOperation = Readonly<{
  operationId: string;
  caseId: CaseId;
  processedAt: string;
}>;

export type OperationHistoryCheckResult =
  | Readonly<{ success: true; processed: boolean }>
  | Readonly<{ success: false; reason: string; issues?: readonly string[] }>;

export type RecordProcessedOperationResult =
  | Readonly<{
      success: true;
      record: ProcessedOperation;
      history: readonly ProcessedOperation[];
    }>
  | Readonly<{ success: false; reason: string; issues?: readonly string[] }>;

const parseHistory = (input: unknown): Readonly<
  | { success: true; history: readonly ProcessedOperation[] }
  | { success: false; reason: string; issues?: readonly string[] }
> => {
  if (!Array.isArray(input)) {
    return { success: false, reason: 'A reliable operation history is required' };
  }
  const parsed = z.array(processedOperationSchema).safeParse(input);
  if (!parsed.success) {
    return {
        success: false,
        reason: 'Operation history is invalid',
        issues: parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`),
    };
  }
  const operationIds = parsed.data.map(({ operationId }) => operationId);
  if (new Set(operationIds).size !== operationIds.length) {
    return { success: false, reason: 'Operation history contains duplicate operationId records' };
  }
  return { success: true, history: parsed.data as readonly ProcessedOperation[] };
};

export const checkOperationProcessed = (
  historyInput: unknown,
  operationId: unknown,
): OperationHistoryCheckResult => {
  const history = parseHistory(historyInput);
  if (!history.success) return history;
  const parsedOperationId = operationIdSchema.safeParse(operationId);
  if (!parsedOperationId.success) {
    return { success: false, reason: 'operationId is required' };
  }
  return {
    success: true,
    processed: history.history.some((record) => record.operationId === parsedOperationId.data),
  };
};

export const recordProcessedOperation = (
  historyInput: unknown,
  recordInput: unknown,
): RecordProcessedOperationResult => {
  const history = parseHistory(historyInput);
  if (!history.success) return history;
  const record = processedOperationSchema.safeParse(recordInput);
  if (!record.success) {
    return {
      success: false,
      reason: 'Processed operation record is invalid',
      issues: record.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`),
    };
  }
  if (history.history.some(({ operationId }) => operationId === record.data.operationId)) {
    return { success: false, reason: 'operationId has already been processed' };
  }
  const processed = record.data as ProcessedOperation;
  return {
    success: true,
    record: processed,
    history: [...history.history, processed],
  };
};

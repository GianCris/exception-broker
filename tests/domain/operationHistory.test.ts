import { describe, expect, it } from 'vitest';

import {
  checkOperationProcessed,
  recordProcessedOperation,
  type ProcessedOperation,
} from '../../src/domain/operationHistory.js';
import { case001Fixture } from '../../src/domain/case-001.fixture.js';

const record = (operationId = 'OPERATION-001'): ProcessedOperation => ({
  operationId,
  caseId: case001Fixture.id,
  processedAt: '2026-08-08T15:00:00.000Z',
});

describe('explicit processed operation history', () => {
  it('checks unprocessed and processed operation IDs against supplied history', () => {
    expect(checkOperationProcessed([], 'OPERATION-001')).toEqual({ success: true, processed: false });
    expect(checkOperationProcessed([record()], 'OPERATION-001')).toEqual({ success: true, processed: true });
  });

  it('records structured operation metadata immutably', () => {
    const history: readonly ProcessedOperation[] = [];
    const result = recordProcessedOperation(history, record());
    expect(result).toEqual({ success: true, record: record(), history: [record()] });
    expect(history).toEqual([]);
  });

  it('rejects a duplicate operationId', () => {
    expect(recordProcessedOperation([record()], record())).toEqual({
      success: false,
      reason: 'operationId has already been processed',
    });
  });

  it('rejects an unreliable history that already contains duplicate operation IDs', () => {
    expect(checkOperationProcessed([record(), record()], 'OPERATION-001')).toEqual({
      success: false,
      reason: 'Operation history contains duplicate operationId records',
    });
  });

  it('normalizes the checked operationId consistently with recorded IDs', () => {
    expect(checkOperationProcessed([record()], ' OPERATION-001 ')).toEqual({
      success: true,
      processed: true,
    });
  });

  it('requires a reliable explicit history', () => {
    expect(checkOperationProcessed(undefined, 'OPERATION-001')).toEqual({
      success: false,
      reason: 'A reliable operation history is required',
    });
    expect(recordProcessedOperation(undefined, record())).toEqual({
      success: false,
      reason: 'A reliable operation history is required',
    });
  });

  it.each([
    ['empty operationId', { ...record(), operationId: '' }],
    ['empty caseId', { ...record(), caseId: '' }],
    ['invalid processedAt', { ...record(), processedAt: 'now' }],
    ['extra data', { ...record(), secret: 'unsupported' }],
  ] as const)('rejects invalid structured record: %s', (_name, value) => {
    expect(recordProcessedOperation([], value).success).toBe(false);
  });

  it('does not generate processedAt or operationId', () => {
    expect(recordProcessedOperation([], {
      caseId: case001Fixture.id,
      processedAt: '2026-08-08T15:00:00.000Z',
    }).success).toBe(false);
    expect(recordProcessedOperation([], {
      operationId: 'OPERATION-001',
      caseId: case001Fixture.id,
    }).success).toBe(false);
  });

  it('is deterministic and does not mutate frozen inputs', () => {
    const history = Object.freeze([Object.freeze(record('OPERATION-000'))]);
    const input = Object.freeze(record());
    const first = recordProcessedOperation(history, input);
    const second = recordProcessedOperation(history, input);
    expect(first).toEqual(second);
    expect(history).toEqual([record('OPERATION-000')]);
    expect(input).toEqual(record());
  });
});

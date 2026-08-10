import { describe, expect, it } from 'vitest';

import {
  assessNoSolution,
  classifyPlanValidation,
} from '../../src/domain/outcomes.js';
import { planIdSchema } from '../../src/domain/schemas.js';
import type { ValidationResult } from '../../src/domain/rules.js';

const planId = planIdSchema.parse('PLAN-ASSESSMENT-001');
const invalidValidation: ValidationResult = {
  valid: false,
  violations: [{
    ruleId: 'R-01',
    field: 'originalQuantityLater',
    actorRole: null,
    message: 'Plan total must equal the requested quantity',
    expected: 600,
    actual: 520,
  }],
};

describe('safe outcome assessments', () => {
  describe('classifyPlanValidation', () => {
    it('classifies an invalid plan without claiming that no solution exists', () => {
      expect(classifyPlanValidation(planId, invalidValidation)).toEqual({
        success: true,
        assessment: {
          outcome: 'PLAN_INVALID',
          planId,
          validation: invalidValidation,
        },
      });
    });

    it('classifies a consistent valid result as PLAN_VALID', () => {
      const validation: ValidationResult = { valid: true, violations: [] };
      expect(classifyPlanValidation(planId, validation)).toEqual({
        success: true,
        assessment: { outcome: 'PLAN_VALID', planId, validation },
      });
    });

    it.each([
      { valid: true, violations: invalidValidation.violations },
      { valid: false, violations: [] },
    ] as const)('fails closed for a contradictory validation result', (validation) => {
      expect(classifyPlanValidation(planId, validation)).toEqual({
        success: false,
        reason: 'CONTRADICTORY_VALIDATION_RESULT',
      });
    });
  });

  describe('assessNoSolution', () => {
    const legacyEvidence = {
      availableUnitsTomorrow: 250,
      requiredMinimumUnitsTomorrow: 300,
      compatible: false,
    };

    it('classifies legacy CASE-001 evidence honestly as unproven', () => {
      expect(assessNoSolution(legacyEvidence, 'LEGACY_CASE_001')).toEqual({
        outcome: 'NO_SOLUTION_UNPROVEN',
        reason: 'LEGACY_EVIDENCE_NOT_EXHAUSTIVE',
        evidence: legacyEvidence,
      });
    });

    it.each([
      ['malformed null', null, 'MALFORMED_EVIDENCE'],
      ['malformed array', [], 'MALFORMED_EVIDENCE'],
      ['incomplete object', {}, 'INCOMPLETE_EVIDENCE'],
      ['numeric shortfall', legacyEvidence, 'INCOMPLETE_EVIDENCE'],
      ['repeated invalid plans', [invalidValidation, invalidValidation], 'MALFORMED_EVIDENCE'],
      ['legacy plan status', 'NO_SOLUTION', 'MALFORMED_EVIDENCE'],
      ['unsupported proof type', { proofType: 'CAPACITY_BOUND_V1', facts: legacyEvidence }, 'UNSUPPORTED_PROOF_TYPE'],
      ['passive snapshot metadata', {
        proofType: 'CAPACITY_BOUND_V1',
        snapshot: { caseId: 'CASE-001', snapshotId: 'external-reference-only' },
        facts: legacyEvidence,
      }, 'UNSUPPORTED_PROOF_TYPE'],
      ['external proven claim', {
        outcome: 'NO_SOLUTION_PROVEN',
        proofType: 'CAPACITY_BOUND_V1',
        facts: legacyEvidence,
      }, 'EXTERNAL_PROVEN_CLAIM_UNTRUSTED'],
    ] as const)('%s cannot produce NO_SOLUTION_PROVEN', (_label, evidence, reason) => {
      const result = assessNoSolution(evidence);
      expect(result).toMatchObject({ outcome: 'NO_SOLUTION_UNPROVEN', reason });
      expect(result.outcome).not.toBe('NO_SOLUTION_PROVEN');
    });

    it('has no runtime input in Block 1 that reaches NO_SOLUTION_PROVEN', () => {
      const inputs: unknown[] = [
        undefined,
        null,
        true,
        0,
        '',
        'NO_SOLUTION',
        {},
        legacyEvidence,
        { proofType: '' },
        { proofType: 'anything' },
        { outcome: 'NO_SOLUTION_PROVEN' },
        { outcome: 'NO_SOLUTION_PROVEN', proofType: 'anything', proof: {} },
      ];

      expect(inputs.map((input) => assessNoSolution(input).outcome))
        .toEqual(inputs.map(() => 'NO_SOLUTION_UNPROVEN'));
    });

    it('is deterministic and does not mutate frozen evidence', () => {
      const evidence = Object.freeze({
        proofType: 'UNSUPPORTED',
        facts: Object.freeze({ available: 520, required: 600 }),
      });
      const before = structuredClone(evidence);
      const first = assessNoSolution(evidence);
      const second = assessNoSolution(evidence);

      expect(first).toEqual(second);
      expect(evidence).toEqual(before);
    });
  });
});

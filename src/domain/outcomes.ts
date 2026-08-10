import type { ValidationResult } from './rules.js';
import type { CaseId, PlanId } from './types.js';

export type PlanAssessment =
  | Readonly<{
      outcome: 'PLAN_VALID';
      planId: PlanId;
      validation: ValidationResult;
    }>
  | Readonly<{
      outcome: 'PLAN_INVALID';
      planId: PlanId;
      validation: ValidationResult;
    }>;

export type PlanAssessmentResult =
  | Readonly<{ success: true; assessment: PlanAssessment }>
  | Readonly<{
      success: false;
      reason: 'CONTRADICTORY_VALIDATION_RESULT';
    }>;

export const classifyPlanValidation = (
  planId: PlanId,
  validation: ValidationResult,
): PlanAssessmentResult => {
  const consistentValid = validation.valid && validation.violations.length === 0;
  const consistentInvalid = !validation.valid && validation.violations.length > 0;

  if (!consistentValid && !consistentInvalid) {
    return { success: false, reason: 'CONTRADICTORY_VALIDATION_RESULT' };
  }

  return {
    success: true,
    assessment: {
      outcome: consistentValid ? 'PLAN_VALID' : 'PLAN_INVALID',
      planId,
      validation,
    },
  };
};

/** Passive future-facing metadata only; Block 1 does not verify freshness. */
export type NoSolutionSnapshotReference = Readonly<{
  caseId: CaseId;
  snapshotId: string;
}>;

export type SubmittedNoSolutionEvidence = Readonly<{
  proofType: string;
  snapshot?: NoSolutionSnapshotReference;
  facts?: unknown;
}>;

export type NoSolutionUnprovenReason =
  | 'LEGACY_EVIDENCE_NOT_EXHAUSTIVE'
  | 'MALFORMED_EVIDENCE'
  | 'INCOMPLETE_EVIDENCE'
  | 'UNSUPPORTED_PROOF_TYPE'
  | 'EXTERNAL_PROVEN_CLAIM_UNTRUSTED';

declare const verifiedNoSolutionProofBrand: unique symbol;

/** Reserved for a future deterministic verifier; Block 1 cannot construct it. */
export type VerifiedNoSolutionProof = Readonly<{
  proofType: string;
  snapshot: NoSolutionSnapshotReference;
  verifierVersion: string;
  evidenceDigest: string;
  verifiedAt: string;
  [verifiedNoSolutionProofBrand]: true;
}>;

export type NoSolutionAssessment =
  | Readonly<{
      outcome: 'NO_SOLUTION_UNPROVEN';
      reason: NoSolutionUnprovenReason;
      evidence?: unknown;
    }>
  | Readonly<{
      outcome: 'NO_SOLUTION_PROVEN';
      proof: VerifiedNoSolutionProof;
    }>;

export type NoSolutionAssessmentSource = 'LEGACY_CASE_001' | 'EXTERNAL';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Block 1 supports zero proof methods, so every runtime result is unproven. */
export const assessNoSolution = (
  evidence: unknown,
  source: NoSolutionAssessmentSource = 'EXTERNAL',
): Extract<NoSolutionAssessment, { outcome: 'NO_SOLUTION_UNPROVEN' }> => {
  if (source === 'LEGACY_CASE_001') {
    return {
      outcome: 'NO_SOLUTION_UNPROVEN',
      reason: 'LEGACY_EVIDENCE_NOT_EXHAUSTIVE',
      evidence,
    };
  }

  if (!isRecord(evidence)) {
    return {
      outcome: 'NO_SOLUTION_UNPROVEN',
      reason: 'MALFORMED_EVIDENCE',
      evidence,
    };
  }

  if (evidence.outcome === 'NO_SOLUTION_PROVEN') {
    return {
      outcome: 'NO_SOLUTION_UNPROVEN',
      reason: 'EXTERNAL_PROVEN_CLAIM_UNTRUSTED',
      evidence,
    };
  }

  if (typeof evidence.proofType !== 'string' || evidence.proofType.trim() === '') {
    return {
      outcome: 'NO_SOLUTION_UNPROVEN',
      reason: 'INCOMPLETE_EVIDENCE',
      evidence,
    };
  }

  return {
    outcome: 'NO_SOLUTION_UNPROVEN',
    reason: 'UNSUPPORTED_PROOF_TYPE',
    evidence,
  };
};

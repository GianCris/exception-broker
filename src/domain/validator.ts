import { deterministicRules } from './rules.js';
import type { ValidationResult } from './rules.js';
import type { ExceptionCase, Plan } from './types.js';

export const validatePlan = (
  exceptionCase: ExceptionCase,
  plan: Plan,
): ValidationResult => {
  const violations = deterministicRules.flatMap((rule) =>
    rule(exceptionCase, plan),
  );

  return {
    valid: violations.length === 0,
    violations,
  };
};

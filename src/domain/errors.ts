import type { ZodIssue } from 'zod';

export class DomainValidationError extends Error {
  public readonly issues: readonly ZodIssue[];

  public constructor(message: string, issues: readonly ZodIssue[]) {
    super(message);
    this.name = 'DomainValidationError';
    this.issues = issues;
  }
}


import type { ZodIssue } from 'zod';

export class DomainValidationError extends Error {
  public constructor(
    message: string,
    public readonly issues: readonly ZodIssue[],
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}


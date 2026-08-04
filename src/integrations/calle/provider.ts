import type { CallRequest } from './types.js';

export interface CallProvider {
  executeCall(request: CallRequest): Promise<unknown>;
}

export const providerOperationalErrorKinds = [
  'CONFIGURATION_MISSING',
  'AUTHENTICATION_FAILED',
  'NETWORK_FAILURE',
  'TIMEOUT',
  'TEMPORARILY_UNAVAILABLE',
  'UNREADABLE_RESPONSE',
  'OPERATION_REJECTED',
] as const;

export type ProviderOperationalErrorKind = typeof providerOperationalErrorKinds[number];

const operationalErrorDetails: Record<
  ProviderOperationalErrorKind,
  Readonly<{ reason: string; retryable: boolean }>
> = {
  CONFIGURATION_MISSING: { reason: 'Call provider configuration is unavailable', retryable: false },
  AUTHENTICATION_FAILED: { reason: 'Call provider authentication failed', retryable: false },
  NETWORK_FAILURE: { reason: 'Call provider network failure', retryable: true },
  TIMEOUT: { reason: 'Call provider timed out', retryable: true },
  TEMPORARILY_UNAVAILABLE: { reason: 'Call provider is temporarily unavailable', retryable: true },
  UNREADABLE_RESPONSE: { reason: 'Call provider returned an unreadable response', retryable: false },
  OPERATION_REJECTED: { reason: 'Call provider rejected the operation', retryable: false },
};

export class ProviderOperationalError extends Error {
  readonly kind: ProviderOperationalErrorKind;
  readonly retryable: boolean;

  constructor(kind: ProviderOperationalErrorKind) {
    const details = operationalErrorDetails[kind];
    super(details.reason);
    this.name = 'ProviderOperationalError';
    this.kind = kind;
    this.retryable = details.retryable;
  }
}

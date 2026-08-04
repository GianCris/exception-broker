import {
  ProviderOperationalError,
  type CallProvider,
  type ProviderOperationalErrorKind,
} from './provider.js';
import type { CallRequest } from './types.js';

export type MockProviderBehavior =
  | Readonly<{ type: 'response'; payload: unknown }>
  | Readonly<{ type: 'operational-error'; kind: ProviderOperationalErrorKind }>
  | Readonly<{ type: 'internal-error'; error: Error }>;

export class MockProvider implements CallProvider {
  readonly #behavior: MockProviderBehavior;
  #invocationCount = 0;
  #lastRequest: CallRequest | undefined;

  constructor(behavior: MockProviderBehavior) {
    this.#behavior = behavior;
  }

  get invocationCount(): number {
    return this.#invocationCount;
  }

  get lastRequest(): CallRequest | undefined {
    return this.#lastRequest;
  }

  async executeCall(request: CallRequest): Promise<unknown> {
    this.#invocationCount += 1;
    this.#lastRequest = request;

    switch (this.#behavior.type) {
      case 'response':
        return this.#behavior.payload;
      case 'operational-error':
        throw new ProviderOperationalError(this.#behavior.kind);
      case 'internal-error':
        throw this.#behavior.error;
    }
  }
}

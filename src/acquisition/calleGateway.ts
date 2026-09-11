import { CalleClient, type Call, type CreateCallInput } from '@call-e/calle';

export interface AcquisitionCallGateway {
  create(input: CreateCallInput, idempotencyKey: string, connectionId?: string): Promise<Call>;
  get(callId: string, connectionId?: string): Promise<Call>;
}

/**
 * Raised only at a local boundary that runs BEFORE the provider operation can leave this
 * process, so the caller may prove no provider request was ever dispatched. Transport
 * errors, timeouts and API rejections are never this error: they stay ambiguous.
 */
export class ProviderNotDispatchedError extends Error {
  readonly reason: 'CONNECTION_CREDENTIAL_UNAVAILABLE';

  constructor() {
    super('CALL-E API key is unavailable');
    this.name = 'ProviderNotDispatchedError';
    this.reason = 'CONNECTION_CREDENTIAL_UNAVAILABLE';
  }
}

export type AcquisitionCalleClient = Readonly<{
  calls: Readonly<{
    create(input: CreateCallInput, options: Readonly<{ idempotencyKey: string }>): Promise<Call>;
    get(callId: string): Promise<Call>;
  }>;
}>;

export type AcquisitionApiKeySource = (connectionId?: string) => string | undefined;
export type AcquisitionClientFactory = (key: string) => AcquisitionCalleClient;

export class CalleAcquisitionGateway implements AcquisitionCallGateway {
  readonly #apiKeySource: AcquisitionApiKeySource;
  readonly #clientFactory: AcquisitionClientFactory;

  constructor(
    apiKeySource: AcquisitionApiKeySource,
    clientFactory: AcquisitionClientFactory = (key) => new CalleClient({ apiKey: key }),
  ) {
    this.#apiKeySource = apiKeySource;
    this.#clientFactory = clientFactory;
  }

  #getClient(connectionId?: string): AcquisitionCalleClient {
    const apiKey = this.#apiKeySource(connectionId);
    if (apiKey === undefined || apiKey.trim() === '') throw new ProviderNotDispatchedError();
    return this.#clientFactory(apiKey);
  }

  create(input: CreateCallInput, idempotencyKey: string, connectionId?: string): Promise<Call> {
    return this.#getClient(connectionId).calls.create(input, { idempotencyKey });
  }

  get(callId: string, connectionId?: string): Promise<Call> {
    return this.#getClient(connectionId).calls.get(callId);
  }
}

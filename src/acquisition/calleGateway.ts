import { CalleClient, type Call, type CreateCallInput } from '@call-e/calle';

export interface AcquisitionCallGateway {
  create(input: CreateCallInput, idempotencyKey: string, connectionId?: string): Promise<Call>;
  get(callId: string, connectionId?: string): Promise<Call>;
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
    if (apiKey === undefined || apiKey.trim() === '') throw new Error('CALL-E API key is unavailable');
    return this.#clientFactory(apiKey);
  }

  create(input: CreateCallInput, idempotencyKey: string, connectionId?: string): Promise<Call> {
    return this.#getClient(connectionId).calls.create(input, { idempotencyKey });
  }

  get(callId: string, connectionId?: string): Promise<Call> {
    return this.#getClient(connectionId).calls.get(callId);
  }
}

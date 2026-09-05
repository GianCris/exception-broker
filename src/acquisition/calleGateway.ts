import { CalleClient, type Call, type CreateCallInput } from '@call-e/calle';

export interface AcquisitionCallGateway {
  create(input: CreateCallInput, idempotencyKey: string): Promise<Call>;
  get(callId: string): Promise<Call>;
}

export type AcquisitionCalleClient = Readonly<{
  calls: Readonly<{
    create(input: CreateCallInput, options: Readonly<{ idempotencyKey: string }>): Promise<Call>;
    get(callId: string): Promise<Call>;
  }>;
}>;

export type AcquisitionApiKeySource = () => string | undefined;
export type AcquisitionClientFactory = (key: string) => AcquisitionCalleClient;

export class CalleAcquisitionGateway implements AcquisitionCallGateway {
  readonly #apiKeySource: AcquisitionApiKeySource;
  readonly #clientFactory: AcquisitionClientFactory;
  #client: AcquisitionCalleClient | undefined;

  constructor(
    apiKeySource: AcquisitionApiKeySource,
    clientFactory: AcquisitionClientFactory = (key) => new CalleClient({ apiKey: key }),
  ) {
    this.#apiKeySource = apiKeySource;
    this.#clientFactory = clientFactory;
  }

  #getClient(): AcquisitionCalleClient {
    if (this.#client !== undefined) return this.#client;
    const apiKey = this.#apiKeySource();
    if (apiKey === undefined || apiKey.trim() === '') throw new Error('CALL-E API key is unavailable');
    this.#client = this.#clientFactory(apiKey);
    return this.#client;
  }

  create(input: CreateCallInput, idempotencyKey: string): Promise<Call> {
    return this.#getClient().calls.create(input, { idempotencyKey });
  }

  get(callId: string): Promise<Call> {
    return this.#getClient().calls.get(callId);
  }
}

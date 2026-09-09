import { randomBytes } from 'node:crypto';

export type AcquisitionConnectionKind = 'HOSTED_DEMO' | 'BYOK';

export type AcquisitionConnectionPublic = Readonly<{
  connectionId: string;
  kind: AcquisitionConnectionKind;
  connected: true;
}>;

type Connection = AcquisitionConnectionPublic & Readonly<{ apiKey: string }>;

export type AcquisitionAccessOptions = Readonly<{
  hostedApiKeySource: () => string | undefined;
  createConnectionId?: () => string;
}>;

export class AcquisitionAccessService {
  readonly #hostedApiKeySource: () => string | undefined;
  readonly #createConnectionId: () => string;
  readonly #connections = new Map<string, Connection>();

  constructor(options: AcquisitionAccessOptions) {
    this.#hostedApiKeySource = options.hostedApiKeySource;
    this.#createConnectionId = options.createConnectionId ?? (() => randomBytes(32).toString('base64url'));
  }

  connectHosted(existingConnectionId?: string): AcquisitionConnectionPublic | undefined {
    if (existingConnectionId !== undefined) {
      const existing = this.#connections.get(existingConnectionId);
      if (existing?.kind === 'HOSTED_DEMO') return this.#public(existing);
    }
    const apiKey = this.#hostedApiKeySource();
    if (apiKey === undefined || apiKey.trim() === '') return undefined;
    return this.#create('HOSTED_DEMO', apiKey);
  }

  connectByok(apiKey: string): AcquisitionConnectionPublic | undefined {
    if (apiKey.trim() === '') return undefined;
    return this.#create('BYOK', apiKey);
  }

  get(connectionId: string): AcquisitionConnectionPublic | undefined {
    const connection = this.#connections.get(connectionId);
    return connection === undefined ? undefined : this.#public(connection);
  }

  disconnect(connectionId: string): boolean {
    return this.#connections.delete(connectionId);
  }

  resolveApiKey(connectionId: string): string | undefined {
    return this.#connections.get(connectionId)?.apiKey;
  }

  has(connectionId: string): boolean {
    return this.#connections.has(connectionId);
  }

  #create(kind: AcquisitionConnectionKind, apiKey: string): AcquisitionConnectionPublic {
    const connection: Connection = { connectionId: this.#createConnectionId(), kind, connected: true, apiKey };
    this.#connections.set(connection.connectionId, connection);
    return this.#public(connection);
  }

  #public(connection: Connection): AcquisitionConnectionPublic {
    return { connectionId: connection.connectionId, kind: connection.kind, connected: true };
  }
}

import { randomBytes } from 'node:crypto';

export type AcquisitionConnectionKind = 'HOSTED_DEMO' | 'BYOK';

export type AcquisitionConnectionPublic = Readonly<{
  connectionId: string;
  kind: AcquisitionConnectionKind;
  connected: true;
}>;

type Connection = AcquisitionConnectionPublic & { apiKeySource: () => string | undefined; lastUsedAt: number; active: boolean };

export type AcquisitionAccessOptions = Readonly<{
  hostedApiKeySource: () => string | undefined;
  createConnectionId?: () => string;
  clock?: () => number;
  idleTtlMs?: number;
}>;

export class AcquisitionAccessService {
  readonly #hostedApiKeySource: () => string | undefined;
  readonly #createConnectionId: () => string;
  readonly #clock: () => number;
  readonly #idleTtlMs: number;
  readonly #connections = new Map<string, Connection>();

  constructor(options: AcquisitionAccessOptions) {
    this.#hostedApiKeySource = options.hostedApiKeySource;
    this.#createConnectionId = options.createConnectionId ?? (() => randomBytes(32).toString('base64url'));
    this.#clock = options.clock ?? Date.now;
    this.#idleTtlMs = options.idleTtlMs ?? 30 * 60_000;
  }

  connectHosted(existingConnectionId?: string): AcquisitionConnectionPublic | undefined {
    if (existingConnectionId !== undefined) {
      const existing = this.#connection(existingConnectionId, true);
      if (existing?.kind === 'HOSTED_DEMO') return this.#public(existing);
    }
    const apiKey = this.#hostedApiKeySource();
    if (apiKey === undefined || apiKey.trim() === '') return undefined;
    return this.#create('HOSTED_DEMO', this.#hostedApiKeySource);
  }

  connectByok(apiKey: string): AcquisitionConnectionPublic | undefined {
    if (apiKey.trim() === '') return undefined;
    return this.#create('BYOK', () => apiKey);
  }

  /** Registers an existing compatibility capability as Hosted without reading the key eagerly. */
  registerHostedCapability(connectionId: string): void {
    if (connectionId.trim() === '' || this.#connections.has(connectionId)) return;
    this.#connections.set(connectionId, { connectionId, kind: 'HOSTED_DEMO', connected: true, apiKeySource: this.#hostedApiKeySource, lastUsedAt: this.#clock(), active: false });
  }

  get(connectionId: string): AcquisitionConnectionPublic | undefined {
    const connection = this.#connection(connectionId, true);
    return connection === undefined ? undefined : this.#public(connection);
  }

  disconnect(connectionId: string): boolean {
    const connection = this.#connection(connectionId, false);
    if (connection?.active) return false;
    return this.#connections.delete(connectionId);
  }

  resolveApiKey(connectionId: string): string | undefined {
    const connection = this.#connection(connectionId, true);
    return connection?.apiKeySource();
  }

  has(connectionId: string): boolean {
    return this.#connection(connectionId, false) !== undefined;
  }

  markActive(connectionId: string, active: boolean): void {
    const connection = this.#connection(connectionId, false);
    if (connection !== undefined) { connection.active = active; connection.lastUsedAt = this.#clock(); }
  }

  #create(kind: AcquisitionConnectionKind, apiKeySource: () => string | undefined): AcquisitionConnectionPublic {
    const connection: Connection = { connectionId: this.#createConnectionId(), kind, connected: true, apiKeySource, lastUsedAt: this.#clock(), active: false };
    this.#connections.set(connection.connectionId, connection);
    return this.#public(connection);
  }

  #public(connection: Connection): AcquisitionConnectionPublic {
    return { connectionId: connection.connectionId, kind: connection.kind, connected: true };
  }

  #connection(connectionId: string, touch: boolean): Connection | undefined {
    const connection = this.#connections.get(connectionId);
    if (connection === undefined) return undefined;
    const now = this.#clock();
    if (!connection.active && now - connection.lastUsedAt >= this.#idleTtlMs) {
      this.#connections.delete(connectionId);
      return undefined;
    }
    if (touch) connection.lastUsedAt = now;
    return connection;
  }
}

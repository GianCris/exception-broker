import type { AcquisitionPublicRecord } from './contracts.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, OPERATOR_SANDBOX_OBJECTIVE, operatorSandboxContext } from '../sandbox/operatorDefinition.js';
import type { LiveControlPublicRecord } from '../control/contracts.js';
import type { AcquisitionConnectionPublic } from './access.js';

export type BrowserAcquisitionCreateInput = Readonly<{
  acquisitionId: string;
  authorizationConfirmed: true;
  phoneNumber?: string;
  /** A claim the server re-verifies. It never grants quota or authority by itself. */
  recoveryOfAcquisitionId?: string;
  request: Readonly<{
    requestId: string;
    caseId: string;
    planId: string;
    actorId: string;
    actorRole: 'client';
    objective: string;
    context: string;
    expectedDecisionSchema: Readonly<{ name: 'exception-broker-phone-decision'; version: 1 }>;
    createdAt: string;
  }>;
}>;

export type BrowserCreateResult = Readonly<{
  accepted: true;
  record: AcquisitionPublicRecord;
  existing: boolean;
}>;

export type BrowserReadResult = Readonly<{
  found: true;
  record: AcquisitionPublicRecord;
}>;

export interface AcquisitionBrowserApi {
  connectHosted(existingConnectionId?: string): Promise<AcquisitionConnectionPublic>;
  connectByok(apiKey: string): Promise<AcquisitionConnectionPublic>;
  getConnection(connectionId: string): Promise<AcquisitionConnectionPublic>;
  disconnect(connectionId: string): Promise<void>;
  create(input: BrowserAcquisitionCreateInput, connectionId: string): Promise<BrowserCreateResult>;
  getActive(connectionId: string): Promise<AcquisitionPublicRecord | null>;
  get(acquisitionId: string, accessToken: string): Promise<AcquisitionPublicRecord>;
  refresh(acquisitionId: string, accessToken: string): Promise<BrowserReadResult>;
  handoff(acquisitionId: string, accessToken: string): Promise<Readonly<{ accepted: true; record: LiveControlPublicRecord; existing: boolean }>>;
  getControl(controlSessionId: string, accessToken: string): Promise<Readonly<{ accepted: true; record: LiveControlPublicRecord; existing: boolean }>>;
  review(controlSessionId: string, accessToken: string, action: 'APPLY' | 'DISCARD'): Promise<Readonly<{ accepted: true; record: LiveControlPublicRecord; existing: boolean }>>;
}

export class AcquisitionApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'AcquisitionApiError';
    this.code = code;
    this.status = status;
  }
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  let body: unknown;
  try { body = await response.json(); } catch { throw new AcquisitionApiError('UNREADABLE_RESPONSE', response.status); }
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      ? body.code
      : 'REQUEST_FAILED';
    throw new AcquisitionApiError(code, response.status);
  }
  return body as T;
};

export const createAcquisitionBrowserApi = (
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): AcquisitionBrowserApi => ({
  async connectHosted(existingConnectionId) {
    return parseResponse<AcquisitionConnectionPublic>(await fetcher('/api/acquisition-access/hosted', {
      method: 'POST',
      ...(existingConnectionId === undefined ? {} : { headers: { 'x-acquisition-connection': existingConnectionId } }),
    }));
  },
  async connectByok(apiKey) {
    return parseResponse<AcquisitionConnectionPublic>(await fetcher('/api/acquisition-access/byok', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }),
    }));
  },
  async getConnection(connectionId) {
    return parseResponse<AcquisitionConnectionPublic>(await fetcher('/api/acquisition-access', { headers: { 'x-acquisition-connection': connectionId } }));
  },
  async disconnect(connectionId) {
    await parseResponse(await fetcher('/api/acquisition-access', { method: 'DELETE', headers: { 'x-acquisition-connection': connectionId } }));
  },
  async create(input, connectionId) {
    return parseResponse<BrowserCreateResult>(await fetcher('/api/acquisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-acquisition-connection': connectionId },
      body: JSON.stringify(input),
    }));
  },
  async getActive(connectionId) {
    const response = await fetcher('/api/acquisitions/active', { headers: { 'x-acquisition-connection': connectionId } });
    if (response.status === 204) return null;
    return parseResponse<AcquisitionPublicRecord>(response);
  },
  async get(acquisitionId, accessToken) {
    return parseResponse<AcquisitionPublicRecord>(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}`, {
      headers: { 'x-acquisition-connection': accessToken },
    }));
  },
  async refresh(acquisitionId, accessToken) {
    return parseResponse<BrowserReadResult>(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}/refresh`, {
      method: 'POST',
      headers: { 'x-acquisition-connection': accessToken },
    }));
  },
  async handoff(acquisitionId, accessToken) {
    return parseResponse(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}/control`, { method: 'POST', headers: { 'x-acquisition-connection': accessToken } }));
  },
  async getControl(controlSessionId, accessToken) {
    return parseResponse(await fetcher(`/api/control-sessions/${encodeURIComponent(controlSessionId)}`, { headers: { 'x-acquisition-connection': accessToken } }));
  },
  async review(controlSessionId, accessToken, action) {
    return parseResponse(await fetcher(`/api/control-sessions/${encodeURIComponent(controlSessionId)}/review`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-connection': accessToken }, body: JSON.stringify({ action }) }));
  },
});

export const ACQUISITION_V1_OBJECTIVE = OPERATOR_SANDBOX_OBJECTIVE;
export const ACQUISITION_V1_CONTEXT = operatorSandboxContext();

/**
 * Rebuilds the canonical create input for an acquisition whose provider acceptance is unknown,
 * so reconciliation re-submits the same content under the same acquisition id. The server still
 * recomputes and verifies the fingerprint and keeps its own persisted idempotency key: this only
 * supplies request content the server never stored. Hosted recipients are server-owned, so only
 * Hosted records are reconstructible from a public record alone.
 */
export const reconcileBrowserAcquisitionRequest = (record: AcquisitionPublicRecord): BrowserAcquisitionCreateInput | null => {
  const { requestId, createdAt, caseId, planId, actorId, actorRole } = record.decisionContext;
  if (record.accessMode !== 'HOSTED_DEMO' || actorRole !== 'client' || planId === undefined) return null;
  return {
    acquisitionId: record.acquisitionId,
    authorizationConfirmed: true,
    request: {
      requestId,
      caseId,
      planId,
      actorId,
      actorRole,
      objective: ACQUISITION_V1_OBJECTIVE,
      context: ACQUISITION_V1_CONTEXT,
      expectedDecisionSchema: OPERATOR_SANDBOX_DEFINITION.expectedDecisionSchema,
      createdAt,
    },
  };
};

export const createBrowserAcquisitionRequest = (input: Readonly<{
  identity: string;
  createdAt: string;
  phoneNumber?: string;
}>): BrowserAcquisitionCreateInput => ({
  acquisitionId: `ACQ-BROWSER-V1-${input.identity}`,
  authorizationConfirmed: true,
  ...(input.phoneNumber === undefined ? {} : { phoneNumber: input.phoneNumber }),
  request: {
    requestId: `REQUEST-BROWSER-V1-${input.identity}`,
    caseId: OPERATOR_SANDBOX_FACTS.caseId,
    planId: OPERATOR_SANDBOX_FACTS.planId,
    actorId: OPERATOR_SANDBOX_FACTS.clientActorId,
    actorRole: OPERATOR_SANDBOX_DEFINITION.actorRole,
    objective: ACQUISITION_V1_OBJECTIVE,
    context: ACQUISITION_V1_CONTEXT,
    expectedDecisionSchema: OPERATOR_SANDBOX_DEFINITION.expectedDecisionSchema,
    createdAt: input.createdAt,
  },
});

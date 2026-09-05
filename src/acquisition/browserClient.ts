import type { AcquisitionPublicRecord } from './contracts.js';
import { OPERATOR_SANDBOX_DEFINITION, OPERATOR_SANDBOX_FACTS, OPERATOR_SANDBOX_OBJECTIVE, operatorSandboxContext } from '../sandbox/operatorDefinition.js';
import type { LiveControlPublicRecord } from '../control/contracts.js';

export type BrowserAcquisitionCreateInput = Readonly<{
  acquisitionId: string;
  clientToken: string;
  authorizationConfirmed: true;
  phoneNumber: string;
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
  create(input: BrowserAcquisitionCreateInput): Promise<BrowserCreateResult>;
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
  async create(input) {
    return parseResponse<BrowserCreateResult>(await fetcher('/api/acquisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }));
  },
  async get(acquisitionId, accessToken) {
    return parseResponse<AcquisitionPublicRecord>(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}`, {
      headers: { 'x-acquisition-demo-token': accessToken },
    }));
  },
  async refresh(acquisitionId, accessToken) {
    return parseResponse<BrowserReadResult>(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}/refresh`, {
      method: 'POST',
      headers: { 'x-acquisition-demo-token': accessToken },
    }));
  },
  async handoff(acquisitionId, accessToken) {
    return parseResponse(await fetcher(`/api/acquisitions/${encodeURIComponent(acquisitionId)}/control`, { method: 'POST', headers: { 'x-acquisition-demo-token': accessToken } }));
  },
  async getControl(controlSessionId, accessToken) {
    return parseResponse(await fetcher(`/api/control-sessions/${encodeURIComponent(controlSessionId)}`, { headers: { 'x-acquisition-demo-token': accessToken } }));
  },
  async review(controlSessionId, accessToken, action) {
    return parseResponse(await fetcher(`/api/control-sessions/${encodeURIComponent(controlSessionId)}/review`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-demo-token': accessToken }, body: JSON.stringify({ action }) }));
  },
});

export const ACQUISITION_V1_OBJECTIVE = OPERATOR_SANDBOX_OBJECTIVE;
export const ACQUISITION_V1_CONTEXT = operatorSandboxContext();

export const createBrowserAcquisitionRequest = (input: Readonly<{
  identity: string;
  createdAt: string;
  accessToken: string;
  phoneNumber: string;
}>): BrowserAcquisitionCreateInput => ({
  acquisitionId: `ACQ-BROWSER-V1-${input.identity}`,
  clientToken: input.accessToken,
  authorizationConfirmed: true,
  phoneNumber: input.phoneNumber,
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

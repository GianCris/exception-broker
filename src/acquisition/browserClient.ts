import type { AcquisitionPublicRecord } from './contracts.js';

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
});

export const ACQUISITION_V1_OBJECTIVE = 'Obtain exactly one explicit decision about the controlled synthetic proposal.';
export const ACQUISITION_V1_CONTEXT = 'Controlled sandbox context only. Return APPROVED, REJECTED, PENDING, or NEEDS_CLARIFICATION. No real customer authority, operational truth, or external effect is established.';

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
    caseId: 'CASE-ACQUISITION-V1-SANDBOX',
    planId: 'PLAN-ACQUISITION-V1-SANDBOX',
    actorId: 'ACTOR-ACQUISITION-V1-CLIENT',
    actorRole: 'client',
    objective: ACQUISITION_V1_OBJECTIVE,
    context: ACQUISITION_V1_CONTEXT,
    expectedDecisionSchema: { name: 'exception-broker-phone-decision', version: 1 },
    createdAt: input.createdAt,
  },
});

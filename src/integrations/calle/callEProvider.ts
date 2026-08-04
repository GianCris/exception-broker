import {
  CalleAPIError,
  CalleAuthenticationError,
  CalleClient,
  CalleConnectionError,
  CalleRateLimitError,
  CalleTimeoutError,
  type CreateCallInput,
} from '@call-e/calle';

import {
  ProviderOperationalError,
  type CallProvider,
  type ProviderOperationalErrorKind,
} from './provider.js';
import type { CallRequest } from './types.js';

type CreateAndWaitOptions = Readonly<{
  idempotencyKey: string;
}>;

export interface CallEClientPort {
  readonly calls: Readonly<{
    createAndWait(input: CreateCallInput, options: CreateAndWaitOptions): Promise<unknown>;
  }>;
}

export type CallEClientFactory = (apiKey: string) => CallEClientPort;
export type CalleApiKeySource = () => string | undefined;

export type CallEProviderOptions = Readonly<{
  apiKeySource?: CalleApiKeySource;
  clientFactory?: CallEClientFactory;
}>;

const decisionValues = ['APPROVED', 'REJECTED', 'PENDING', 'NEEDS_CLARIFICATION'] as const;

export const buildCallEInput = (request: CallRequest): CreateCallInput => ({
  task: [
    request.objective,
    '',
    'Decision context:',
    request.context,
    '',
    'Return only an explicit decision supported by the call evidence.',
  ].join('\n'),
  recipients: [{ phones: [request.phoneNumber] }],
  resultSchema: {
    type: 'object',
    required: [
      'decision',
      'actorId',
      'actorRole',
      'caseId',
      'planId',
      'summary',
      'authorizationChanges',
      'clarificationNeeded',
    ],
    properties: {
      decision: {
        type: 'string',
        enum: [...decisionValues],
        description: 'Use only the explicit decision supported by the call evidence.',
      },
      actorId: { type: 'string', enum: [request.actorId] },
      actorRole: { type: 'string', enum: [request.actorRole] },
      caseId: { type: 'string', enum: [request.caseId] },
      planId: request.planId === undefined
        ? { type: 'string', description: 'The plan identifier explicitly discussed during the call.' }
        : { type: 'string', enum: [request.planId] },
      summary: { type: 'string', description: 'A concise summary supported by the call evidence.' },
      authorizationChanges: {
        type: 'array',
        description: 'Explicit numeric authorization changes proposed during the call, or an empty array.',
        items: {
          type: 'object',
          required: ['field', 'newValue'],
          properties: {
            field: { type: 'string' },
            previousValue: {
              type: 'number',
              description: 'Untrusted external recollection; the internal system remains authoritative.',
            },
            newValue: { type: 'number' },
            reason: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      clarificationNeeded: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  metadata: {
    request_id: request.requestId,
    case_id: request.caseId,
    actor_id: request.actorId,
    ...(request.planId === undefined ? {} : { plan_id: request.planId }),
  },
});

const defaultApiKeySource: CalleApiKeySource = () => process.env.CALLE_API_KEY;
const defaultClientFactory: CallEClientFactory = (apiKey) => new CalleClient({ apiKey });

const operationalKindForSdkError = (error: unknown): ProviderOperationalErrorKind | undefined => {
  if (error instanceof CalleTimeoutError) return 'TIMEOUT';
  if (error instanceof CalleAuthenticationError) return 'AUTHENTICATION_FAILED';
  if (error instanceof CalleRateLimitError) return 'TEMPORARILY_UNAVAILABLE';
  if (error instanceof CalleConnectionError) return 'NETWORK_FAILURE';
  if (error instanceof SyntaxError) return 'UNREADABLE_RESPONSE';
  if (error instanceof CalleAPIError) {
    if (error.code === 'unauthorized' || error.code === 'forbidden' || error.status === 401 || error.status === 403) {
      return 'AUTHENTICATION_FAILED';
    }
    if (error.code === 'provider_unavailable' || error.code === 'internal_error' || error.status >= 500) {
      return 'TEMPORARILY_UNAVAILABLE';
    }
    return 'OPERATION_REJECTED';
  }
  return undefined;
};

export class CallEProvider implements CallProvider {
  readonly #apiKeySource: CalleApiKeySource;
  readonly #clientFactory: CallEClientFactory;

  constructor(options: CallEProviderOptions = {}) {
    this.#apiKeySource = options.apiKeySource ?? defaultApiKeySource;
    this.#clientFactory = options.clientFactory ?? defaultClientFactory;
  }

  async executeCall(request: CallRequest): Promise<unknown> {
    const apiKey = this.#apiKeySource();
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new ProviderOperationalError('CONFIGURATION_MISSING');
    }

    try {
      const client = this.#clientFactory(apiKey);
      return await client.calls.createAndWait(
        buildCallEInput(request),
        { idempotencyKey: request.requestId },
      );
    } catch (error: unknown) {
      const operationalKind = operationalKindForSdkError(error);
      if (operationalKind !== undefined) throw new ProviderOperationalError(operationalKind);
      throw error;
    }
  }
}

import { mapCalleResponse } from './mapper.js';
import { ProviderOperationalError, type CallProvider } from './provider.js';
import type { CallMappingResult, CallRequest } from './types.js';

export const executeCall = async (
  provider: CallProvider,
  request: CallRequest,
  receivedAt: string | (() => string),
): Promise<CallMappingResult> => {
  try {
    const providerRequest = structuredClone(request);
    const externalResponse: unknown = await provider.executeCall(providerRequest);
    const resolvedReceivedAt = typeof receivedAt === 'function' ? receivedAt() : receivedAt;
    return mapCalleResponse(request, externalResponse, resolvedReceivedAt);
  } catch (error: unknown) {
    if (error instanceof ProviderOperationalError) {
      return {
        success: false,
        reason: error.message,
        retryable: error.retryable,
        issues: [`Provider operational error: ${error.kind}`],
      };
    }

    throw error;
  }
};

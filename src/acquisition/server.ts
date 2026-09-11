import { CalleAcquisitionGateway } from './calleGateway.js';
import { AcquisitionAccessService } from './access.js';
import { acquisitionGuardPolicyFromEnvironment } from './guardrails.js';
import { createAcquisitionHttpHandler } from './http.js';
import { AcquisitionService } from './service.js';
import { JsonFileAcquisitionStore } from './store.js';
import { LiveControlService } from '../control/service.js';
import { JsonFileLiveControlStore } from '../control/store.js';

export type ProductionAcquisitionOptions = Readonly<{
  storePath: string;
  environment?: NodeJS.ProcessEnv;
}>;

export const createProductionAcquisitionHandler = (options: ProductionAcquisitionOptions) => {
  const environment = options.environment ?? process.env;
  const configuredTtl = environment.ACQUISITION_CONNECTION_IDLE_TTL_MS;
  const ttl = configuredTtl === undefined || configuredTtl.trim() === '' ? Number.NaN : Number(configuredTtl);
  const access = new AcquisitionAccessService({
    hostedApiKeySource: () => environment.CALLE_API_KEY,
    ...(Number.isSafeInteger(ttl) && ttl >= 0 ? { idleTtlMs: ttl } : {}),
  });
  const policy = acquisitionGuardPolicyFromEnvironment(environment);
  policy.allowedClientTokens.forEach((token) => access.registerHostedCapability(token));
  const acquisitionStore = new JsonFileAcquisitionStore(options.storePath);
  const service = new AcquisitionService({
    store: acquisitionStore,
    gateway: new CalleAcquisitionGateway((connectionId) => connectionId === undefined ? undefined : access.resolveApiKey(connectionId)),
    policy: { ...policy, isClientAllowed: (connectionId) => access.has(connectionId) },
    onConnectionActiveChange: (connectionId, active) => access.markActive(connectionId, active),
  });
  const controls = new LiveControlService({ acquisitions: service, store: new JsonFileLiveControlStore(`${options.storePath}.controls.json`) });
  return createAcquisitionHttpHandler(service, controls, access, environment.ACQUISITION_HOSTED_RECIPIENT === undefined ? {} : { hostedRecipient: environment.ACQUISITION_HOSTED_RECIPIENT });
};

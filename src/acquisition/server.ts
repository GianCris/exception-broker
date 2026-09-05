import { CalleAcquisitionGateway } from './calleGateway.js';
import { acquisitionGuardPolicyFromEnvironment } from './guardrails.js';
import { createAcquisitionHttpHandler } from './http.js';
import { AcquisitionService } from './service.js';
import { JsonFileAcquisitionStore } from './store.js';

export type ProductionAcquisitionOptions = Readonly<{
  storePath: string;
  environment?: NodeJS.ProcessEnv;
}>;

export const createProductionAcquisitionHandler = (options: ProductionAcquisitionOptions) => {
  const environment = options.environment ?? process.env;
  const service = new AcquisitionService({
    store: new JsonFileAcquisitionStore(options.storePath),
    gateway: new CalleAcquisitionGateway(() => environment.CALLE_API_KEY),
    policy: acquisitionGuardPolicyFromEnvironment(environment),
  });
  return createAcquisitionHttpHandler(service);
};

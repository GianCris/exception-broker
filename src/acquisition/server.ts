import { CalleAcquisitionGateway } from './calleGateway.js';
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
  const acquisitionStore = new JsonFileAcquisitionStore(options.storePath);
  const service = new AcquisitionService({
    store: acquisitionStore,
    gateway: new CalleAcquisitionGateway(() => environment.CALLE_API_KEY),
    policy: acquisitionGuardPolicyFromEnvironment(environment),
  });
  const controls = new LiveControlService({ acquisitions: service, store: new JsonFileLiveControlStore(`${options.storePath}.controls.json`) });
  return createAcquisitionHttpHandler(service, controls);
};

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createNodeAcquisitionListener } from '../src/acquisition/nodeHttp.js';
import { createProductionAcquisitionHandler } from '../src/acquisition/server.js';

const serverPort = (value: string | undefined): number => {
  const parsed = Number(value ?? '8787');
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('Invalid ACQUISITION_SERVER_PORT');
  return parsed;
};

export const startAcquisitionServer = (environment: NodeJS.ProcessEnv = process.env) => {
  const port = serverPort(environment.ACQUISITION_SERVER_PORT);
  const host = environment.ACQUISITION_SERVER_HOST ?? '127.0.0.1';
  const storePath = resolve(environment.ACQUISITION_STORE_PATH ?? '.acquisition-data/acquisitions.json');
  const staticRoot = resolve(environment.ACQUISITION_STATIC_ROOT ?? 'dist');
  const handler = createProductionAcquisitionHandler({ storePath, environment });
  const server = createServer(createNodeAcquisitionListener(handler, { staticRoot }));
  server.listen(port, host, () => {
    process.stdout.write(`Exception Broker acquisition server listening on http://${host}:${port}\n`);
    process.stdout.write(`Live acquisition policy: ${environment.ACQUISITION_LIVE_ENABLED === 'true' ? 'explicitly enabled' : 'disabled'}\n`);
  });
  return server;
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    startAcquisitionServer();
  } catch {
    process.stderr.write('Acquisition server configuration is invalid; no server started.\n');
    process.exitCode = 1;
  }
}

import type { Call, CreateCallInput } from '@call-e/calle';
import { describe, expect, it, vi } from 'vitest';

import { AcquisitionAccessService } from '../../src/acquisition/access.js';
import { CalleAcquisitionGateway } from '../../src/acquisition/calleGateway.js';
import { createAcquisitionHttpHandler } from '../../src/acquisition/http.js';
import type { AcquisitionService } from '../../src/acquisition/service.js';

const ids = () => {
  const values = ['HOSTED-CONNECTION', 'BYOK-CONNECTION'];
  return () => values.shift() ?? 'EXTRA-CONNECTION';
};

describe('Acquisition connection boundary', () => {
  it('keeps hosted and BYOK credentials only behind opaque server-side connections', () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    const hosted = access.connectHosted();
    const byok = access.connectByok('BYOK-SECRET');
    expect(hosted).toEqual({ connectionId: 'HOSTED-CONNECTION', kind: 'HOSTED_DEMO', connected: true });
    expect(byok).toEqual({ connectionId: 'BYOK-CONNECTION', kind: 'BYOK', connected: true });
    expect(JSON.stringify({ hosted, byok })).not.toMatch(/HOSTED-SECRET|BYOK-SECRET/);
    expect(access.resolveApiKey('HOSTED-CONNECTION')).toBe('HOSTED-SECRET');
    expect(access.resolveApiKey('BYOK-CONNECTION')).toBe('BYOK-SECRET');
    expect(access.connectHosted('HOSTED-CONNECTION')).toEqual(hosted);
  });

  it('disconnect removes ephemeral BYOK access and never falls back to hosted credentials', () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    const byok = access.connectByok('BYOK-SECRET')!;
    expect(access.disconnect(byok.connectionId)).toBe(true);
    expect(access.resolveApiKey(byok.connectionId)).toBeUndefined();
    expect(access.get(byok.connectionId)).toBeUndefined();
  });

  it('uses a fresh client resolved for the exact connection on create and refresh', async () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    const hosted = access.connectHosted()!;
    const byok = access.connectByok('BYOK-SECRET')!;
    const keys: string[] = [];
    const returned = { id: 'CALL', status: 'queued' } as Call;
    const gateway = new CalleAcquisitionGateway((connectionId) => access.resolveApiKey(connectionId ?? ''), (key) => {
      keys.push(key);
      return { calls: { create: vi.fn(async () => returned), get: vi.fn(async () => returned) } };
    });
    await gateway.create({ task: 'same acquisition flow', recipients: [] } as CreateCallInput, 'IDEMPOTENCY', hosted.connectionId);
    await gateway.get('CALL', byok.connectionId);
    expect(keys).toEqual(['HOSTED-SECRET', 'BYOK-SECRET']);
  });

  it('never returns a BYOK key from the server connection API', async () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    const handler = createAcquisitionHttpHandler({} as AcquisitionService, undefined, access);
    const response = await handler(new Request('http://local/api/acquisition-access/byok', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'BYOK-SECRET' }),
    }));
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain('BYOK-SECRET');
  });
});

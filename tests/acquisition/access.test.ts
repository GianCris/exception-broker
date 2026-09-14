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

  it('expires only idle connections and keeps active provider access recoverable', () => {
    let time = 1_000;
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids(), clock: () => time, idleTtlMs: 100 });
    const active = access.connectByok('BYOK-ACTIVE')!;
    const idle = access.connectByok('BYOK-IDLE')!;
    access.markActive(active.connectionId, true);
    time += 101;
    expect(access.resolveApiKey(active.connectionId)).toBe('BYOK-ACTIVE');
    expect(access.resolveApiKey(idle.connectionId)).toBeUndefined();
    expect(access.disconnect(active.connectionId)).toBe(false);
    expect(access.resolveApiKey(active.connectionId)).toBe('BYOK-ACTIVE');
    access.markActive(active.connectionId, false);
    time += 101;
    expect(access.resolveApiKey(active.connectionId)).toBeUndefined();
  });

  it('derives create authority, access mode, and Hosted destination only from server connection state', async () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    const hosted = access.connectHosted()!;
    const create = vi.fn(async () => ({ accepted: false, code: 'INVALID_INPUT', reason: 'captured' }) as const);
    const handler = createAcquisitionHttpHandler({ create } as unknown as AcquisitionService, undefined, access, { hostedRecipient: '+12025550199' });
    await handler(new Request('http://local/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-connection': hosted.connectionId },
      body: JSON.stringify({ clientToken: 'ATTACKER', accessMode: 'BYOK', phoneNumber: '+12025550123' }),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      clientToken: hosted.connectionId,
      accessMode: 'HOSTED_DEMO',
      phoneNumber: '+12025550199',
    }));

    const byok = access.connectByok('BYOK-SECRET')!;
    await handler(new Request('http://local/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-connection': byok.connectionId },
      body: JSON.stringify({ clientToken: 'ATTACKER', accessMode: 'HOSTED_DEMO', phoneNumber: '+12025550123' }),
    }));
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({
      clientToken: byok.connectionId,
      accessMode: 'BYOK',
      phoneNumber: '+12025550123',
    }));
  });

  it('fails Hosted access closed when its server-owned recipient is unavailable', async () => {
    const key = vi.fn(() => 'HOSTED-SECRET');
    const access = new AcquisitionAccessService({ hostedApiKeySource: key, createConnectionId: ids() });
    const handler = createAcquisitionHttpHandler({} as AcquisitionService, undefined, access);
    const response = await handler(new Request('http://local/api/acquisition-access/hosted', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ connected: false, code: 'HOSTED_ACCESS_UNAVAILABLE' });
    expect(key).not.toHaveBeenCalled();
  });

  it('classifies legacy compatibility capabilities as Hosted without restoring an arbitrary-recipient bypass', async () => {
    const access = new AcquisitionAccessService({ hostedApiKeySource: () => 'HOSTED-SECRET', createConnectionId: ids() });
    access.registerHostedCapability('LEGACY-CAPABILITY');
    const create = vi.fn(async () => ({ accepted: false, code: 'INVALID_INPUT', reason: 'captured' }) as const);
    const handler = createAcquisitionHttpHandler({ create } as unknown as AcquisitionService, undefined, access, { hostedRecipient: '+12025550199' });
    await handler(new Request('http://local/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-demo-token': 'LEGACY-CAPABILITY' },
      body: JSON.stringify({ accessMode: 'BYOK', clientToken: 'OTHER', phoneNumber: '+12025550123' }),
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      accessMode: 'HOSTED_DEMO',
      clientToken: 'LEGACY-CAPABILITY',
      phoneNumber: '+12025550199',
    }));

    const denied = await handler(new Request('http://local/api/acquisitions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-acquisition-demo-token': 'UNKNOWN-CAPABILITY' }, body: '{}',
    }));
    expect(denied.status).toBe(403);
    expect(create).toHaveBeenCalledOnce();
  });
});

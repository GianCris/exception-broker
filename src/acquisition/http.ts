import type { AcquisitionService } from './service.js';
import { toPublicAcquisitionRecord } from './contracts.js';
import type { LiveControlService } from '../control/service.js';
import type { AcquisitionAccessService } from './access.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export type AcquisitionHttpHandler = (request: Request) => Promise<Response>;
export type AcquisitionHttpOptions = Readonly<{ hostedRecipient?: string }>;

export const createAcquisitionHttpHandler = (service: AcquisitionService, controls?: LiveControlService, access?: AcquisitionAccessService, options: AcquisitionHttpOptions = {}): AcquisitionHttpHandler => async (request) => {
  const url = new URL(request.url);
  const clientToken = request.headers.get('x-acquisition-connection') ?? request.headers.get('x-acquisition-demo-token') ?? '';
  const match = /^\/api\/acquisitions\/([^/]+)$/.exec(url.pathname);
  const pollMatch = /^\/api\/acquisitions\/([^/]+)\/poll$/.exec(url.pathname);
  const refreshMatch = /^\/api\/acquisitions\/([^/]+)\/refresh$/.exec(url.pathname);
  const controlMatch = /^\/api\/acquisitions\/([^/]+)\/control$/.exec(url.pathname);
  const controlReadMatch = /^\/api\/control-sessions\/([^/]+)$/.exec(url.pathname);
  const reviewMatch = /^\/api\/control-sessions\/([^/]+)\/review$/.exec(url.pathname);

  if (access !== undefined && request.method === 'POST' && url.pathname === '/api/acquisition-access/hosted') {
    if (options.hostedRecipient === undefined || !/^\+[1-9]\d{7,14}$/.test(options.hostedRecipient)) {
      return json({ connected: false, code: 'HOSTED_ACCESS_UNAVAILABLE' }, 503);
    }
    const connection = access.connectHosted(clientToken || undefined);
    return connection === undefined
      ? json({ connected: false, code: 'HOSTED_ACCESS_UNAVAILABLE' }, 503)
      : json(connection, 201);
  }
  if (access !== undefined && request.method === 'POST' && url.pathname === '/api/acquisition-access/byok') {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ connected: false, code: 'INVALID_INPUT' }, 400); }
    const apiKey = typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 1 && 'apiKey' in body && typeof body.apiKey === 'string'
      ? body.apiKey
      : '';
    const connection = access.connectByok(apiKey);
    return connection === undefined
      ? json({ connected: false, code: 'INVALID_INPUT' }, 400)
      : json(connection, 201);
  }
  if (access !== undefined && request.method === 'GET' && url.pathname === '/api/acquisition-access') {
    const connection = access.get(clientToken);
    return connection === undefined ? json({ connected: false, code: 'CONNECTION_NOT_FOUND' }, 404) : json(connection);
  }
  if (access !== undefined && request.method === 'DELETE' && url.pathname === '/api/acquisition-access') {
    if (access.get(clientToken) === undefined) return json({ connected: false, code: 'CONNECTION_NOT_FOUND' }, 404);
    return access.disconnect(clientToken)
      ? json({ connected: false })
      : json({ connected: true, code: 'CONNECTION_ACTIVE' }, 409);
  }

  if (request.method === 'GET' && url.pathname === '/api/acquisitions/active') {
    if (clientToken === '') return json({ found: false, code: 'NOT_FOUND' }, 404);
    const active = await service.getActive(clientToken);
    return active === undefined ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } }) : json(toPublicAcquisitionRecord(active));
  }

  if (controls !== undefined && request.method === 'POST' && controlMatch !== null) {
    const result = await controls.create(decodeURIComponent(controlMatch[1] ?? ''), clientToken);
    return result.accepted ? json(result, result.existing ? 200 : 201) : json(result, result.code === 'NOT_FOUND' ? 404 : 409);
  }
  if (controls !== undefined && request.method === 'GET' && controlReadMatch !== null) {
    const result = await controls.get(decodeURIComponent(controlReadMatch[1] ?? ''), clientToken);
    return result.accepted ? json(result) : json(result, 404);
  }
  if (controls !== undefined && request.method === 'POST' && reviewMatch !== null) {
    let body: unknown;
    try { body = await request.json(); } catch { return json({ accepted: false, code: 'REVIEW_CONFLICT', reason: 'Review body must be JSON' }, 400); }
    const keys = typeof body === 'object' && body !== null && !Array.isArray(body) ? Object.keys(body) : [];
    if (keys.length !== 1 || keys[0] !== 'action') return json({ accepted: false, code: 'REVIEW_CONFLICT', reason: 'Review accepts only action intent' }, 400);
    const result = await controls.review(decodeURIComponent(reviewMatch[1] ?? ''), clientToken, (body as { action?: unknown }).action);
    return result.accepted ? json(result) : json(result, result.code === 'NOT_FOUND' ? 404 : 409);
  }

  if (request.method === 'POST' && url.pathname === '/api/acquisitions') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ accepted: false, code: 'INVALID_INPUT', reason: 'Request body must be JSON' }, 400);
    }
    let trustedInput = body;
    if (access !== undefined) {
      const connection = access.get(clientToken);
      if (connection === undefined) return json({ accepted: false, code: 'CLIENT_NOT_ALLOWED', reason: 'CALL-E connection is unavailable' }, 403);
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ accepted: false, code: 'INVALID_INPUT', reason: 'Invalid acquisition request' }, 400);
      const browser = body as Record<string, unknown>;
      const phoneNumber = connection.kind === 'HOSTED_DEMO' ? options.hostedRecipient : browser.phoneNumber;
      if (connection.kind === 'HOSTED_DEMO' && (typeof phoneNumber !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phoneNumber))) {
        return json({ accepted: false, code: 'RECIPIENT_NOT_ALLOWED', reason: 'Hosted synthetic destination is unavailable' }, 503);
      }
      trustedInput = { ...browser, clientToken: connection.connectionId, accessMode: connection.kind, phoneNumber };
    }
    const result = await service.create(trustedInput);
    return result.accepted
      ? json({ ...result, record: toPublicAcquisitionRecord(result.record) }, result.existing ? 200 : 201)
      : json(result, result.code === 'INVALID_INPUT' ? 400 : 403);
  }

  if (request.method === 'POST' && pollMatch !== null) {
    const result = await service.poll(decodeURIComponent(pollMatch[1] ?? ''), clientToken);
    return result.found
      ? json({ ...result, record: toPublicAcquisitionRecord(result.record) })
      : json(result, result.code === 'NOT_FOUND' ? 404 : 503);
  }

  if (request.method === 'POST' && refreshMatch !== null) {
    const result = await service.refresh(decodeURIComponent(refreshMatch[1] ?? ''), clientToken);
    return result.found
      ? json({ ...result, record: toPublicAcquisitionRecord(result.record) })
      : json(result, result.code === 'NOT_FOUND' ? 404 : 503);
  }

  if (request.method === 'GET' && match !== null) {
    const record = await service.get(decodeURIComponent(match[1] ?? ''), clientToken);
    return record === undefined ? json({ found: false, code: 'NOT_FOUND' }, 404) : json(toPublicAcquisitionRecord(record));
  }

  return json({ code: 'NOT_FOUND' }, 404);
};

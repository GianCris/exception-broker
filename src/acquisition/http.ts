import type { AcquisitionService } from './service.js';
import { toPublicAcquisitionRecord } from './contracts.js';
import type { LiveControlService } from '../control/service.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export type AcquisitionHttpHandler = (request: Request) => Promise<Response>;

export const createAcquisitionHttpHandler = (service: AcquisitionService, controls?: LiveControlService): AcquisitionHttpHandler => async (request) => {
  const url = new URL(request.url);
  const clientToken = request.headers.get('x-acquisition-demo-token') ?? '';
  const match = /^\/api\/acquisitions\/([^/]+)$/.exec(url.pathname);
  const pollMatch = /^\/api\/acquisitions\/([^/]+)\/poll$/.exec(url.pathname);
  const refreshMatch = /^\/api\/acquisitions\/([^/]+)\/refresh$/.exec(url.pathname);
  const controlMatch = /^\/api\/acquisitions\/([^/]+)\/control$/.exec(url.pathname);
  const controlReadMatch = /^\/api\/control-sessions\/([^/]+)$/.exec(url.pathname);
  const reviewMatch = /^\/api\/control-sessions\/([^/]+)\/review$/.exec(url.pathname);

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
    const result = await service.create(body);
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

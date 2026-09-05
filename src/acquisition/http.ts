import type { AcquisitionService } from './service.js';
import { toPublicAcquisitionRecord } from './contracts.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export type AcquisitionHttpHandler = (request: Request) => Promise<Response>;

export const createAcquisitionHttpHandler = (service: AcquisitionService): AcquisitionHttpHandler => async (request) => {
  const url = new URL(request.url);
  const clientToken = request.headers.get('x-acquisition-demo-token') ?? '';
  const match = /^\/api\/acquisitions\/([^/]+)$/.exec(url.pathname);
  const pollMatch = /^\/api\/acquisitions\/([^/]+)\/poll$/.exec(url.pathname);
  const refreshMatch = /^\/api\/acquisitions\/([^/]+)\/refresh$/.exec(url.pathname);

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

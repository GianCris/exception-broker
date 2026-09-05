import { readFile, stat } from 'node:fs/promises';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import type { AcquisitionHttpHandler } from './http.js';

const maximumBodyBytes = 64 * 1024;

const webHeaders = (headers: IncomingHttpHeaders): Headers => {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
};

const readBody = async (request: IncomingMessage): Promise<string | undefined> => {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBodyBytes) throw new RangeError('Request body exceeds acquisition limit');
    chunks.push(buffer);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8');
};

export const nodeRequestToWebRequest = async (request: IncomingMessage): Promise<Request> => {
  const method = request.method ?? 'GET';
  const body = await readBody(request);
  return new Request(new URL(request.url ?? '/', 'http://acquisition.local'), {
    method,
    headers: webHeaders(request.headers),
    ...(body === undefined ? {} : { body }),
  });
};

export const writeWebResponse = async (source: Response, target: ServerResponse): Promise<void> => {
  target.statusCode = source.status;
  source.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await source.arrayBuffer()));
};

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const serveStatic = async (request: IncomingMessage, response: ServerResponse, staticRoot: string): Promise<void> => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.end('Method Not Allowed');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://acquisition.local').pathname);
  } catch {
    response.statusCode = 400;
    response.end('Bad Request');
    return;
  }
  const root = resolve(staticRoot);
  const requested = resolve(root, `.${pathname}`);
  const pathFromRoot = relative(root, requested);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    response.statusCode = 404;
    response.end('Not Found');
    return;
  }

  let filePath = pathname === '/' ? resolve(root, 'index.html') : requested;
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
  } catch {
    if (extname(pathname) !== '') {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    filePath = resolve(root, 'index.html');
  }

  try {
    const contents = await readFile(filePath);
    response.statusCode = 200;
    response.setHeader('content-type', contentTypes[extname(filePath)] ?? 'application/octet-stream');
    response.setHeader('cache-control', extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600');
    response.end(request.method === 'HEAD' ? undefined : contents);
  } catch {
    response.statusCode = 404;
    response.end('Not Found');
  }
};

export type NodeAcquisitionListenerOptions = Readonly<{ staticRoot?: string }>;

export const createNodeAcquisitionListener = (
  handler: AcquisitionHttpHandler,
  options: NodeAcquisitionListenerOptions = {},
) => async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  try {
    const pathname = new URL(request.url ?? '/', 'http://acquisition.local').pathname;
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      await writeWebResponse(await handler(await nodeRequestToWebRequest(request)), response);
      return;
    }
    if (options.staticRoot !== undefined) {
      await serveStatic(request, response, options.staticRoot);
      return;
    }
    response.statusCode = 404;
    response.end('Not Found');
  } catch (error: unknown) {
    response.statusCode = error instanceof RangeError ? 413 : 500;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ code: error instanceof RangeError ? 'REQUEST_TOO_LARGE' : 'SERVER_FAILURE' }));
  }
};

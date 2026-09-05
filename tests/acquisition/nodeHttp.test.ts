import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AcquisitionHttpHandler } from '../../src/acquisition/http.js';
import { createNodeAcquisitionListener } from '../../src/acquisition/nodeHttp.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const request = (method: string, url: string, body?: string, headers: Record<string, string> = {}): IncomingMessage => {
  const stream = Readable.from(body === undefined ? [] : [body]) as IncomingMessage;
  Object.assign(stream, { method, url, headers });
  return stream;
};

const response = () => {
  const headers = new Map<string, string | number | readonly string[]>();
  let body = Buffer.alloc(0);
  const target = {
    statusCode: 0,
    setHeader: vi.fn((name: string, value: string | number | readonly string[]) => { headers.set(name, value); return target; }),
    end: vi.fn((chunk?: string | Uint8Array) => { body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk); return target; }),
  } as unknown as ServerResponse;
  return { target, headers, body: () => body.toString('utf8') };
};

describe('Node acquisition HTTP runtime adapter', () => {
  it('translates a Node /api request to the existing Web handler and writes its response', async () => {
    const handler = vi.fn<AcquisitionHttpHandler>(async (webRequest) => {
      expect(webRequest.method).toBe('POST');
      expect(new URL(webRequest.url).pathname).toBe('/api/acquisitions/ACQ-001/refresh');
      expect(webRequest.headers.get('x-acquisition-demo-token')).toBe('inert-token');
      expect(await webRequest.json()).toEqual({ refresh: true });
      return new Response(JSON.stringify({ routed: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    });
    const output = response();
    await createNodeAcquisitionListener(handler)(
      request('POST', '/api/acquisitions/ACQ-001/refresh', JSON.stringify({ refresh: true }), {
        'content-type': 'application/json', 'x-acquisition-demo-token': 'inert-token',
      }),
      output.target,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(output.target.statusCode).toBe(202);
    expect(output.body()).toBe('{"routed":true}');
  });

  it('does not route a non-api request to acquisition logic', async () => {
    const handler = vi.fn<AcquisitionHttpHandler>();
    const output = response();
    await createNodeAcquisitionListener(handler)(request('GET', '/not-api'), output.target);
    expect(handler).not.toHaveBeenCalled();
    expect(output.target.statusCode).toBe(404);
  });

  it('serves the built frontend and SPA fallback without importing acquisition code into it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'exception-broker-static-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'index.html'), '<main>local frontend</main>', 'utf8');
    const handler = vi.fn<AcquisitionHttpHandler>();
    const output = response();
    await createNodeAcquisitionListener(handler, { staticRoot: directory })(request('GET', '/case/ACQ-001'), output.target);
    expect(handler).not.toHaveBeenCalled();
    expect(output.target.statusCode).toBe(200);
    expect(output.body()).toBe('<main>local frontend</main>');
  });

  it('fails closed before the Web handler when the request body exceeds its bound', async () => {
    const handler = vi.fn<AcquisitionHttpHandler>();
    const output = response();
    await createNodeAcquisitionListener(handler)(request('POST', '/api/acquisitions', 'x'.repeat(65 * 1024)), output.target);
    expect(handler).not.toHaveBeenCalled();
    expect(output.target.statusCode).toBe(413);
    expect(JSON.parse(output.body())).toEqual({ code: 'REQUEST_TOO_LARGE' });
  });

  it('wires only /api to the local server in Vite without client credential configuration', async () => {
    const vite = await readFile('vite.config.ts', 'utf8');
    expect(vite).toContain("'/api'");
    expect(vite).toContain('http://127.0.0.1:');
    expect(vite).toContain('ACQUISITION_SERVER_PORT');
    expect(vite).not.toMatch(/CALLE_API_KEY|VITE_.*TOKEN|VITE_.*PHONE/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, type TestServer } from '../support/harness.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); });

describe('owner web dashboard', () => {
  it('serves the page without a sign-in, with a strict content policy, and keeps it out of the API description', async () => {
    const res = await fetch(`${server.base}/owner`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain('Business at a glance');
    const spec = await call(server, 'GET', '/v1/meta');
    expect(spec.status).toBe(200);
  });
});

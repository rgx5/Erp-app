import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, type TestServer } from '../support/harness.js';

let open: TestServer;
let closed: TestServer;
beforeAll(async () => {
  open = await startServer({ CORS_ALLOWED_ORIGINS: 'app://onesync, https://erp.example.com', SELF_SIGNUP_ENABLED: 'true' });
  closed = await startServer();
});
afterAll(async () => { await open.close(); await closed.close(); });

describe('GET /v1/meta', () => {
  it('identifies the server without a sign-in', async () => {
    const res = await call(closed, 'GET', '/v1/meta');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ app: 'onesync-erp', apiVersion: 'v1', auth: { passwordLogin: true, mfa: true, apiKeys: true, selfSignup: false } });
    expect((await call(open, 'GET', '/v1/meta')).json).toMatchObject({ auth: { selfSignup: true } });
  });
});

describe('CORS', () => {
  const preflight = (s: TestServer, origin: string) => fetch(`${s.base}/v1/auth/login`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,idempotency-key,approval-id,if-match' } });

  it('answers the preflight for a listed origin and names the headers the client uses', async () => {
    const res = await preflight(open, 'app://onesync');
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get('access-control-allow-origin')).toBe('app://onesync');
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    for (const h of ['authorization', 'idempotency-key', 'approval-id', 'if-match']) expect(allowed).toContain(h);
  });

  it('marks real responses for a listed origin and exposes the request id', async () => {
    const res = await fetch(`${open.base}/v1/meta`, { headers: { origin: 'https://erp.example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://erp.example.com');
    expect((res.headers.get('access-control-expose-headers') ?? '').toLowerCase()).toContain('x-request-id');
  });

  it('never allows an origin that is not listed, and is off when nothing is configured', async () => {
    expect((await preflight(open, 'https://evil.example.com')).headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${open.base}/v1/meta`, { headers: { origin: 'https://evil.example.com' } })).headers.get('access-control-allow-origin')).toBeNull();
    expect((await preflight(closed, 'app://onesync')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

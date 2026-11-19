import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, PLATFORM_TOKEN, startServer, type TestServer } from '../support/harness.js';

let on: TestServer;
let off: TestServer;
beforeAll(async () => { on = await startServer({ DEMO_SEED_ENABLED: 'true' }); off = await startServer(); }, 60_000);
afterAll(async () => { await on.close(); await off.close(); });

describe('POST /v1/demo/seed', () => {
  it('is switched off (404) unless DEMO_SEED_ENABLED is true', async () => {
    expect((await call(off, 'POST', '/v1/demo/seed', { token: PLATFORM_TOKEN, body: {} })).status).toBe(404);
  });
  it('needs the platform token', async () => {
    expect((await call(on, 'POST', '/v1/demo/seed', { body: {} })).status).toBe(403);
    expect((await call(on, 'POST', '/v1/demo/seed', { token: 'x'.repeat(40), body: {} })).status).toBe(403);
  });
  it('fills a business with real data over HTTP, and does nothing the second time', async () => {
    const slug = `demo-${Date.now().toString(36)}`;
    const first = await call(on, 'POST', '/v1/demo/seed', { token: PLATFORM_TOKEN, body: { slug } });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ created: true, login: { businessCode: slug, password: 'demo-passphrase-2026' } });
    expect(first.json.invoices).toBeGreaterThan(30);
    const login = await call(on, 'POST', '/v1/auth/login', { body: { tenant: slug, email: `owner@${slug}.example.com`, password: 'demo-passphrase-2026' } });
    const token = login.json.accessToken as string;
    const company = (await call(on, 'GET', '/v1/companies', { token })).json.items[0].id as string;
    const dash = (await call(on, 'GET', `/v1/dashboard?companyId=${company}`, { token })).json;
    expect(Number(dash.yearToDate.revenue)).toBeGreaterThan(100_000);
    const second = await call(on, 'POST', '/v1/demo/seed', { token: PLATFORM_TOKEN, body: { slug } });
    expect(second.status).toBe(200); expect(second.json).toMatchObject({ created: false });
  }, 120_000);
  it('rejects a body it does not know', async () => {
    expect((await call(on, 'POST', '/v1/demo/seed', { token: PLATFORM_TOKEN, body: { drop: 'tables' } })).status).toBe(422);
  });
});
